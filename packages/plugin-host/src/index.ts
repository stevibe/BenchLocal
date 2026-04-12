import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type {
  BenchmarkScore,
  BenchLocalConfig,
  BenchLocalExecutionMode,
  BenchLocalPluginConfig,
  BenchLocalVerifierConfig,
  GenerationRequest,
  HostContext,
  PluginRunHistoryEntry,
  PluginRunSummary,
  ProgressEvent,
  RegisteredModel,
  ScenarioMeta,
  ScenarioResult,
  ScenarioPackRegistry,
  ScenarioPackRegistryEntry,
  VerifierEndpoint,
  VerifierMode,
  VerifierSpec
} from "@benchlocal/core";
import {
  expandHomePath,
  getConfigPath,
  saveConfigFile,
  type PluginInspection,
  type PluginManifest
} from "@benchlocal/core";

export type PluginHostStatus = "idle" | "loading" | "ready" | "error";

export type LoadedPluginHandle = {
  pluginId: string;
  entryPath: string;
};

const execFileAsync = promisify(execFile);

async function readJsonFile<TValue>(targetPath: string): Promise<TValue> {
  const raw = await fs.readFile(targetPath, "utf8");
  return JSON.parse(raw) as TValue;
}

function isScenarioPackRegistryEntry(value: unknown): value is ScenarioPackRegistryEntry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const source = candidate.source as Record<string, unknown> | undefined;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.version === "string" &&
    typeof source === "object" &&
    source !== null &&
    ((source.type === "github" && typeof source.repo === "string" && typeof source.tag === "string") ||
      (source.type === "archive" && typeof source.url === "string"))
  );
}

function isScenarioPackRegistry(value: unknown): value is ScenarioPackRegistry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.packs) && candidate.packs.every(isScenarioPackRegistryEntry);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getBenchLocalWorkspaceRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

async function resolveBenchLocalRuntimeRoot(): Promise<string> {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const packagedRoot = resourcesPath ? path.join(resourcesPath, "benchlocal-runtime") : undefined;

  if (packagedRoot && (await pathExists(packagedRoot))) {
    return packagedRoot;
  }

  const workspaceRoot = getBenchLocalWorkspaceRoot();
  if (await pathExists(workspaceRoot)) {
    return workspaceRoot;
  }

  throw new Error("BenchLocal runtime resources are unavailable for scenario pack installation.");
}

function sanitizeRuntimeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function getVerifierContainerName(pluginId: string, verifierId: string): string {
  return `benchlocal-${sanitizeRuntimeName(pluginId)}-${sanitizeRuntimeName(verifierId)}`;
}

function getGitHubArchiveUrl(repo: string, tag: string): string {
  return `https://github.com/${repo}/archive/refs/tags/${tag}.tar.gz`;
}

function getScenarioPackBaseDir(config: BenchLocalConfig, pluginId: string): string {
  return path.join(expandHomePath(config.plugin_storage_dir), pluginId);
}

function getScenarioPackVersionsDir(baseDir: string): string {
  return path.join(baseDir, "versions");
}

function getScenarioPackCurrentPointerPath(baseDir: string): string {
  return path.join(baseDir, "current.json");
}

async function readScenarioPackCurrentVersion(baseDir: string): Promise<string | null> {
  const pointerPath = getScenarioPackCurrentPointerPath(baseDir);

  if (!(await pathExists(pointerPath))) {
    return null;
  }

  const parsed = await readJsonFile<{ version?: string }>(pointerPath);
  return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : null;
}

async function writeScenarioPackCurrentVersion(baseDir: string, version: string): Promise<void> {
  const pointerPath = getScenarioPackCurrentPointerPath(baseDir);
  const tempPath = `${pointerPath}.tmp-${randomUUID().slice(0, 8)}`;
  await fs.writeFile(
    tempPath,
    JSON.stringify(
      {
        version,
        updatedAt: new Date().toISOString()
      },
      null,
      2
    ),
    "utf8"
  );
  await fs.rename(tempPath, pointerPath);
}

async function removeScenarioPackCurrentVersion(baseDir: string): Promise<void> {
  await fs.rm(getScenarioPackCurrentPointerPath(baseDir), { force: true });
}

async function cleanupScenarioPackStaging(baseDir: string): Promise<void> {
  if (!(await pathExists(baseDir))) {
    return;
  }

  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.name.startsWith(".staging-"))
      .map((entry) => fs.rm(path.join(baseDir, entry.name), { recursive: true, force: true }))
  );
}

