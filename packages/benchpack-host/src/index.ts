import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type {
  BenchPackRegistry,
  BenchPackRegistryEntry,
  BenchmarkScore,
  BenchLocalConfig,
  BenchLocalExecutionMode,
  BenchLocalBenchPackConfig,
  BenchLocalVerifierConfig,
  GenerationRequest,
  HostContext,
  InferenceEndpoint,
  BenchPackRunHistoryEntry,
  BenchPackRunSummary,
  ProgressEvent,
  RegisteredModel,
  ScenarioMeta,
  ScenarioResult,
  VerifierEndpoint,
  VerifierMode,
  VerifierSpec
} from "@benchlocal/core";
import {
  expandHomePath,
  getConfigPath,
  saveConfigFile,
  type BenchPackInspection,
  type BenchPackManifest
} from "@benchlocal/core";

export type BenchPackHostStatus = "idle" | "loading" | "ready" | "error";

export type LoadedBenchPackHandle = {
  benchPackId: string;
  entryPath: string;
};

const execFileAsync = promisify(execFile);
let dockerExecutablePathPromise: Promise<string | null> | null = null;

type DockerRuntimeAvailability = {
  state: "ready" | "not_installed" | "not_running";
  available: boolean;
  details?: string;
  simulated?: boolean;
};

type VerifierPreparationProgress = {
  verifierId: string;
  phase: "checking_docker" | "building_image" | "pulling_image" | "starting_container" | "waiting_for_healthcheck";
  message: string;
};

type InferenceRoute = {
  modelId: string;
  providerId: string;
  upstreamBaseUrl: string;
  upstreamModel: string;
  upstreamAuthMode: "none" | "bearer";
  upstreamApiKey?: string;
  exposedModel: string;
};

type InferenceRelay = {
  endpoints: InferenceEndpoint[];
  dispose(): Promise<void>;
};

type HostContextResources = {
  context: HostContext;
  dispose(): Promise<void>;
};

async function readJsonFile<TValue>(targetPath: string): Promise<TValue> {
  const raw = await fs.readFile(targetPath, "utf8");
  return JSON.parse(raw) as TValue;
}

