# Bench Protocol v1

## Purpose

Bench Protocol v1 defines how BenchLocal loads, configures, executes, and manages benchmark plugins.

This protocol is designed for the current six benchmark pillars:

- ToolCall-15
- BugFind-15
- DataExtract-15
- InstructFollow-15
- ReasonMath-15
- StructOutput-15

It must support:

- simple prompt-and-score benchmarks
- tool-calling benchmarks
- multi-turn benchmarks
- verifier-backed benchmarks with sidecars
- standalone operation in each plugin repo

## Design Principles

- Host-owned shared config
- plugin-owned benchmark logic
- deterministic event stream
- explicit sidecar requirements
- stable standalone compatibility
- versioned protocol surface

## Artifact Layout

Each installable plugin repo should expose:

```text
benchlocal.plugin.json
dist/benchlocal/index.js
```

Recommended source layout inside the plugin repo:

```text
src/benchlocal/
  index.ts
  manifest.ts
```

The standalone web app can continue to live in:

```text
app/
components/
lib/
scripts/
```

Plugin authors should build against `@benchlocal/sdk` rather than hand-rolling the host context and plugin object shape.

## Manifest

File name:

`benchlocal.plugin.json`

Example:

```json
{
  "schemaVersion": 1,
  "protocolVersion": 1,
  "id": "bugfind-15",
  "name": "BugFind-15",
  "version": "0.1.0",
  "description": "Execution-backed benchmark for bug finding and bug fixing.",
  "entry": "./dist/benchlocal/index.js",
  "repository": {
    "type": "git",
    "url": "https://github.com/stevibe/BugFind-15"
  },
  "theme": {
    "accent": "#c96b4a"
  },
  "capabilities": {
    "tools": false,
    "multiTurn": true,
    "streamingProgress": true,
    "sidecars": true,
    "standaloneWebApp": true
  },
  "sidecars": [
    {
      "id": "verifier",
      "kind": "docker-http",
      "required": true,
      "defaultPort": 4010,
      "healthcheckPath": "/health"
    }
  ]
}
```

### Manifest Fields

Required:

- `schemaVersion`
- `protocolVersion`
- `id`
- `name`
- `version`
- `entry`
- `capabilities`

Optional:

- `description`
- `repository`
- `theme`
- `sidecars`

### Manifest Constraints

- `id` must be globally unique and stable.
- `protocolVersion` must match a version supported by BenchLocal.
- `entry` must resolve relative to the repo root.
- `sidecars` must be declarative. The host decides lifecycle.

## TypeScript Interfaces

```ts
export type PluginId = string;
export type ScenarioId = string;

export interface PluginManifest {
  schemaVersion: 1;
  protocolVersion: 1;
  id: PluginId;
  name: string;
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

export interface SidecarSpec {
  id: string;
  kind: "docker-http";
  required: boolean;
  defaultPort?: number;
  healthcheckPath?: string;
}

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
```

## Host Context

BenchLocal passes normalized host-owned configuration into the plugin.

```ts
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
  secrets: SecretResolution[];
  sidecars: SidecarEndpoint[];
  logger: HostLogger;
}
```

### ProviderConfig

```ts
export interface ProviderConfig {
  id: string;
  kind: "openrouter" | "ollama" | "llamacpp" | "mlx" | "lmstudio" | "openai_compatible";
  name: string;
  enabled: boolean;
  baseUrl: string;
  authMode: "none" | "bearer";
  metadata?: Record<string, string | number | boolean>;
}
```

### RegisteredModel

```ts
export interface RegisteredModel {
  id: string;
  provider: string;
  model: string;
  label: string;
  enabled: boolean;
  group: "primary" | "secondary" | string;
}
```

### SecretResolution

```ts
export interface SecretResolution {
  providerId: string;
  keyName: string;
  value?: string;
  source: "config" | "env" | "none";
}
```

### SidecarEndpoint

```ts
export interface SidecarEndpoint {
  id: string;
  kind: "docker-http";
  required: boolean;
  status: "running" | "stopped" | "failed";
  url?: string;
  port?: number;
}
```

## Scenario Metadata

Plugins must expose a list of scenarios without executing them.

```ts
export interface ScenarioMeta {
  id: ScenarioId;
  title: string;
  category?: string;
  tags?: string[];
  description?: string;
}
```

This powers:

- run selection UI
- single-scenario reruns
- category filters
- plugin overview screens

## Scenario Run Input

BenchLocal invokes the plugin one scenario at a time, per model.

```ts
export interface ScenarioRunInput {
  runId: string;
  pluginId: string;
  scenario: ScenarioMeta;
  model: RegisteredModel;
  generation: GenerationRequest;
}

export interface GenerationRequest {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  request_timeout_seconds?: number;
}
```

The plugin must not read model/provider configuration from `.env` in BenchLocal mode. It must use the host-supplied input and host context.

## Scenario Result

Plugins return normalized results so BenchLocal can render all benchmarks in one UI.

```ts
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
```

### ModelOutput

