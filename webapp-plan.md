# BenchLocal Web App — Detailed Plan

## Executive Summary

Transform BenchLocal from an Electron desktop application into a server-hosted web application. The user runs a Node.js server process on their machine (where LLM providers, Docker, and Bench Packs live), then connects via any browser — on the same machine or remotely.

**Key insight**: The existing architecture already cleanly separates UI (`app/src/renderer/`) from orchestration (`packages/benchpack-host/`). The plan is to extract these into a web-server backend and a standalone React frontend, replacing Electron IPC with HTTP/SSE.

---

## 1. Current Architecture (as-is)

```
┌─────────────────────────────────────────────────┐
│  Electron Main Process (app/src/main/)          │
│                                                  │
│  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ IPC Handlers  │  │ benchpack-host package   │ │
│  │ (ipc.ts)      │──│ (run orchestration,      │ │
│  │               │  │  Docker, verifiers,      │ │
│  │ config,       │  │  install/uninstall)      │ │
│  │ themes,       │  └──────────────────────────┘ │
│  │ workspaces    │                                │
│  │ updates       │                                │
│  └──────────────┘                                │
│       ▲  IPC bridge (preload)                    │
│       │                                          │
│  ┌──────────────┐                                │
│  │ React UI      │  (app/src/renderer/src/)      │
│  │ (App.tsx ~7900│                                │
│  │  lines)       │                                │
│  └──────────────┘                                │
│                                                  │
│  Storage: ~/.benchlocal/                         │
│    config.toml, state.json,                      │
│    runs/, benchpacks/, logs/, cache/, themes/    │
└─────────────────────────────────────────────────┘
```

### Key packages

| Package                      | Location                    | Role                                                                                              |
| ---------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------- |
| `@benchlocal/core`           | `packages/benchlocal-core/` | Shared types, config parsing, workspace state, themes (pure TypeScript, already published to npm) |
| `@benchlocal/benchpack-host` | `packages/benchpack-host/`  | Run orchestration, Docker verifier lifecycle, Bench Pack install/inspect/run                      |
| `benchlocal-app`             | `app/`                      | Electron shell: main process, IPC bridge, React renderer UI                                       |

### Data layer

All user data lives under `~/.benchlocal/`:

```
~/.benchlocal/
  config.toml          ← providers, models, benchpacks, UI theme (TOML)
  state.json           ← workspaces, tabs, per-tab models/sampling/execution mode (JSON)
  runs/                ← per-run directories: summary.json, events.jsonl, host.log
  benchpacks/          ← installed Bench Pack artifacts
  logs/                ← host log files
  cache/               ← cache directory
  themes/              ← user-installed theme JSON files
```

### IPC API surface (what the renderer calls through the preload bridge)

The preload bridge (`app/src/preload/index.ts`) exposes `window.benchlocal` with these namespaces:

| Namespace    | Methods                                                                                                                                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app`        | `metadata()`, `onOpenAbout()`, `onOpenSettings()`                                                                                                                                                                                               |
| `updates`    | `state()`, `check()`, `install()`, `onState()`                                                                                                                                                                                                  |
| `config`     | `load()`, `save()`                                                                                                                                                                                                                              |
| `models`     | `discover()`                                                                                                                                                                                                                                    |
| `themes`     | `list()`, `load()`                                                                                                                                                                                                                              |
| `workspaces` | `load()`, `save()`, `export()`, `import()`                                                                                                                                                                                                      |
| `benchPacks` | `list()`, `registry()`, `install()`, `installFromUrl()`, `update()`, `uninstall()`, `onMutationProgress()`, `activeRuns()`, `run()`, `retryScenario()`, `resumeRun()`, `stop()`, `history()`, `loadHistory()`, `clearHistory()`, `onRunEvent()` |
| `verifiers`  | `list()`, `start()`, `stop()`, `cancelStart()`, `deleteImage()`, `onProgress()`                                                                                                                                                                 |
| `logs`       | `openDetachedWindow()`, `closeDetachedWindow()`, `publishDetachedState()`, `onDetachedState()`, `onDetachedWindowClosed()`                                                                                                                      |

### React renderer UI (App.tsx — single ~7900 line file)

The UI is a single massive React component with:

- **Sidebar** — workspace list, tab chips, drag-and-drop tab reordering
- **Top bar** — settings, theme switcher, about dialog, update notifications
- **Main content** — benchmark run controls, results grid (scenarios × models), scoring
- **Log drawer** — bottom panel showing real-time run events
- **Settings panels** — Providers, Models, Bench Packs (install/registry), Verification (Docker verifiers)
- **Modals** — detail view, sampling overrides, model selection, model aliases, run history, confirm dialogs, verifier preparation

Styling: Tailwind CSS v4 + CSS custom properties (CSS variables) driven by theme JSON files.

---

## 2. Target Architecture

```
┌───────────────────────────────────────────────────────┐
│  Node.js HTTP Server (NEW: app/src/server/)           │
│                                                       │
│  ┌─────────────────────────┐  ┌────────────────────┐  │
│  │ REST API + SSE          │──│ benchpack-host pkg │  │
│  │ (Fastify/Express)       │  │ (run orchestration │  │
│  │                         │  │  Docker, verifiers │  │
│  │ GET/POST endpoints for  │  │  install/uninstall)│  │
│  │ all IPC operations      │  └────────────────────┘  │
│  │ SSE endpoint for        │                          │
│  │ run events (real-time)  │                          │
│  └─────────────────────────┘                          │
│                                                       │
│  Storage: ~/.benchlocal/ (unchanged)                  │
└───────────────────────────────────────────────────────┘
        ▲  HTTP
        │  port 3540 (default)
        │
