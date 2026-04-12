import type { BenchLocalExecutionMode } from "./workspaces.js";

export type BenchPackId = string;
export type ScenarioId = string;

export type VerifierMode = "cloud" | "docker" | "custom_url";

export interface VerifierSpec {
  id: string;
  transport: "http";
  required: boolean;
  description?: string;
  defaultMode: VerifierMode;
  cloud?: {
    baseUrl?: string;
    healthcheckPath?: string;
  };
  docker?: {
    image?: string;
    buildContext?: string;
    listenPort: number;
    healthcheckPath?: string;
  };
  customUrl?: {
    defaultUrl?: string;
    healthcheckPath?: string;
  };
}

export type SidecarSpec = VerifierSpec;

export interface BenchPackManifest {
  schemaVersion: 1;
  protocolVersion: 1;
  id: BenchPackId;
  name: string;
  author?: string;
  version: string;
  description?: string;
  entry: string;
  repository?: {
    type: "git";
    url: string;
  };
  theme?: {
    accent?: string;
  };
  samplingDefaults?: GenerationRequest;
  capabilities: {
    tools: boolean;
    multiTurn: boolean;
    streamingProgress: boolean;
    verification: boolean;
    standaloneWebApp: boolean;
    sidecars?: boolean;
  };
  verifiers?: VerifierSpec[];
  sidecars?: SidecarSpec[];
}

export interface BenchPackRegistryEntry {
  id: BenchPackId;
  name: string;
  author?: string;
  description?: string;
  version: string;
  source:
    | {
        type: "github";
        repo: string;
        tag: string;
      }
    | {
        type: "archive";
        url: string;
      };
  homepage?: string;
  license?: string;
  scenarioCount?: number;
  capabilities?: {
    tools?: boolean;
    multiTurn?: boolean;
    verification?: boolean;
    standaloneWebApp?: boolean;
  };
}

export interface BenchPackRegistry {
  schemaVersion: 1;
  packs: BenchPackRegistryEntry[];
}

export type BenchPackInspectionStatus =
  | "ready"
  | "not_installed"
  | "manifest_missing"
  | "entry_missing"
  | "invalid_manifest"
  | "load_error";

export interface BenchPackInspection {
  id: string;
  source: string;
  rootDir?: string;
  status: BenchPackInspectionStatus;
  error?: string;
  manifest?: BenchPackManifest;
  scenarioCount?: number;
  scenarios?: ScenarioMeta[];
}

export interface BenchPackRunSummary {
  runId: string;
  runDir: string;
  benchPackId: string;
  benchPackName: string;
  executionMode?: BenchLocalExecutionMode;
  startedAt: string;
  completedAt: string;
  modelCount: number;
  scenarioCount: number;
  cancelled?: boolean;
  error?: string;
  events: ProgressEvent[];
  resultsByModel: Record<string, ScenarioResult[]>;
  scores: Record<string, BenchmarkScore>;
}

export interface BenchPackRunHistoryEntry {
  runId: string;
  runDir: string;
  benchPackId: string;
  benchPackName: string;
  executionMode?: BenchLocalExecutionMode;
  startedAt: string;
  completedAt: string;
  modelCount: number;
  scenarioCount: number;
  cancelled?: boolean;
  error?: string;
}

export interface ScenarioMeta {
  id: ScenarioId;
  title: string;
  category?: string;
  tags?: string[];
  description?: string;
  promptText?: string;
  detailCards?: Array<{
    title: string;
    content: string;
  }>;
}

export interface ProviderConfig {
  id: string;
  kind: "openrouter" | "ollama" | "llamacpp" | "mlx" | "lmstudio" | "openai_compatible";
  name: string;
  enabled: boolean;
  baseUrl: string;
  authMode: "none" | "bearer";
  metadata?: Record<string, string | number | boolean>;
}

export interface RegisteredModel {
  id: string;
  provider: string;
  model: string;
  label: string;
  enabled: boolean;
  group: string;
}

