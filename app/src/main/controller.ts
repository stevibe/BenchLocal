import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  BenchLocalAgentCreateModelRequest,
  BenchLocalAgentCreateProviderRequest,
  BenchLocalAgentEvent,
  BenchLocalAgentPatchModelRequest,
  BenchLocalAgentPatchProviderRequest,
  BenchLocalAgentSafeConfig,
  BenchLocalConfig,
  BenchLocalModelConfig,
  BenchLocalExecutionMode,
  BenchLocalProviderConfig,
  BenchLocalProviderKind,
  BenchLocalWorkspaceState,
  BenchLocalWorkspaceTabModelSelection,
  BenchPackRunSummary,
  GenerationRequest,
  ProgressEvent,
  ScenarioMeta
} from "@core";
import {
  getConfigPath,
  getWorkspaceStatePath,
  loadOrCreateConfig,
  loadOrCreateWorkspaceState,
  saveConfigFile,
  saveWorkspaceStateFile
} from "@core";
import {
  checkConfiguredModelAvailability,
  deleteConfiguredBenchPackVerifierImage,
  deleteRunHistoryForBenchPack,
  getConfiguredBenchPackVerifierStatus,
  installBenchPackFromRegistry,
  installBenchPackFromUrl,
  inspectConfiguredBenchPacks,
  clearRunHistoryForBenchPack,
  listRunHistoryForBenchPack,
  loadBenchPackRegistry,
  loadRunSummaryForBenchPack,
  resumeBenchPackRun,
  retryScenarioForBenchPackRun,
  runConfiguredBenchPack,
  startConfiguredBenchPackVerifiers,
  stopConfiguredBenchPackVerifiers,
  uninstallBenchPack,
  updateBenchPackFromRegistry
} from "@benchpack-host";
import type { BenchLocalDiscoveredModel } from "@/shared/desktop-api";
import { loadAppMetadata } from "./app-metadata";

export type BenchLocalControllerEventName = "agent-event";

type RuntimeCompatibility = {
  benchLocalVersion: string;
};

type ProgressCallback = (event: ProgressEvent) => void;

type RetryBatchKind = "provider_errors" | "failed_results";

type RetryScenarioCell = {
  modelId: string;
  scenarioId: string;
};

type RetryBatchPlan = {
  tabId: string;
  benchPackId: string;
  runId: string;
  kind: RetryBatchKind;
  executionMode: BenchLocalExecutionMode;
  cells: RetryScenarioCell[];
  groups: RetryScenarioCell[][];
};

type BenchPackMutationProgress = {
  benchPackId: string;
  action: "install" | "update" | "uninstall";
  phase: "resolving" | "downloading" | "extracting" | "hydrating" | "validating" | "activating" | "removing" | "complete";
  message: string;
};

type VerifierPreparationProgress = Extract<ProgressEvent, { type: "verifier_preparing" }>;

const RUN_RELEASE_TIMEOUT_MS = 5000;
const VERIFIER_RELEASE_TIMEOUT_MS = 15000;
const PROVIDER_KIND_LABELS: Record<BenchLocalProviderKind, string> = {
  openrouter: "OpenRouter",
  huggingface: "Hugging Face",
  ollama: "Ollama",
  llamacpp: "llama.cpp",
  mlx: "MLX",
  lmstudio: "LM Studio",
  pico: "Pico",
  openai_compatible: "OpenAI Compatible"
};

function defaultProviderName(kind: BenchLocalProviderKind): string {
  return PROVIDER_KIND_LABELS[kind] ?? kind;
}

function fallbackProviderDisplayName(providerId: string): string {
  const trimmed = providerId.trim();

  if (/^openai[_-]compatible-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return "OpenAI Compatible";
  }

  switch (trimmed) {
    case "openrouter":
      return "OpenRouter";
    case "huggingface":
      return "Hugging Face";
    case "ollama":
      return "Ollama";
    case "llamacpp":
      return "llama.cpp";
    case "mlx":
      return "MLX";
    case "lmstudio":
      return "LM Studio";
    case "pico":
      return "Pico";
    default:
      return trimmed || "Unknown Provider";
  }
}

function getProviderDisplayName(providers: Record<string, BenchLocalProviderConfig>, providerId: string): string {
  return providers[providerId]?.name?.trim() || fallbackProviderDisplayName(providerId);
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    throw new Error(`${field} is required.`);
  }

  return normalized;
}

function normalizeOptionalBoolean(value: unknown, fallback: boolean, field: string): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean.`);
  }

  return value;
}

function createCopyLabel(label: string, existingLabels: string[]): string {
  const base = `${label.trim() || "Untitled"} Copy`;
  const existing = new Set(existingLabels.map((candidate) => candidate.trim()));

  if (!existing.has(base)) {
    return base;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} ${index}`;

    if (!existing.has(candidate)) {
      return candidate;
    }
  }

  return `${base} ${randomUUID().slice(0, 8)}`;
}

function createUniqueProviderId(
  kind: BenchLocalProviderKind,
  providers: Record<string, BenchLocalProviderConfig>
): string {
  let id = "";

  do {
    id = `${kind}-${randomUUID()}`;
  } while (providers[id]);

  return id;
}

function createUniqueModelId(model: BenchLocalModelConfig, models: BenchLocalModelConfig[]): string {
  const existing = new Set(models.map((candidate) => candidate.id));
  const modelPart = model.model.trim() || model.id.split(":").slice(1).join(":").trim() || "model";
  let id = "";

  do {
    id = `${model.provider}:${modelPart}:copy-${randomUUID()}`;
  } while (existing.has(id));

  return id;
}