┌───────┴───────────────────────────────────────────────┐
│  React SPA (EXTRACTED: app/src/renderer/)             │
│                                                       │
│  Served statically by the same server OR standalone   │
│  Single-page app: fetch() + EventSource instead of    │
│  window.benchlocal IPC                                │
│                                                       │
│  Access via: http://server-host:3540                  │
└───────────────────────────────────────────────────────┘
```

---

## 3. Option Analysis

### Option A — Full web app (server + SPA) — **RECOMMENDED**

Build a proper HTTP server backend and adapt the existing React renderer as a standalone SPA.

**Pros:**

- Full parity with the desktop app
- Can be accessed from any browser, any device
- Real-time streaming of run events via Server-Sent Events (SSE)
- Reuses existing React UI with minimal changes (only IPC → HTTP)
- Single deployment: one Node.js process serves both API and static files
- Docker verifier management works identically on the server

**Cons:**

- Requires building a new server layer
- Loses desktop features: auto-updater, system menu, window state persistence, file dialogs

### Option B — CLI producer + standalone viewer

CLI tool runs benchmarks and writes JSON output files; separate viewer HTML loads them.

**Pros:**

- Simplest to build
- Viewer is a single HTML file
- Good for CI/CD pipelines

**Cons:**

- No real-time feedback during runs
- No remote access — must be on the same machine to read files
- No configuration management from the viewer
- Cannot start/stop runs from the viewer
- Loses the interactive benchmark experience

### Option C — Desktop app with remote renderer

Keep the Electron app but serve the renderer UI over HTTP.

**Pros:**

- Minimal code changes

**Cons:**

- Still requires Electron on the server
- Complex IPC-over-network bridge needed
- No advantage over Option A

### Decision: **Option A**

It provides the best balance of remote accessibility, real-time interaction, and code reuse. The existing codebase is already well-structured for this split — `benchpack-host` is pure Node.js and needs no Electron dependencies.

---

## 4. Implementation Plan (Option A)

### Phase 1: Server Backend (`app/src/server/`)

#### 4.1 Server framework

Use **Fastify** (or Express) for the HTTP server. Fastify is recommended for its speed, built-in validation, and SSE support.

**Dependencies to add to `app/package.json`:**

```json
{
  "fastify": "^5.x",
  "@fastify/static": "^8.x",
  "@fastify/cors": "^10.x",
  "@fastify/formbody": "^8.x"
}
```

#### 4.2 Server entry point

New file: `app/src/server/index.ts`

```typescript
// app/src/server/index.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerApiRoutes } from "./api-routes";
import { registerSseRoutes } from "./sse-routes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PORT = 3540;
const DEFAULT_HOST = "127.0.0.1"; // secure by default

async function startServer() {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, {
    origin: process.env.BENCHLOCAL_CORS_ORIGIN || true,
  });

  // API routes
  registerApiRoutes(fastify);
  registerSseRoutes(fastify);

  // Static file serving (React SPA build output)
  const rendererOut = path.join(__dirname, "..", "renderer-out");
  fastify.register(fastifyStatic, {
    root: rendererOut,
    prefix: "/",
  });

  // SPA fallback: serve index.html for all non-API routes
  fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.type("text/html").sendFile("index.html");
  });

  const port = Number(process.env.BENCHLOCAL_PORT) || DEFAULT_PORT;
  const host = process.env.BENCHLOCAL_HOST || DEFAULT_HOST;

  await fastify.listen({ port, host });
  console.log(`BenchLocal web server running at http://${host}:${port}`);
}

