# BenchLocal Architecture Draft

## Purpose

BenchLocal is a desktop host for local and remote LLM benchmark execution.

It unifies the shared runtime across:

- ToolCall-15
- BugFind-15
- DataExtract-15
- InstructFollow-15
- ReasonMath-15
- StructOutput-15

The six existing benchmark repos remain standalone open-source Next.js apps. BenchLocal does not replace them. Instead, it treats each benchmark as an installable plugin with a common execution protocol.

## Goals

- Provide one desktop app for configuring providers, models, and generation parameters.
- Persist shared settings in one predictable user-owned config location.
- Install benchmark plugins by cloning their repos locally.
- Run any benchmark through one common UI and result viewer.
- Support plugin-specific dependencies such as Docker verifier sidecars.
- Preserve standalone operation for every benchmark repo.

## Non-Goals

- BenchLocal is not a cloud SaaS control plane.
- BenchLocal does not remove standalone web apps from the benchmark repos.
- BenchLocal does not let plugins own provider configuration in desktop mode.
- BenchLocal does not embed six separate web servers as the primary architecture.

## Key Decisions

### 1. One User Config Root

BenchLocal stores persistent user state under `~/.benchlocal`.

Proposed layout:

```text
~/.benchlocal/
  config.toml
  state.json
  plugins/
  runs/
  logs/
  cache/
```

Use `config.toml` for durable user configuration:

- providers
- models
- default generation params
- concurrency limits
- plugin registry
- sidecar defaults
- UI preferences

Use `state.json` for ephemeral UI state:

- last selected plugin
- last selected models
- window layout
- recent view filters

### 2. Host Owns Shared Runtime

BenchLocal must own the shared concerns that are currently duplicated in the six repos:

- provider registry
- API base URLs
- API key resolution
- model selection and grouping
- request parameters
- run scheduling
- concurrency policy
- result persistence
- trace browsing UI

If plugins continue owning these concerns, BenchLocal becomes just a launcher rather than a unified product.

### 3. Plugins Own Benchmark Logic

Each plugin owns:

- scenarios
- prompt contracts
- tool execution loop if needed
- verifier integration if needed
- scoring and rubric logic
- benchmark-specific raw traces

This keeps benchmark methodology versioned with the benchmark itself.

### 4. Standalone Mode Still Matters

Each benchmark repo must continue to support standalone Next.js execution.

Each repo should support two modes:

- standalone mode
  - reads local `.env`
  - runs its own web app
- BenchLocal mode
  - receives normalized config from BenchLocal
  - exposes a plugin entrypoint

The benchmark logic should be shared between these two modes.

## Product Shape

BenchLocal is an Electron desktop app with:

- main process
  - config manager
  - plugin manager
  - sidecar manager
  - run manager
  - secret resolution
- renderer process
  - settings UI
  - plugin library
  - benchmark run screen
  - trace viewer
  - results comparison UI
- plugin host
  - isolated Node execution context for installed plugins

Do not make BenchLocal a shell around six running Next.js servers. The Next.js apps remain for standalone mode only.

## Config Model

Primary config file:

`~/.benchlocal/config.toml`

Suggested structure:

```toml
schema_version = 1
default_plugin = "toolcall-15"
run_storage_dir = "~/.benchlocal/runs"
plugin_storage_dir = "~/.benchlocal/plugins"

[ui]
theme = "system"
show_secondary_table = true

[defaults]
temperature = 0
top_p = 1
top_k = 0
min_p = 0
repetition_penalty = 1
request_timeout_seconds = 30
max_concurrent_models = 8
max_concurrent_runs = 1

[providers.openrouter]
enabled = true
base_url = "https://openrouter.ai/api/v1"
api_key_env = "OPENROUTER_API_KEY"

[providers.ollama]
enabled = true
base_url = "http://127.0.0.1:11434/v1"

[providers.llamacpp]
enabled = false
base_url = "http://127.0.0.1:8080/v1"

[providers.mlx]
enabled = false
base_url = "http://127.0.0.1:8082/v1"

[providers.lmstudio]
enabled = false
base_url = "http://127.0.0.1:1234/v1"

[[models]]
id = "openrouter:openai/gpt-4.1"
provider = "openrouter"
model = "openai/gpt-4.1"
group = "primary"
enabled = true

[[models]]
id = "ollama:qwen3.5:4b"
provider = "ollama"
model = "qwen3.5:4b"
group = "primary"
enabled = true

[plugins.toolcall-15]
enabled = true
source = "github"
repo = "stevibe/ToolCall-15"

[plugins.bugfind-15]
enabled = true
source = "github"
repo = "stevibe/BugFind-15"

[plugins.bugfind-15.sidecars.verifier]
port = 4010
auto_start = true

[plugins.structoutput-15]
enabled = true
source = "github"
repo = "stevibe/StructOutput-15"

[plugins.structoutput-15.sidecars.verifier]
port = 4011
auto_start = true
```

## Secrets

BenchLocal should not default to storing raw API keys in `config.toml`.

Preferred order:

1. OS keychain
2. environment variable fallback
3. explicit missing-secret error

The config can reference the secret source, but not necessarily contain the raw value.

## Settings UI

BenchLocal needs a first-class settings UI. This is one of the main reasons to build the desktop app.

Required settings screens:

### Providers

- enable or disable provider
- base URL
- connection test
- secret status
- provider-specific notes

### Models

- add model
- assign provider
- set display label
- enable or disable model
- assign group such as primary or secondary
- reorder models

### Generation Defaults