function sanitizeScenarioPackVersion(input: string): string {
  return input.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || randomUUID().slice(0, 8);
}

async function runDockerCommand(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", args, {
    maxBuffer: 4 * 1024 * 1024
  });

  return stdout.trim();
}

async function runTarCommand(args: string[], options?: { cwd?: string }): Promise<string> {
  const { stdout } = await execFileAsync("tar", args, {
    cwd: options?.cwd,
    maxBuffer: 8 * 1024 * 1024
  });

  return stdout.trim();
}

async function detectDockerAvailability(): Promise<{ available: boolean; details?: string }> {
  try {
    const version = await runDockerCommand(["version", "--format", "{{.Server.Version}}"]);
    return {
      available: true,
      details: version || "Docker available"
    };
  } catch (error) {
    return {
      available: false,
      details: error instanceof Error ? error.message : "Docker CLI is unavailable."
    };
  }
}

async function inspectDockerContainer(containerName: string): Promise<{
  exists: boolean;
  running: boolean;
}> {
  try {
    const stdout = await runDockerCommand([
      "inspect",
      containerName,
      "--format",
      "{{.State.Running}}"
    ]);

    return {
      exists: true,
      running: stdout === "true"
    };
  } catch {
    return {
      exists: false,
      running: false
    };
  }
}

async function inspectDockerPortBinding(
  containerName: string,
  containerPort: number
): Promise<{
  exists: boolean;
  running: boolean;
  hostPort?: number;
}> {
  try {
    const stdout = await runDockerCommand(["inspect", containerName]);
    const parsed = JSON.parse(stdout) as Array<{
      State?: { Running?: boolean };
      NetworkSettings?: {
        Ports?: Record<string, Array<{ HostPort?: string }> | null>;
      };
    }>;
    const details = parsed[0];
    const running = Boolean(details?.State?.Running);
    const portRecord = details?.NetworkSettings?.Ports?.[`${containerPort}/tcp`];
    const hostPortRaw = Array.isArray(portRecord) ? portRecord[0]?.HostPort : undefined;
    const hostPort = hostPortRaw ? Number(hostPortRaw) : undefined;

    return {
      exists: true,
      running,
      hostPort
    };
  } catch {
    return {
      exists: false,
      running: false
    };
  }
}

async function allocateLocalPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", reject);

    server.once("listening", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate local port.")));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });

    server.listen(0);
  });
}

async function inspectDockerImage(image: string): Promise<boolean> {
  try {
    await runDockerCommand(["image", "inspect", image]);
    return true;
  } catch {
    return false;
  }
}

async function stopDockerVerifierContainer(containerName: string): Promise<void> {
  try {
    await runDockerCommand(["rm", "-f", containerName]);
  } catch {
    // Treat missing containers as already stopped.
  }
}

async function startDockerVerifierContainer(
  containerName: string,
  image: string,
  hostPort: number,
  containerPort: number,
  options?: {
    pullImage?: boolean;
  }
): Promise<void> {
  await stopDockerVerifierContainer(containerName);
  if (options?.pullImage !== false) {
    await runDockerCommand(["pull", image]);
  }
  await runDockerCommand([
    "run",
    "-d",
    "--name",
    containerName,
    "-p",
    `${hostPort}:${containerPort}`,
    image
  ]);
}

async function buildDockerVerifierImage(tag: string, contextPath: string): Promise<void> {
  await runDockerCommand(["build", "-t", tag, contextPath]);
}

async function resolveInstalledScenarioPackRoot(config: BenchLocalConfig, pluginId: string): Promise<string | undefined> {
  const baseDir = getScenarioPackBaseDir(config, pluginId);

  if (!(await pathExists(baseDir))) {
    return undefined;
  }

  const currentVersion = await readScenarioPackCurrentVersion(baseDir);

  if (currentVersion) {
    const versionDir = path.join(getScenarioPackVersionsDir(baseDir), currentVersion);

    if (await pathExists(versionDir)) {
      return versionDir;
    }
  }

  const legacyManifestPath = path.join(baseDir, "benchlocal.plugin.json");
  if (await pathExists(legacyManifestPath)) {
    return baseDir;
  }

  return undefined;
}