startServer();
```

#### 4.3 API routes mapping (IPC → HTTP)

Each IPC channel becomes an HTTP endpoint under `/api/`:

| IPC Channel                   | HTTP Method | Endpoint                                      | Notes                                                               |
| ----------------------------- | ----------- | --------------------------------------------- | ------------------------------------------------------------------- |
| `config:load`                 | GET         | `/api/config`                                 | Returns `{ config }`                                                |
| `config:save`                 | PUT         | `/api/config`                                 | Body: `{ config }`                                                  |
| `app:metadata`                | GET         | `/api/metadata`                               | App version info                                                    |
| `updates:get-state`           | GET         | `/api/updates/state`                          |                                                                     |
| `updates:check`               | POST        | `/api/updates/check`                          |                                                                     |
| `updates:install`             | POST        | `/api/updates/install`                        |                                                                     |
| `models:discover`             | POST        | `/api/models/discover`                        | Body: `{ provider }`                                                |
| `themes:list`                 | GET         | `/api/themes`                                 |                                                                     |
| `themes:load`                 | GET         | `/api/themes/:themeId`                        |                                                                     |
| `workspaces:load`             | GET         | `/api/workspaces`                             |                                                                     |
| `workspaces:save`             | PUT         | `/api/workspaces`                             | Body: `{ state }`                                                   |
| `workspaces:export`           | POST        | `/api/workspaces/export`                      | Body: `{ workspaceId, state }` → returns file stream                |
| `workspaces:import`           | POST        | `/api/workspaces/import`                      | Multipart file upload                                               |
| `benchpacks:list`             | GET         | `/api/benchpacks`                             |                                                                     |
| `benchpacks:registry`         | GET         | `/api/benchpacks/registry`                    |                                                                     |
| `benchpacks:install`          | POST        | `/api/benchpacks/:benchPackId/install`        | SSE: mutation progress                                              |
| `benchpacks:install-from-url` | POST        | `/api/benchpacks/install-from-url`            | Body: `{ url }`                                                     |
| `benchpacks:update`           | POST        | `/api/benchpacks/:benchPackId/update`         |                                                                     |
| `benchpacks:uninstall`        | POST        | `/api/benchpacks/:benchPackId/uninstall`      |                                                                     |
| `benchpacks:active-runs`      | GET         | `/api/benchpacks/active-runs`                 |                                                                     |
| `benchpacks:run`              | POST        | `/api/benchpacks/run`                         | Body: `{ tabId, benchPackId, modelIds, executionMode, generation }` |
| `benchpacks:retry-scenario`   | POST        | `/api/benchpacks/retry-scenario`              |                                                                     |
| `benchpacks:resume-run`       | POST        | `/api/benchpacks/resume-run`                  |                                                                     |
| `benchpacks:stop`             | POST        | `/api/benchpacks/stop`                        | Body: `{ tabId }`                                                   |
| `benchpacks:history`          | GET         | `/api/benchpacks/:benchPackId/history`        |                                                                     |
| `benchpacks:history-load`     | GET         | `/api/benchpacks/:benchPackId/history/:runId` |                                                                     |
| `benchpacks:history-clear`    | POST        | `/api/benchpacks/:benchPackId/history/clear`  |                                                                     |
| `verifiers:list`              | GET         | `/api/verifiers`                              |                                                                     |
| `verifiers:start`             | POST        | `/api/verifiers/start`                        | Body: `{ benchPackId }`                                             |
| `verifiers:stop`              | POST        | `/api/verifiers/stop`                         | Body: `{ benchPackId }`                                             |
| `verifiers:cancel-start`      | POST        | `/api/verifiers/cancel-start`                 |                                                                     |
| `verifiers:delete-image`      | POST        | `/api/verifiers/delete-image`                 | Body: `{ benchPackId, verifierId }`                                 |

**File: `app/src/server/api-routes.ts`**

```typescript
// app/src/server/api-routes.ts
import type { FastifyInstance } from "fastify";
import {
  loadOrCreateConfig,
  saveConfigFile,
  getConfigPath,
  loadOrCreateWorkspaceState,
  getWorkspaceStatePath,
  saveWorkspaceStateFile,
} from "@benchlocal/core";
import {
  inspectConfiguredBenchPacks,
  loadBenchPackRegistry,
  installBenchPackFromRegistry,
  installBenchPackFromUrl,
  updateBenchPackFromRegistry,
  uninstallBenchPack,
  runConfiguredBenchPack,
  resumeBenchPackRun,
  retryScenarioForBenchPackRun,
  listRunHistoryForBenchPack,
  loadRunSummaryForBenchPack,
  clearRunHistoryForBenchPack,
  getConfiguredBenchPackVerifierStatus,
  startConfiguredBenchPackVerifiers,
  stopConfiguredBenchPackVerifiers,
  deleteConfiguredBenchPackVerifierImage,
} from "@benchlocal/benchpack-host";
import { listAvailableThemes, loadAvailableTheme } from "./themes";
import { loadAppMetadata } from "./app-metadata";
import { discoverProviderModels } from "./models";
import { activeRunManager } from "./run-manager";
import { sseBus } from "./sse-bus";