function normalizeProviderConfig(
  input: BenchLocalAgentCreateProviderRequest,
  providers: Record<string, BenchLocalProviderConfig>
): { providerId: string; provider: BenchLocalProviderConfig } {
  const providerId = normalizeOptionalString(input.id) ?? createUniqueProviderId(input.kind, providers);
  const provider: BenchLocalProviderConfig = {
    kind: input.kind,
    name: normalizeOptionalString(input.name) ?? defaultProviderName(input.kind),
    enabled: normalizeOptionalBoolean(input.enabled, true, "enabled"),
    base_url: normalizeRequiredString(input.base_url, "base_url")
  };
  const apiKey = normalizeOptionalString(input.api_key);
  const apiKeyEnv = normalizeOptionalString(input.api_key_env);

  if (apiKey) {
    provider.api_key = apiKey;
  }

  if (apiKeyEnv) {
    provider.api_key_env = apiKeyEnv;
  }

  return { providerId, provider };
}

function patchProviderConfig(
  provider: BenchLocalProviderConfig,
  input: BenchLocalAgentPatchProviderRequest
): BenchLocalProviderConfig {
  const next: BenchLocalProviderConfig = {
    ...provider,
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.name !== undefined ? { name: normalizeOptionalString(input.name) ?? defaultProviderName(input.kind ?? provider.kind) } : {}),
    ...(input.enabled !== undefined ? { enabled: normalizeOptionalBoolean(input.enabled, provider.enabled, "enabled") } : {}),
    ...(input.base_url !== undefined ? { base_url: normalizeRequiredString(input.base_url, "base_url") } : {})
  };

  if (input.api_key !== undefined) {
    const apiKey = normalizeOptionalString(input.api_key);

    if (apiKey) {
      next.api_key = apiKey;
    } else {
      delete next.api_key;
    }
  }

  if (input.api_key_env !== undefined) {
    const apiKeyEnv = normalizeOptionalString(input.api_key_env);

    if (apiKeyEnv) {
      next.api_key_env = apiKeyEnv;
    } else {
      delete next.api_key_env;
    }
  }

  return next;
}

function buildModelConfig(
  input: BenchLocalAgentCreateModelRequest,
  providers: Record<string, BenchLocalProviderConfig>
): BenchLocalModelConfig {
  const provider = normalizeRequiredString(input.provider, "provider");
  const model = normalizeRequiredString(input.model, "model");
  const providerLabel = getProviderDisplayName(providers, provider);

  return {
    id: normalizeOptionalString(input.id) ?? `${provider}:${model}`,
    provider,
    model,
    label: normalizeOptionalString(input.label) ?? `${model} via ${providerLabel}`,
    group: normalizeOptionalString(input.group) ?? "primary",
    enabled: normalizeOptionalBoolean(input.enabled, true, "enabled")
  };
}

function patchModelConfig(
  model: BenchLocalModelConfig,
  input: BenchLocalAgentPatchModelRequest,
  providers: Record<string, BenchLocalProviderConfig>
): BenchLocalModelConfig {
  return buildModelConfig(
    {
      id: input.id ?? model.id,
      provider: input.provider ?? model.provider,
      model: input.model ?? model.model,
      label: input.label ?? model.label,
      group: input.group ?? model.group,
      enabled: input.enabled ?? model.enabled
    },
    providers
  );
}