async function resolveConfiguredPluginRoot(config: BenchLocalConfig, pluginId: string, plugin: BenchLocalPluginConfig): Promise<string | undefined> {
  if (plugin.source === "local") {
    return plugin.path ? expandHomePath(plugin.path) : undefined;
  }

  if (plugin.source === "registry" || plugin.source === "github" || plugin.source === "git") {
    return resolveInstalledScenarioPackRoot(config, pluginId);
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
    candidate.capabilities !== null &&
    ("verification" in (candidate.capabilities as Record<string, unknown>) ||
      "sidecars" in (candidate.capabilities as Record<string, unknown>))
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

async function importFreshModule(entryPath: string): Promise<Record<string, unknown>> {
  const stats = await fs.stat(entryPath);
  const url = pathToFileURL(entryPath);
  url.searchParams.set("mtime", String(stats.mtimeMs));
  return (await import(url.href)) as Record<string, unknown>;
}

async function inspectPlugin(pluginId: string, config: BenchLocalConfig, pluginConfig: BenchLocalPluginConfig): Promise<PluginInspection> {
  const rootDir = await resolveConfiguredPluginRoot(config, pluginId, pluginConfig);

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
    const loaded = normalizePluginModule(await importFreshModule(entryPath));
    const listScenarios = loaded.listScenarios;
    const runtimeManifest = isPluginManifest(loaded.manifest) ? loaded.manifest : manifest;

    if (typeof listScenarios !== "function") {
      return {
        id: pluginId,
        source: pluginConfig.source,
        rootDir,
        status: "load_error",
        manifest: runtimeManifest,
        error: "Plugin entry does not export a listScenarios function."
      };
    }

    const scenarios = await (listScenarios as () => Promise<PluginInspection["scenarios"]>)();

    return {
      id: pluginId,
      source: pluginConfig.source,
      rootDir,
      status: "ready",
      manifest: runtimeManifest,
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

export async function loadScenarioPackRegistry(config: BenchLocalConfig): Promise<ScenarioPackRegistryEntry[]> {
  const response = await fetch(config.registry.official_url, {
    method: "GET",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch scenario pack registry (${response.status}).`);
  }

  const parsed = (await response.json()) as unknown;

  if (!isScenarioPackRegistry(parsed)) {
    throw new Error("Scenario pack registry payload is invalid.");
  }

  return parsed.packs.slice().sort((left, right) => left.name.localeCompare(right.name));
}

type ScenarioPackInstallAction = "install" | "update" | "uninstall";
type ScenarioPackInstallPhase =
  | "resolving"
  | "downloading"
  | "extracting"
  | "hydrating"
  | "validating"
  | "activating"
  | "removing"
  | "complete";

export type ScenarioPackInstallProgress = {
  pluginId: string;
  action: ScenarioPackInstallAction;
  phase: ScenarioPackInstallPhase;
  message: string;
};

type InstallProgressReporter = (progress: ScenarioPackInstallProgress) => void | Promise<void>;

async function reportInstallProgress(
  reporter: InstallProgressReporter | undefined,
  progress: ScenarioPackInstallProgress
): Promise<void> {
  await reporter?.(progress);
}

async function downloadScenarioPackArchive(
  archiveUrl: string,
  archivePath: string,
  reporter: InstallProgressReporter | undefined,
  pluginId: string,
  action: ScenarioPackInstallAction
): Promise<void> {
  await reportInstallProgress(reporter, {
    pluginId,
    action,
    phase: "downloading",
    message: "Downloading scenario pack artifact."
  });

  const response = await fetch(archiveUrl);

  if (!response.ok) {
    throw new Error(`Failed to download scenario pack archive (${response.status}).`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(archivePath, buffer);
}

async function copyIfPresent(sourcePath: string, targetPath: string): Promise<void> {
  if (!(await pathExists(sourcePath))) {
    return;
  }

  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.cp(sourcePath, targetPath, { recursive: true });
}

async function hydrateBenchLocalRuntimeDependencies(rootDir: string): Promise<void> {
  const runtimeRoot = await resolveBenchLocalRuntimeRoot();
  const nodeModulesRoot = path.join(rootDir, "node_modules");
  const scopedRoot = path.join(nodeModulesRoot, "@benchlocal");

  await fs.mkdir(scopedRoot, { recursive: true });

  const requiredCopies = [
    {
      source: path.join(runtimeRoot, "packages/benchlocal-sdk"),
      target: path.join(scopedRoot, "sdk"),
      label: "@benchlocal/sdk"
    },
    {
      source: path.join(runtimeRoot, "packages/benchlocal-core"),
      target: path.join(scopedRoot, "core"),
      label: "@benchlocal/core"
    },
    {
      source: path.join(runtimeRoot, "node_modules/zod"),
      target: path.join(nodeModulesRoot, "zod"),
      label: "zod"
    },
    {
      source: path.join(runtimeRoot, "node_modules/smol-toml"),
      target: path.join(nodeModulesRoot, "smol-toml"),
      label: "smol-toml"
    }
  ];

  for (const item of requiredCopies) {
    if (!(await pathExists(item.source))) {
      throw new Error(`BenchLocal runtime dependency is missing from the app bundle: ${item.label}`);
    }
    await copyIfPresent(item.source, item.target);
  }
}

async function stageScenarioPackArchiveInstall(
  baseDir: string,
  pluginId: string,
  version: string,
  archiveUrl: string,
  reporter?: InstallProgressReporter,
  action: ScenarioPackInstallAction = "install"
): Promise<string> {
  await fs.mkdir(baseDir, { recursive: true });
  await fs.mkdir(getScenarioPackVersionsDir(baseDir), { recursive: true });
  await cleanupScenarioPackStaging(baseDir);

  const stagingRoot = path.join(baseDir, `.staging-${randomUUID().slice(0, 8)}`);
  const archivePath = path.join(stagingRoot, "package.tar.gz");
  const extractDir = path.join(stagingRoot, "extract");
  const versionKey = `${sanitizeScenarioPackVersion(version)}-${randomUUID().slice(0, 8)}`;
  const versionStageDir = path.join(stagingRoot, versionKey);
  const finalVersionDir = path.join(getScenarioPackVersionsDir(baseDir), versionKey);

  await fs.mkdir(stagingRoot, { recursive: true });

  try {
    await downloadScenarioPackArchive(archiveUrl, archivePath, reporter, pluginId, action);
    await reportInstallProgress(reporter, {
      pluginId,
      action,
      phase: "extracting",
      message: "Extracting scenario pack artifact."
    });
    await fs.mkdir(extractDir, { recursive: true });
    await runTarCommand(["-xzf", archivePath, "-C", extractDir]);

    const entries = await fs.readdir(extractDir, { withFileTypes: true });
    const topLevelDir =
      entries.length === 1 && entries[0]?.isDirectory()
        ? path.join(extractDir, entries[0].name)
        : extractDir;

    await fs.cp(topLevelDir, versionStageDir, { recursive: true });
    await reportInstallProgress(reporter, {
      pluginId,
      action,
      phase: "hydrating",
      message: "Preparing scenario pack runtime."
    });
    await hydrateBenchLocalRuntimeDependencies(versionStageDir);
    await reportInstallProgress(reporter, {
      pluginId,
      action,
      phase: "validating",
      message: "Validating scenario pack."
    });

    const manifest = await readPluginManifest(versionStageDir);
    const entryPath = path.resolve(versionStageDir, manifest.entry);

    if (!(await pathExists(entryPath))) {
      throw new Error(`Scenario pack entry is missing: ${entryPath}`);
    }

    await fs.rename(versionStageDir, finalVersionDir);
    return finalVersionDir;
  } catch (error) {
    await fs.rm(stagingRoot, { recursive: true, force: true });
    throw error;
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

export async function installScenarioPackFromRegistry(
  config: BenchLocalConfig,
  pluginId: string,
  reporter?: InstallProgressReporter
): Promise<BenchLocalConfig> {
  await reportInstallProgress(reporter, {
    pluginId,
    action: "install",
    phase: "resolving",
    message: "Resolving scenario pack from registry."
  });
  const registry = await loadScenarioPackRegistry(config);
  const entry = registry.find((candidate) => candidate.id === pluginId);

  if (!entry) {
    throw new Error(`Scenario pack "${pluginId}" was not found in the official registry.`);
  }

  const baseDir = getScenarioPackBaseDir(config, pluginId);
  const archiveUrl =
    entry.source.type === "github" ? getGitHubArchiveUrl(entry.source.repo, entry.source.tag) : entry.source.url;
  const rootDir = await stageScenarioPackArchiveInstall(baseDir, pluginId, entry.version, archiveUrl, reporter, "install");
  const manifest = await readPluginManifest(rootDir);
  await reportInstallProgress(reporter, {
    pluginId,
    action: "install",
    phase: "activating",
    message: "Activating scenario pack."
  });
  await writeScenarioPackCurrentVersion(baseDir, path.basename(rootDir));
  const nextConfig: BenchLocalConfig = structuredClone(config);
  const existing = nextConfig.plugins[pluginId];
  nextConfig.plugins[pluginId] = bootstrapPluginConfigFromManifest(manifest, entry, existing);

  if (!nextConfig.default_plugin) {
    nextConfig.default_plugin = pluginId;
  }

  await saveConfigFile(nextConfig, getConfigPath());
  await reportInstallProgress(reporter, {
    pluginId,
    action: "install",
    phase: "complete",
    message: "Scenario pack installed."
  });
  return nextConfig;
}

export async function updateScenarioPackFromRegistry(
  config: BenchLocalConfig,
  pluginId: string,
  reporter?: InstallProgressReporter
): Promise<BenchLocalConfig> {
  if (!config.plugins[pluginId]) {
    throw new Error(`Scenario pack "${pluginId}" is not installed.`);
  }

  await reportInstallProgress(reporter, {
    pluginId,
    action: "update",
    phase: "resolving",
    message: "Resolving scenario pack update."
  });
  const registry = await loadScenarioPackRegistry(config);
  const entry = registry.find((candidate) => candidate.id === pluginId);

  if (!entry) {
    throw new Error(`Scenario pack "${pluginId}" was not found in the official registry.`);
  }

  const baseDir = getScenarioPackBaseDir(config, pluginId);
  const archiveUrl =
    entry.source.type === "github" ? getGitHubArchiveUrl(entry.source.repo, entry.source.tag) : entry.source.url;
  const rootDir = await stageScenarioPackArchiveInstall(baseDir, pluginId, entry.version, archiveUrl, reporter, "update");
  const manifest = await readPluginManifest(rootDir);
  await reportInstallProgress(reporter, {
    pluginId,
    action: "update",
    phase: "activating",
    message: "Activating updated scenario pack."
  });
  await writeScenarioPackCurrentVersion(baseDir, path.basename(rootDir));

  const nextConfig: BenchLocalConfig = structuredClone(config);
  const existing = nextConfig.plugins[pluginId];
  nextConfig.plugins[pluginId] = bootstrapPluginConfigFromManifest(manifest, entry, existing);
  await saveConfigFile(nextConfig, getConfigPath());
  await reportInstallProgress(reporter, {
    pluginId,
    action: "update",
    phase: "complete",
    message: "Scenario pack updated."
  });
  return nextConfig;
}

export async function uninstallScenarioPack(
  config: BenchLocalConfig,
  pluginId: string,
  reporter?: InstallProgressReporter
): Promise<BenchLocalConfig> {
  const rootDir = getScenarioPackBaseDir(config, pluginId);
  await reportInstallProgress(reporter, {
    pluginId,
    action: "uninstall",
    phase: "removing",
    message: "Removing scenario pack."
  });

  const nextConfig: BenchLocalConfig = structuredClone(config);
  delete nextConfig.plugins[pluginId];

  if (nextConfig.default_plugin === pluginId) {
    nextConfig.default_plugin = Object.keys(nextConfig.plugins)[0] ?? "";
  }

  await saveConfigFile(nextConfig, getConfigPath());
  await removeScenarioPackCurrentVersion(rootDir);
  await fs.rm(rootDir, { recursive: true, force: true });
  await reportInstallProgress(reporter, {
    pluginId,
    action: "uninstall",
    phase: "complete",
    message: "Scenario pack removed."
  });
  return nextConfig;
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

  const rootDir = await resolveConfiguredPluginRoot(config, pluginId, pluginConfig);

  if (!rootDir || !(await pathExists(rootDir))) {
    throw new Error(`Plugin "${pluginId}" is not installed at a resolvable path.`);
  }

  const manifest = await readPluginManifest(rootDir);
  const entryPath = path.resolve(rootDir, manifest.entry);

  if (!(await pathExists(entryPath))) {
    throw new Error(`Plugin entry is missing: ${entryPath}`);
  }

  const imported = await importFreshModule(entryPath);
  const plugin = normalizeLoadedPlugin(imported);
  const runtimeManifest = isPluginManifest(plugin.manifest) ? plugin.manifest : manifest;

  return {
    rootDir,
    manifest: runtimeManifest,
    plugin
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

function getPluginRunRoot(config: BenchLocalConfig, pluginId: string): string {
  return path.join(expandHomePath(config.run_storage_dir), pluginId);
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

function compactGenerationRequest(input?: GenerationRequest): GenerationRequest {
  if (!input) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as GenerationRequest;
}

function resolveScenarioPackGeneration(
  manifest: PluginManifest,
  overrides?: GenerationRequest
): GenerationRequest {
  return compactGenerationRequest({
    ...(manifest.samplingDefaults ?? {}),
    ...(overrides ?? {})
  });
}

async function createHostContext(
  config: BenchLocalConfig,
  pluginId: string,
  rootDir: string,
  manifest: PluginManifest,
  artifacts: RunArtifacts
): Promise<HostContext> {
  const pluginConfig = config.plugins[pluginId];
  const providers = Object.entries(config.providers).map(([id, provider]) => ({
    id,
    kind: provider.kind,
    name: provider.name,
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

  const verifiers = await resolveVerifierEndpoints(pluginId, pluginConfig, manifest);

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
    secrets,
    verifiers,
    sidecars: verifiers,
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

async function probeVerifier(url: string, healthcheckPath?: string): Promise<VerifierEndpoint["status"]> {
  if (!healthcheckPath) {
    return "running";
  }

  try {
    const response = await fetch(`${url}${healthcheckPath.startsWith("/") ? healthcheckPath : `/${healthcheckPath}`}`, {
      method: "GET"
    });

    return response.ok ? "running" : "stopped";
  } catch {
    return "stopped";
  }
}

async function waitForVerifierReady(
  url: string,
  healthcheckPath?: string,
  options?: {
    attempts?: number;
    delayMs?: number;
  }
): Promise<boolean> {
  const attempts = options?.attempts ?? 12;
  const delayMs = options?.delayMs ?? 500;

  for (let index = 0; index < attempts; index += 1) {
    if ((await probeVerifier(url, healthcheckPath)) === "running") {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return false;
}

function getManifestVerifiers(manifest: PluginManifest): VerifierSpec[] {
  return manifest.verifiers ?? manifest.sidecars ?? [];
}

function bootstrapVerifierConfig(spec: VerifierSpec, existing?: BenchLocalVerifierConfig): BenchLocalVerifierConfig {
  return {
    mode: existing?.mode ?? spec.defaultMode,
    auto_start: existing?.auto_start ?? true,
    custom_url: existing?.custom_url ?? spec.customUrl?.defaultUrl,
    cloud_url: existing?.cloud_url ?? spec.cloud?.baseUrl,
    docker_image: existing?.docker_image ?? spec.docker?.image
  };
}

function bootstrapPluginConfigFromManifest(
  manifest: PluginManifest,
  entry: ScenarioPackRegistryEntry,
  existing?: BenchLocalPluginConfig
): BenchLocalPluginConfig {
  const verifierSpecs = getManifestVerifiers(manifest);
  const verifiers =
    verifierSpecs.length > 0
      ? Object.fromEntries(
          verifierSpecs.map((spec) => [
            spec.id,
            bootstrapVerifierConfig(spec, existing?.verifiers?.[spec.id] ?? existing?.sidecars?.[spec.id])
          ])
        )
      : undefined;

  return {
    enabled: existing?.enabled ?? true,
    source: "registry",
    repo: entry.source.type === "github" ? entry.source.repo : undefined,
    ref: entry.source.type === "github" ? entry.source.tag : undefined,
    version: entry.version,
    auto_update: existing?.auto_update,
    verifiers
  };
}

function getVerifierUrl(spec: VerifierSpec, config?: BenchLocalVerifierConfig): { mode: VerifierMode; url?: string; port?: number; details?: string } {
  const mode = config?.mode ?? spec.defaultMode;

  if (mode === "docker") {
    return {
      mode,
      details: "BenchLocal assigns a free local port automatically."
    };
  }

  if (mode === "cloud") {
    return {
      mode,
      url: config?.cloud_url ?? spec.cloud?.baseUrl,
      details: spec.cloud?.baseUrl ?? config?.cloud_url
    };
  }

  return {
    mode,
    url: config?.custom_url ?? spec.customUrl?.defaultUrl,
    details: config?.custom_url ?? spec.customUrl?.defaultUrl
  };
}

async function resolveDockerVerifierEndpoint(
  pluginId: string,
  spec: VerifierSpec,
  config?: BenchLocalVerifierConfig
): Promise<VerifierEndpoint> {
  const docker = await detectDockerAvailability();

  if (!docker.available) {
    return {
      id: spec.id,
      transport: spec.transport,
      mode: "docker",
      required: spec.required,
      status: "missing_dependency",
      details: docker.details
    };
  }

  const containerName = getVerifierContainerName(pluginId, spec.id);
  const containerPort = spec.docker?.containerPort;
  const container: {
    exists: boolean;
    running: boolean;
    hostPort?: number;
  } = containerPort
    ? await inspectDockerPortBinding(containerName, containerPort)
    : await inspectDockerContainer(containerName);
  const port = container.hostPort;
  const url = port ? `http://127.0.0.1:${port}` : undefined;
  const healthcheckPath = spec.docker?.healthcheckPath ?? spec.cloud?.healthcheckPath ?? spec.customUrl?.healthcheckPath;
  const status =
    container.running && url
      ? await probeVerifier(url, healthcheckPath)
      : container.exists
        ? "stopped"
        : "stopped";

  return {
    id: spec.id,
    transport: spec.transport,
    mode: "docker",
    required: spec.required,
    status,
    url,
    port,
    details: container.running
      ? spec.docker?.image
      : "BenchLocal assigns a free local port automatically when this verifier starts."
  };
}

async function resolveVerifierEndpoints(
  pluginId: string,
  pluginConfig: BenchLocalPluginConfig | undefined,
  manifest: PluginManifest
): Promise<VerifierEndpoint[]> {
  const verifierSpecs = getManifestVerifiers(manifest);

  return Promise.all(
    verifierSpecs.map(async (spec) => {
      const configured = pluginConfig?.verifiers?.[spec.id] ?? pluginConfig?.sidecars?.[spec.id];

      if ((configured?.mode ?? spec.defaultMode) === "docker") {
        return resolveDockerVerifierEndpoint(pluginId, spec, configured);
      }

      const resolved = getVerifierUrl(spec, configured);
      const healthcheckPath =
        spec.customUrl?.healthcheckPath ?? spec.cloud?.healthcheckPath ?? spec.docker?.healthcheckPath;
      const status = resolved.url ? await probeVerifier(resolved.url, healthcheckPath) : "failed";

      return {
        id: spec.id,
        transport: spec.transport,
        mode: resolved.mode,
        required: spec.required,
        status,
        url: resolved.url,
        port: resolved.port,
        details: resolved.details ?? (resolved.url ? undefined : "Verifier URL is not configured.")
      } satisfies VerifierEndpoint;
    })
  );
}

export type ConfiguredPluginVerifierStatus = {
  pluginId: string;
  pluginName: string;
  verifiers: VerifierEndpoint[];
  docker: {
    available: boolean;
    details?: string;
  };
};

async function loadConfiguredPluginRuntime(
  config: BenchLocalConfig,
  pluginId: string
): Promise<{
  rootDir: string;
  pluginConfig: BenchLocalPluginConfig;
  manifest: PluginManifest;
}> {
  const pluginConfig = config.plugins[pluginId];

  if (!pluginConfig) {
    throw new Error(`Unknown plugin "${pluginId}" in BenchLocal config.`);
  }

  const rootDir = await resolveConfiguredPluginRoot(config, pluginId, pluginConfig);

  if (!rootDir || !(await pathExists(rootDir))) {
    throw new Error(`Plugin "${pluginId}" is not installed at a resolvable path.`);
  }

  const manifest = await readPluginManifest(rootDir);
  return {
    rootDir,
    pluginConfig,
    manifest
  };
}

export async function getConfiguredPluginVerifierStatus(
  config: BenchLocalConfig,
  pluginId: string
): Promise<ConfiguredPluginVerifierStatus> {
  const { pluginConfig, manifest } = await loadConfiguredPluginRuntime(config, pluginId);
  const docker = await detectDockerAvailability();
  const verifiers = await resolveVerifierEndpoints(pluginId, pluginConfig, manifest);

  return {
    pluginId,
    pluginName: manifest.name,
    verifiers,
    docker
  };
}

export async function startConfiguredPluginVerifiers(
  config: BenchLocalConfig,
  pluginId: string
): Promise<ConfiguredPluginVerifierStatus> {
  const { rootDir, pluginConfig, manifest } = await loadConfiguredPluginRuntime(config, pluginId);
  const verifierSpecs = getManifestVerifiers(manifest);
  const docker = await detectDockerAvailability();

  for (const spec of verifierSpecs) {
    const runtime = pluginConfig.verifiers?.[spec.id] ?? pluginConfig.sidecars?.[spec.id];
    const mode = runtime?.mode ?? spec.defaultMode;

    if (mode !== "docker" || !runtime?.auto_start) {
      continue;
    }

    if (!docker.available) {
      continue;
    }

    let image = runtime.docker_image ?? spec.docker?.image;
    const containerPort = spec.docker?.containerPort;
    let pullImage = true;

    if (!image && spec.docker?.buildContext) {
      image = `benchlocal/${sanitizeRuntimeName(pluginId)}-${sanitizeRuntimeName(spec.id)}:local`;
      pullImage = false;

      if (!(await inspectDockerImage(image))) {
        await buildDockerVerifierImage(image, path.resolve(rootDir, spec.docker.buildContext));
      }
    }

    if (!image || !containerPort) {
      continue;
    }

    const hostPort = await allocateLocalPort();

    await startDockerVerifierContainer(
      getVerifierContainerName(pluginId, spec.id),
      image,
      hostPort,
      containerPort,
      {
        pullImage
      }
    );

    await waitForVerifierReady(
      `http://127.0.0.1:${hostPort}`,
      spec.docker?.healthcheckPath ?? spec.cloud?.healthcheckPath ?? spec.customUrl?.healthcheckPath
    );
  }

  return getConfiguredPluginVerifierStatus(config, pluginId);
}

export async function stopConfiguredPluginVerifiers(
  config: BenchLocalConfig,
  pluginId: string
): Promise<ConfiguredPluginVerifierStatus> {
  const { manifest } = await loadConfiguredPluginRuntime(config, pluginId);
  const verifierSpecs = getManifestVerifiers(manifest);

  await Promise.all(
    verifierSpecs.map((spec) => stopDockerVerifierContainer(getVerifierContainerName(pluginId, spec.id)))
  );

  return getConfiguredPluginVerifierStatus(config, pluginId);
}

async function executeSerialMode(
  scenarios: ScenarioMeta[],
  selectedModels: RegisteredModel[],
  prepared: Awaited<ReturnType<LoadedBenchPlugin["prepare"]>>,
  pluginId: string,
  generation: GenerationRequest,
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
          generation
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
  generation: GenerationRequest,
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
          generation
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
  generation: GenerationRequest,
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
          generation
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
  generation: GenerationRequest,
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
            generation
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
    generation?: GenerationRequest;
    abortSignal?: AbortSignal;
    onEvent?: (event: ProgressEvent) => Promise<void> | void;
  }
): Promise<PluginRunSummary> {
  const artifacts = await createRunArtifacts(config, pluginId);
  const { rootDir, manifest, plugin } = await loadConfiguredPlugin(config, pluginId);
  await startConfiguredPluginVerifiers(config, pluginId);
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
  const executionMode = options?.executionMode ?? "parallel_by_model";
  const generation = resolveScenarioPackGeneration(manifest, options?.generation);
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
          await executeSerialMode(scenarios, selectedModels, prepared, pluginId, generation, emit, resultsByModel, artifacts.runId, options?.abortSignal);
          break;
        case "parallel_by_test_case":
          await executeParallelScenariosMode(scenarios, selectedModels, prepared, pluginId, generation, emit, resultsByModel, artifacts.runId, options?.abortSignal);
          break;
        case "full_parallel":
          await executeFullParallelMode(scenarios, selectedModels, prepared, pluginId, generation, emit, resultsByModel, artifacts.runId, options?.abortSignal);
          break;
        case "parallel_by_model":
        default:
          await executeParallelModelsMode(scenarios, selectedModels, prepared, pluginId, generation, emit, resultsByModel, artifacts.runId, options?.abortSignal);
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

export async function listRunHistoryForPlugin(
  config: BenchLocalConfig,
  pluginId: string
): Promise<PluginRunHistoryEntry[]> {
  const runRoot = getPluginRunRoot(config, pluginId);

  if (!(await pathExists(runRoot))) {
    return [];
  }

  const entries = await fs.readdir(runRoot, { withFileTypes: true });
  const summaries: Array<PluginRunHistoryEntry | null> = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const summaryPath = path.join(runRoot, entry.name, "summary.json");

        if (!(await pathExists(summaryPath))) {
          return null;
        }

        const summary = await readJsonFile<PluginRunSummary>(summaryPath);
        return {
          runId: summary.runId,
          runDir: summary.runDir,
          pluginId: summary.pluginId,
          pluginName: summary.pluginName,
          executionMode: summary.executionMode,
          startedAt: summary.startedAt,
          completedAt: summary.completedAt,
          modelCount: summary.modelCount,
          scenarioCount: summary.scenarioCount,
          cancelled: summary.cancelled,
          error: summary.error
        } satisfies PluginRunHistoryEntry;
      })
  );

  return summaries
    .filter((entry): entry is PluginRunHistoryEntry => entry !== null)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export async function loadRunSummaryForPlugin(
  config: BenchLocalConfig,
  pluginId: string,
  runId: string
): Promise<PluginRunSummary> {
  const summaryPath = path.join(getPluginRunRoot(config, pluginId), runId, "summary.json");

  if (!(await pathExists(summaryPath))) {
    throw new Error(`Run history "${runId}" was not found for plugin "${pluginId}".`);
  }

  return readJsonFile<PluginRunSummary>(summaryPath);
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
