import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type {
  BenchmarkScore,
  BenchLocalConfig,
  BenchLocalExecutionMode,
  BenchLocalPluginConfig,
  HostContext,
  PluginRunSummary,
  ProgressEvent,
  RegisteredModel,
  ScenarioMeta,
  ScenarioResult
} from "@benchlocal/core";
import { expandHomePath, type PluginInspection, type PluginManifest } from "@benchlocal/core";

export type PluginHostStatus = "idle" | "loading" | "ready" | "error";

export type LoadedPluginHandle = {
  pluginId: string;
  entryPath: string;
};

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveConfiguredPluginRoot(config: BenchLocalConfig, pluginId: string, plugin: BenchLocalPluginConfig): string | undefined {
  if (plugin.source === "local") {
    return plugin.path ? expandHomePath(plugin.path) : undefined;
  }

  if (plugin.source === "github" || plugin.source === "git") {
    return path.join(expandHomePath(config.plugin_storage_dir), pluginId);
  }

  return undefined;
}

function isPluginManifest(value: unknown): value is PluginManifest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.schemaVersion === 1 &&
    candidate.protocolVersion === 1 &&
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.version === "string" &&
    typeof candidate.entry === "string" &&
    typeof candidate.capabilities === "object" &&
    candidate.capabilities !== null
  );
}

async function readPluginManifest(rootDir: string): Promise<PluginManifest> {
  const manifestPath = path.join(rootDir, "benchlocal.plugin.json");
  const raw = await fs.readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!isPluginManifest(parsed)) {
    throw new Error("Invalid benchlocal.plugin.json manifest.");
  }

  return parsed;
}

function normalizePluginModule(module: Record<string, unknown>): Record<string, unknown> {
  let current: Record<string, unknown> = module;

  while (
    current.default &&
    typeof current.default === "object" &&
    current.default !== null &&
    typeof current.listScenarios !== "function"
  ) {
    current = current.default as Record<string, unknown>;
  }

  return current;
}

async function inspectPlugin(pluginId: string, config: BenchLocalConfig, pluginConfig: BenchLocalPluginConfig): Promise<PluginInspection> {
  const rootDir = resolveConfiguredPluginRoot(config, pluginId, pluginConfig);

  if (!rootDir) {
    return {
      id: pluginId,
      source: pluginConfig.source,
      status: "not_installed",
      error: "Plugin root could not be resolved from config."
    };
  }

  if (!(await pathExists(rootDir))) {
    return {
      id: pluginId,
      source: pluginConfig.source,
      rootDir,
      status: "not_installed",
      error: "Plugin install directory does not exist."
    };
  }

  const manifestPath = path.join(rootDir, "benchlocal.plugin.json");

  if (!(await pathExists(manifestPath))) {
    return {
      id: pluginId,
      source: pluginConfig.source,
      rootDir,
      status: "manifest_missing",
      error: "benchlocal.plugin.json is missing."
    };
  }

  let manifest: PluginManifest;

  try {
    manifest = await readPluginManifest(rootDir);
  } catch (error) {
    return {
      id: pluginId,
      source: pluginConfig.source,
      rootDir,
      status: "invalid_manifest",
      error: error instanceof Error ? error.message : "Failed to parse plugin manifest."
    };
  }

  const entryPath = path.resolve(rootDir, manifest.entry);

  if (!(await pathExists(entryPath))) {
    return {
      id: pluginId,
      source: pluginConfig.source,
      rootDir,
      status: "entry_missing",
      manifest,
      error: `Plugin entry is missing: ${entryPath}`
    };
  }

  try {
    const loaded = normalizePluginModule((await import(pathToFileURL(entryPath).href)) as Record<string, unknown>);
    const listScenarios = loaded.listScenarios;

    if (typeof listScenarios !== "function") {
      return {
        id: pluginId,
        source: pluginConfig.source,
        rootDir,
        status: "load_error",
        manifest,
        error: "Plugin entry does not export a listScenarios function."
      };
    }

    const scenarios = await (listScenarios as () => Promise<PluginInspection["scenarios"]>)();

    return {
      id: pluginId,
      source: pluginConfig.source,
      rootDir,
      status: "ready",
      manifest,
      scenarioCount: scenarios?.length ?? 0,
      scenarios
    };
  } catch (error) {
    return {
      id: pluginId,
      source: pluginConfig.source,
      rootDir,
      status: "load_error",
      manifest,
      error: error instanceof Error ? error.message : "Failed to load plugin entry."
    };
  }
}

