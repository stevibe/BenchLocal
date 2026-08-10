# @benchlocal/web-sdk

Browser SDK for Interactive Web Bench Packs in the BenchLocal ecosystem.

This package is part of the `github.com/stevibe/BenchLocal` project. BenchLocal is a local LLM benchmarking desktop app. The web SDK lets a hosted Bench Pack UI ask the local BenchLocal app to run inference with the user's saved providers and selected models, without exposing provider credentials to the hosted page.

Use this package when you are building a Bench Pack that renders as a web app instead of the standard BenchLocal result table.

## Install

```bash
npm install @benchlocal/web-sdk
```

`@benchlocal/web-sdk` is MIT licensed.

## What This SDK Does

Interactive Web Bench Packs run in a browser surface inside the BenchLocal desktop app. The web page owns the visual benchmark experience. BenchLocal owns local state and sensitive execution:

- provider credentials
- model configuration
- selected models for the current tab
- chat and streaming inference
- run state shown in the BenchLocal tab shell
- history records and artifacts

The SDK talks to BenchLocal through a narrow `postMessage` bridge. It does not work as a general HTTP proxy and it does not expose API keys.

## When To Use It

Use `@benchlocal/web-sdk` for hosted or local web benchmarks that need richer presentation than a table:

- form-filling benchmarks
- browser-like task simulations
- interactive prompt challenges
- visual tool-use tests
- agent workflow demos
- benchmarks with custom progress, playback, or artifacts

For normal table-based Bench Packs, use `@benchlocal/sdk` instead.

## Quick Start

```ts
import { createBenchLocalClient } from "@benchlocal/web-sdk";

const benchlocal = createBenchLocalClient();

const environment = await benchlocal.environment.detect({ timeoutMs: 500 });

if (!environment.isInsideBenchLocal) {
  // Render a normal-browser landing state.
  // Do not ask users for provider credentials here.
}

const selected = await benchlocal.models.getSelected();
const model = selected.models[0];

if (!model) {
  throw new Error("No BenchLocal model is selected for this tab.");
}

await benchlocal.runs.startState({
  message: "Running web benchmark.",
  metadata: { modelId: model.id }
});

try {
  const response = await benchlocal.inference.chat({
    modelId: model.id,
    messages: [{ role: "user", content: "Fill the form with this profile..." }],
    generation: {
      temperature: 0.2,
      max_tokens: 1024
    }
  });

  await benchlocal.history.save({
    status: "completed",
    metadata: {
      modelId: model.id,
      answer: response.content
    }
  });
} catch (error) {
  await benchlocal.history.save({
    status: "error",
    metadata: {
      message: error instanceof Error ? error.message : String(error)
    }
  });
} finally {
  await benchlocal.runs.stopState({ message: "Benchmark finished." });
}
```

## Runtime Detection

Web Bench Packs can also be opened in a normal browser. Use environment detection before calling bridge APIs that require BenchLocal.

```ts
const benchlocal = createBenchLocalClient();

const environment = await benchlocal.environment.detect({ timeoutMs: 500 });

if (environment.isInsideBenchLocal) {
  console.log("Running inside BenchLocal", environment.capabilities);
} else if (environment.reason === "top-level") {
  console.log("Opened directly in a browser.");
} else {
  console.log("Embedded, but BenchLocal bridge is unavailable.");
}
```

The detection result has this shape:

```ts
interface BenchLocalWebEnvironmentInfo {
  isEmbedded: boolean;
  isInsideBenchLocal: boolean;
  bridgeAvailable: boolean;
  bridgeVersion?: 1;
  capabilities?: BenchLocalWebCapabilities;
  reason?: "top-level" | "timeout" | "error";
  error?: string;
}
```

`environment.isEmbedded` is a synchronous iframe check. `environment.detect()` confirms whether the parent frame is actually BenchLocal by making a short `capabilities` bridge request.

## Creating A Client

```ts
const benchlocal = createBenchLocalClient({
  requestTimeoutMs: 30000
});
```

Options:

```ts
interface BenchLocalWebClientOptions {
  target?: Window;
  targetOrigin?: string;
  requestTimeoutMs?: number;
}
```

Most Bench Packs should call `createBenchLocalClient()` with no options. The default target is `window.parent`.

## Capabilities

```ts
const capabilities = await benchlocal.capabilities();
```

Returns information about the installed web pack and the permissions BenchLocal granted from the pack manifest.

```ts
interface BenchLocalWebCapabilities {
  bridgeVersion: 1;
  permissions: string[];
  pack: {
    id: string;
    name: string;
    version: string;
    entry: string;
    buildId?: string;
  };
  history?: {
    runId?: string;
    mode?: "live" | "history";
    playback: boolean;
  };
}
```

Use `capabilities.history?.mode === "history"` to render a read-only history playback experience.

## Model APIs

### List Available Models

```ts
const { models, availability } = await benchlocal.models.list();
```

`models.list()` returns models that BenchLocal can expose to the current web pack. Use this when your UI wants to show all allowed choices.

### Get Selected Models

```ts
const { models } = await benchlocal.models.getSelected();
```

`models.getSelected()` returns the models selected on the current BenchLocal tab. This is the most common API for a web benchmark. If your benchmark supports one model at a time, show these models and let the user pick one inside your web UI.

### React To Model Selection Changes

```ts
const unsubscribe = benchlocal.models.onChanged((event) => {
  console.log("BenchLocal model selection changed", event.models);
});

// Later:
unsubscribe();
```

BenchLocal sends this event when the user changes the tab's selected models from the desktop UI.

### Model Shape

The SDK re-exports `RegisteredModel` and `ModelAvailability` from `@benchlocal/core`.

```ts
interface RegisteredModel {
  id: string;
  provider: string;
  model: string;
  label: string;
  enabled: boolean;
  group: string;
}

type ModelAvailabilityStatus = "online" | "offline";

interface ModelAvailability {
  modelId: string;
  providerId: string;
  status: ModelAvailabilityStatus;
  reason:
    | "available"
    | "provider_missing"
    | "provider_disabled"
    | "auth_missing"
    | "provider_unreachable"
    | "provider_error"
    | "model_missing";
  details?: string;
  checkedAt: string;
}
```

Use `model.id` when calling inference APIs. Treat `model.provider` as a display name. BenchLocal does not expose provider secrets to the web page.

## Inference APIs

Inference runs through the local BenchLocal app, using the user's configured provider and model.

### Non-Streaming Chat

```ts
const result = await benchlocal.inference.chat({
  modelId: model.id,
  messages: [
    { role: "system", content: "You are a precise form-filling assistant." },
    { role: "user", content: "Fill this application form." }
  ],
  generation: {
    temperature: 0.2,
    top_p: 0.95,
    max_tokens: 1500,
    request_timeout_seconds: 300
  },
  metadata: {
    scenarioId: "case-001"
  }
});

console.log(result.content);
```

Request shape:

```ts
interface BenchLocalChatRequest {
  modelId: string;
  messages: ChatMessage[];
  generation?: GenerationRequest;
  tools?: unknown[];
  toolChoice?: unknown;
  metadata?: Record<string, unknown>;
}
```

Response shape:

```ts
interface BenchLocalChatResponse {
  id?: string;
  modelId: string;
  message?: ChatMessage;
  content?: string;
  finishReason?: string;
  usage?: Record<string, unknown>;
  raw?: unknown;
}
```

### Streaming Chat

```ts
let content = "";

for await (const event of benchlocal.inference.streamChat({
  modelId: model.id,
  messages: [{ role: "user", content: "Solve the task step by step." }],
  generation: { temperature: 0.2 }
})) {
  if (event.type === "delta" && event.content) {
    content += event.content;
  }

  if (event.type === "tool_call") {
    console.log("Tool call", event.toolCall);
  }

  if (event.type === "error") {
    throw new Error(event.message);
  }
}
```

Stream events:

```ts
type BenchLocalChatStreamEvent =
  | { type: "start"; id?: string; modelId: string }
  | { type: "delta"; id?: string; modelId: string; content?: string; raw?: unknown }
  | { type: "tool_call"; id?: string; modelId: string; toolCall: ToolCallRecord; raw?: unknown }
  | {
      type: "done";
      id?: string;
      modelId: string;
      message?: ChatMessage;
      content?: string;
      finishReason?: string;
      usage?: Record<string, unknown>;
      raw?: unknown;
    }
  | { type: "error"; modelId: string; message: string; code?: string; retryable?: boolean };
```

## Run State APIs

Interactive Web Bench Packs control their own UI, so they must tell BenchLocal when a run starts, progresses, stops, or is cancelled. BenchLocal uses this state to show tab spinners and a host-side Stop button.

### Start A Run

```ts
await benchlocal.runs.startState({
  message: "Started form-filling benchmark.",
  metadata: { modelId: model.id }
});
```

### Update Progress

```ts
await benchlocal.runs.updateProgress({
  status: "running",
  progress: 0.42,
  message: "Filled employment history.",
  metadata: {
    step: "employment-history"
  }
});
```

Progress input:

```ts
interface BenchLocalWebRunProgressInput {
  status?: "created" | "running" | "completed" | "cancelled" | "error";
  message?: string;
  progress?: number;
  metadata?: Record<string, unknown>;
}
```

### Handle Stop Requests

BenchLocal can ask the web app to stop. The web app owns cancellation because it owns the benchmark workflow.

```ts
let stopped = false;

const unsubscribeStop = benchlocal.runs.onStopRequested(async (event) => {
  stopped = true;

  await benchlocal.history.save({
    status: "cancelled",
    events: [
      {
        type: "stop_requested",
        createdAt: event.requestedAt,
        payload: { reason: event.reason }
      }
    ]
  });

  await benchlocal.runs.stopState({ message: "Stopped by BenchLocal." });
});

// Check this between steps, tool calls, stream chunks, or animation frames.
if (stopped) {
  return;
}

// Later:
unsubscribeStop();
```

### Stop A Run

Always call `stopState()` when the active run is complete, cancelled, or has errored.

```ts
await benchlocal.runs.stopState({
  message: "Completed benchmark.",
  metadata: { status: "completed" }
});
```

## History APIs

History lets the web pack persist data in BenchLocal so users can revisit runs later.

### Load History

```ts
const history = await benchlocal.history.load<{
  selectedModelId?: string;
  score?: number;
}>();

if (history.payload) {
  renderPlayback(history.payload.metadata);
}
```

Use this when `capabilities.history?.mode === "history"`.

### Save History

```ts
await benchlocal.history.save({
  status: "completed",
  score: {
    totalScore: 87,
    categories: [
      { id: "accuracy", label: "Accuracy", score: 90 },
      { id: "format", label: "Format", score: 80 }
    ]
  },
  metadata: {
    selectedModelId: model.id,
    completedCases: 15
  },
  events: [
    {
      type: "case_completed",
      createdAt: new Date().toISOString(),
      payload: { caseId: "case-001" }
    }
  ]
});
```

History payload:

```ts
interface WebBenchPackHistoryPayload {
  status?: "created" | "running" | "completed" | "cancelled" | "error";
  score?: BenchmarkScore;
  metadata?: Record<string, unknown>;
  artifacts?: ArtifactRef[];
  events?: Array<{
    type: string;
    createdAt: string;
    payload?: unknown;
  }>;
}
```

### Write Artifacts

```ts
const artifact = await benchlocal.history.writeArtifact({
  kind: "json",
  label: "Final form state",
  path: "form-state.json",
  contentType: "application/json",
  content: JSON.stringify(formState, null, 2)
});

await benchlocal.history.save({
  status: "completed",
  artifacts: [artifact],
  metadata: { savedArtifact: artifact.path }
});
```

Artifact input:

```ts
interface BenchLocalWebArtifactWriteInput {
  kind: string;
  label: string;
  path?: string;
  contentType?: string;
  content: string | ArrayBuffer | Uint8Array;
}
```

## Permission Model

The Bench Pack manifest declares which bridge permissions the hosted page needs. BenchLocal should enforce these permissions before serving bridge calls.