export function registerApiRoutes(fastify: FastifyInstance) {
  const api = fastify.prefix("/api");

  // --- App metadata ---
  api.get("/metadata", async () => loadAppMetadata());

  // --- Config ---
  api.get("/config", async () => {
    const result = await loadOrCreateConfig();
    return {
      path: result.path,
      created: result.created,
      config: result.config,
    };
  });

  api.put("/config", async (request, reply) => {
    const config = (request.body as any).config;
    const saved = await saveConfigFile(config, getConfigPath());
    return { path: getConfigPath(), created: false, config: saved };
  });

  // --- Workspaces ---
  api.get("/workspaces", async () => {
    await loadOrCreateConfig();
    const result = await loadOrCreateWorkspaceState(getWorkspaceStatePath());
    return { path: result.path, created: result.created, state: result.state };
  });

  api.put("/workspaces", async (request, reply) => {
    await loadOrCreateConfig();
    const state = (request.body as any).state;
    const saved = await saveWorkspaceStateFile(state, getWorkspaceStatePath());
    return { path: getWorkspaceStatePath(), created: false, state: saved };
  });

  // --- Bench Packs ---
  api.get("/benchpacks", async () => {
    const { config } = await loadOrCreateConfig();
    return inspectConfiguredBenchPacks(config, await getRuntimeCompatibility());
  });

  api.get("/benchpacks/registry", async () => {
    const { config } = await loadOrCreateConfig();
    return loadBenchPackRegistry(config);
  });

  api.post("/benchpacks/:benchPackId/install", async (request) => {
    const { benchPackId } = request.params as any;
    const { config } = await loadOrCreateConfig();
    const saved = await installBenchPackFromRegistry(
      config,
      benchPackId,
      (progress) => sseBus.emit("benchpack-mutation-progress", progress),
      await getRuntimeCompatibility()
    );
    return { path: getConfigPath(), created: false, config: saved };
  });

  // ... (all other bench pack routes follow the same pattern)

  // --- Run management ---
  api.post("/benchpacks/run", async (request) => {
    const input = request.body as any;
    const { config } = await loadOrCreateConfig();
    const controller = new AbortController();
    activeRunManager.setActive(input.tabId, {
      benchPackId: input.benchPackId,
      controller,
    });

    try {
      return await runConfiguredBenchPack(
        config,
        input.benchPackId,
        {
          modelIds: input.modelIds,
          executionMode: input.executionMode,
          generation: input.generation,
          abortSignal: controller.signal,
          onEvent: (event) => {
            sseBus.emit("run-event", { tabId: input.tabId, event });
          },
        },
        await getRuntimeCompatibility()
      );
    } finally {
      activeRunManager.clearActive(input.tabId);
    }
  });

  api.post("/benchpacks/stop", async (request) => {
    const { tabId } = request.body as any;
    const active = activeRunManager.getActive(tabId);
    if (!active) return { stopped: false };
    active.controller.abort(new Error("Run cancelled by user."));
    return { stopped: true };
  });

  // --- Verifiers ---
  api.get("/verifiers", async () => {
    const { config } = await loadOrCreateConfig();
    const inspections = await inspectConfiguredBenchPacks(
      config,
      await getRuntimeCompatibility()
    );
    const relevant = inspections.filter(
      (i) =>
        i.manifest?.capabilities.verification ||
        i.manifest?.capabilities.sidecars
    );
    return Promise.all(
      relevant.map((i) => getConfiguredBenchPackVerifierStatus(config, i.id))
    );
  });

  // --- Themes ---
  api.get("/themes", async () => listAvailableThemes());
  api.get("/themes/:themeId", async (request) => {
    return loadAvailableTheme((request.params as any).themeId);
  });

  // --- Models ---
  api.post("/models/discover", async (request) => {
    const { provider } = request.body as any;
    return discoverProviderModels(provider);
  });

  // --- Updates (can be no-op for web or forwarded) ---
  api.get("/updates/state", async () => ({
    status: "unsupported",
    currentVersion: (await loadAppMetadata()).version,
  }));
  api.post("/updates/check", async () => ({ status: "not_available" }));
  api.post("/updates/install", async () => ({ started: false }));
}
```

#### 4.4 SSE event bus

Replace Electron's `ipcRenderer.on()` pattern with Server-Sent Events.

**File: `app/src/server/sse-bus.ts`**

```typescript
// app/src/server/sse-bus.ts
type EventHandler = (data: any) => void;

export class SseBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on(channel: string, handler: EventHandler): () => void {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
    }
    this.handlers.get(channel)!.add(handler);
    return () => {
      this.handlers.get(channel)?.delete(handler);
    };
  }

  emit(channel: string, data: any): void {
    for (const handler of this.handlers.get(channel) || []) {
      handler(data);
    }
  }
}

export const sseBus = new SseBus();
```

**File: `app/src/server/sse-routes.ts`**

```typescript
// app/src/server/sse-routes.ts
import type { FastifyInstance, FastifyReply } from "fastify";
import { sseBus } from "./sse-bus";

export function registerSseRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api/events/sse",
    { handlerTimeout: 0 },
    async (request, reply) => {
      reply.header("Content-Type", "text/event-stream");
      reply.header("Cache-Control", "no-cache");
      reply.header("Connection", "keep-alive");
      reply.header("X-Accel-Buffering", "no"); // disable Nginx buffering

      // Send initial heartbeat
      reply.raw.write(": connected\n\n");

      // Register handlers for each event channel
      const channels = [
        "run-event",
        "benchpack-mutation-progress",
        "verifier-progress",
        "app-update-state",
      ];

      const unsubscribers = channels.map((channel) =>
        sseBus.on(channel, (data) => {
          reply.raw.write(
            `event: ${channel}\ndata: ${JSON.stringify(data)}\n\n`
          );
        })
      );

      // Cleanup on client disconnect
      request.raw.on("close", () => {
        unsubscribers.forEach((unsub) => unsub());
      });

      // Keep-alive
      const keepAliveInterval = setInterval(() => {
        reply.raw.write(": heartbeat\n\n");
      }, 15000);

      request.raw.on("close", () => clearInterval(keepAliveInterval));

      // Hold the response open
      return new Promise(() => {});
    }
  );
}
```

#### 4.5 Run manager (replaces activeBenchPackRuns map)

**File: `app/src/server/run-manager.ts`**

```typescript
// app/src/server/run-manager.ts
export class ActiveRunManager {
  private runs = new Map<
    string,
    { benchPackId: string; controller: AbortController }
  >();