export async function inspectConfiguredPlugins(config: BenchLocalConfig): Promise<PluginInspection[]> {
  return Promise.all(
    Object.entries(config.plugins).map(async ([pluginId, pluginConfig]) => inspectPlugin(pluginId, config, pluginConfig))
  );
}

type LoadedBenchPlugin = {
  manifest: PluginManifest;
  listScenarios: () => Promise<ScenarioMeta[]>;
  prepare: (context: HostContext) => Promise<{
    runScenario: (input: {
      runId: string;
      pluginId: string;
      scenario: ScenarioMeta;
      model: RegisteredModel;
      abortSignal?: AbortSignal;
      generation: {
        temperature?: number;
        top_p?: number;
        top_k?: number;
        min_p?: number;
        repetition_penalty?: number;
        request_timeout_seconds?: number;
      };
    }, emit: (event: ProgressEvent) => Promise<void> | void) => Promise<ScenarioResult>;
    dispose: () => Promise<void>;
  }>;
  scoreModelResults: (results: ScenarioResult[]) => BenchmarkScore;
};

function normalizeLoadedPlugin(module: Record<string, unknown>): LoadedBenchPlugin {
  const normalized = normalizePluginModule(module) as Record<string, unknown>;

  if (
    typeof normalized.listScenarios !== "function" ||
    typeof normalized.prepare !== "function" ||
    typeof normalized.scoreModelResults !== "function" ||
    !normalized.manifest
  ) {
    throw new Error("Plugin entry does not implement the BenchLocal runtime surface.");
  }

  return normalized as unknown as LoadedBenchPlugin;
}

async function loadConfiguredPlugin(config: BenchLocalConfig, pluginId: string): Promise<{
  rootDir: string;
  manifest: PluginManifest;
  plugin: LoadedBenchPlugin;
}> {
  const pluginConfig = config.plugins[pluginId];

  if (!pluginConfig) {
    throw new Error(`Unknown plugin "${pluginId}" in BenchLocal config.`);
  }

  const rootDir = resolveConfiguredPluginRoot(config, pluginId, pluginConfig);

  if (!rootDir || !(await pathExists(rootDir))) {
    throw new Error(`Plugin "${pluginId}" is not installed at a resolvable path.`);
  }

  const manifest = await readPluginManifest(rootDir);
  const entryPath = path.resolve(rootDir, manifest.entry);

  if (!(await pathExists(entryPath))) {
    throw new Error(`Plugin entry is missing: ${entryPath}`);
  }

  const imported = (await import(pathToFileURL(entryPath).href)) as Record<string, unknown>;

  return {
    rootDir,
    manifest,
    plugin: normalizeLoadedPlugin(imported)
  };
}

type RunArtifacts = {
  runId: string;
  runDir: string;
  eventsPath: string;
  summaryPath: string;
  hostLogPath: string;
};