- temperature
- top_p
- top_k
- min_p
- repetition_penalty
- request timeout
- concurrency limits

### Plugins

- install plugin
- update plugin
- remove plugin
- show plugin version
- show plugin capabilities
- show sidecar requirements

### Sidecars

- auto-start toggle
- configured port
- health status
- logs
- start and stop controls

### Advanced

- config file location
- runs directory
- logs directory
- reset cached state
- export and import config

## Plugin Architecture

Each benchmark repo should expose a plugin entrypoint and a plugin manifest.

Example manifest:

```json
{
  "schemaVersion": 1,
  "id": "bugfind-15",
  "name": "BugFind-15",
  "version": "0.1.0",
  "entry": "./dist/benchlocal/index.js",
  "theme": {
    "accent": "#c96b4a"
  },
  "capabilities": {
    "tools": false,
    "multiTurn": true,
    "sidecars": true
  },
  "sidecars": [
    {
      "id": "verifier",
      "type": "docker-http",
      "healthcheck": "http://127.0.0.1:4010/health"
    }
  ]
}
```

Suggested runtime contract:

```ts
export interface BenchPlugin {
  manifest: PluginManifest;
  listScenarios(): Promise<ScenarioMeta[]>;
  prepare(ctx: HostContext): Promise<PreparedPlugin>;
  scoreModelResults(results: ScenarioResult[]): BenchmarkScore;
}

export interface PreparedPlugin {
  runScenario(input: ScenarioRunInput, emit: ProgressEmitter): Promise<ScenarioResult>;
  dispose(): Promise<void>;
}
```

Normalized scenario result shape:

```ts
export interface ScenarioResult {
  scenarioId: string;
  status: "pass" | "partial" | "fail";
  score?: number;
  points?: number;
  summary: string;
  note?: string;
  rawLog: string;
  artifacts?: Array<{
    kind: string;
    label: string;
    path?: string;
    contentType?: string;
  }>;
  verifier?: {
    status: string;
    summary: string;
    details?: Record<string, unknown>;
  };
}
```

## Sidecar Model

Some plugins need external verification dependencies:

- BugFind-15 requires a Docker-backed verifier service.
- StructOutput-15 requires a validator container.

BenchLocal should manage sidecars declaratively:

- build
- start
- stop
- healthcheck
- logs
- port assignment

Do not require the user to manually juggle multiple terminals in desktop mode.

Standalone repos can keep their existing scripts such as:

- `npm run verify:sandbox:serve`
- `npm run verify:sandbox:stop`

But BenchLocal should call the equivalent plugin-defined lifecycle internally.

## Current Shared Seams In Existing Repos

The current repos already show the shared host boundaries:

- provider config parsing is duplicated across all six `lib/models.ts` files
- the run API shape is duplicated across all six `app/api/run/route.ts` files
- orchestrator event streams are structurally similar across all six `lib/orchestrator.ts` files
- BugFind-15 and StructOutput-15 add verifier boundaries on top of the same general run loop

These duplicated areas should be moved into shared BenchLocal host code and a shared SDK.

## Proposed Packages

- `BenchLocal/app`
  - Electron app
- `BenchLocal/packages/benchlocal-core`
  - shared types and event schema
- `BenchLocal/packages/benchlocal-sdk`
  - plugin authoring helpers
- `BenchLocal/packages/plugin-host`
  - isolated execution runtime for plugins

The six plugin repos can later depend on `benchlocal-sdk`.

## Migration Strategy

### Phase 1. Define The Protocol

- finalize plugin manifest schema
- finalize runtime interfaces
- finalize config schema
- finalize sidecar lifecycle contract

### Phase 2. Build BenchLocal Core

- config loader for `~/.benchlocal/config.toml`
- plugin install registry
- provider and model registry
- run manager
- sidecar manager

### Phase 3. Convert The Simplest Plugin

Convert `DataExtract-15` first because it has no sidecar and no tool loop.

Success criteria:

- plugin loads in BenchLocal
- provider config comes from BenchLocal
- benchmark runs successfully
- standalone Next.js mode still works

### Phase 4. Prove Sidecar Support

Convert `BugFind-15` next.

Success criteria:

- BenchLocal can build and start the verifier
- plugin can receive verifier endpoint from host
- standalone mode still works

### Phase 5. Convert Tool Loop Support

Convert `ToolCall-15`.

Success criteria:

- plugin can expose tool-execution benchmark logic cleanly through the protocol

### Phase 6. Convert Remaining Plugins

- InstructFollow-15
- ReasonMath-15
- StructOutput-15

### Phase 7. Harden The Product

- run history
- diff and compare views
- import and export config
- secret storage integration
- crash recovery

## Risks

### Plugin Isolation

Running arbitrary plugin code from cloned repos inside the desktop app is a trust boundary. BenchLocal should execute plugins in a controlled Node host process, not directly inside the renderer.

### Version Drift

If the standalone app and BenchLocal plugin mode diverge too much, maintenance cost will rise. The benchmark core must be shared between both modes.

### Sidecar Port Collisions

BenchLocal should own port assignment and health checks to prevent collisions such as BugFind and StructOutput both trying to occupy the same default port.

### Duplicate UI Logic

If each plugin keeps shipping custom UI for desktop mode, BenchLocal loses the benefit of a unified interface. Plugin-specific UI should be optional and limited.

## Immediate Next Steps

1. Create `Bench Protocol v1` as a separate spec document.
2. Define the exact `config.toml` schema.
3. Define the plugin manifest schema.
4. Define the sidecar lifecycle contract.
5. Start the first implementation against `DataExtract-15`.
