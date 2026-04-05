import type { BenchLocalExecutionMode } from "./workspaces.js";

export type PluginId = string;
export type ScenarioId = string;

export interface SidecarSpec {
  id: string;
  kind: "docker-http";
  required: boolean;
  defaultPort?: number;
  healthcheckPath?: string;
}

export interface PluginManifest {
  schemaVersion: 1;
  protocolVersion: 1;
  id: PluginId;
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
  capabilities: {
    tools: boolean;
    multiTurn: boolean;
    streamingProgress: boolean;
    sidecars: boolean;
    standaloneWebApp: boolean;
  };
  sidecars?: SidecarSpec[];
}

export type PluginInspectionStatus =
  | "ready"
  | "not_installed"
  | "manifest_missing"
  | "entry_missing"
  | "invalid_manifest"
  | "load_error";

export interface PluginInspection {
  id: string;
  source: string;
  rootDir?: string;
  status: PluginInspectionStatus;
  error?: string;
  manifest?: PluginManifest;
  scenarioCount?: number;
  scenarios?: ScenarioMeta[];
}

export interface PluginRunSummary {
  runId: string;
  runDir: string;
  pluginId: string;
  pluginName: string;
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

export interface PluginRunHistoryEntry {
  runId: string;
  runDir: string;
  pluginId: string;
  pluginName: string;
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

export interface GenerationDefaults {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  request_timeout_seconds: number;
  max_concurrent_models: number;
  max_concurrent_runs: number;
}

export interface SecretResolution {
  providerId: string;
  keyName: string;
  value?: string;
  source: "config" | "env" | "none";
}

export interface SidecarEndpoint {
  id: string;
  kind: "docker-http";
  required: boolean;
  status: "running" | "stopped" | "failed";
  url?: string;
  port?: number;
}

export interface HostContext {
  protocolVersion: 1;
  plugin: {
    id: string;
    version: string;
    installDir: string;
    dataDir: string;
    cacheDir: string;
    runsDir: string;
  };
  providers: ProviderConfig[];
  models: RegisteredModel[];
  defaults: GenerationDefaults;
  secrets: SecretResolution[];
  sidecars: SidecarEndpoint[];
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
  pluginId: string;
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

export interface BenchPlugin {
  manifest: PluginManifest;
  listScenarios(): Promise<ScenarioMeta[]>;
  prepare(context: HostContext): Promise<PreparedPlugin>;
  scoreModelResults(results: ScenarioResult[]): BenchmarkScore;
}

export interface PreparedPlugin {
  runScenario(input: ScenarioRunInput, emit: ProgressEmitter): Promise<ScenarioResult>;
  dispose(): Promise<void>;
}

export interface HostLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