async function createRunArtifacts(config: BenchLocalConfig, pluginId: string): Promise<RunArtifacts> {
  const runId = `${pluginId}-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(expandHomePath(config.run_storage_dir), pluginId, runId);

  await fs.mkdir(runDir, { recursive: true });

  return {
    runId,
    runDir,
    eventsPath: path.join(runDir, "events.jsonl"),
    summaryPath: path.join(runDir, "summary.json"),
    hostLogPath: path.join(runDir, "host.log")
  };
}

async function appendJsonLine(targetPath: string, value: unknown): Promise<void> {
  await fs.appendFile(targetPath, `${JSON.stringify(value)}\n`, "utf8");
}

async function appendTextLine(targetPath: string, value: string): Promise<void> {
  await fs.appendFile(targetPath, `${value}\n`, "utf8");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown benchmark error.";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && /abort|cancel/i.test(error.name + " " + error.message);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  const reason = signal.reason;

  if (reason instanceof Error) {
    throw reason;
  }

  throw new Error("Run cancelled by user.");
}

async function createHostContext(
  config: BenchLocalConfig,
  pluginId: string,
  rootDir: string,
  manifest: PluginManifest,
  artifacts: RunArtifacts
): Promise<HostContext> {
  const providers = Object.entries(config.providers).map(([id, provider]) => ({
    id,
    enabled: provider.enabled,
    baseUrl: provider.base_url,
    authMode: (provider.api_key || provider.api_key_env ? "bearer" : "none") as "bearer" | "none"
  }));

  const models = config.models.filter((model) => model.enabled).map((model) => ({
    id: model.id,
    provider: model.provider,
    model: model.model,
    label: model.label,
    enabled: model.enabled,
    group: model.group
  }));

  const secrets = await Promise.all(
    Object.entries(config.providers).map(async ([providerId, provider]) => {
      const envName = provider.api_key_env;
      const envValue = envName ? process.env[envName] : undefined;
      const value = provider.api_key ?? envValue;

      return {
        providerId,
        keyName: envName ?? "api_key",
        value,
        source: provider.api_key ? "config" : envValue ? "env" : "none"
      } as const;
    })
  );

  return {
    protocolVersion: 1,
    plugin: {
      id: pluginId,
      version: manifest.version,
      installDir: rootDir,
      dataDir: path.join(expandHomePath(config.cache_dir), "plugin-data", pluginId),
      cacheDir: path.join(expandHomePath(config.cache_dir), "plugins", pluginId),
      runsDir: artifacts.runDir
    },
    providers,
    models,
    defaults: config.defaults,
    secrets,
    sidecars: [],
    logger: {
      debug(message, meta) {
        console.debug(`[plugin:${pluginId}] ${message}`, meta ?? "");
        void appendTextLine(artifacts.hostLogPath, `[debug] ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`);
      },
      info(message, meta) {
        console.info(`[plugin:${pluginId}] ${message}`, meta ?? "");
        void appendTextLine(artifacts.hostLogPath, `[info] ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`);
      },
      warn(message, meta) {
        console.warn(`[plugin:${pluginId}] ${message}`, meta ?? "");
        void appendTextLine(artifacts.hostLogPath, `[warn] ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`);
      },
      error(message, meta) {
        console.error(`[plugin:${pluginId}] ${message}`, meta ?? "");
        void appendTextLine(artifacts.hostLogPath, `[error] ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`);
      }
    }
  };
}

async function executeSerialMode(
  scenarios: ScenarioMeta[],
  selectedModels: RegisteredModel[],
  prepared: Awaited<ReturnType<LoadedBenchPlugin["prepare"]>>,
  pluginId: string,
  config: BenchLocalConfig,
  emit: (event: ProgressEvent) => Promise<void>,
  resultsByModel: Record<string, ScenarioResult[]>,
  runId: string,
  abortSignal?: AbortSignal
): Promise<void> {
  for (const [index, scenario] of scenarios.entries()) {
    throwIfAborted(abortSignal);
    await emit({
      type: "scenario_started",
      scenarioId: scenario.id,
      title: scenario.title,
      index: index + 1,
      total: scenarios.length
    });

    for (const model of selectedModels) {
      throwIfAborted(abortSignal);
      const result = await prepared.runScenario(
        {
          runId,
          pluginId,
          scenario,
          model,
          abortSignal,
          generation: {
            temperature: config.defaults.temperature,
            top_p: config.defaults.top_p,
            top_k: config.defaults.top_k,
            min_p: config.defaults.min_p,
            repetition_penalty: config.defaults.repetition_penalty,
            request_timeout_seconds: config.defaults.request_timeout_seconds
          }
        },
        emit
      );

      resultsByModel[model.id].push(result);
      await emit({ type: "scenario_result", modelId: model.id, scenarioId: scenario.id, result });
    }

    await emit({
      type: "scenario_finished",
      scenarioId: scenario.id
    });
  }
}

async function executeParallelModelsMode(
  scenarios: ScenarioMeta[],
  selectedModels: RegisteredModel[],
  prepared: Awaited<ReturnType<LoadedBenchPlugin["prepare"]>>,
  pluginId: string,
  config: BenchLocalConfig,
  emit: (event: ProgressEvent) => Promise<void>,
  resultsByModel: Record<string, ScenarioResult[]>,
  runId: string,
  abortSignal?: AbortSignal
): Promise<void> {
  for (const [index, scenario] of scenarios.entries()) {
    throwIfAborted(abortSignal);
    await emit({
      type: "scenario_started",
      scenarioId: scenario.id,
      title: scenario.title,
      index: index + 1,
      total: scenarios.length
    });

    const scenarioResults = await Promise.all(
      selectedModels.map(async (model) => {
        const result = await prepared.runScenario(
          {
          runId,
          pluginId,
          scenario,
          model,
          abortSignal,
          generation: {
              temperature: config.defaults.temperature,
              top_p: config.defaults.top_p,
              top_k: config.defaults.top_k,
              min_p: config.defaults.min_p,
              repetition_penalty: config.defaults.repetition_penalty,
              request_timeout_seconds: config.defaults.request_timeout_seconds
            }
          },
          emit
        );

        return { modelId: model.id, result };
      })
    );

    for (const { modelId, result } of scenarioResults) {
      resultsByModel[modelId].push(result);
      await emit({ type: "scenario_result", modelId, scenarioId: scenario.id, result });
    }

    await emit({
      type: "scenario_finished",
      scenarioId: scenario.id
    });
  }
}

async function executeParallelScenariosMode(
  scenarios: ScenarioMeta[],
  selectedModels: RegisteredModel[],
  prepared: Awaited<ReturnType<LoadedBenchPlugin["prepare"]>>,
  pluginId: string,
  config: BenchLocalConfig,
  emit: (event: ProgressEvent) => Promise<void>,
  resultsByModel: Record<string, ScenarioResult[]>,
  runId: string,
  abortSignal?: AbortSignal
): Promise<void> {
  await Promise.all(
    scenarios.map(async (scenario, index) => {
      throwIfAborted(abortSignal);
      await emit({
        type: "scenario_started",
        scenarioId: scenario.id,
        title: scenario.title,
        index: index + 1,
        total: scenarios.length
      });

      for (const model of selectedModels) {
        const result = await prepared.runScenario(
          {
          runId,
          pluginId,
          scenario,
          model,
          abortSignal,
          generation: {
              temperature: config.defaults.temperature,
              top_p: config.defaults.top_p,
              top_k: config.defaults.top_k,
              min_p: config.defaults.min_p,
              repetition_penalty: config.defaults.repetition_penalty,
              request_timeout_seconds: config.defaults.request_timeout_seconds
            }
          },
          emit
        );

        resultsByModel[model.id].push(result);
        await emit({ type: "scenario_result", modelId: model.id, scenarioId: scenario.id, result });
      }

      await emit({
        type: "scenario_finished",
        scenarioId: scenario.id
      });
    })
  );
}

async function executeFullParallelMode(
  scenarios: ScenarioMeta[],
  selectedModels: RegisteredModel[],
  prepared: Awaited<ReturnType<LoadedBenchPlugin["prepare"]>>,
  pluginId: string,
  config: BenchLocalConfig,
  emit: (event: ProgressEvent) => Promise<void>,
  resultsByModel: Record<string, ScenarioResult[]>,
  runId: string,
  abortSignal?: AbortSignal
): Promise<void> {
  await Promise.all(
    scenarios.map(async (scenario, index) => {
      throwIfAborted(abortSignal);
      await emit({
        type: "scenario_started",
        scenarioId: scenario.id,
        title: scenario.title,
        index: index + 1,
        total: scenarios.length
      });

      const scenarioResults = await Promise.all(
        selectedModels.map(async (model) => {
          const result = await prepared.runScenario(
            {
            runId,
            pluginId,
            scenario,
            model,
            abortSignal,
            generation: {
                temperature: config.defaults.temperature,
                top_p: config.defaults.top_p,
                top_k: config.defaults.top_k,
                min_p: config.defaults.min_p,
                repetition_penalty: config.defaults.repetition_penalty,
                request_timeout_seconds: config.defaults.request_timeout_seconds
              }
            },
            emit
          );

          return { modelId: model.id, result };
        })
      );

      for (const { modelId, result } of scenarioResults) {
        resultsByModel[modelId].push(result);
        await emit({ type: "scenario_result", modelId, scenarioId: scenario.id, result });
      }

      await emit({
        type: "scenario_finished",
        scenarioId: scenario.id
      });
    })
  );
}

export async function runConfiguredPluginBenchmark(
  config: BenchLocalConfig,
  pluginId: string,
  options?: {
    modelIds?: string[];
    executionMode?: BenchLocalExecutionMode;
    abortSignal?: AbortSignal;
    onEvent?: (event: ProgressEvent) => Promise<void> | void;
  }
): Promise<PluginRunSummary> {
  const artifacts = await createRunArtifacts(config, pluginId);
  const { rootDir, manifest, plugin } = await loadConfiguredPlugin(config, pluginId);
  const hostContext = await createHostContext(config, pluginId, rootDir, manifest, artifacts);
  const enabledModels = hostContext.models.filter((model) => model.enabled);
  const selectedModels =
    options?.modelIds && options.modelIds.length > 0
      ? options.modelIds
          .map((modelId) => enabledModels.find((model) => model.id === modelId))
          .filter((model): model is (typeof enabledModels)[number] => Boolean(model))
      : enabledModels;

  if (selectedModels.length === 0) {
    throw new Error("No enabled models are configured in BenchLocal.");
  }

  const scenarios = await plugin.listScenarios();
  const prepared = await plugin.prepare(hostContext);
  const events: ProgressEvent[] = [];
  const resultsByModel: Record<string, ScenarioResult[]> = Object.fromEntries(selectedModels.map((model) => [model.id, []]));
  const startedAt = new Date().toISOString();
  const executionMode = options?.executionMode ?? "parallel_models";
  let runErrorMessage: string | undefined;
  let cancelled = false;

  const emit = async (event: ProgressEvent) => {
    events.push(event);
    await appendJsonLine(artifacts.eventsPath, event);
    await options?.onEvent?.(event);
  };

  await emit({
    type: "run_started",
    models: selectedModels.map((model) => ({ id: model.id, label: model.label })),
    totalScenarios: scenarios.length
  });

  try {
    try {
      throwIfAborted(options?.abortSignal);
      switch (executionMode) {
        case "serial":
          await executeSerialMode(scenarios, selectedModels, prepared, pluginId, config, emit, resultsByModel, artifacts.runId, options?.abortSignal);
          break;
        case "parallel_scenarios":
          await executeParallelScenariosMode(scenarios, selectedModels, prepared, pluginId, config, emit, resultsByModel, artifacts.runId, options?.abortSignal);
          break;
        case "full_parallel":
          await executeFullParallelMode(scenarios, selectedModels, prepared, pluginId, config, emit, resultsByModel, artifacts.runId, options?.abortSignal);
          break;
        case "parallel_models":
        default:
          await executeParallelModelsMode(scenarios, selectedModels, prepared, pluginId, config, emit, resultsByModel, artifacts.runId, options?.abortSignal);
          break;
      }
    } catch (error) {
      runErrorMessage = toErrorMessage(error);
      cancelled = isAbortError(error) || Boolean(options?.abortSignal?.aborted);
      await emit({
        type: "run_error",
        message: runErrorMessage
      });
    }
  } finally {
    await prepared.dispose();
  }

  const scores = Object.fromEntries(
    Object.entries(resultsByModel).map(([modelId, results]) => [modelId, plugin.scoreModelResults(results)])
  );

  if (!runErrorMessage) {
    await emit({
      type: "run_finished",
      scores
    });
  }

  const summary: PluginRunSummary = {
    runId: artifacts.runId,
    runDir: artifacts.runDir,
    pluginId,
    pluginName: manifest.name,
    executionMode,
    startedAt,
    completedAt: new Date().toISOString(),
    modelCount: selectedModels.length,
    scenarioCount: scenarios.length,
    cancelled,
    error: runErrorMessage,
    events,
    resultsByModel,
    scores
  };

  await fs.writeFile(
    artifacts.summaryPath,
    JSON.stringify(
      {
        ...summary,
        error: runErrorMessage
      },
      null,
      2
    ),
    "utf8"
  );

  return summary;
}

export function createPluginHost() {
  let status: PluginHostStatus = "idle";

  return {
    getStatus(): PluginHostStatus {
      return status;
    },
    async loadPlugin(entryPath: string, pluginId: string): Promise<LoadedPluginHandle> {
      status = "loading";
      status = "ready";

      return {
        pluginId,
        entryPath
      };
    }
  };
}
