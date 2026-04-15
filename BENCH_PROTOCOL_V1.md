# Bench Protocol v1

## Purpose

Bench Protocol v1 defines the runtime contract between BenchLocal and installable Bench Packs.

It covers:

- Bench Pack metadata
- the runtime entrypoint
- scenario metadata
- host context
- generation settings
- verifier endpoints
- progress events
- scenario results

## Core design rules

- BenchLocal owns the shared desktop runtime
- Bench Packs own benchmark-specific behavior
- metadata is static and file-based
- runtime behavior is explicit and deterministic
- verifier dependencies are declared, not hardcoded

## Install artifact

Each Bench Pack artifact must expose:

```text
benchlocal.pack.json
dist/benchlocal/index.js
```

Optional runtime content:

- `verification/`
- `README.md`
- `METHODOLOGY.md`

## Manifest

File name:

```text
benchlocal.pack.json
```

This file is the canonical Bench Pack metadata source.

Representative shape:

```json
{
  "schemaVersion": 1,
  "protocolVersion": 1,
  "id": "bugfind-15",
  "name": "BugFind-15",
  "author": "stevibe",
  "version": "1.0.0",
  "description": "Execution-backed benchmark for bug finding and bug fixing.",
  "entry": "./dist/benchlocal/index.js",
  "requirements": {
    "benchlocal": {
      "minVersion": "0.2.0"
    },
    "hostFeatures": ["inferenceEndpoints", "dockerInferenceEndpoints"]
  },
  "samplingDefaults": {
    "temperature": 0
  },
  "capabilities": {
    "tools": false,
    "multiTurn": false,
    "streamingProgress": true,
    "verification": true
  },
  "verifiers": [
    {
      "id": "verifier",
      "transport": "http",
      "required": true,
      "defaultMode": "docker",
      "docker": {
        "buildContext": "./verification",
        "listenPort": 4010,
        "healthcheckPath": "/health"
      }
    }
  ]
}
```

Important fields:

- `id`
- `name`
- `version`
- `entry`
- `capabilities`

Common optional fields:

- `author`
- `description`
- `repository`
- `theme`
- `requirements`
- `samplingDefaults`
- `verifiers`

Compatibility requirements are optional and are enforced by the BenchLocal client at install, inspect, and run time.

Supported requirement fields:

- `requirements.benchlocal.minVersion`
  - minimum BenchLocal client version required
- `requirements.benchlocal.maxVersionExclusive`
  - exclusive upper bound for BenchLocal client version
- `requirements.hostFeatures`
  - optional host feature flags required by the pack

## Runtime entrypoint

BenchLocal loads `dist/benchlocal/index.js` and expects a default export with this shape:

```ts
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
```

`prepare(context)` is the point where the pack receives the resolved host state for a run session.

## Scenario metadata

`listScenarios()` returns the UI-visible metadata for each scenario.

Important fields:

- `id`
- `title`
- `category`
- `description`
- `detailCards`

`detailCards` power the structured scenario cards shown in the desktop UI, such as:

- `What this tests`
- `Success case`
- `Failure case`

## Host context

BenchLocal provides a `HostContext` to `prepare(context)`.

Key fields:

- `benchPack`
  - install and storage paths
- `providers`
  - resolved provider registry
- `models`
  - shared registered models
- `secrets`
  - resolved provider secrets from config or environment
- `verifiers`
  - resolved verifier endpoints and status
- `inferenceEndpoints`
  - optional host-owned OpenAI-compatible model endpoints for selected Bench Packs
- `logger`
  - host logging bridge

Bench Packs should usually use the helpers from `@benchlocal/sdk` instead of reading the raw context manually.

`inferenceEndpoints` is additive and optional. Existing packs can continue using direct provider/model access. Packs that need a host-managed model transport can use the inference endpoint helpers from `@benchlocal/sdk`.

Running inference endpoints expose:

- `baseUrl`
  - host-reachable URL for the Bench Pack runtime
- `dockerBaseUrl`
  - optional container-reachable URL for Docker verifiers
- `apiKey`
  - ephemeral BenchLocal-issued bearer token when auth is required
- `exposedModel`
  - stable model identifier the pack should send to the endpoint

## Generation settings

Per-scenario generation settings arrive as:

```ts
type GenerationRequest = {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  repetition_penalty?: number;
  request_timeout_seconds?: number;
};
```

Behavior:

- if a field is present, the pack may forward it to the provider client
- if a field is omitted, BenchLocal may still supply a platform default before the pack receives the request
- BenchLocal currently applies `request_timeout_seconds: 300` unless the pack or user overrides it

This allows:

- pack-level defaults from `benchlocal.pack.json`
- per-tab user overrides from BenchLocal
- omission of unsupported or unnecessary values

## Progress events

Bench Packs emit deterministic progress events through `emit`.

Current event types:

- `run_started`
- `scenario_started`
- `model_progress`
- `scenario_result`
- `scenario_finished`
- `run_finished`
- `run_error`

BenchLocal stores these events for detached logs, status UI, and run history.

## Scenario result

Each `runScenario(...)` call returns a `ScenarioResult`.

Representative shape:

```ts
type ScenarioResult = {
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
};
```

## Benchmark score

After a run completes, BenchLocal asks the pack to aggregate model-level results into a `BenchmarkScore`.

Representative shape:

```ts
type BenchmarkScore = {
  totalScore: number;
  categories: Array<{
    id: string;
    label: string;
    score: number;
    weight?: number;
  }>;
  summary?: string;
};
```

## Verifiers

Verifier-dependent Bench Packs declare their verifier requirements in the manifest.

BenchLocal owns:

- verifier mode selection
- Docker lifecycle
- dynamic host port assignment
- health checks
- status reporting

Bench Packs own:

- verifier implementation
- verifier request and response contract
- use of the resolved verifier URL

`listenPort` is the internal verifier port inside the container. BenchLocal assigns the host port automatically.

## Compatibility note

The codebase still carries a few `sidecar` aliases for backward compatibility.

Public protocol terminology should use:

- `verifier`
- `verifiers`

not `sidecar`.