export interface SecretResolution {
  providerId: string;
  keyName: string;
  value?: string;
  source: "config" | "env" | "none";
}

export interface VerifierEndpoint {
  id: string;
  transport: "http";
  mode: VerifierMode;
  required: boolean;
  status: "running" | "stopped" | "failed" | "missing_dependency";
  url?: string;
  port?: number;
  details?: string;
}

export type SidecarEndpoint = VerifierEndpoint;

export interface HostContext {
  protocolVersion: 1;
  benchPack: {
    id: string;
    version: string;
    installDir: string;
    dataDir: string;
    cacheDir: string;
    runsDir: string;
  };
  providers: ProviderConfig[];
  models: RegisteredModel[];
  secrets: SecretResolution[];
  verifiers: VerifierEndpoint[];
  sidecars?: SidecarEndpoint[];
  logger: HostLogger;
}

export interface GenerationRequest {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  request_timeout_seconds?: number;
}

export interface ScenarioRunInput {
  runId: string;
  benchPackId: string;
  scenario: ScenarioMeta;
  model: RegisteredModel;
  generation: GenerationRequest;
  abortSignal?: AbortSignal;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  rawArguments: string;
  turn?: number;
}

export interface ToolResultRecord {
  callId: string;
  name: string;
  result: unknown;
}

export interface ModelOutput {
  finalAnswer?: string;
  assistantMessages?: string[];
  toolCalls?: ToolCallRecord[];
  toolResults?: ToolResultRecord[];
}

export interface VerifierResult {
  status: string;
  summary: string;
  details?: Record<string, unknown>;
}

export interface ArtifactRef {
  kind: string;
  label: string;
  path?: string;
  contentType?: string;
}

export interface ScenarioResult {
  scenarioId: string;
  status: "pass" | "partial" | "fail";
  score?: number;
  points?: number;
  summary: string;
  note?: string;
  rawLog: string;
  output?: ModelOutput;
  verifier?: VerifierResult;
  artifacts?: ArtifactRef[];
  timings?: {
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
  };
}

export interface BenchmarkScore {
  totalScore: number;
  categories: Array<{
    id: string;
    label: string;
    score: number;
    weight?: number;
  }>;
  summary?: string;
}

export interface RunStartedEvent {
  type: "run_started";
  models: Array<{ id: string; label: string }>;
  totalScenarios: number;
}

export interface ScenarioStartedEvent {
  type: "scenario_started";
  scenarioId: string;
  title: string;
  index: number;
  total: number;
}

export interface ModelProgressEvent {
  type: "model_progress";
  modelId: string;
  scenarioId: string;
  message: string;
}

export interface ScenarioResultEvent {
  type: "scenario_result";
  modelId: string;
  scenarioId: string;
  result: ScenarioResult;
}

export interface ScenarioFinishedEvent {
  type: "scenario_finished";
  scenarioId: string;
}

export interface RunFinishedEvent {
  type: "run_finished";
  scores: Record<string, BenchmarkScore>;
}

export interface RunErrorEvent {
  type: "run_error";
  message: string;
}

export type ProgressEvent =
  | RunStartedEvent
  | ScenarioStartedEvent
  | ModelProgressEvent
  | ScenarioResultEvent
  | ScenarioFinishedEvent
  | RunFinishedEvent
  | RunErrorEvent;

export type ProgressEmitter = (event: ProgressEvent) => Promise<void> | void;

export interface BenchPackRuntime {
  manifest: BenchPackManifest;
  listScenarios(): Promise<ScenarioMeta[]>;
  prepare(context: HostContext): Promise<PreparedBenchPack>;
  scoreModelResults(results: ScenarioResult[]): BenchmarkScore;
}

export interface PreparedBenchPack {
  runScenario(input: ScenarioRunInput, emit: ProgressEmitter): Promise<ScenarioResult>;
  dispose(): Promise<void>;
}

export interface HostLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