```ts
export interface ModelOutput {
  finalAnswer?: string;
  assistantMessages?: string[];
  toolCalls?: ToolCallRecord[];
  toolResults?: ToolResultRecord[];
}
```

### ToolCallRecord

```ts
export interface ToolCallRecord {
  id: string;
  name: string;
  rawArguments: string;
  turn?: number;
}
```

### ToolResultRecord

```ts
export interface ToolResultRecord {
  callId: string;
  name: string;
  result: unknown;
}
```

### VerifierResult

```ts
export interface VerifierResult {
  status: string;
  summary: string;
  details?: Record<string, unknown>;
}
```

### ArtifactRef

```ts
export interface ArtifactRef {
  kind: string;
  label: string;
  path?: string;
  contentType?: string;
}
```

## Final Benchmark Score

Plugins remain responsible for turning scenario results into benchmark-specific aggregate scoring.

```ts
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
```

BenchLocal stores and displays this shape, but does not impose one scoring formula on all plugins.

## Progress Event Protocol

BenchLocal needs a unified progress stream similar to the current SSE behavior in the standalone apps.

```ts
export type ProgressEvent =
  | RunStartedEvent
  | ScenarioStartedEvent
  | ModelProgressEvent
  | ScenarioResultEvent
  | ScenarioFinishedEvent
  | RunFinishedEvent
  | RunErrorEvent;
```

```ts
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

export type ProgressEmitter = (event: ProgressEvent) => Promise<void> | void;
```

This shape is deliberately aligned with the current standalone orchestrator event streams.

## Sidecar Lifecycle Contract

BenchLocal owns sidecar lifecycle. Plugins declare what they need and receive running endpoints through `HostContext`.

Sidecar host responsibilities:

- resolve port
- build or pull image if needed
- start container
- healthcheck
- restart on failure if configured
- surface logs to the UI
- stop on plugin uninstall or app shutdown when appropriate

Plugins can optionally expose helper hooks for sidecars:

```ts
export interface BenchPlugin {
  manifest: PluginManifest;
  listScenarios(): Promise<ScenarioMeta[]>;
  prepare(context: HostContext): Promise<PreparedPlugin>;
  scoreModelResults(results: ScenarioResult[]): BenchmarkScore;
  sidecars?: PluginSidecarLifecycle;
}

export interface PluginSidecarLifecycle {
  validate?(context: HostContext): Promise<void>;
}
```

BenchLocal should avoid making plugin authors own raw Docker command orchestration in the primary protocol.

## Error Handling

Plugins should fail with explicit host-visible errors.

Recommended error classes:

```ts
export class PluginConfigError extends Error {}
export class PluginDependencyError extends Error {}
export class PluginExecutionError extends Error {}
```

Examples:

- missing sidecar endpoint
- unsupported scenario ID
- provider secret unavailable
- malformed plugin manifest

BenchLocal should display these as actionable UI errors, not opaque stack traces.

## Standalone Compatibility Contract

A plugin repo must support:

- BenchLocal mode
- standalone mode

Recommended pattern:

- benchmark core code moves into shared library modules
- standalone Next.js route calls the same plugin core
- standalone `.env` adapter translates local env into the same normalized host config shape

That avoids code drift between the desktop host and the standalone app.

## Security Model

Plugins are executable code. Treat them as trusted-but-isolated local extensions.

Recommended rules:

- run plugins in a separate Node host process
- do not run plugin code in the Electron renderer
- do not expose unrestricted Electron APIs directly to plugins
- surface plugin logs separately from host logs

## Compatibility Rules

BenchLocal should support a plugin if:

- `protocolVersion` is recognized
- manifest validates
- entrypoint loads
- required sidecars can be satisfied

BenchLocal should reject a plugin if:

- protocol version is unsupported
- entrypoint is missing
- duplicate plugin ID is already installed
- declared sidecar kind is unsupported

## Mapping The Current Six Repos

### DataExtract-15

- no tools
- no sidecar
- single-turn deterministic grader

### InstructFollow-15

- no tools
- no sidecar
- single-turn deterministic grader

### ReasonMath-15

- no tools
- no sidecar
- single-turn deterministic grader

### ToolCall-15

- tool loop
- no sidecar
- multi-turn assistant/tool trace

### BugFind-15

- multi-turn
- Docker HTTP verifier sidecar

### StructOutput-15

- single-turn
- Docker HTTP validator sidecar

Bench Protocol v1 is explicitly designed to cover all six without special cases in the host UI.

## Migration Guidance For Existing Repos

Each repo should add:

- `benchlocal.plugin.json`
- `src/benchlocal/index.ts`
- optional `src/benchlocal/manifest.ts`

Each repo should then:

- move provider parsing out of plugin core
- accept host-supplied models and generation params
- accept host-supplied sidecar endpoints
- expose `listScenarios`, `prepare`, and `scoreModelResults`
- keep the current Next.js app as a wrapper over the same core

## Immediate Next Step

The next document should define the exact `~/.benchlocal/config.toml` schema and the settings UI model that edits it.