  setActive(
    tabId: string,
    run: { benchPackId: string; controller: AbortController }
  ) {
    this.runs.set(tabId, run);
  }

  getActive(tabId: string) {
    return this.runs.get(tabId);
  }

  clearActive(tabId: string) {
    this.runs.delete(tabId);
  }

  listActive() {
    return Array.from(this.runs.entries()).map(([tabId, run]) => ({
      tabId,
      benchPackId: run.benchPackId,
    }));
  }

  async shutdown() {
    for (const run of this.runs.values()) {
      run.controller.abort(new Error("Server shutting down."));
    }
    this.runs.clear();
  }
}

export const activeRunManager = new ActiveRunManager();
```

#### 4.6 Desktop-only features to stub out

| Feature                      | Desktop behavior          | Web replacement                                                       |
| ---------------------------- | ------------------------- | --------------------------------------------------------------------- |
| `workspaces:export`          | `dialog.showSaveDialog()` | Return file as download stream with `Content-Disposition: attachment` |
| `workspaces:import`          | `dialog.showOpenDialog()` | Accept multipart file upload                                          |
| `logs:openDetachedWindow`    | `new BrowserWindow()`     | Open new browser tab with `?view=logs`                                |
| `logs:closeDetachedWindow`   | `window.close()`          | Close tab (browser handles this)                                      |
| `app:updates`                | `electron-updater`        | Stub — no auto-update in web mode (or external update mechanism)      |
| `app:metadata`               | Read from `package.json`  | Same, read from `package.json`                                        |
| Window state persistence     | `window-state.json`       | Browser handles window size (localStorage for sidebar open state)     |
| System menu (Cmd+,)          | Electron `Menu`           | Keyboard shortcut handled in React                                    |
| macOS `app.showAboutPanel()` | Native dialog             | Custom about modal in React                                           |

---

### Phase 2: React Renderer Adaptation

#### 5.1 New API client (replaces `window.benchlocal`)

**File: `app/src/renderer/src/api/client.ts`**

This replaces the IPC bridge with fetch-based HTTP calls:

```typescript
// app/src/renderer/src/api/client.ts
const API_BASE = "/api"; // Same-origin by default; configurable via env

export async function fetchApi<T>(
  method: string,
  path: string,
  body?: any
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`API error ${response.status}: ${errorBody}`);
  }

  return response.json();
}

export function createSseConnection(): EventSource {
  return new EventSource(`${API_BASE}/events/sse`);
}

