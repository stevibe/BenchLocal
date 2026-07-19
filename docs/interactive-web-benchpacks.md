# Interactive Web Bench Packs

BenchLocal currently supports Bench Packs that run through the standard host runtime and render results in a table. Interactive Web Bench Packs add a second presentation model: a hosted web app renders the benchmark experience, while BenchLocal remains the local authority for credentials, providers, models, inference, history, and artifacts.

This is an evolution of BenchLocal's protocol, not a replacement for table Bench Packs.

## Goals

- Keep the same user experience as installing and opening a normal Bench Pack.
- Let official hosted packs render richer benchmark experiences than a table can provide.
- Keep provider credentials and model execution local to the desktop app.
- Support streaming and non-streaming inference through the same local provider/model configuration users already trust.
- Let web packs store structured metadata and artifacts into BenchLocal history.
- Let web packs own their own history playback UI when a user opens a saved run.
- Keep the architecture compatible with the Agent API and MCP surface as future UI features grow.

## Pack Types

BenchLocal should support two manifest types:

- `table`: current runtime module Bench Pack. BenchLocal imports a local JS entry, runs scenarios, scores results, and renders the table.
- `web`: hosted interactive Bench Pack. BenchLocal opens a sandboxed web surface and injects a narrow bridge API.

Existing packs can omit `type`; BenchLocal treats them as `table`.

## Hosted Versioning

Official web pack entries should be immutable by version:

```text
https://packs.benchlocal.com/{pack-id}/{version}/index.html
```

Example:

```text
https://packs.benchlocal.com/llm-form-filling-test/1.0.0/index.html
```

The registry still owns install discovery and versioning. Installing a web pack installs its manifest into BenchLocal, not just a bare URL. The hosted app may be patched by publishing a new version and updating the registry.

Local development can use `http://localhost` or `http://127.0.0.1` entries, but official registry-hosted web packs should use `https`.

Every run must persist the exact web pack identity used:

```json
{
  "packId": "llm-form-filling-test",
  "packType": "web",
  "version": "1.0.0",
  "entryUrl": "https://packs.benchlocal.com/llm-form-filling-test/1.0.0/index.html",
  "buildId": "2026-05-31-a84f91",
  "manifestHash": "sha256-..."
}
```

This keeps hosted delivery flexible while preserving benchmark traceability.

## Manifest Shape

```json
{
  "schemaVersion": 1,
  "protocolVersion": 1,
  "type": "web",
  "id": "llm-form-filling-test",
  "name": "LLM Form Filling Test",
  "version": "1.0.0",
  "entry": "https://packs.benchlocal.com/llm-form-filling-test/1.0.0/index.html",
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
      "artifacts:write"
    ],
    "historyPlayback": true,
    "dataPolicy": {
      "mayUseRemoteServices": true,
      "remoteOrigins": ["https://api.packs.benchlocal.com"],
      "sendsModelOutputs": false,
      "sendsRunMetadata": true,
      "description": "This pack may use hosted test assets and anonymous aggregate run metadata. Provider credentials stay local."
    }
  },
  "capabilities": {
    "tools": true,
    "multiTurn": true,
    "streamingProgress": true,
    "verification": false
  }
}
```

## Registry Shape

Registry entries should support a hosted web source:

```json
{
  "id": "llm-form-filling-test",
  "name": "LLM Form Filling Test",
  "version": "1.0.0",
  "source": {
    "type": "web",
    "entry": "https://packs.benchlocal.com/llm-form-filling-test/1.0.0/index.html",
    "manifest": "https://packs.benchlocal.com/llm-form-filling-test/1.0.0/benchlocal.pack.json"
  }
}
```

If `manifest` is present, BenchLocal should fetch and validate it during install. If it is absent, the registry entry can be converted into a minimal installed manifest.

For local development and third-party testing, the existing install-from-URL flow may also point directly at a Web Bench Pack manifest:

```text
http://127.0.0.1:5174/benchlocal.pack.json
```

Local `http://localhost` and `http://127.0.0.1` manifest URLs are accepted for development. Public remote Web Bench Pack entries should use `https`.

## Security Boundary

The hosted page is not trusted with provider credentials.

Required rules:

- Load only declared `https` entries for official hosted packs.
- Allow only manifest-declared origins to talk to the bridge.
- Disable Node integration and direct filesystem access in the web surface.
- Do not expose provider API keys, secret environment names, or raw provider config to the web app.
- Do not provide an arbitrary credentialed HTTP proxy.
- Treat bridge permissions as capabilities and enforce them per installed pack.
- Delegate microphone access only when the active pack declares `media:microphone`; scope Electron media approval to that pack's declared origins and audio-only requests.
- Persist pack id, version, entry URL, and build metadata into each run.

The web app may call its own server if the manifest declares it. Provider requests still go through BenchLocal.

## Bridge API

The hosted app should use a browser-safe SDK:

```ts
import { createBenchLocalClient } from "@benchlocal/web-sdk";

const benchlocal = createBenchLocalClient();
```

The web app can quickly detect whether it is running inside BenchLocal. This is useful for showing a normal-browser landing state instead of waiting for bridge calls to time out:

```ts
const environment = await benchlocal.environment.detect({ timeoutMs: 500 });

if (!environment.isInsideBenchLocal) {
  // Render an "Open this Bench Pack in BenchLocal" state.
}
```

Initial surface:

```ts
const insideBenchLocal = await benchlocal.environment.isInsideBenchLocal({ timeoutMs: 500 });
await benchlocal.capabilities();
await benchlocal.models.list();
await benchlocal.models.getSelected();

const unsubscribeStop = benchlocal.runs.onStopRequested(() => {
  // Cancel active work, then call stopState().
});

await benchlocal.runs.startState({ message: "Running the interactive benchmark." });

await benchlocal.inference.chat({
  modelId: "qwen-qwen3-5-9b",
  messages: [{ role: "user", content: "..." }],
  generation: { temperature: 0.2, top_p: 0.95 }
});

for await (const chunk of benchlocal.inference.streamChat({
  modelId: "qwen-qwen3-5-9b",
  messages: [{ role: "user", content: "..." }],
  generation: { temperature: 0.2 }
})) {
  // Render stream updates in the web app.
}

await benchlocal.runs.stopState({ message: "Interactive benchmark stopped." });
```

The bridge should be implemented on top of BenchLocal's existing provider/model execution services, not a second inference stack.

## Run State API

Interactive packs own their UI runtime, but BenchLocal still needs to reflect that runtime in the desktop shell. Use the run-state API to keep the host tab state accurate.

```ts
await benchlocal.runs.startState({
  message: "Started form-filling benchmark.",
  metadata: { modelId }
});

await benchlocal.runs.updateProgress({
  status: "running",
  progress: 0.35,
  message: "Filled applicant information."
});

const unsubscribe = benchlocal.runs.onStopRequested(async () => {
  // Stop timers, abort active work when possible, and persist a cancelled state.
  await benchlocal.history.save({ status: "cancelled" });
  await benchlocal.runs.stopState({ message: "Stopped by BenchLocal." });
});

await benchlocal.runs.stopState({
  message: "Completed form-filling benchmark.",
  metadata: { status: "completed" }
});
```

`startState` turns on the BenchLocal tab spinner and enables the host Stop action. `stopState` clears the spinner and any pending stop state. When the user clicks Stop in BenchLocal, the host emits `runs.stopRequested`; the web app must implement that callback and stop its own active work.

## Inference Parameters

The exposed inference API must support both common OpenAI-compatible parameters and provider-specific extensions.

Common parameters:

- `temperature`
- `top_p`
- `top_k`
- `min_p`
- `max_tokens`
- `seed`
- `stop`
- `presence_penalty`
- `frequency_penalty`
- `repetition_penalty`
- `request_timeout_seconds`

Reasoning parameters:

```ts
reasoning?: {
  effort?: "minimal" | "low" | "medium" | "high";
  budget_tokens?: number;
  enabled?: boolean;
  adaptive?: boolean;
  exclude?: boolean;
  summary?: "auto" | "concise" | "detailed";
  provider?: Record<string, unknown>;
}
```

Provider-specific escape hatch:

```ts
provider_options?: Record<string, unknown>;
extra_body?: Record<string, unknown>;
```

This lets BenchLocal support normal sampling while still allowing cases such as DeepSeek reasoning settings or Claude adaptive reasoning without hard-coding every provider's dialect into the top-level API.

## History API

Interactive packs should store their own structured history payload in BenchLocal. BenchLocal stores and indexes the run; the web app owns playback.

Minimum history capabilities:

```ts
await benchlocal.history.save({
  status: "completed",
  score: {
    totalScore: 87,
    categories: [{ id: "form_accuracy", label: "Form Accuracy", score: 90 }]
  },
  metadata: {
    taskCount: 12,
    difficulty: "mixed"
  },
  artifacts: [
    { kind: "json", label: "trace", contentType: "application/json", path: "artifacts/trace.json" }
  ]
});

const history = await benchlocal.history.load();
```

When a user opens a saved web run:

1. BenchLocal loads the same installed web pack version if possible.
2. BenchLocal passes the saved run id and saved web history payload to the web app.
3. The web app renders playback using its own UI.
4. If the exact version is unavailable, BenchLocal should warn and either use the closest compatible installed version or block playback.

History should support:

- `metadata`: JSON object controlled by the pack.
- `artifacts`: files written into the run directory.
- `events`: optional timeline events for live UI and replay.
- `score`: optional summary score for BenchLocal-level list views and share cards.
- `pack`: immutable pack identity for traceability.

## App Integration

Opening an installed web pack should create a normal BenchLocal tab, but the tab content is a sandboxed web surface instead of the table result view.

The existing controls should continue to matter:

- selected models
- run mode
- runs per test
- sampling settings
- availability refresh
- stop/resume where the web pack supports it
- history list

For the first implementation, the web tab can expose model selection and inference through the bridge, then store history through the new web history API.

## Implementation Phases

1. Add protocol types for `web` manifests, web permissions, richer inference parameters, web history payloads, and bridge messages.
2. Add a browser-safe `@benchlocal/web-sdk` package for hosted web apps.
3. Teach registry install and URL install to accept web pack manifests and hosted entries.
4. Add a sandboxed renderer surface for web packs.
5. Inject the bridge and route calls to existing BenchLocal model/inference services.
6. Persist web-pack history payloads and artifacts into the existing run directory layout.
7. Add history playback handoff from BenchLocal to the web app.
8. Add Agent API/MCP endpoints for web-pack tabs and history where useful.

## Non-Goals For The First Slice

- Full offline execution of hosted web packs.
- Arbitrary third-party web origins without a manifest.
- Sending provider credentials to hosted pack servers.
- Replacing table Bench Packs.