function createAgentEvent<TPayload>(type: BenchLocalAgentEvent["type"], payload: TPayload): BenchLocalAgentEvent<TPayload> {
  return {
    eventId: `evt-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    type,
    payload
  };
}

function providerSupportsModelDiscovery(provider: BenchLocalProviderConfig): boolean {
  return provider.kind === "openrouter" || provider.kind === "huggingface" || provider.kind === "openai_compatible";
}

function providerModelsUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL("models", normalizedBaseUrl).toString();
}

function formatModelPricing(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const prompt = typeof record.prompt === "string" || typeof record.prompt === "number" ? String(record.prompt) : null;
  const completion =
    typeof record.completion === "string" || typeof record.completion === "number" ? String(record.completion) : null;

  if (prompt && completion) {
    return `In ${prompt} · Out ${completion}`;
  }

  if (prompt) {
    return `Prompt ${prompt}`;
  }

  if (completion) {
    return `Completion ${completion}`;
  }

  return undefined;
}

function mapDiscoveredModel(input: unknown): BenchLocalDiscoveredModel | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";

  if (!id) {
    return null;
  }

  const name = typeof record.name === "string" ? record.name.trim() : undefined;
  const ownedBy = typeof record.owned_by === "string" ? record.owned_by.trim() : undefined;
  const topProvider =
    typeof record.top_provider === "object" && record.top_provider !== null
      ? (record.top_provider as Record<string, unknown>)
      : null;
  const architecture =
    typeof record.architecture === "object" && record.architecture !== null
      ? (record.architecture as Record<string, unknown>)
      : null;
  const contextLength =
    typeof record.context_length === "number"
      ? record.context_length
      : typeof topProvider?.context_length === "number"
        ? (topProvider.context_length as number)
        : undefined;
  const modality =
    Array.isArray(architecture?.modality)
      ? architecture.modality.filter((value): value is string => typeof value === "string").join(", ")
      : Array.isArray(record.input_modalities)
        ? record.input_modalities.filter((value): value is string => typeof value === "string").join(", ")
        : Array.isArray(record.output_modalities)
          ? record.output_modalities.filter((value): value is string => typeof value === "string").join(", ")
          : undefined;

  return {
    id,
    name,
    ownedBy,
    contextLength,
    pricing: formatModelPricing(record.pricing),
    modality
  };
}

function normalizeRunsPerTest(value: unknown): number {
  return [1, 3, 5, 7, 9].includes(value as number) ? (value as number) : 1;
}

function normalizeModelSelections(
  selections: BenchLocalWorkspaceTabModelSelection[],
  config: BenchLocalConfig
): BenchLocalWorkspaceTabModelSelection[] {
  const availableIds = new Set(config.models.filter((model) => model.enabled).map((model) => model.id));
  const seen = new Set<string>();
  const normalized: BenchLocalWorkspaceTabModelSelection[] = [];

  for (const selection of selections) {
    const modelId = selection.modelId.trim();

    if (!modelId || seen.has(modelId) || !availableIds.has(modelId)) {
      continue;
    }

    seen.add(modelId);
    normalized.push({
      modelId,
      ...(selection.alias?.trim() ? { alias: selection.alias.trim() } : {})
    });
  }

  return normalized;
}

function normalizeModelIds(modelIds: string[], config: BenchLocalConfig): BenchLocalWorkspaceTabModelSelection[] {
  return normalizeModelSelections(
    modelIds.map((modelId) => ({ modelId })),
    config
  );
}

function uniqueValues(values: string[]): string[] {
  return values.filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);
}

function getRunModelOrder(summary: BenchPackRunSummary): string[] {
  const runStarted = summary.events.find(
    (event): event is Extract<ProgressEvent, { type: "run_started" }> => event.type === "run_started"
  );

  return uniqueValues([
    ...(runStarted?.models.map((model) => model.id) ?? []),
    ...Object.keys(summary.resultsByModel)
  ]);
}

function getRunScenarioOrder(summary: BenchPackRunSummary, scenarios: ScenarioMeta[]): string[] {
  return uniqueValues([
    ...scenarios.map((scenario) => scenario.id),
    ...Object.values(summary.resultsByModel).flatMap((results) => results.map((result) => result.scenarioId))
  ]);
}

function collectRetryCells(summary: BenchPackRunSummary, kind: RetryBatchKind): RetryScenarioCell[] {
  const cells: RetryScenarioCell[] = [];

  for (const [modelId, results] of Object.entries(summary.resultsByModel)) {
    for (const result of results) {
      if (result.status !== "fail") {
        continue;
      }

      const isProviderError = result.errorType === "provider_error";

      if (kind === "provider_errors" && !isProviderError) {
        continue;
      }

      if (kind === "failed_results" && isProviderError) {
        continue;
      }

      cells.push({
        modelId,
        scenarioId: result.scenarioId
      });
    }
  }

  return cells;
}

function groupRetryCellsForExecutionMode(
  cells: RetryScenarioCell[],
  executionMode: BenchLocalExecutionMode,
  scenarioOrder: string[],
  modelOrder: string[]
): RetryScenarioCell[][] {
  const cellSet = new Set(cells.map((cell) => `${cell.modelId}::${cell.scenarioId}`));
  const cellFor = (modelId: string, scenarioId: string): RetryScenarioCell | null =>
    cellSet.has(`${modelId}::${scenarioId}`) ? { modelId, scenarioId } : null;
  const singletonByScenarioThenModel = scenarioOrder.flatMap((scenarioId) =>
    modelOrder.flatMap((modelId) => {
      const cell = cellFor(modelId, scenarioId);
      return cell ? [[cell]] : [];
    })
  );

  switch (executionMode) {
    case "serial":
      return singletonByScenarioThenModel;
    case "serial_by_model":
      return modelOrder.flatMap((modelId) =>
        scenarioOrder.flatMap((scenarioId) => {
          const cell = cellFor(modelId, scenarioId);
          return cell ? [[cell]] : [];
        })
      );
    case "parallel_by_test_case":
      return scenarioOrder
        .map((scenarioId) => modelOrder.flatMap((modelId) => cellFor(modelId, scenarioId) ?? []))
        .filter((group) => group.length > 0);
    case "parallel_by_model":
      return modelOrder
        .map((modelId) => scenarioOrder.flatMap((scenarioId) => cellFor(modelId, scenarioId) ?? []))
        .filter((group) => group.length > 0);
    case "full_parallel":
      return [singletonByScenarioThenModel.flat()].filter((group) => group.length > 0);
    default:
      return singletonByScenarioThenModel;
  }
}

function redactConfig(config: BenchLocalConfig): BenchLocalAgentSafeConfig {
  return {
    ...config,
    providers: Object.fromEntries(
      Object.entries(config.providers).map(([providerId, provider]) => [
        providerId,
        {
          kind: provider.kind,
          name: provider.name,
          enabled: provider.enabled,
          base_url: provider.base_url,
          api_key_env: provider.api_key_env,
          has_api_key: Boolean(provider.api_key?.trim()),
          has_api_key_env: Boolean(provider.api_key_env?.trim())
        }
      ])
    )
  };
}

export class BenchLocalController {
  private readonly events = new EventEmitter();
  private readonly activeBenchPackRuns = new Map<
    string,
    {
      benchPackId: string;
      controller: AbortController;
    }
  >();
  private readonly activeVerifierStarts = new Map<
    string,
    {
      controller: AbortController;
    }
  >();

  onAgentEvent(listener: (event: BenchLocalAgentEvent) => void): () => void {
    this.events.on("agent-event", listener);
    return () => this.events.off("agent-event", listener);
  }

  emitAgentEvent<TPayload>(type: BenchLocalAgentEvent["type"], payload: TPayload): BenchLocalAgentEvent<TPayload> {
    const event = createAgentEvent(type, payload);
    this.events.emit("agent-event", event);
    return event;
  }

  async getRuntimeCompatibility(): Promise<RuntimeCompatibility> {
    const metadata = await loadAppMetadata();

    return {
      benchLocalVersion: metadata.version
    };
  }

  async loadConfig() {
    return loadOrCreateConfig();
  }

  async saveConfig(config: BenchLocalConfig) {
    const saved = await saveConfigFile(config, getConfigPath());
    const result = {
      path: getConfigPath(),
      created: false,
      config: saved
    };

    this.emitAgentEvent("config.updated", {
      config: redactConfig(saved)
    });

    return result;
  }

  async loadWorkspaceState() {
    await loadOrCreateConfig();
    return loadOrCreateWorkspaceState(getWorkspaceStatePath());
  }

  async saveWorkspaceState(state: BenchLocalWorkspaceState) {
    await loadOrCreateConfig();
    const saved = await saveWorkspaceStateFile(state, getWorkspaceStatePath());
    const result = {
      path: getWorkspaceStatePath(),
      created: false,
      state: saved
    };

    this.emitAgentEvent("workspace.updated", {
      state: saved
    });

    return result;
  }

  async listProviders() {
    const safeConfig = await this.getSafeConfig();
    return safeConfig.providers;
  }

  async createProvider(input: BenchLocalAgentCreateProviderRequest) {
    const { config } = await loadOrCreateConfig();
    const nextConfig = structuredClone(config);
    const { providerId, provider } = normalizeProviderConfig(input, nextConfig.providers);

    if (nextConfig.providers[providerId]) {
      throw new Error(`Provider "${getProviderDisplayName(nextConfig.providers, providerId)}" already exists.`);
    }

    nextConfig.providers[providerId] = provider;
    const saved = await this.saveConfig(nextConfig);
    const safeConfig = redactConfig(saved.config);

    return {
      providerId,
      provider: safeConfig.providers[providerId],
      config: safeConfig
    };
  }

  async updateProvider(providerId: string, input: BenchLocalAgentPatchProviderRequest) {
    const { config } = await loadOrCreateConfig();
    const nextConfig = structuredClone(config);
    const provider = nextConfig.providers[providerId];

    if (!provider) {
      throw new Error(`Provider "${fallbackProviderDisplayName(providerId)}" was not found.`);
    }

    nextConfig.providers[providerId] = patchProviderConfig(provider, input);
    const saved = await this.saveConfig(nextConfig);
    const safeConfig = redactConfig(saved.config);

    return {
      providerId,
      provider: safeConfig.providers[providerId],
      config: safeConfig
    };
  }

  async deleteProvider(providerId: string) {
    const { config } = await loadOrCreateConfig();

    if (!config.providers[providerId]) {
      throw new Error(`Provider "${fallbackProviderDisplayName(providerId)}" was not found.`);
    }

    const nextConfig = structuredClone(config);
    const providerName = getProviderDisplayName(nextConfig.providers, providerId);
    const removedModelIds = new Set(nextConfig.models.filter((model) => model.provider === providerId).map((model) => model.id));
    delete nextConfig.providers[providerId];
    nextConfig.models = nextConfig.models.filter((model) => model.provider !== providerId);
    const saved = await this.saveConfig(nextConfig);

    if (removedModelIds.size > 0) {
      await this.removeWorkspaceModelSelections(removedModelIds);
    }

    return {
      providerId,
      providerName,
      removedModelIds: Array.from(removedModelIds),
      config: redactConfig(saved.config)
    };
  }

  async duplicateProvider(providerId: string) {
    const { config } = await loadOrCreateConfig();
    const provider = config.providers[providerId];

    if (!provider) {
      throw new Error(`Provider "${fallbackProviderDisplayName(providerId)}" was not found.`);
    }

    const nextConfig = structuredClone(config);
    const nextProviderId = createUniqueProviderId(provider.kind, nextConfig.providers);
    const nextProviderName = createCopyLabel(
      getProviderDisplayName(nextConfig.providers, providerId),
      Object.values(nextConfig.providers).map((candidate) => candidate.name)
    );
    nextConfig.providers[nextProviderId] = {
      ...provider,
      name: nextProviderName
    };
    const saved = await this.saveConfig(nextConfig);
    const safeConfig = redactConfig(saved.config);

    return {
      providerId: nextProviderId,
      provider: safeConfig.providers[nextProviderId],
      config: safeConfig
    };
  }

  async discoverProviderModelsById(providerId: string): Promise<BenchLocalDiscoveredModel[]> {
    const { config } = await loadOrCreateConfig();
    const provider = config.providers[providerId];

    if (!provider) {
      throw new Error(`Provider "${fallbackProviderDisplayName(providerId)}" was not found.`);
    }

    return this.discoverProviderModels(provider);
  }

  async createModel(input: BenchLocalAgentCreateModelRequest) {
    const { config } = await loadOrCreateConfig();
    const nextConfig = structuredClone(config);
    const model = buildModelConfig(input, nextConfig.providers);

    if (!nextConfig.providers[model.provider]) {
      throw new Error(`Model provider "${fallbackProviderDisplayName(model.provider)}" does not exist yet.`);
    }

    if (nextConfig.models.some((candidate) => candidate.id === model.id)) {
      throw new Error(`Model "${model.id}" already exists.`);
    }

    nextConfig.models.push(model);
    const saved = await this.saveConfig(nextConfig);

    return {
      modelId: model.id,
      model,
      config: redactConfig(saved.config)
    };
  }

  async updateModel(modelId: string, input: BenchLocalAgentPatchModelRequest) {
    const { config } = await loadOrCreateConfig();
    const nextConfig = structuredClone(config);
    const index = nextConfig.models.findIndex((model) => model.id === modelId);

    if (index < 0) {
      throw new Error(`Model "${modelId}" was not found.`);
    }

    const model = patchModelConfig(nextConfig.models[index], input, nextConfig.providers);

    if (!nextConfig.providers[model.provider]) {
      throw new Error(`Model provider "${fallbackProviderDisplayName(model.provider)}" does not exist yet.`);
    }

    if (nextConfig.models.some((candidate, candidateIndex) => candidateIndex !== index && candidate.id === model.id)) {
      throw new Error(`Model "${model.id}" already exists.`);
    }

    nextConfig.models[index] = model;
    const saved = await this.saveConfig(nextConfig);

    if (model.id !== modelId) {
      await this.replaceWorkspaceModelSelectionId(modelId, model.id);
    }

    return {
      modelId: model.id,
      previousModelId: modelId,
      model,
      config: redactConfig(saved.config)
    };
  }

  async deleteModel(modelId: string) {
    const { config } = await loadOrCreateConfig();
    const nextConfig = structuredClone(config);
    const index = nextConfig.models.findIndex((model) => model.id === modelId);

    if (index < 0) {
      throw new Error(`Model "${modelId}" was not found.`);
    }

    const [removedModel] = nextConfig.models.splice(index, 1);
    const saved = await this.saveConfig(nextConfig);
    await this.removeWorkspaceModelSelections(new Set([modelId]));

    return {
      modelId,
      model: removedModel,
      config: redactConfig(saved.config)
    };
  }

  async duplicateModel(modelId: string) {
    const { config } = await loadOrCreateConfig();
    const model = config.models.find((candidate) => candidate.id === modelId);

    if (!model) {
      throw new Error(`Model "${modelId}" was not found.`);
    }

    const nextConfig = structuredClone(config);
    const nextModelLabel = createCopyLabel(
      model.label || model.model || model.id,
      nextConfig.models.map((candidate) => candidate.label)
    );
    const nextModel: BenchLocalModelConfig = {
      ...model,
      id: createUniqueModelId(model, nextConfig.models),
      label: nextModelLabel
    };
    nextConfig.models.push(nextModel);
    const saved = await this.saveConfig(nextConfig);

    return {
      modelId: nextModel.id,
      model: nextModel,
      config: redactConfig(saved.config)
    };
  }

  async discoverProviderModels(provider: BenchLocalProviderConfig): Promise<BenchLocalDiscoveredModel[]> {
    if (!providerSupportsModelDiscovery(provider)) {
      throw new Error(`${provider.name} does not support model browsing yet.`);
    }

    const headers = new Headers({
      Accept: "application/json"
    });
    const apiKey = provider.api_key?.trim() || (provider.api_key_env ? process.env[provider.api_key_env]?.trim() : "");

    if (apiKey) {
      headers.set("Authorization", `Bearer ${apiKey}`);
    }

    const response = await fetch(providerModelsUrl(provider.base_url), {
      method: "GET",
      headers
    });

    if (!response.ok) {
      throw new Error(`Failed to load models from ${provider.name}: ${response.status} ${response.statusText}`.trim());
    }

    const payload = (await response.json()) as { data?: unknown[] } | unknown[];
    const entries = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : [];

    return entries
      .map((entry) => mapDiscoveredModel(entry))
      .filter((entry): entry is BenchLocalDiscoveredModel => Boolean(entry))
      .sort((left, right) => (left.name ?? left.id).localeCompare(right.name ?? right.id));
  }

  async checkModelAvailability(input: { config: BenchLocalConfig; modelIds?: string[] }) {
    const availability = await checkConfiguredModelAvailability(input.config, { modelIds: input.modelIds });
    this.emitAgentEvent("models.availability.updated", { availability });
    return availability;
  }

  async listBenchPacks() {
    const { config } = await loadOrCreateConfig();
    return inspectConfiguredBenchPacks(config, await this.getRuntimeCompatibility());
  }

  async loadBenchPackRegistry() {
    const { config } = await loadOrCreateConfig();
    return loadBenchPackRegistry(config);
  }

  async installBenchPack(benchPackId: string, onProgress?: (progress: BenchPackMutationProgress) => void) {
    const { config } = await loadOrCreateConfig();
    const saved = await installBenchPackFromRegistry(
      config,
      benchPackId,
      (progress) => {
        onProgress?.(progress);
      },
      await this.getRuntimeCompatibility()
    );

    return this.saveConfig(saved);
  }

  async installBenchPackFromUrl(url: string, onProgress?: (progress: BenchPackMutationProgress) => void) {
    const { config } = await loadOrCreateConfig();
    const saved = await installBenchPackFromUrl(
      config,
      url,
      (progress) => {
        onProgress?.(progress);
      },
      await this.getRuntimeCompatibility()
    );

    return this.saveConfig(saved);
  }

  async updateBenchPack(benchPackId: string, onProgress?: (progress: BenchPackMutationProgress) => void) {
    const { config } = await loadOrCreateConfig();
    const saved = await updateBenchPackFromRegistry(
      config,
      benchPackId,
      (progress) => {
        onProgress?.(progress);
      },
      await this.getRuntimeCompatibility()
    );

    return this.saveConfig(saved);
  }

  async uninstallBenchPack(benchPackId: string, onProgress?: (progress: BenchPackMutationProgress) => void) {
    const { config } = await loadOrCreateConfig();
    const saved = await uninstallBenchPack(config, benchPackId, (progress) => {
      onProgress?.(progress);
    });

    return this.saveConfig(saved);
  }

  async listActiveRuns() {
    return Array.from(this.activeBenchPackRuns.entries()).map(([tabId, run]) => ({
      tabId,
      benchPackId: run.benchPackId
    }));
  }

  async listRunHistory(benchPackId: string) {
    const { config } = await loadOrCreateConfig();
    return listRunHistoryForBenchPack(config, benchPackId);
  }

  async loadRunHistory(benchPackId: string, runId: string) {
    const { config } = await loadOrCreateConfig();
    return loadRunSummaryForBenchPack(config, benchPackId, runId);
  }

  async clearRunHistory(benchPackId: string) {
    const { config } = await loadOrCreateConfig();
    return clearRunHistoryForBenchPack(config, benchPackId);
  }

  async deleteRunHistory(benchPackId: string, runIds: string[]) {
    const { config } = await loadOrCreateConfig();
    return deleteRunHistoryForBenchPack(config, benchPackId, runIds);
  }

  async listVerifiers() {
    const { config } = await loadOrCreateConfig();
    const inspections = await inspectConfiguredBenchPacks(config, await this.getRuntimeCompatibility());
    const relevant = inspections.filter((inspection) => inspection.manifest?.capabilities.verification || inspection.manifest?.capabilities.sidecars);
    return Promise.all(relevant.map((inspection) => getConfiguredBenchPackVerifierStatus(config, inspection.id)));
  }

  async startVerifier(
    benchPackId: string,
    onProgress?: (progress: VerifierPreparationProgress) => void
  ) {
    const existingActiveStart = this.activeVerifierStarts.get(benchPackId);

    if (existingActiveStart) {
      if (existingActiveStart.controller.signal.aborted) {
        await this.waitForVerifierStartRelease(benchPackId);
      } else {
        throw new Error(`Verifier startup is already active for Bench Pack "${benchPackId}".`);
      }
    }

    const { config } = await loadOrCreateConfig();
    const currentStatus = await getConfiguredBenchPackVerifierStatus(config, benchPackId);
    const controller = new AbortController();
    this.activeVerifierStarts.set(benchPackId, {
      controller
    });

    try {
      return await startConfiguredBenchPackVerifiers(config, benchPackId, {
        abortSignal: controller.signal,
        onProgress: (progress) => {
          const event: VerifierPreparationProgress = {
            type: "verifier_preparing",
            benchPackId,
            benchPackName: currentStatus.benchPackName,
            verifierId: progress.verifierId,
            phase: progress.phase,
            message: progress.message
          };
          this.emitAgentEvent("verifier.event", {
            benchPackId,
            event
          });
          onProgress?.(event);
        }
      });
    } finally {
      this.activeVerifierStarts.delete(benchPackId);
    }
  }

  async stopVerifier(benchPackId: string) {
    const { config } = await loadOrCreateConfig();
    return stopConfiguredBenchPackVerifiers(config, benchPackId);
  }

  async cancelVerifierStart(benchPackId: string) {
    const activeStart = this.activeVerifierStarts.get(benchPackId);

    if (!activeStart) {
      return { cancelled: false };
    }

    activeStart.controller.abort(new Error("Verifier start cancelled by user."));
    return { cancelled: true };
  }

  async deleteVerifierImage(benchPackId: string, verifierId: string) {
    const { config } = await loadOrCreateConfig();
    return deleteConfiguredBenchPackVerifierImage(config, benchPackId, verifierId);
  }

  async runBenchPack(
    input: {
      tabId: string;
      benchPackId: string;
      modelIds?: string[];
      executionMode?: BenchLocalExecutionMode;
      runsPerTest?: number;
      generation?: GenerationRequest;
    },
    onEvent?: ProgressCallback
  ) {
    await this.prepareRunSlot(input.tabId, input.benchPackId);
    const { config } = await loadOrCreateConfig();
    const activeRun = this.activeBenchPackRuns.get(input.tabId);

    if (!activeRun) {
      throw new Error("Benchmark run slot was not initialized.");
    }

    try {
      const result = await runConfiguredBenchPack(
        config,
        input.benchPackId,
        {
          modelIds: input.modelIds,
          executionMode: input.executionMode,
          runsPerTest: input.runsPerTest,
          generation: input.generation,
          abortSignal: activeRun.controller.signal,
          onEvent: (progressEvent) => {
            this.emitRunEvent(input.tabId, input.benchPackId, progressEvent);
            onEvent?.(progressEvent);
          }
        },
        await this.getRuntimeCompatibility()
      );
      this.emitAgentEvent("benchpack.run.finished", {
        tabId: input.tabId,
        benchPackId: input.benchPackId,
        runId: result.runId,
        cancelled: result.cancelled === true
      });
      return result;
    } catch (error) {
      this.emitAgentEvent("benchpack.run.error", {
        tabId: input.tabId,
        benchPackId: input.benchPackId,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      this.activeBenchPackRuns.delete(input.tabId);
    }
  }

  async retryScenario(
    input: {
      tabId: string;
      benchPackId: string;
      runId: string;
      scenarioId: string;
      modelId: string;
      runsPerTest?: number;
      generation?: GenerationRequest;
    },
    onEvent?: ProgressCallback
  ) {
    const { config } = await loadOrCreateConfig();

    return retryScenarioForBenchPackRun(
      config,
      input.benchPackId,
      {
        runId: input.runId,
        scenarioId: input.scenarioId,
        modelId: input.modelId,
        runsPerTest: input.runsPerTest,
        generation: input.generation,
        onEvent: (progressEvent) => {
          this.emitRunEvent(input.tabId, input.benchPackId, progressEvent);
          onEvent?.(progressEvent);
        }
      },
      await this.getRuntimeCompatibility()
    );
  }

  async createRetryBatchPlan(input: {
    tabId: string;
    benchPackId: string;
    runId: string;
    kind: RetryBatchKind;
    executionMode: BenchLocalExecutionMode;
  }): Promise<RetryBatchPlan> {
    const { config } = await loadOrCreateConfig();
    const summary = await loadRunSummaryForBenchPack(config, input.benchPackId, input.runId);
    const inspections = await inspectConfiguredBenchPacks(config, await this.getRuntimeCompatibility());
    const inspection = inspections.find((candidate) => candidate.id === input.benchPackId);
    const scenarioOrder = getRunScenarioOrder(summary, inspection?.scenarios ?? []);
    const modelOrder = getRunModelOrder(summary);
    const cells = collectRetryCells(summary, input.kind);

    return {
      ...input,
      cells,
      groups: groupRetryCellsForExecutionMode(cells, input.executionMode, scenarioOrder, modelOrder)
    };
  }

  async executeRetryBatch(
    plan: RetryBatchPlan,
    input: {
      runsPerTest?: number;
      generation?: GenerationRequest;
    },
    onEvent?: ProgressCallback
  ) {
    const failures: Array<{ modelId: string; scenarioId: string; message: string }> = [];

    for (const group of plan.groups) {
      await Promise.all(
        group.map(async (cell) => {
          try {
            await this.retryScenario(
              {
                tabId: plan.tabId,
                benchPackId: plan.benchPackId,
                runId: plan.runId,
                scenarioId: cell.scenarioId,
                modelId: cell.modelId,
                runsPerTest: input.runsPerTest,
                generation: input.generation
              },
              onEvent
            );
          } catch (error) {
            failures.push({
              ...cell,
              message: error instanceof Error ? error.message : String(error)
            });
          }
        })
      );
    }

    const { config } = await loadOrCreateConfig();

    return {
      run: await loadRunSummaryForBenchPack(config, plan.benchPackId, plan.runId),
      attempted: plan.cells.length,
      failed: failures.length,
      failures
    };
  }

  async resumeRun(
    input: {
      tabId: string;
      benchPackId: string;
      runId: string;
      executionMode?: BenchLocalExecutionMode;
      runsPerTest?: number;
      generation?: GenerationRequest;
    },
    onEvent?: ProgressCallback
  ) {
    await this.prepareRunSlot(input.tabId, input.benchPackId);
    const { config } = await loadOrCreateConfig();
    const activeRun = this.activeBenchPackRuns.get(input.tabId);

    if (!activeRun) {
      throw new Error("Benchmark run slot was not initialized.");
    }

    try {
      const result = await resumeBenchPackRun(
        config,
        input.benchPackId,
        {
          runId: input.runId,
          executionMode: input.executionMode,
          runsPerTest: input.runsPerTest,
          generation: input.generation,
          abortSignal: activeRun.controller.signal,
          onEvent: (progressEvent) => {
            this.emitRunEvent(input.tabId, input.benchPackId, progressEvent);
            onEvent?.(progressEvent);
          }
        },
        await this.getRuntimeCompatibility()
      );
      this.emitAgentEvent("benchpack.run.finished", {
        tabId: input.tabId,
        benchPackId: input.benchPackId,
        runId: result.runId,
        cancelled: result.cancelled === true
      });
      return result;
    } catch (error) {
      this.emitAgentEvent("benchpack.run.error", {
        tabId: input.tabId,
        benchPackId: input.benchPackId,
        runId: input.runId,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      this.activeBenchPackRuns.delete(input.tabId);
    }
  }

  async stopRun(tabId: string) {
    const activeRun = this.activeBenchPackRuns.get(tabId);

    if (!activeRun) {
      return { stopped: false };
    }

    activeRun.controller.abort(new Error("Run cancelled by user."));
    return { stopped: true };
  }

  async stopActiveBenchPackRunsForShutdown(
    options?: {
      timeoutMs?: number;
      intervalMs?: number;
    }
  ): Promise<void> {
    if (this.activeBenchPackRuns.size === 0 && this.activeVerifierStarts.size === 0) {
      return;
    }

    for (const activeRun of this.activeBenchPackRuns.values()) {
      activeRun.controller.abort(new Error("Run cancelled because BenchLocal is shutting down."));
    }

    for (const activeStart of this.activeVerifierStarts.values()) {
      activeStart.controller.abort(new Error("Verifier start cancelled because BenchLocal is shutting down."));
    }

    const timeoutMs = options?.timeoutMs ?? 15000;
    const intervalMs = options?.intervalMs ?? 50;
    const deadline = Date.now() + timeoutMs;

    while (this.activeBenchPackRuns.size > 0 || this.activeVerifierStarts.size > 0) {
      if (Date.now() >= deadline) {
        throw new Error("Timed out while waiting for active Bench Pack work to stop.");
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  async createWorkspaceTab(
    workspaceId: string,
    input: {
      benchPackId?: string | null;
      title?: string;
      modelSelections?: BenchLocalWorkspaceTabModelSelection[];
    }
  ) {
    const { config } = await loadOrCreateConfig();

    return this.mutateWorkspaceState((state) => {
      const workspace = state.workspaces[workspaceId];

      if (!workspace) {
        throw new Error(`Workspace "${workspaceId}" was not found.`);
      }

      const now = new Date().toISOString();
      const tabId = `tab-${randomUUID()}`;
      const benchPackId = input.benchPackId?.trim() || null;

      state.tabs[tabId] = {
        id: tabId,
        title: input.title?.trim() || (benchPackId ? this.createTabTitle(benchPackId) : "New Tab"),
        benchPackId,
        loadedRunId: null,
        focusedScenarioId: null,
        modelSelections: normalizeModelSelections(input.modelSelections ?? [], config),
        samplingOverrides: {},
        executionMode: "parallel_by_test_case",
        runsPerTest: 1,
        createdAt: now,
        updatedAt: now
      };
      workspace.tabIds.push(tabId);
      workspace.activeTabId = tabId;
      workspace.updatedAt = now;

      return state;
    });
  }

  async patchTab(
    tabId: string,
    patch: Partial<{
      title: string;
      focusedScenarioId: string | null;
      modelSelections: BenchLocalWorkspaceTabModelSelection[];
      samplingOverrides: GenerationRequest;
      executionMode: BenchLocalExecutionMode;
      runsPerTest: number;
    }>
  ) {
    const { config } = await loadOrCreateConfig();

    return this.mutateWorkspaceState((state) => {
      const tab = state.tabs[tabId];

      if (!tab) {
        throw new Error(`Tab "${tabId}" was not found.`);
      }

      if (patch.title !== undefined) {
        tab.title = patch.title.trim() || "New Tab";
      }

      if (patch.focusedScenarioId !== undefined) {
        tab.focusedScenarioId = patch.focusedScenarioId?.trim() || null;
      }

      if (patch.modelSelections !== undefined) {
        tab.modelSelections = normalizeModelSelections(patch.modelSelections, config);
      }

      if (patch.samplingOverrides !== undefined) {
        tab.samplingOverrides = patch.samplingOverrides;
      }

      if (patch.executionMode !== undefined) {
        tab.executionMode = patch.executionMode;
      }

      if (patch.runsPerTest !== undefined) {
        tab.runsPerTest = normalizeRunsPerTest(patch.runsPerTest);
      }

      tab.updatedAt = new Date().toISOString();
      return state;
    });
  }

  async selectTabBenchPack(tabId: string, benchPackId: string | null, title?: string) {
    return this.mutateWorkspaceState((state) => {
      const tab = state.tabs[tabId];

      if (!tab) {
        throw new Error(`Tab "${tabId}" was not found.`);
      }

      const normalizedBenchPackId = benchPackId?.trim() || null;
      tab.benchPackId = normalizedBenchPackId;
      tab.loadedRunId = null;
      tab.focusedScenarioId = null;
      tab.title = title?.trim() || (normalizedBenchPackId ? this.createTabTitle(normalizedBenchPackId) : "New Tab");
      tab.updatedAt = new Date().toISOString();

      return state;
    });
  }

  async selectTabModels(tabId: string, input: { modelIds?: string[]; selections?: BenchLocalWorkspaceTabModelSelection[] }) {
    const { config } = await loadOrCreateConfig();

    return this.mutateWorkspaceState((state) => {
      const tab = state.tabs[tabId];

      if (!tab) {
        throw new Error(`Tab "${tabId}" was not found.`);
      }

      tab.modelSelections = input.selections
        ? normalizeModelSelections(input.selections, config)
        : normalizeModelIds(input.modelIds ?? [], config);
      tab.loadedRunId = null;
      tab.updatedAt = new Date().toISOString();

      return state;
    });
  }

  async setTabLoadedRun(tabId: string, runId: string | null) {
    return this.mutateWorkspaceState((state) => {
      const tab = state.tabs[tabId];

      if (!tab) {
        return state;
      }

      tab.loadedRunId = runId;
      tab.updatedAt = new Date().toISOString();
      return state;
    });
  }

  async getSafeConfig(): Promise<BenchLocalAgentSafeConfig> {
    const { config } = await loadOrCreateConfig();
    return redactConfig(config);
  }

  private async mutateWorkspaceState(updater: (state: BenchLocalWorkspaceState) => BenchLocalWorkspaceState) {
    const { state } = await this.loadWorkspaceState();
    const nextState = updater(structuredClone(state));
    return this.saveWorkspaceState(nextState);
  }

  private async removeWorkspaceModelSelections(modelIds: Set<string>) {
    if (modelIds.size === 0) {
      return this.loadWorkspaceState();
    }

    return this.mutateWorkspaceState((state) => {
      for (const tab of Object.values(state.tabs)) {
        tab.modelSelections = tab.modelSelections.filter((selection) => !modelIds.has(selection.modelId));
      }

      return state;
    });
  }

  private async replaceWorkspaceModelSelectionId(previousModelId: string, nextModelId: string) {
    if (previousModelId === nextModelId) {
      return this.loadWorkspaceState();
    }

    return this.mutateWorkspaceState((state) => {
      for (const tab of Object.values(state.tabs)) {
        tab.modelSelections = tab.modelSelections.map((selection) =>
          selection.modelId === previousModelId ? { ...selection, modelId: nextModelId } : selection
        );
      }

      return state;
    });
  }

  private async prepareRunSlot(tabId: string, benchPackId: string) {
    const existingActiveRun = this.activeBenchPackRuns.get(tabId);

    if (existingActiveRun) {
      if (existingActiveRun.controller.signal.aborted) {
        await this.waitForBenchPackRunRelease(tabId);
      } else {
        throw new Error("A benchmark run is already active for this tab.");
      }
    }

    const controller = new AbortController();
    this.activeBenchPackRuns.set(tabId, {
      benchPackId,
      controller
    });
  }

  private async waitForBenchPackRunRelease(tabId: string) {
    const deadline = Date.now() + RUN_RELEASE_TIMEOUT_MS;

    while (this.activeBenchPackRuns.has(tabId)) {
      if (Date.now() >= deadline) {
        throw new Error("The previous benchmark run is still shutting down. Please wait a moment and try again.");
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private async waitForVerifierStartRelease(benchPackId: string) {
    const deadline = Date.now() + VERIFIER_RELEASE_TIMEOUT_MS;

    while (this.activeVerifierStarts.has(benchPackId)) {
      if (Date.now() >= deadline) {
        throw new Error(`Timed out while waiting for verifier startup "${benchPackId}" to stop.`);
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private emitRunEvent(tabId: string, benchPackId: string, event: ProgressEvent) {
    this.emitAgentEvent("benchpack.run.event", {
      tabId,
      benchPackId,
      event
    });

    if (event.type === "run_started") {
      this.emitAgentEvent("benchpack.run.started", {
        tabId,
        benchPackId,
        runId: event.runId
      });
    }
  }

  private createTabTitle(benchPackId: string): string {
    return benchPackId
      .split(/[-_]+/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ") || "New Tab";
  }
}

export const benchLocalController = new BenchLocalController();