// Thin wrapper matching the existing desktop API shape
export const benchlocalApi = {
  config: {
    load: () => fetchApi("GET", "/config"),
    save: (config: any) => fetchApi("PUT", "/config", { config }),
  },
  workspaces: {
    load: () => fetchApi("GET", "/workspaces"),
    save: (state: any) => fetchApi("PUT", "/workspaces", { state }),
    // export/import handled separately (file download/upload)
  },
  benchPacks: {
    list: () => fetchApi("GET", "/benchpacks"),
    registry: () => fetchApi("GET", "/benchpacks/registry"),
    install: ({ benchPackId }: { benchPackId: string }) =>
      fetchApi("POST", `/benchpacks/${benchPackId}/install`),
    installFromUrl: ({ url }: { url: string }) =>
      fetchApi("POST", "/benchpacks/install-from-url", { url }),
    update: ({ benchPackId }: { benchPackId: string }) =>
      fetchApi("POST", `/benchpacks/${benchPackId}/update`),
    uninstall: ({ benchPackId }: { benchPackId: string }) =>
      fetchApi("POST", `/benchpacks/${benchPackId}/uninstall`),
    run: (input: any) => fetchApi("POST", "/benchpacks/run", input),
    stop: ({ tabId }: { tabId: string }) =>
      fetchApi("POST", "/benchpacks/stop", { tabId }),
    history: ({ benchPackId }: { benchPackId: string }) =>
      fetchApi("GET", `/benchpacks/${benchPackId}/history`),
    loadHistory: ({
      benchPackId,
      runId,
    }: {
      benchPackId: string;
      runId: string;
    }) => fetchApi("GET", `/benchpacks/${benchPackId}/history/${runId}`),
    clearHistory: ({ benchPackId }: { benchPackId: string }) =>
      fetchApi("POST", `/benchpacks/${benchPackId}/history/clear`),
  },
  verifiers: {
    list: () => fetchApi("GET", "/verifiers"),
    start: ({ benchPackId }: { benchPackId: string }) =>
      fetchApi("POST", "/verifiers/start", { benchPackId }),
    stop: ({ benchPackId }: { benchPackId: string }) =>
      fetchApi("POST", "/verifiers/stop", { benchPackId }),
  },
  themes: {
    list: () => fetchApi("GET", "/themes"),
    load: ({ themeId }: { themeId: string }) =>
      fetchApi("GET", `/themes/${themeId}`),
  },
  models: {
    discover: ({ provider }: { provider: any }) =>
      fetchApi("POST", "/models/discover", { provider }),
  },
  app: {
    metadata: () => fetchApi("GET", "/metadata"),
  },
  // SSE-based event subscription (replaces ipcRenderer.on)
  sse: {
    connect: () => createSseConnection(),
  },
};
```

#### 5.2 Changes to App.tsx

The changes to `App.tsx` are targeted replacements of `window.benchlocal` calls:

| Desktop code                                                | Web replacement                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `window.benchlocal.config.load()`                           | `benchlocalApi.config.load()`                                                  |
| `window.benchlocal.benchPacks.run(...)`                     | `benchlocalApi.benchPacks.run(...)`                                            |
| `window.benchlocal.benchPacks.onRunEvent(listener)`         | `sseSource.addEventListener('run-event', (e) => listener(JSON.parse(e.data)))` |
| `window.benchlocal.benchPacks.onMutationProgress(listener)` | `sseSource.addEventListener('benchpack-mutation-progress', ...)`               |
| `window.benchlocal.workspaces.export(...)`                  | File download via `<a download>` + fetch with `Content-Disposition`            |
| `window.benchlocal.workspaces.import()`                     | `<input type="file">` + POST multipart                                         |
| `window.benchlocal.updates.*`                               | Stubbed (no-op)                                                                |
| `window.benchlocal.logs.openDetachedWindow()`               | `window.open('?view=logs')`                                                    |

The SSE connection is established once at app mount and torn down on unmount. All real-time events flow through the single `EventSource`.

#### 5.3 Build configuration changes

**File: `app/electron.vite.config.ts`** (or new `app/vite.config.web.ts`)

The existing electron-vite config builds both the Electron main process and the renderer. For the web app, we need a separate Vite config that:

1. Builds only the renderer as a standalone SPA
2. Outputs to `app/out/renderer-out/` (or similar)
3. Uses standard browser polyfills (no Electron)
4. No preload, no context bridge

```typescript
// app/vite.config.web.ts (new)
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@core": path.resolve(__dirname, "../packages/benchlocal-core/src"),
    },
  },
  build: {
    outDir: "out/renderer-out",
    emptyOutDir: true,
  },
});
```

#### 5.4 CSS and assets

No changes needed. The existing Tailwind CSS, CSS custom properties (themes), and assets work identically in a browser.

---

### Phase 3: Build & Deployment

#### 6.1 New scripts in `package.json` (root)

```json
{
  "scripts": {
    "web:dev": "concurrently \"npm run web:dev:server\" \"npm run web:dev:renderer\"",
    "web:dev:server": "tsx watch app/src/server/index.ts",
    "web:dev:renderer": "vite --config app/vite.config.web.ts",
    "web:build": "npm run build --workspace @benchlocal/core && npm run build --workspace @benchlocal/benchpack-host && npm run web:build:renderer && npm run web:build:server",
    "web:build:renderer": "vite build --config app/vite.config.web.ts",
    "web:build:server": "esbuild app/src/server/index.ts --bundle --platform=node --target=node20 --format=esm --outfile=app/out/server/index.js --external:@benchlocal/* --external:fastify",
    "web:start": "node app/out/server/index.js"
  }
}
```

#### 6.2 Docker deployment (optional but recommended)

**File: `Dockerfile.web`**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run web:build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/app/out/server ./server
COPY --from=builder /app/app/out/renderer-out ./renderer-out
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/themes ./themes

# Expose Docker socket for verifier containers (requires -v /var/run/docker.sock)
ENV BENCHLOCAL_PORT=3540
ENV BENCHLOCAL_HOST=0.0.0.0

EXPOSE 3540
CMD ["node", "server/index.js"]
```

Run:

```bash
docker run -p 3540:3540 \
  -v ~/.benchlocal:/root/.benchlocal \
  -v /var/run/docker.sock:/var/run/docker.sock \
  benchlocal-web
```

#### 6.3 Reverse proxy (optional)

For production behind Nginx/Caddy:

```nginx
location / {
    proxy_pass http://127.0.0.1:3540;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    # SSE needs no buffering
    proxy_buffering off;
}
```

---

### Phase 4: Files to create/modify

#### New files

| File                                         | Purpose                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| `app/src/server/index.ts`                    | Fastify server entry point                                                              |
| `app/src/server/api-routes.ts`               | REST API endpoint definitions                                                           |
| `app/src/server/sse-routes.ts`               | SSE event streaming endpoint                                                            |
| `app/src/server/sse-bus.ts`                  | In-process event bus (replaces IPC event channels)                                      |
| `app/src/server/run-manager.ts`              | Active run tracking (replaces `activeBenchPackRuns` map)                                |
| `app/src/server/themes.ts`                   | Theme listing/loading (extracted from `app/src/main/themes.ts`, no Electron dependency) |
| `app/src/server/app-metadata.ts`             | App metadata (extracted from `app/src/main/app-metadata.ts`, no Electron dependency)    |
| `app/src/server/models.ts`                   | Model discovery (extracted from `app/src/main/ipc.ts`, no Electron dependency)          |
| `app/src/server/updater.ts`                  | Stubbed update handler (no auto-update in web mode)                                     |
| `app/src/renderer/src/api/client.ts`         | HTTP/SSE API client (replaces `window.benchlocal` IPC bridge)                           |
| `app/src/renderer/src/api/sse-subscriber.ts` | SSE connection manager with reconnect logic                                             |
| `app/vite.config.web.ts`                     | Vite config for renderer-only (no Electron) build                                       |
| `app/tsconfig.server.json`                   | TypeScript config for server-side code                                                  |
| `Dockerfile.web`                             | Docker image for the web server                                                         |