function isBenchPackRegistryEntry(value: unknown): value is BenchPackRegistryEntry {
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

function isBenchPackRegistry(value: unknown): value is BenchPackRegistry {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.packs) && candidate.packs.every(isBenchPackRegistryEntry);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isExecutableFile(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getNormalizedPathEnv(): string {
  const pathEntries = new Set(
    (process.env.PATH ?? "")
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)
  );

  for (const candidate of [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    "/Applications/Docker.app/Contents/Resources/bin",
    "/Applications/OrbStack.app/Contents/MacOS/bin"
  ]) {
    pathEntries.add(candidate);
  }

  return Array.from(pathEntries).join(path.delimiter);
}

async function resolveDockerExecutable(): Promise<string | null> {
  if (!dockerExecutablePathPromise) {
    dockerExecutablePathPromise = (async () => {
      const candidates = [
        ...getNormalizedPathEnv()
          .split(path.delimiter)
          .filter(Boolean)
          .map((directory) => path.join(directory, "docker")),
        "/usr/local/bin/docker",
        "/opt/homebrew/bin/docker",
        "/Applications/Docker.app/Contents/Resources/bin/docker",
        "/Applications/OrbStack.app/Contents/MacOS/bin/docker"
      ];

      const seen = new Set<string>();
      for (const candidate of candidates) {
        if (seen.has(candidate)) {
          continue;
        }
        seen.add(candidate);
        if (await isExecutableFile(candidate)) {
          return candidate;
        }
      }

      return null;
    })();
  }

  return dockerExecutablePathPromise;
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

  throw new Error("BenchLocal runtime resources are unavailable for Bench Pack installation.");
}

function sanitizeRuntimeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function getVerifierContainerName(benchPackId: string, verifierId: string): string {
  return `benchlocal-${sanitizeRuntimeName(benchPackId)}-${sanitizeRuntimeName(verifierId)}`;
}

function getGitHubArchiveUrl(repo: string, tag: string): string {
  return `https://codeload.github.com/${repo}/tar.gz/refs/tags/${tag}`;
}

function getBenchPackBaseDir(config: BenchLocalConfig, benchPackId: string): string {
  return path.join(expandHomePath(config.benchpack_storage_dir), benchPackId);
}

function getBenchPackVersionsDir(baseDir: string): string {
  return path.join(baseDir, "versions");
}

function getBenchPackCurrentPointerPath(baseDir: string): string {
  return path.join(baseDir, "current.json");
}

async function readBenchPackCurrentVersion(baseDir: string): Promise<string | null> {
  const pointerPath = getBenchPackCurrentPointerPath(baseDir);

  if (!(await pathExists(pointerPath))) {
    return null;
  }

  const parsed = await readJsonFile<{ version?: string }>(pointerPath);
  return typeof parsed.version === "string" && parsed.version.trim() ? parsed.version.trim() : null;
}

async function writeBenchPackCurrentVersion(baseDir: string, version: string): Promise<void> {
  const pointerPath = getBenchPackCurrentPointerPath(baseDir);
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

async function removeBenchPackCurrentVersion(baseDir: string): Promise<void> {
  await fs.rm(getBenchPackCurrentPointerPath(baseDir), { force: true });
}

async function cleanupBenchPackStaging(baseDir: string): Promise<void> {
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

function sanitizeBenchPackVersion(input: string): string {
  return input.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || randomUUID().slice(0, 8);
}

async function runDockerCommand(args: string[]): Promise<string> {
  const dockerExecutable = await resolveDockerExecutable();
  if (!dockerExecutable) {
    const error = new Error("Docker CLI is not installed.");
    (error as NodeJS.ErrnoException).code = "ENOENT";
    throw error;
  }

  const { stdout } = await execFileAsync(dockerExecutable, args, {
    env: {
      ...process.env,
      PATH: getNormalizedPathEnv()
    },
    maxBuffer: 4 * 1024 * 1024
  });

  return stdout.trim();
}

async function runDockerCliVersionCheck(): Promise<boolean> {
  try {
    const dockerExecutable = await resolveDockerExecutable();
    if (!dockerExecutable) {
      return false;
    }

    await execFileAsync(dockerExecutable, ["--version"], {
      env: {
        ...process.env,
        PATH: getNormalizedPathEnv()
      },
      maxBuffer: 1024 * 1024
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return false;
    }

    return true;
  }
}

function normalizeDockerErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Docker is unavailable.";
  }

  const candidate = error.message.trim();
  return candidate || "Docker is unavailable.";
}

function getSimulatedDockerAvailability(): DockerRuntimeAvailability | null {
  const raw = process.env.BENCHLOCAL_SIMULATE_DOCKER?.trim().toLowerCase();

  if (!raw) {
    return null;
  }

  if (raw === "not_installed" || raw === "missing") {
    return {
      state: "not_installed",
      available: false,
      details: "Simulated: Docker is not installed on this machine.",
      simulated: true
    };
  }

  if (raw === "not_running" || raw === "stopped") {
    return {
      state: "not_running",
      available: false,
      details: "Simulated: Docker is installed but not running.",
      simulated: true
    };
  }

  return null;
}

async function maybeDelayVerifierPreparation(): Promise<void> {
  const raw = process.env.BENCHLOCAL_SIMULATE_VERIFIER_PREP_MS?.trim();

  if (!raw) {
    return;
  }

  const durationMs = Number(raw);

  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function runTarCommand(args: string[], options?: { cwd?: string }): Promise<string> {
  const { stdout } = await execFileAsync("tar", args, {
    cwd: options?.cwd,
    maxBuffer: 8 * 1024 * 1024
  });

  return stdout.trim();
}

async function detectDockerAvailability(): Promise<DockerRuntimeAvailability> {
  const simulated = getSimulatedDockerAvailability();

  if (simulated) {
    return simulated;
  }

  try {
    const version = await runDockerCommand(["version", "--format", "{{.Server.Version}}"]);
    return {
      state: "ready",
      available: true,
      details: version || "Docker available"
    };
  } catch (error) {
    const dockerCliInstalled = await runDockerCliVersionCheck();
    const details = normalizeDockerErrorMessage(error);

    if (!dockerCliInstalled) {
      return {
        state: "not_installed",
        available: false,
        details: "Docker is not installed."
      };
    }

    return {
      state: "not_running",
      available: false,
      details:
        /cannot connect to the docker daemon|is the docker daemon running|error during connect|connection refused/i.test(details)
          ? "Docker is installed but not running."
          : details
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
  listenPort: number
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
    const portRecord = details?.NetworkSettings?.Ports?.[`${listenPort}/tcp`];
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
  listenPort: number,
  options?: {
    pullImage?: boolean;
  }
): Promise<void> {
  await stopDockerVerifierContainer(containerName);
  if (options?.pullImage !== false) {
    await runDockerCommand(["pull", image]);
  }
  const dockerArgs = [
    "run",
    "-d",
    "--name",
    containerName,
    ...(process.platform === "linux" ? ["--add-host", "host.docker.internal:host-gateway"] : []),
    "-p",
    `${hostPort}:${listenPort}`,
    image
  ];
  await runDockerCommand(dockerArgs);
}

async function buildDockerVerifierImage(tag: string, contextPath: string): Promise<void> {
  await runDockerCommand(["build", "-t", tag, contextPath]);
}

async function resolveInstalledBenchPackRoot(config: BenchLocalConfig, benchPackId: string): Promise<string | undefined> {
  const baseDir = getBenchPackBaseDir(config, benchPackId);

  if (!(await pathExists(baseDir))) {
    return undefined;
  }

  const currentVersion = await readBenchPackCurrentVersion(baseDir);

  if (currentVersion) {
    const versionDir = path.join(getBenchPackVersionsDir(baseDir), currentVersion);

    if (await pathExists(versionDir)) {
      return versionDir;
    }
  }

  const legacyManifestPath = path.join(baseDir, "benchlocal.pack.json");
  if (await pathExists(legacyManifestPath)) {
    return baseDir;
  }

  return undefined;
}

async function resolveConfiguredBenchPackRoot(config: BenchLocalConfig, benchPackId: string, benchPack: BenchLocalBenchPackConfig): Promise<string | undefined> {
  if (benchPack.source === "local") {
    return benchPack.path ? expandHomePath(benchPack.path) : undefined;
  }

  if (
    benchPack.source === "registry" ||
    benchPack.source === "archive" ||
    benchPack.source === "github" ||
    benchPack.source === "git"
  ) {
    return resolveInstalledBenchPackRoot(config, benchPackId);
  }

  return undefined;
}

function isBenchPackManifest(value: unknown): value is BenchPackManifest {
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

async function readBenchPackManifest(rootDir: string): Promise<BenchPackManifest> {
  const manifestPath = path.join(rootDir, "benchlocal.pack.json");
  const raw = await fs.readFile(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (!isBenchPackManifest(parsed)) {
    throw new Error("Invalid benchlocal.pack.json manifest.");
  }

  return parsed;
}

function normalizeBenchPackModule(module: Record<string, unknown>): Record<string, unknown> {
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

async function inspectBenchPack(benchPackId: string, config: BenchLocalConfig, benchPackConfig: BenchLocalBenchPackConfig): Promise<BenchPackInspection> {
  const rootDir = await resolveConfiguredBenchPackRoot(config, benchPackId, benchPackConfig);

  if (!rootDir) {
    return {
      id: benchPackId,
      source: benchPackConfig.source,
      status: "not_installed",
      error: "Bench Pack root could not be resolved from config."
    };
  }

  if (!(await pathExists(rootDir))) {
    return {
      id: benchPackId,
      source: benchPackConfig.source,
      rootDir,
      status: "not_installed",
      error: "Bench Pack install directory does not exist."
    };
  }

  const manifestPath = path.join(rootDir, "benchlocal.pack.json");

  if (!(await pathExists(manifestPath))) {
    return {
      id: benchPackId,
      source: benchPackConfig.source,
      rootDir,
      status: "manifest_missing",
      error: "benchlocal.pack.json is missing."
    };
  }

  let manifest: BenchPackManifest;

  try {
    manifest = await readBenchPackManifest(rootDir);
  } catch (error) {
    return {
      id: benchPackId,
      source: benchPackConfig.source,
      rootDir,
      status: "invalid_manifest",
      error: error instanceof Error ? error.message : "Failed to parse Bench Pack manifest."
    };
  }

  const entryPath = path.resolve(rootDir, manifest.entry);

  if (!(await pathExists(entryPath))) {
    return {
      id: benchPackId,
      source: benchPackConfig.source,
      rootDir,
      status: "entry_missing",
      manifest,
      error: `Bench Pack entry is missing: ${entryPath}`
    };
  }

  try {
    const loaded = normalizeBenchPackModule(await importFreshModule(entryPath));
    const listScenarios = loaded.listScenarios;
    const runtimeManifest = isBenchPackManifest(loaded.manifest) ? loaded.manifest : manifest;

    if (typeof listScenarios !== "function") {
      return {
        id: benchPackId,
        source: benchPackConfig.source,
        rootDir,
        status: "load_error",
        manifest: runtimeManifest,
        error: "Bench Pack entry does not export a listScenarios function."
      };
    }

    const scenarios = await (listScenarios as () => Promise<BenchPackInspection["scenarios"]>)();

    return {
      id: benchPackId,
      source: benchPackConfig.source,
      rootDir,
      status: "ready",
      manifest: runtimeManifest,
      scenarioCount: scenarios?.length ?? 0,
      scenarios
    };
  } catch (error) {
    return {
      id: benchPackId,
      source: benchPackConfig.source,
      rootDir,
      status: "load_error",
      manifest,
      error: error instanceof Error ? error.message : "Failed to load bench pack entry."
    };
  }
}

export async function inspectConfiguredBenchPacks(config: BenchLocalConfig): Promise<BenchPackInspection[]> {
  return Promise.all(
    Object.entries(config.benchpacks).map(async ([benchPackId, benchPackConfig]) => inspectBenchPack(benchPackId, config, benchPackConfig))
  );
}

export async function loadBenchPackRegistry(config: BenchLocalConfig): Promise<BenchPackRegistryEntry[]> {
  const response = await fetch(config.registry.official_url, {
    method: "GET",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Bench Pack registry (${response.status}).`);
  }

  const parsed = (await response.json()) as unknown;

  if (!isBenchPackRegistry(parsed)) {
    throw new Error("Bench Pack registry payload is invalid.");
  }

  return parsed.packs.slice().sort((left, right) => left.name.localeCompare(right.name));
}

type BenchPackInstallAction = "install" | "update" | "uninstall";
type BenchPackInstallPhase =
  | "resolving"
  | "downloading"
  | "extracting"
  | "hydrating"
  | "validating"
  | "activating"
  | "removing"
  | "complete";

export type BenchPackInstallProgress = {
  benchPackId: string;
  action: BenchPackInstallAction;
  phase: BenchPackInstallPhase;
  message: string;
};

type InstallProgressReporter = (progress: BenchPackInstallProgress) => void | Promise<void>;

async function reportInstallProgress(
  reporter: InstallProgressReporter | undefined,
  progress: BenchPackInstallProgress
): Promise<void> {
  await reporter?.(progress);
}

async function downloadBenchPackArchive(
  archiveUrl: string,
  archivePath: string,
  reporter: InstallProgressReporter | undefined,
  benchPackId: string,
  action: BenchPackInstallAction
): Promise<void> {
  await reportInstallProgress(reporter, {
    benchPackId,
    action,
    phase: "downloading",
    message: "Downloading Bench Pack artifact."
  });

  const response = await fetch(archiveUrl);

  if (!response.ok) {
    throw new Error(`Failed to download Bench Pack archive (${response.status}).`);
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

async function stageBenchPackArchiveInstall(
  version: string,
  archiveUrl: string,
  reporter?: InstallProgressReporter,
  action: BenchPackInstallAction = "install",
  progressBenchPackId = "benchpack"
): Promise<{ stagingRoot: string; stagedDir: string; manifest: BenchPackManifest }> {
  const stagingRoot = path.join(os.tmpdir(), `benchlocal-benchpack-${randomUUID().slice(0, 8)}`);
  const archivePath = path.join(stagingRoot, "package.tar.gz");
  const extractDir = path.join(stagingRoot, "extract");
  const versionKey = `${sanitizeBenchPackVersion(version)}-${randomUUID().slice(0, 8)}`;
  const versionStageDir = path.join(stagingRoot, versionKey);

  await fs.mkdir(stagingRoot, { recursive: true });

  try {
    await downloadBenchPackArchive(archiveUrl, archivePath, reporter, progressBenchPackId, action);
    await reportInstallProgress(reporter, {
      benchPackId: progressBenchPackId,
      action,
      phase: "extracting",
      message: "Extracting Bench Pack artifact."
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
      benchPackId: progressBenchPackId,
      action,
      phase: "hydrating",
      message: "Preparing Bench Pack runtime."
    });
    await hydrateBenchLocalRuntimeDependencies(versionStageDir);
    await reportInstallProgress(reporter, {
      benchPackId: progressBenchPackId,
      action,
      phase: "validating",
      message: "Validating Bench Pack."
    });

    const manifest = await readBenchPackManifest(versionStageDir);
    const entryPath = path.resolve(versionStageDir, manifest.entry);

    if (!(await pathExists(entryPath))) {
      throw new Error(`Bench Pack entry is missing: ${entryPath}`);
    }

    return {
      stagingRoot,
      stagedDir: versionStageDir,
      manifest
    };
  } catch (error) {
    await fs.rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

async function commitStagedBenchPackInstall(
  config: BenchLocalConfig,
  benchPackId: string,
  version: string,
  stagedDir: string,
  stagingRoot?: string,
  options?: {
    replaceExisting?: boolean;
  }
): Promise<string> {
  const baseDir = getBenchPackBaseDir(config, benchPackId);
  if (options?.replaceExisting) {
    await fs.rm(baseDir, { recursive: true, force: true });
  }
  await fs.mkdir(baseDir, { recursive: true });
  await fs.mkdir(getBenchPackVersionsDir(baseDir), { recursive: true });
  await cleanupBenchPackStaging(baseDir);
  const versionKey = `${sanitizeBenchPackVersion(version)}-${randomUUID().slice(0, 8)}`;
  const finalVersionDir = path.join(getBenchPackVersionsDir(baseDir), versionKey);

  await fs.rename(stagedDir, finalVersionDir);
  if (stagingRoot) {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
  return finalVersionDir;
}

export async function installBenchPackFromRegistry(
  config: BenchLocalConfig,
  benchPackId: string,
  reporter?: InstallProgressReporter
): Promise<BenchLocalConfig> {
  await reportInstallProgress(reporter, {
    benchPackId,
    action: "install",
    phase: "resolving",
    message: "Resolving Bench Pack from registry."
  });
  const registry = await loadBenchPackRegistry(config);
  const entry = registry.find((candidate) => candidate.id === benchPackId);

  if (!entry) {
    throw new Error(`Bench Pack "${benchPackId}" was not found in the official registry.`);
  }

  const archiveUrl =
    entry.source.type === "github" ? getGitHubArchiveUrl(entry.source.repo, entry.source.tag) : entry.source.url;
  const baseDir = getBenchPackBaseDir(config, benchPackId);
  const staged = await stageBenchPackArchiveInstall(entry.version, archiveUrl, reporter, "install", benchPackId);
  const rootDir = await commitStagedBenchPackInstall(config, benchPackId, entry.version, staged.stagedDir, staged.stagingRoot);
  const manifest = staged.manifest;
  await reportInstallProgress(reporter, {
    benchPackId,
    action: "install",
    phase: "activating",
    message: "Activating Bench Pack."
  });
  await writeBenchPackCurrentVersion(baseDir, path.basename(rootDir));
  const nextConfig: BenchLocalConfig = structuredClone(config);
  const existing = nextConfig.benchpacks[benchPackId];
  nextConfig.benchpacks[benchPackId] = bootstrapBenchPackConfigFromManifest(manifest, entry, existing);

  if (!nextConfig.default_benchpack) {
    nextConfig.default_benchpack = benchPackId;
  }

  await saveConfigFile(nextConfig, getConfigPath());
  await reportInstallProgress(reporter, {
    benchPackId,
    action: "install",
    phase: "complete",
    message: "Bench Pack installed."
  });
  return nextConfig;
}

export async function updateBenchPackFromRegistry(
  config: BenchLocalConfig,
  benchPackId: string,
  reporter?: InstallProgressReporter
): Promise<BenchLocalConfig> {
  if (!config.benchpacks[benchPackId]) {
    throw new Error(`Bench Pack "${benchPackId}" is not installed.`);
  }

  await reportInstallProgress(reporter, {
    benchPackId,
    action: "update",
    phase: "resolving",
    message: "Resolving Bench Pack update."
  });
  const registry = await loadBenchPackRegistry(config);
  const entry = registry.find((candidate) => candidate.id === benchPackId);

  if (!entry) {
    throw new Error(`Bench Pack "${benchPackId}" was not found in the official registry.`);
  }

  const archiveUrl =
    entry.source.type === "github" ? getGitHubArchiveUrl(entry.source.repo, entry.source.tag) : entry.source.url;
  const baseDir = getBenchPackBaseDir(config, benchPackId);
  const staged = await stageBenchPackArchiveInstall(entry.version, archiveUrl, reporter, "update", benchPackId);
  await reportInstallProgress(reporter, {
    benchPackId,
    action: "update",
    phase: "removing",
    message: "Replacing installed Bench Pack."
  });
  const rootDir = await commitStagedBenchPackInstall(config, benchPackId, entry.version, staged.stagedDir, staged.stagingRoot, {
    replaceExisting: true
  });
  const manifest = staged.manifest;
  await reportInstallProgress(reporter, {
    benchPackId,
    action: "update",
    phase: "activating",
    message: "Activating updated Bench Pack."
  });
  await writeBenchPackCurrentVersion(baseDir, path.basename(rootDir));

  const nextConfig: BenchLocalConfig = structuredClone(config);
  const existing = nextConfig.benchpacks[benchPackId];
  nextConfig.benchpacks[benchPackId] = bootstrapBenchPackConfigFromManifest(manifest, entry, existing);
  await saveConfigFile(nextConfig, getConfigPath());
  await reportInstallProgress(reporter, {
    benchPackId,
    action: "update",
    phase: "complete",
    message: "Bench Pack updated."
  });
  return nextConfig;
}

export async function installBenchPackFromUrl(
  config: BenchLocalConfig,
  archiveUrl: string,
  reporter?: InstallProgressReporter
): Promise<BenchLocalConfig> {
  const normalizedUrl = archiveUrl.trim();

  if (!normalizedUrl) {
    throw new Error("Bench Pack URL is required.");
  }

  try {
    const parsed = new URL(normalizedUrl);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Bench Pack URL must use http:// or https://.");
    }
  } catch {
    throw new Error("Bench Pack URL must be a valid http:// or https:// URL.");
  }

  await reportInstallProgress(reporter, {
    benchPackId: "third-party",
    action: "install",
    phase: "resolving",
    message: "Resolving Bench Pack from URL."
  });

  const staged = await stageBenchPackArchiveInstall("url", normalizedUrl, reporter, "install", "third-party");
  const manifest = staged.manifest;
  const benchPackId = manifest.id;
  const rootDir = await commitStagedBenchPackInstall(config, benchPackId, manifest.version, staged.stagedDir, staged.stagingRoot);

  await reportInstallProgress(reporter, {
    benchPackId,
    action: "install",
    phase: "activating",
    message: "Activating Bench Pack."
  });
  await writeBenchPackCurrentVersion(getBenchPackBaseDir(config, benchPackId), path.basename(rootDir));

  const nextConfig: BenchLocalConfig = structuredClone(config);
  const existing = nextConfig.benchpacks[benchPackId];
  nextConfig.benchpacks[benchPackId] = {
    enabled: existing?.enabled ?? true,
    source: "archive",
    url: normalizedUrl,
    version: manifest.version,
    auto_update: existing?.auto_update,
    verifiers:
      getManifestVerifiers(manifest).length > 0
        ? Object.fromEntries(
            getManifestVerifiers(manifest).map((spec) => [
              spec.id,
              bootstrapVerifierConfig(spec, existing?.verifiers?.[spec.id] ?? existing?.sidecars?.[spec.id])
            ])
          )
        : undefined
  };

  if (!nextConfig.default_benchpack) {
    nextConfig.default_benchpack = benchPackId;
  }

  await saveConfigFile(nextConfig, getConfigPath());
  await reportInstallProgress(reporter, {
    benchPackId,
    action: "install",
    phase: "complete",
    message: "Bench Pack installed."
  });
  return nextConfig;
}

export async function uninstallBenchPack(
  config: BenchLocalConfig,
  benchPackId: string,
  reporter?: InstallProgressReporter
): Promise<BenchLocalConfig> {
  const rootDir = getBenchPackBaseDir(config, benchPackId);
  await reportInstallProgress(reporter, {
    benchPackId,
    action: "uninstall",
    phase: "removing",
    message: "Removing Bench Pack."
  });

  const nextConfig: BenchLocalConfig = structuredClone(config);
  delete nextConfig.benchpacks[benchPackId];

  if (nextConfig.default_benchpack === benchPackId) {
    nextConfig.default_benchpack = Object.keys(nextConfig.benchpacks)[0] ?? "";
  }

  await saveConfigFile(nextConfig, getConfigPath());
  await removeBenchPackCurrentVersion(rootDir);
  await fs.rm(rootDir, { recursive: true, force: true });
  await reportInstallProgress(reporter, {
    benchPackId,
    action: "uninstall",
    phase: "complete",
    message: "Bench Pack removed."
  });
  return nextConfig;
}

type LoadedBenchPackRuntime = {
  manifest: BenchPackManifest;
  listScenarios: () => Promise<ScenarioMeta[]>;
  prepare: (context: HostContext) => Promise<{
    runScenario: (input: {
      runId: string;
      benchPackId: string;
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

function normalizeLoadedBenchPack(module: Record<string, unknown>): LoadedBenchPackRuntime {
  const normalized = normalizeBenchPackModule(module) as Record<string, unknown>;

  if (
    typeof normalized.listScenarios !== "function" ||
    typeof normalized.prepare !== "function" ||
    typeof normalized.scoreModelResults !== "function" ||
    !normalized.manifest
  ) {
    throw new Error("Bench Pack entry does not implement the BenchLocal runtime surface.");
  }

  return normalized as unknown as LoadedBenchPackRuntime;
}

async function loadConfiguredBenchPack(config: BenchLocalConfig, benchPackId: string): Promise<{
  rootDir: string;
  manifest: BenchPackManifest;
  benchPack: LoadedBenchPackRuntime;
}> {
  const benchPackConfig = config.benchpacks[benchPackId];

  if (!benchPackConfig) {
    throw new Error(`Unknown Bench Pack "${benchPackId}" in BenchLocal config.`);
  }

  const rootDir = await resolveConfiguredBenchPackRoot(config, benchPackId, benchPackConfig);

  if (!rootDir || !(await pathExists(rootDir))) {
    throw new Error(`Bench Pack "${benchPackId}" is not installed at a resolvable path.`);
  }

  const manifest = await readBenchPackManifest(rootDir);
  const entryPath = path.resolve(rootDir, manifest.entry);

  if (!(await pathExists(entryPath))) {
    throw new Error(`Bench Pack entry is missing: ${entryPath}`);
  }

  const imported = await importFreshModule(entryPath);
  const benchPack = normalizeLoadedBenchPack(imported);
  const runtimeManifest = isBenchPackManifest(benchPack.manifest) ? benchPack.manifest : manifest;

  return {
    rootDir,
    manifest: runtimeManifest,
    benchPack
  };
}

type RunArtifacts = {
  runId: string;
  runDir: string;
  eventsPath: string;
  summaryPath: string;
  hostLogPath: string;
};

async function createRunArtifacts(config: BenchLocalConfig, benchPackId: string): Promise<RunArtifacts> {
  const runId = `${benchPackId}-${new Date().toISOString().replaceAll(":", "-")}-${randomUUID().slice(0, 8)}`;
  const runDir = path.join(expandHomePath(config.run_storage_dir), benchPackId, runId);

  await fs.mkdir(runDir, { recursive: true });

  return {
    runId,
    runDir,
    eventsPath: path.join(runDir, "events.jsonl"),
    summaryPath: path.join(runDir, "summary.json"),
    hostLogPath: path.join(runDir, "host.log")
  };
}

function getBenchPackRunRoot(config: BenchLocalConfig, benchPackId: string): string {
  return path.join(expandHomePath(config.run_storage_dir), benchPackId);
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

function resolveBenchPackGeneration(
  manifest: BenchPackManifest,
  overrides?: GenerationRequest
): GenerationRequest {
  return compactGenerationRequest({
    ...(manifest.samplingDefaults ?? {}),
    ...(overrides ?? {})
  });
}

function createHostLogger(benchPackId: string, hostLogPath: string): HostContext["logger"] {
  return {
    debug(message, meta) {
      console.debug(`[benchpack:${benchPackId}] ${message}`, meta ?? "");
      void appendTextLine(hostLogPath, `[debug] ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`);
    },
    info(message, meta) {
      console.info(`[benchpack:${benchPackId}] ${message}`, meta ?? "");
      void appendTextLine(hostLogPath, `[info] ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`);
    },
    warn(message, meta) {
      console.warn(`[benchpack:${benchPackId}] ${message}`, meta ?? "");
      void appendTextLine(hostLogPath, `[warn] ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`);
    },
    error(message, meta) {
      console.error(`[benchpack:${benchPackId}] ${message}`, meta ?? "");
      void appendTextLine(hostLogPath, `[error] ${message}${meta ? ` ${JSON.stringify(meta)}` : ""}`);
    }
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function normalizeInferencePath(pathname: string): string {
  if (pathname === "/v1") {
    return "/";
  }

  if (pathname.startsWith("/v1/")) {
    return pathname.slice(3);
  }

  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

async function readIncomingBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return Buffer.concat(chunks);
}

function writeJsonResponse(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  headers?: Record<string, string>
): void {
  const body = Buffer.from(JSON.stringify(payload), "utf8");

  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.byteLength),
    ...headers
  });
  response.end(body);
}

function createUpstreamHeaders(request: IncomingMessage, route: InferenceRoute): Headers {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) {
      continue;
    }

    const normalizedKey = key.toLowerCase();
    if (normalizedKey === "authorization" || normalizedKey === "content-length" || normalizedKey === "host") {
      continue;
    }

    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  if (route.upstreamAuthMode === "bearer" && route.upstreamApiKey) {
    headers.set("authorization", `Bearer ${route.upstreamApiKey}`);
  }

  return headers;
}

function toNodeHeaders(headers: Headers, overrides?: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};

  headers.forEach((value, key) => {
    if (overrides && key in overrides && overrides[key] === undefined) {
      return;
    }

    result[key] = value;
  });

  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value === undefined) {
      delete result[key];
      continue;
    }

    result[key] = value;
  }

  return result;
}

function rewriteResponseModel(payload: unknown, route: InferenceRoute): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  if (record.model !== route.upstreamModel) {
    return payload;
  }

  return {
    ...record,
    model: route.exposedModel
  };
}

async function startInferenceRelay(
  providers: HostContext["providers"],
  models: HostContext["models"],
  secrets: HostContext["secrets"],
  logger: HostContext["logger"]
): Promise<InferenceRelay> {
  if (models.length === 0) {
    return {
      endpoints: [],
      async dispose() {}
    };
  }

  const providerMap = new Map(providers.map((provider) => [provider.id, provider]));
  const secretMap = new Map(secrets.map((secret) => [secret.providerId, secret]));
  const failedEndpoints: InferenceEndpoint[] = [];
  const routes: InferenceRoute[] = [];

  for (const model of models) {
    const provider = providerMap.get(model.provider);

    if (!provider) {
      failedEndpoints.push({
        modelId: model.id,
        providerId: model.provider,
        transport: "openai_compatible",
        status: "failed",
        details: `Provider "${model.provider}" was not found.`
      });
      continue;
    }

    if (!provider.enabled) {
      failedEndpoints.push({
        modelId: model.id,
        providerId: model.provider,
        transport: "openai_compatible",
        status: "failed",
        details: `Provider "${model.provider}" is configured but disabled.`
      });
      continue;
    }

    const upstreamApiKey = secretMap.get(provider.id)?.value;
    if (provider.authMode === "bearer" && !upstreamApiKey) {
      failedEndpoints.push({
        modelId: model.id,
        providerId: model.provider,
        transport: "openai_compatible",
        status: "failed",
        details: `Provider "${model.provider}" requires an API key, but no secret is available.`
      });
      continue;
    }

    routes.push({
      modelId: model.id,
      providerId: provider.id,
      upstreamBaseUrl: normalizeBaseUrl(provider.baseUrl),
      upstreamModel: model.model,
      upstreamAuthMode: provider.authMode,
      upstreamApiKey,
      exposedModel: model.id
    });
  }

  if (routes.length === 0) {
    return {
      endpoints: failedEndpoints,
      async dispose() {}
    };
  }

  const relayToken = `benchlocal_${randomUUID()}`;
  const routeMap = new Map(routes.map((route) => [route.exposedModel, route]));
  const runningModelPayload = routes.map((route) => ({
    id: route.exposedModel,
    object: "model",
    created: 0,
    owned_by: route.providerId
  }));

  const server = createServer(async (request, response) => {
    const requestId = randomUUID().slice(0, 8);

    try {
      const authorization = request.headers.authorization;
      const providedToken = typeof authorization === "string" ? authorization.replace(/^Bearer\s+/i, "").trim() : "";

      if (providedToken !== relayToken) {
        writeJsonResponse(
          response,
          401,
          {
            error: {
              message: "BenchLocal inference relay rejected the request.",
              type: "invalid_request_error"
            }
          },
          {
            "www-authenticate": "Bearer"
          }
        );
        return;
      }

      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const normalizedPath = normalizeInferencePath(requestUrl.pathname);

      if (request.method === "GET" && (normalizedPath === "/models" || normalizedPath === "/")) {
        writeJsonResponse(response, 200, {
          object: "list",
          data: runningModelPayload
        });
        return;
      }

      const rawBody = await readIncomingBody(request);
      let route: InferenceRoute | undefined;
      let outboundBody = rawBody;

      if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "DELETE") {
        const contentType = String(request.headers["content-type"] ?? "");
        if (!contentType.toLowerCase().includes("application/json")) {
          writeJsonResponse(response, 415, {
            error: {
              message: "BenchLocal inference relay currently supports JSON request bodies only.",
              type: "invalid_request_error"
            }
          });
          return;
        }

        let parsedBody: unknown;
        try {
          parsedBody = rawBody.length > 0 ? JSON.parse(rawBody.toString("utf8")) : {};
        } catch {
          writeJsonResponse(response, 400, {
            error: {
              message: "BenchLocal inference relay received invalid JSON.",
              type: "invalid_request_error"
            }
          });
          return;
        }

        if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
          writeJsonResponse(response, 400, {
            error: {
              message: "BenchLocal inference relay expected a JSON object request body.",
              type: "invalid_request_error"
            }
          });
          return;
        }

        const modelId = typeof (parsedBody as Record<string, unknown>).model === "string" ? String((parsedBody as Record<string, unknown>).model) : "";
        route = routeMap.get(modelId);

        if (!route) {
          writeJsonResponse(response, 404, {
            error: {
              message: `Model "${modelId || "unknown"}" is not exposed by the BenchLocal inference relay.`,
              type: "invalid_request_error"
            }
          });
          return;
        }

        outboundBody = Buffer.from(
          JSON.stringify({
            ...(parsedBody as Record<string, unknown>),
            model: route.upstreamModel
          }),
          "utf8"
        );
      } else {
        const queryModelId = requestUrl.searchParams.get("model");
        route = queryModelId ? routeMap.get(queryModelId) : routes[0];

        if (!route) {
          writeJsonResponse(response, 503, {
            error: {
              message: "No running models are currently exposed by the BenchLocal inference relay.",
              type: "server_error"
            }
          });
          return;
        }
      }

      const upstreamUrl = new URL(normalizedPath.replace(/^\//, ""), route.upstreamBaseUrl);
      upstreamUrl.search = requestUrl.search;

      const upstreamResponse = await fetch(upstreamUrl, {
        method: request.method ?? "GET",
        headers: createUpstreamHeaders(request, route),
        body: outboundBody.length > 0 ? outboundBody.toString("utf8") : undefined
      });

      const contentType = upstreamResponse.headers.get("content-type") ?? "";
      if (contentType.toLowerCase().includes("application/json")) {
        const rawText = await upstreamResponse.text();
        let responseBody = rawText;

        try {
          const parsed = JSON.parse(rawText);
          responseBody = JSON.stringify(rewriteResponseModel(parsed, route));
        } catch {
          responseBody = rawText;
        }

        response.writeHead(
          upstreamResponse.status,
          toNodeHeaders(upstreamResponse.headers, {
            "content-length": String(Buffer.byteLength(responseBody)),
            "transfer-encoding": undefined
          })
        );
        response.end(responseBody);
        return;
      }

      response.writeHead(upstreamResponse.status, toNodeHeaders(upstreamResponse.headers));
      if (!upstreamResponse.body) {
        response.end();
        return;
      }

      await pipeline(Readable.fromWeb(upstreamResponse.body as never), response);
    } catch (error) {
      logger.error("Inference relay request failed.", {
        error: toErrorMessage(error),
        requestId
      });

      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }

      writeJsonResponse(response, 502, {
        error: {
          message: "BenchLocal inference relay failed to reach the upstream provider.",
          type: "server_error",
          details: toErrorMessage(error)
        }
      });
    }
  });

  try {
    const address = await new Promise<ReturnType<typeof server.address>>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "0.0.0.0", () => resolve(server.address()));
    });

    if (!address || typeof address === "string") {
      throw new Error("BenchLocal inference relay failed to bind to a local TCP port.");
    }

    const baseUrl = `http://127.0.0.1:${address.port}/v1/`;
    const dockerBaseUrl = `http://host.docker.internal:${address.port}/v1/`;
    logger.info("Started BenchLocal inference relay.", {
      baseUrl,
      dockerBaseUrl,
      modelCount: routes.length
    });

    return {
      endpoints: [
        ...routes.map((route) => ({
          modelId: route.modelId,
          providerId: route.providerId,
          transport: "openai_compatible" as const,
          status: "running" as const,
          baseUrl,
          dockerBaseUrl,
          authMode: "bearer" as const,
          apiKey: relayToken,
          exposedModel: route.exposedModel
        })),
        ...failedEndpoints
      ],
      async dispose() {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        });
        logger.info("Stopped BenchLocal inference relay.", {
          baseUrl,
          dockerBaseUrl
        });
      }
    };
  } catch (error) {
    logger.error("Failed to start BenchLocal inference relay.", {
      error: toErrorMessage(error)
    });

    return {
      endpoints: [
        ...routes.map((route) => ({
          modelId: route.modelId,
          providerId: route.providerId,
          transport: "openai_compatible" as const,
          status: "failed" as const,
          details: `BenchLocal inference relay failed to start: ${toErrorMessage(error)}`
        })),
        ...failedEndpoints
      ],
      async dispose() {}
    };
  }
}

async function createHostContext(
  config: BenchLocalConfig,
  benchPackId: string,
  rootDir: string,
  manifest: BenchPackManifest,
  artifacts: RunArtifacts
): Promise<HostContextResources> {
  const benchPackConfig = config.benchpacks[benchPackId];
  const logger = createHostLogger(benchPackId, artifacts.hostLogPath);
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

  const verifiers = await resolveVerifierEndpoints(benchPackId, benchPackConfig, manifest);
  const inferenceRelay = await startInferenceRelay(providers, models, secrets, logger);

  return {
    context: {
      protocolVersion: 1,
      benchPack: {
        id: benchPackId,
        version: manifest.version,
        installDir: rootDir,
        dataDir: path.join(expandHomePath(config.cache_dir), "benchpack-data", benchPackId),
        cacheDir: path.join(expandHomePath(config.cache_dir), "benchpacks", benchPackId),
        runsDir: artifacts.runDir
      },
      providers,
      models,
      secrets,
      verifiers,
      sidecars: verifiers,
      inferenceEndpoints: inferenceRelay.endpoints,
      logger
    },
    dispose: inferenceRelay.dispose
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

function getManifestVerifiers(manifest: BenchPackManifest): VerifierSpec[] {
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

function bootstrapBenchPackConfigFromManifest(
  manifest: BenchPackManifest,
  entry: BenchPackRegistryEntry,
  existing?: BenchLocalBenchPackConfig
): BenchLocalBenchPackConfig {
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

function formatDockerVerifierUnavailableMessage(benchPackId: string, availability: DockerRuntimeAvailability): string {
  if (availability.state === "not_installed") {
    return `Bench Pack "${benchPackId}" requires Local Docker, but Docker is not installed.`;
  }

  return `Bench Pack "${benchPackId}" requires Local Docker, but Docker is not running.`;
}

async function resolveDockerVerifierEndpoint(
  benchPackId: string,
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
      status: docker.state === "not_running" ? "dependency_not_running" : "missing_dependency",
      details: docker.details
    };
  }

  const containerName = getVerifierContainerName(benchPackId, spec.id);
  const listenPort = spec.docker?.listenPort;
  const container: {
    exists: boolean;
    running: boolean;
    hostPort?: number;
  } = listenPort
    ? await inspectDockerPortBinding(containerName, listenPort)
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
  benchPackId: string,
  benchPackConfig: BenchLocalBenchPackConfig | undefined,
  manifest: BenchPackManifest
): Promise<VerifierEndpoint[]> {
  const verifierSpecs = getManifestVerifiers(manifest);

  return Promise.all(
    verifierSpecs.map(async (spec) => {
      const configured = benchPackConfig?.verifiers?.[spec.id] ?? benchPackConfig?.sidecars?.[spec.id];

      if ((configured?.mode ?? spec.defaultMode) === "docker") {
        return resolveDockerVerifierEndpoint(benchPackId, spec, configured);
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

export type ConfiguredBenchPackVerifierStatus = {
  benchPackId: string;
  benchPackName: string;
  verifiers: VerifierEndpoint[];
  docker: DockerRuntimeAvailability;
};

async function loadConfiguredBenchPackRuntime(
  config: BenchLocalConfig,
  benchPackId: string
): Promise<{
  rootDir: string;
  benchPackConfig: BenchLocalBenchPackConfig;
  manifest: BenchPackManifest;
}> {
  const benchPackConfig = config.benchpacks[benchPackId];

  if (!benchPackConfig) {
    throw new Error(`Unknown Bench Pack "${benchPackId}" in BenchLocal config.`);
  }

  const rootDir = await resolveConfiguredBenchPackRoot(config, benchPackId, benchPackConfig);

  if (!rootDir || !(await pathExists(rootDir))) {
    throw new Error(`Bench Pack "${benchPackId}" is not installed at a resolvable path.`);
  }

  const manifest = await readBenchPackManifest(rootDir);
  return {
    rootDir,
    benchPackConfig,
    manifest
  };
}

export async function getConfiguredBenchPackVerifierStatus(
  config: BenchLocalConfig,
  benchPackId: string
): Promise<ConfiguredBenchPackVerifierStatus> {
  const { benchPackConfig, manifest } = await loadConfiguredBenchPackRuntime(config, benchPackId);
  const docker = await detectDockerAvailability();
  const verifiers = await resolveVerifierEndpoints(benchPackId, benchPackConfig, manifest);

  return {
    benchPackId,
    benchPackName: manifest.name,
    verifiers,
    docker
  };
}

export async function startConfiguredBenchPackVerifiers(
  config: BenchLocalConfig,
  benchPackId: string,
  options?: {
    abortSignal?: AbortSignal;
    onProgress?: (progress: VerifierPreparationProgress) => Promise<void> | void;
  }
): Promise<ConfiguredBenchPackVerifierStatus> {
  const { rootDir, benchPackConfig, manifest } = await loadConfiguredBenchPackRuntime(config, benchPackId);
  const verifierSpecs = getManifestVerifiers(manifest);
  const docker = await detectDockerAvailability();

  for (const spec of verifierSpecs) {
    const runtime = benchPackConfig.verifiers?.[spec.id] ?? benchPackConfig.sidecars?.[spec.id];
    const mode = runtime?.mode ?? spec.defaultMode;

    if (mode !== "docker" || !runtime?.auto_start) {
      continue;
    }

    throwIfAborted(options?.abortSignal);
    await options?.onProgress?.({
      verifierId: spec.id,
      phase: "checking_docker",
      message: docker.available
        ? "Checking Local Docker availability."
        : docker.details ?? "Checking Local Docker availability."
    });

    if (!docker.available) {
      if (spec.required) {
        throw new Error(formatDockerVerifierUnavailableMessage(benchPackId, docker));
      }
      continue;
    }

    let image = runtime.docker_image ?? spec.docker?.image;
    const listenPort = spec.docker?.listenPort;
    let pullImage = true;

    if (!image && spec.docker?.buildContext) {
      image = `benchlocal/${sanitizeRuntimeName(benchPackId)}-${sanitizeRuntimeName(spec.id)}:local`;
      pullImage = false;

      if (!(await inspectDockerImage(image))) {
        await options?.onProgress?.({
          verifierId: spec.id,
          phase: "building_image",
          message: "Building the local verifier image."
        });
        await maybeDelayVerifierPreparation();
        throwIfAborted(options?.abortSignal);
        await buildDockerVerifierImage(image, path.resolve(rootDir, spec.docker.buildContext));
      }
    }

    if (!image || !listenPort) {
      if (spec.required) {
        throw new Error(`Bench Pack "${benchPackId}" is missing Docker verifier metadata for "${spec.id}".`);
      }
      continue;
    }

    const hostPort = await allocateLocalPort();

    if (pullImage) {
      await options?.onProgress?.({
        verifierId: spec.id,
        phase: "pulling_image",
        message: `Pulling verifier image ${image}.`
      });
      await maybeDelayVerifierPreparation();
      throwIfAborted(options?.abortSignal);
    }

    await options?.onProgress?.({
      verifierId: spec.id,
      phase: "starting_container",
      message: `Starting verifier ${spec.id}.`
    });
    await maybeDelayVerifierPreparation();
    throwIfAborted(options?.abortSignal);
    await startDockerVerifierContainer(
      getVerifierContainerName(benchPackId, spec.id),
      image,
      hostPort,
      listenPort,
      {
        pullImage
      }
    );

    await options?.onProgress?.({
      verifierId: spec.id,
      phase: "waiting_for_healthcheck",
      message: "Waiting for the verifier health check to pass."
    });
    await maybeDelayVerifierPreparation();
    throwIfAborted(options?.abortSignal);
    await waitForVerifierReady(
      `http://127.0.0.1:${hostPort}`,
      spec.docker?.healthcheckPath ?? spec.cloud?.healthcheckPath ?? spec.customUrl?.healthcheckPath
    );
  }

  return getConfiguredBenchPackVerifierStatus(config, benchPackId);
}

export async function stopConfiguredBenchPackVerifiers(
  config: BenchLocalConfig,
  benchPackId: string
): Promise<ConfiguredBenchPackVerifierStatus> {
  const { manifest } = await loadConfiguredBenchPackRuntime(config, benchPackId);
  const verifierSpecs = getManifestVerifiers(manifest);

  await Promise.all(
    verifierSpecs.map((spec) => stopDockerVerifierContainer(getVerifierContainerName(benchPackId, spec.id)))
  );

  return getConfiguredBenchPackVerifierStatus(config, benchPackId);
}

async function executeSerialMode(
  scenarios: ScenarioMeta[],
  selectedModels: RegisteredModel[],
  prepared: Awaited<ReturnType<LoadedBenchPackRuntime["prepare"]>>,
  benchPackId: string,
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
          benchPackId,
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
  prepared: Awaited<ReturnType<LoadedBenchPackRuntime["prepare"]>>,
  benchPackId: string,
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
          benchPackId,
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
  prepared: Awaited<ReturnType<LoadedBenchPackRuntime["prepare"]>>,
  benchPackId: string,
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
          benchPackId,
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
  prepared: Awaited<ReturnType<LoadedBenchPackRuntime["prepare"]>>,
  benchPackId: string,
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
            benchPackId,
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

export async function runConfiguredBenchPack(
  config: BenchLocalConfig,
  benchPackId: string,
  options?: {
    modelIds?: string[];
    executionMode?: BenchLocalExecutionMode;
    generation?: GenerationRequest;
    abortSignal?: AbortSignal;
    onEvent?: (event: ProgressEvent) => Promise<void> | void;
  }
): Promise<BenchPackRunSummary> {
  const artifacts = await createRunArtifacts(config, benchPackId);
  const { rootDir, manifest, benchPack } = await loadConfiguredBenchPack(config, benchPackId);
  const events: ProgressEvent[] = [];
  const emit = async (event: ProgressEvent) => {
    events.push(event);
    await appendJsonLine(artifacts.eventsPath, event);
    await options?.onEvent?.(event);
  };

  await startConfiguredBenchPackVerifiers(config, benchPackId, {
    abortSignal: options?.abortSignal,
    onProgress: async (progress) => {
      await emit({
        type: "verifier_preparing",
        benchPackId,
        benchPackName: manifest.name,
        verifierId: progress.verifierId,
        phase: progress.phase,
        message: progress.message
      });
    }
  });
  const hostResources = await createHostContext(config, benchPackId, rootDir, manifest, artifacts);
  const hostContext = hostResources.context;
  let hostDisposed = false;
  const disposeHostResources = async () => {
    if (hostDisposed) {
      return;
    }

    hostDisposed = true;
    await hostResources.dispose();
  };

  try {
    const blockingVerifier = hostContext.verifiers.find((verifier) => verifier.required && verifier.status !== "running");

    if (blockingVerifier) {
      if (blockingVerifier.status === "missing_dependency") {
        throw new Error(blockingVerifier.details ?? `Bench Pack "${manifest.name}" requires Local Docker.`);
      }

      if (blockingVerifier.status === "dependency_not_running") {
        throw new Error(blockingVerifier.details ?? `Bench Pack "${manifest.name}" requires Local Docker to be running.`);
      }

      throw new Error(
        blockingVerifier.details ??
          `Bench Pack "${manifest.name}" requires verifier "${blockingVerifier.id}" to be running before the test can start.`
      );
    }

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

    const scenarios = await benchPack.listScenarios();
    const prepared = await benchPack.prepare(hostContext);
    const resultsByModel: Record<string, ScenarioResult[]> = Object.fromEntries(selectedModels.map((model) => [model.id, []]));
    const startedAt = new Date().toISOString();
    const executionMode = options?.executionMode ?? "parallel_by_model";
    const generation = resolveBenchPackGeneration(manifest, options?.generation);
    let runErrorMessage: string | undefined;
    let cancelled = false;

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
            await executeSerialMode(scenarios, selectedModels, prepared, benchPackId, generation, emit, resultsByModel, artifacts.runId, options?.abortSignal);
            break;
          case "parallel_by_test_case":
            await executeParallelScenariosMode(scenarios, selectedModels, prepared, benchPackId, generation, emit, resultsByModel, artifacts.runId, options?.abortSignal);
            break;
          case "full_parallel":
            await executeFullParallelMode(scenarios, selectedModels, prepared, benchPackId, generation, emit, resultsByModel, artifacts.runId, options?.abortSignal);
            break;
          case "parallel_by_model":
          default:
            await executeParallelModelsMode(scenarios, selectedModels, prepared, benchPackId, generation, emit, resultsByModel, artifacts.runId, options?.abortSignal);
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

      const scores = Object.fromEntries(
        Object.entries(resultsByModel).map(([modelId, results]) => [modelId, benchPack.scoreModelResults(results)])
      );

      if (!runErrorMessage) {
        await emit({
          type: "run_finished",
          scores
        });
      }

      const summary: BenchPackRunSummary = {
        runId: artifacts.runId,
        runDir: artifacts.runDir,
        benchPackId,
        benchPackName: manifest.name,
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
    } finally {
      await prepared.dispose();
      await disposeHostResources();
    }
  } catch (error) {
    await disposeHostResources();
    throw error;
  }
}

export async function listRunHistoryForBenchPack(
  config: BenchLocalConfig,
  benchPackId: string
): Promise<BenchPackRunHistoryEntry[]> {
  const runRoot = getBenchPackRunRoot(config, benchPackId);

  if (!(await pathExists(runRoot))) {
    return [];
  }

  const entries = await fs.readdir(runRoot, { withFileTypes: true });
  const summaries: Array<BenchPackRunHistoryEntry | null> = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const summaryPath = path.join(runRoot, entry.name, "summary.json");

        if (!(await pathExists(summaryPath))) {
          return null;
        }

        const summary = await readJsonFile<BenchPackRunSummary>(summaryPath);
        return {
          runId: summary.runId,
          runDir: summary.runDir,
          benchPackId: summary.benchPackId,
          benchPackName: summary.benchPackName,
          executionMode: summary.executionMode,
          startedAt: summary.startedAt,
          completedAt: summary.completedAt,
          modelCount: summary.modelCount,
          scenarioCount: summary.scenarioCount,
          cancelled: summary.cancelled,
          error: summary.error
        } satisfies BenchPackRunHistoryEntry;
      })
  );

  return summaries
    .filter((entry): entry is BenchPackRunHistoryEntry => entry !== null)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export async function loadRunSummaryForBenchPack(
  config: BenchLocalConfig,
  benchPackId: string,
  runId: string
): Promise<BenchPackRunSummary> {
  const summaryPath = path.join(getBenchPackRunRoot(config, benchPackId), runId, "summary.json");

  if (!(await pathExists(summaryPath))) {
    throw new Error(`Run history "${runId}" was not found for Bench Pack "${benchPackId}".`);
  }

  return readJsonFile<BenchPackRunSummary>(summaryPath);
}

export async function clearRunHistoryForBenchPack(config: BenchLocalConfig, benchPackId: string): Promise<{ removed: boolean }> {
  const runRoot = getBenchPackRunRoot(config, benchPackId);
  await fs.rm(runRoot, { recursive: true, force: true });
  return { removed: true };
}

export function createBenchPackHost() {
  let status: BenchPackHostStatus = "idle";

  return {
    getStatus(): BenchPackHostStatus {
      return status;
    },
    async loadBenchPack(entryPath: string, benchPackId: string): Promise<LoadedBenchPackHandle> {
      status = "loading";
      status = "ready";

      return {
        benchPackId,
        entryPath
      };
    }
  };
}