Common permissions:

| Permission | Enables |
| --- | --- |
| `models:list` | `models.list()` |
| `models:read` | `models.getSelected()` and `models.onChanged()` |
| `inference:chat` | `inference.chat()` |
| `inference:stream` | `inference.streamChat()` |
| `runs:write` | `runs.startState()`, `runs.updateProgress()`, `runs.stopState()`, and stop callbacks |
| `history:read` | `history.load()` |
| `history:write` | `history.save()` |
| `artifacts:write` | `history.writeArtifact()` |
| `media:microphone` | Browser microphone capture from the active pack frame after the user grants OS permission |

Example web manifest section:

```json
{
  "type": "web",
  "web": {
    "bridgeVersion": 1,
    "allowedOrigins": ["https://packs.benchlocal.com"],
    "permissions": [
      "models:list",
      "models:read",
      "inference:chat",
      "inference:stream",
      "runs:write",
      "history:read",
      "history:write",
      "artifacts:write",
      "media:microphone"
    ],
    "historyPlayback": true
  }
}
```

## Security Notes

- Do not ask users to paste provider API keys into your web pack.
- Do not send provider credentials to your servers.
- Do not rely on direct browser requests to LLM providers. CORS and credential trust are the reason this SDK exists.
- Treat the web app as presentation and benchmark orchestration.
- Treat BenchLocal as the local authority for provider execution, selected models, history, and artifacts.
- If your web pack calls remote services, declare those origins in the Bench Pack data policy and explain what data is sent.
- Request `media:microphone` only when live audio is required. BenchLocal delegates microphone access only to the active pack's declared origins and rejects camera or mixed audio/video requests.
- Store enough history metadata for users to understand and reproduce a run, but avoid storing secrets.

## Error Handling

Bridge calls reject with an `Error`. BenchLocal may attach `code` and `retryable` fields.

```ts
try {
  await benchlocal.inference.chat(request);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
  console.error("BenchLocal bridge error", { message, code });
}
```

Common cases:

- `BenchLocal bridge request timed out`: the page is not inside BenchLocal, the parent bridge is unavailable, or the request took longer than `requestTimeoutMs`.
- permission error: the installed web manifest did not grant the method's permission.
- inference error: the selected model/provider failed locally.

## Development Workflow

During local development, point a web Bench Pack manifest at your dev server:

```json
{
  "schemaVersion": 1,
  "protocolVersion": 1,
  "type": "web",
  "id": "my-web-benchpack",
  "name": "My Web Bench Pack",
  "version": "0.1.0",
  "entry": "http://127.0.0.1:5174",
  "web": {
    "bridgeVersion": 1,
    "allowedOrigins": ["http://127.0.0.1:5174"],
    "permissions": ["models:read", "inference:chat", "runs:write", "history:write"]
  },
  "capabilities": {
    "tools": true,
    "multiTurn": true,
    "streamingProgress": true,
    "verification": false
  }
}
```

For official hosted packs, use an immutable hosted URL such as:

```text
https://packs.benchlocal.com/{pack-id}/{version}/index.html
```

This keeps web delivery patchable while BenchLocal history can still record the pack id, version, entry URL, build id, and manifest metadata used for the run.

## Versioning

This package follows the BenchLocal ecosystem package version. `@benchlocal/web-sdk@0.3.0` is intended to be used with `@benchlocal/core@0.3.0`.

The browser bridge has its own protocol version:

```ts
BENCHLOCAL_WEB_BRIDGE_VERSION === 1;
```

Breaking changes to bridge messages should increment the bridge version.

## Related Packages

- `@benchlocal/core`: shared BenchLocal protocol and data types
- `@benchlocal/sdk`: SDK for table/runtime Bench Packs
- `@benchlocal/web-sdk`: browser SDK for Interactive Web Bench Packs

## Repository

- BenchLocal monorepo: https://github.com/stevibe/BenchLocal
- Issues: https://github.com/stevibe/BenchLocal/issues

## License

MIT. Copyright (c) 2026 stevibe.