#### Modified files

| File                            | Changes                                                                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/src/renderer/src/App.tsx`  | Replace `window.benchlocal.*` with `benchlocalApi.*`; replace IPC event listeners with SSE listeners; stub desktop-only features (updates, dialogs) |
| `app/src/renderer/src/main.tsx` | Remove Electron preload expectations; initialize API client                                                                                         |
| `app/src/shared/desktop-api.ts` | Rename to `api.ts` (optional) or keep as reference; create web-compatible version                                                                   |
| `app/package.json`              | Add server dependencies (Fastify, etc.); add web build scripts                                                                                      |
| `package.json` (root)           | Add `web:dev`, `web:build`, `web:start` scripts                                                                                                     |
| `app/electron.vite.config.ts`   | Add renderer-out build target (or keep separate via `vite.config.web.ts`)                                                                           |

#### Files to extract (copy + remove Electron deps)

| Source                                  | Target                           | What to remove                                                                       |
| --------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| `app/src/main/themes.ts`                | `app/src/server/themes.ts`       | `import { app } from 'electron'`, `process.resourcesPath`, `__dirname` Electron path |
| `app/src/main/app-metadata.ts`          | `app/src/server/app-metadata.ts` | Electron-specific `app.getVersion()` fallbacks                                       |
| `app/src/main/ipc.ts` (model discovery) | `app/src/server/models.ts`       | `ipcRenderer`, dialog imports                                                        |

---

## 5. Data flow comparison

### Desktop (current)

```
React UI ──IPC──► Electron Main ──calls──► benchpack-host
  ▲                                       │
  │        IPC event                      ▼
  └──── ipcRenderer.on ─── run events ◄─── runConfiguredBenchPack()
```

### Web app (target)

```
React SPA ──fetch()──► Fastify API ──calls──► benchpack-host
  ▲                                       │
  │         SSE stream                    ▼
  └── EventSource.on ◄── /api/events ◄─── runConfiguredBenchPack()
```

The benchpack-host package is **unchanged**. It is pure Node.js with no Electron dependency.

---

## 6. What stays the same

- `~/.benchlocal/` directory structure (unchanged)
- `config.toml` format (unchanged)
- `state.json` format (unchanged)
- Bench Pack install artifacts (unchanged)
- Run storage format (unchanged)
- `@benchlocal/core` package (unchanged)
- `@benchlocal/benchpack-host` package (unchanged)
- Bench Pack registry (unchanged)
- Docker verifier management (unchanged)
- Theme JSON files (unchanged)
- React UI styling (Tailwind + CSS variables, unchanged)

---

## 7. What changes

| Area          | Desktop                            | Web                                                    |
| ------------- | ---------------------------------- | ------------------------------------------------------ |
| Process model | Electron main + renderer           | Single Node.js HTTP server                             |
| IPC           | Electron IPC                       | HTTP REST + SSE                                        |
| UI hosting    | Embedded Chromium                  | Any browser                                            |
| File dialogs  | `dialog.showSaveDialog/OpenDialog` | Browser download/upload                                |
| App updates   | `electron-updater` (auto)          | Manual (git pull + restart, or container image update) |
| Window state  | Persisted to JSON file             | Browser localStorage                                   |
| System menu   | Electron Menu                      | Browser keyboard shortcuts                             |
| About dialog  | Native `showAboutPanel()`          | Custom React modal                                     |
| Detached logs | New BrowserWindow                  | New browser tab (`?view=logs`)                         |

---

## 8. Risk assessment

| Risk                              | Impact                                         | Mitigation                                                                                                                    |
| --------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| SSE reconnect on network drop     | Run events lost during disconnect              | Server buffers recent events; client can poll `/api/benchpacks/active-runs` on reconnect                                      |
| CORS when accessing remote server | Blocked requests                               | Server sets `Access-Control-Allow-Origin`                                                                                     |
| Docker not available on server    | Verifier-dependent packs fail                  | Same as desktop — Docker required. Document clearly.                                                                          |
| Long-running runs on server       | Server process must stay alive                 | Use `pm2`, systemd, or Docker container with restart policy                                                                   |
| Large SSE payloads                | Memory pressure during fast runs               | Batch events; limit SSE buffer size                                                                                           |
| Security: no authentication       | Anyone who reaches the port can run benchmarks | Default bind to `127.0.0.1`. Document `--host 0.0.0.0` requires reverse proxy with auth. Optional: add basic auth middleware. |

---

## 9. Migration path

The web app and desktop app can coexist:

1. **Phase 1**: Build the server backend alongside the existing Electron app. Both read/write the same `~/.benchlocal/` directory.
2. **Phase 2**: Build the web renderer alongside the Electron renderer. They share the same React codebase (same `App.tsx`, different API client).
3. **Phase 3**: Users can switch between desktop and web by running either `npm run dev` (Electron) or `npm run web:dev` (web).
4. **Phase 4**: When satisfied, the desktop build can be deprecated or kept as an alternative distribution.

This means **no data migration** is needed — both apps use the same `~/.benchlocal/` directory.

---

## 10. Effort estimate

| Task                                             | Estimated effort |
| ------------------------------------------------ | ---------------- |
| Server backend (Fastify, routes, SSE)            | 2-3 days         |
| Extract Electron-only modules (themes, metadata) | 0.5 day          |
| React API client (fetch + SSE wrapper)           | 1 day            |
| Adapt App.tsx (replace IPC with HTTP calls)      | 2-3 days         |
| Build configuration (Vite web config, scripts)   | 0.5 day          |
| Docker deployment config                         | 0.5 day          |
| Testing & polish                                 | 1-2 days         |
| **Total**                                        | **~7-11 days**   |

---

## 11. API reference (target REST API)

Complete list of endpoints for the web server:

### App

- `GET /api/metadata` — App version info
- `GET /api/updates/state` — Update state (stubbed)
- `POST /api/updates/check` — Check for updates (stubbed)
- `POST /api/updates/install` — Install update (stubbed)

### Configuration

- `GET /api/config` — Load current config
- `PUT /api/config` — Save config (body: `{ config: BenchLocalConfig }`)

### Workspaces

- `GET /api/workspaces` — Load workspace state
- `PUT /api/workspaces` — Save workspace state (body: `{ state: BenchLocalWorkspaceState }`)
- `POST /api/workspaces/export` — Export workspace (body: `{ workspaceId, state }`) → file download
- `POST /api/workspaces/import` — Import workspace (multipart: `.benchlocal-workspace.json`)

### Bench Packs

- `GET /api/benchpacks` — List installed Bench Packs
- `GET /api/benchpacks/registry` — Fetch official registry
- `POST /api/benchpacks/:benchPackId/install` — Install from registry
- `POST /api/benchpacks/install-from-url` — Install from URL (body: `{ url }`)
- `POST /api/benchpacks/:benchPackId/update` — Update from registry
- `POST /api/benchpacks/:benchPackId/uninstall` — Uninstall
- `GET /api/benchpacks/active-runs` — List active runs
- `POST /api/benchpacks/run` — Start a new run
- `POST /api/benchpacks/retry-scenario` — Retry a single scenario
- `POST /api/benchpacks/resume-run` — Resume an incomplete run
- `POST /api/benchpacks/stop` — Stop an active run (body: `{ tabId }`)
- `GET /api/benchpacks/:benchPackId/history` — List run history
- `GET /api/benchpacks/:benchPackId/history/:runId` — Load a specific run summary
- `POST /api/benchpacks/:benchPackId/history/clear` — Clear run history

### Verifiers

- `GET /api/verifiers` — List verifier statuses
- `POST /api/verifiers/start` — Start verifiers (body: `{ benchPackId }`)
- `POST /api/verifiers/stop` — Stop verifiers (body: `{ benchPackId }`)
- `POST /api/verifiers/cancel-start` — Cancel verifier startup
- `POST /api/verifiers/delete-image` — Delete Docker image (body: `{ benchPackId, verifierId }`)

### Themes

- `GET /api/themes` — List available themes
- `GET /api/themes/:themeId` — Load a specific theme

### Models

- `POST /api/models/discover` — Discover models from a provider (body: `{ provider }`)

### Real-time events

- `GET /api/events/sse` — Server-Sent Events stream
  - `event: run-event` — Run progress events
  - `event: benchpack-mutation-progress` — Install/update/uninstall progress
  - `event: verifier-progress` — Verifier preparation progress
  - `event: app-update-state` — Update state changes (stubbed)

---

## 12. Environment variables

| Variable                 | Default         | Description                                |
| ------------------------ | --------------- | ------------------------------------------ |
| `BENCHLOCAL_PORT`        | `3540`          | HTTP server port                           |
| `BENCHLOCAL_HOST`        | `127.0.0.1`     | Bind address (`0.0.0.0` for remote access) |
| `BENCHLOCAL_CORS_ORIGIN` | `*`             | CORS origin restriction                    |
| `BENCHLOCAL_BASIC_AUTH`  | _(none)_        | Optional `user:password` for basic auth    |
| `BENCHLOCAL_HOME`        | `~/.benchlocal` | Override data directory                    |

---

## 13. Future enhancements (post-MVP)

1. **Authentication** — JWT-based auth for multi-user access
2. **WebSocket alternative to SSE** — For bidirectional communication (e.g., interactive logs)
3. **Run scheduling** — Queue and schedule benchmark runs
4. **Multi-user workspaces** — Separate workspace isolation per user
5. **Export to PDF/HTML** — Run result reports
6. **Comparison view** — Side-by-side comparison of multiple runs
7. **CI/CD integration** — Headless mode with JSON output only
8. **Plugin system** — Allow community web UI extensions
