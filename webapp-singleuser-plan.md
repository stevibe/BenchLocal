# BenchLocal Web App — Single-User Plan

## Context

This plan is for a **single-user, closed-environment** deployment. The server runs on your local machine. You connect from any browser on the same LAN. No authentication, no multi-user isolation, no public exposure.

---

## 1. Current Architecture

```
┌─────────────────────────────────────────────────────┐
│  Electron Main Process (app/src/main/)              │
│                                                     │
│  ┌──────────────┐  ┌─────────────────────────────┐  │
│  │ IPC Handlers  │  │ benchpack-host package      │  │
│  │ (ipc.ts)      │──│ (run orchestration,         │  │
│  │               │  │  Docker, verifiers,         │  │
│  │ config,       │  │  install/uninstall)         │  │
│  │ themes,       │  └─────────────────────────────┘  │
│  │ workspaces    │                                    │
│  └──────────────┘                                    │
│        ▲  IPC bridge (preload)                       │
│        │                                             │
│  ┌──────────────┐                                    │
│  │ React UI      │  (app/src/renderer/src/App.tsx    │
│  │ (App.tsx)     │   ~7900 lines, single file)       │
│  └──────────────┘                                    │
│                                                     │
│  Storage: ~/.benchlocal/                            │
└─────────────────────────────────────────────────────┘
```

### Key packages

| Package                      | Role                                                   |
| ---------------------------- | ------------------------------------------------------ |
| `@benchlocal/core`           | Types, config (TOML), workspace state (JSON), themes   |
| `@benchlocal/benchpack-host` | Run orchestration, Docker verifiers, install/uninstall |
| `benchlocal-app`             | Electron shell: main process, IPC, React renderer      |

### Data layout (`~/.benchlocal/`)

```
config.toml          ← providers, models, benchpacks, theme
state.json           ← workspaces, tabs, per-tab model/sampling settings
runs/                ← per-run: summary.json, events.jsonl, host.log
benchpacks/          ← installed Bench Pack artifacts
logs/                ← host log files
cache/               ← cache
themes/              ← user-installed theme JSON files
```

### IPC API surface

The preload bridge (`app/src/preload/index.ts`) exposes `window.benchlocal`:

| Namespace    | Methods                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`     | `load()`, `save()`                                                                                                                                                                                                              |
| `workspaces` | `load()`, `save()`, `export()`, `import()`                                                                                                                                                                                      |
| `benchPacks` | `list()`, `registry()`, `install()`, `installFromUrl()`, `update()`, `uninstall()`, `run()`, `retryScenario()`, `resumeRun()`, `stop()`, `history()`, `loadHistory()`, `clearHistory()`, `onRunEvent()`, `onMutationProgress()` |
| `verifiers`  | `list()`, `start()`, `stop()`, `cancelStart()`, `deleteImage()`, `onProgress()`                                                                                                                                                 |
| `themes`     | `list()`, `load()`                                                                                                                                                                                                              |
| `models`     | `discover()`                                                                                                                                                                                                                    |
| `app`        | `metadata()`, `onOpenAbout()`, `onOpenSettings()`                                                                                                                                                                               |
| `updates`    | `state()`, `check()`, `install()`, `onState()`                                                                                                                                                                                  |
| `logs`       | `openDetachedWindow()`, `closeDetachedWindow()`, `publishDetachedState()`, `onDetachedState()`, `onDetachedWindowClosed()`                                                                                                      |

---

## 2. Target Architecture

```
┌──────────────────────────────────────────────────┐
│  Node.js HTTP Server (app/src/server/)           │
│                                                  │
│  ┌──────────────────┐  ┌─────────────────────┐   │
│  │ REST + SSE       │──│ benchpack-host pkg  │   │
│  │ (Fastify)        │  │ (run orchestration  │   │
│  │                  │  │  Docker, verifiers  │   │
│  └──────────────────┘  └─────────────────────┘   │
│                                                  │
│  Storage: ~/.benchlocal/ (unchanged)             │
└──────────────────────────────────────────────────┘
        ▲  HTTP :3540
        │
┌───────┴──────────────────────────────────────────┐
│  React SPA (same App.tsx, fetch instead of IPC)  │
│  Served statically by the same server            │
│  Access: http://your-server:3540                 │
└──────────────────────────────────────────────────┘
```

**The benchpack-host package is unchanged** — it's pure Node.js with no Electron dependency.

---

## 3. Implementation

### 3.1 Server entry point

**`app/src/server/index.ts`**

```typescript
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerApiRoutes } from "./api-routes";
import { registerSseRoute } from "./sse-route";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const server = Fastify({ logger: { level: "info" } });

  registerApiRoutes(server);
  registerSseRoute(server);

  // Serve the React SPA build output
  const rendererOut = path.join(__dirname, "..", "renderer-out");
  server.register(fastifyStatic, { root: rendererOut, prefix: "/" });

  // SPA fallback
  server.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.type("text/html").sendFile("index.html");
  });

  const port = Number(process.env.BENCHLOCAL_PORT) || 3540;
  const host = process.env.BENCHLOCAL_HOST || "0.0.0.0";

  await server.listen({ port, host });
  console.log(`BenchLocal running at http://${host}:${port}`);
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  await activeRunManager.shutdown();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await activeRunManager.shutdown();
  process.exit(0);
});

main();
```

### 3.2 SSE event bus

**`app/src/server/sse-bus.ts`** — in-process pub/sub replacing Electron IPC event channels.

```typescript
type Handler = (data: unknown) => void;

export class SseBus {
  private subs = new Map<string, Set<Handler>>();

  on(channel: string, handler: Handler): () => void {
    const set = this.subs.get(channel) || new Set<Handler>();
    set.add(handler);
    this.subs.set(channel, set);
    return () => set.delete(handler);
  }

  emit(channel: string, data: unknown) {
    for (const handler of this.subs.get(channel) || []) {
      handler(data);
    }
  }
}

export const sseBus = new SseBus();
```

### 3.3 SSE endpoint

**`app/src/server/sse-route.ts`** — single SSE stream for all real-time events.

```typescript
import type { FastifyInstance } from "fastify";
import { sseBus } from "./sse-bus";

export function registerSseRoute(server: FastifyInstance) {
  server.get("/api/events/sse", { handlerTimeout: 0 }, async (req, reply) => {
    reply.header("Content-Type", "text/event-stream");
    reply.header("Cache-Control", "no-cache");
    reply.header("Connection", "keep-alive");
    reply.raw.write(": connected\n\n");

    const channels = [
      "run-event",
      "benchpack-mutation-progress",
      "verifier-progress",
    ];

    const unsubscribers = channels.map((ch) =>
      sseBus.on(ch, (data) => {
        reply.raw.write(`event: ${ch}\ndata: ${JSON.stringify(data)}\n\n`);
      })
    );

    const keepAlive = setInterval(() => {
      reply.raw.write(": heartbeat\n\n");
    }, 15000);

    req.raw.on("close", () => {
      unsubscribers.forEach((u) => u());
      clearInterval(keepAlive);
    });

    return new Promise<never>(() => {});
  });
}
```

### 3.4 Active run tracker

**`app/src/server/run-manager.ts`** — replaces the `activeBenchPackRuns` Map in `ipc.ts`.

```typescript
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

### 3.5 API routes

**`app/src/server/api-routes.ts`** — one route per IPC channel. All routes delegate to `@benchlocal/core` or `@benchlocal/benchpack-host`.

```typescript
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

async function compat() {
  const meta = await loadAppMetadata();
  return { benchLocalVersion: meta.version };
}

export function registerApiRoutes(server: FastifyInstance) {
  const api = server.prefix("/api");

  // --- metadata ---
  api.get("/metadata", () => loadAppMetadata());

  // --- config ---
  api.get("/config", async () => {
    const r = await loadOrCreateConfig();
    return { path: r.path, created: r.created, config: r.config };
  });

  api.put("/config", async (req) => {
    const saved = await saveConfigFile(
      (req.body as any).config,
      getConfigPath()
    );
    return { path: getConfigPath(), created: false, config: saved };
  });

  // --- workspaces ---
  api.get("/workspaces", async () => {
    await loadOrCreateConfig();
    const r = await loadOrCreateWorkspaceState(getWorkspaceStatePath());
    return { path: r.path, created: r.created, state: r.state };
  });

  api.put("/workspaces", async (req) => {
    await loadOrCreateConfig();
    const saved = await saveWorkspaceStateFile(
      (req.body as any).state,
      getWorkspaceStatePath()
    );
    return { path: getWorkspaceStatePath(), created: false, state: saved };
  });

  // --- workspaces: export (file download) ---
  api.post("/workspaces/export", async (req, reply) => {
    const { workspaceId, state } = req.body as any;
    const workspace = state.workspaces[workspaceId];
    if (!workspace) throw new Error(`Workspace "${workspaceId}" not found.`);

    const tabs = Object.fromEntries(
      workspace.tabIds
        .map((id: string) => state.tabs[id])
        .filter(Boolean)
        .map((tab: any) => [tab.id, tab])
    );

    const name =
      (workspace.name.replace(/[^a-z0-9.-]/gi, "-") || "workspace") +
      ".benchlocal-workspace.json";

    reply.header("Content-Disposition", `attachment; filename="${name}"`);
    reply.header("Content-Type", "application/json");
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      workspace,
      tabs,
    };
  });

  // --- workspaces: import (file upload) ---
  api.post("/workspaces/import", async (req) => {
    // Accept JSON body directly (browser-side file reader)
    const data = req.body as any;
    if (!data.workspace || !data.tabs) {
      throw new Error("Import file is missing workspace or tab data.");
    }
    return { imported: true, workspace: data.workspace, tabs: data.tabs };
  });

  // --- bench packs ---
  api.get("/benchpacks", async () => {
    const { config } = await loadOrCreateConfig();
    return inspectConfiguredBenchPacks(config, await compat());
  });

  api.get("/benchpacks/registry", async () => {
    const { config } = await loadOrCreateConfig();
    return loadBenchPackRegistry(config);
  });

  api.post("/benchpacks/:benchPackId/install", async (req) => {
    const { config } = await loadOrCreateConfig();
    const saved = await installBenchPackFromRegistry(
      config,
      (req.params as any).benchPackId,
      (p) => sseBus.emit("benchpack-mutation-progress", p),
      await compat()
    );
    return { path: getConfigPath(), created: false, config: saved };
  });

  api.post("/benchpacks/install-from-url", async (req) => {
    const { config } = await loadOrCreateConfig();
    const saved = await installBenchPackFromUrl(
      config,
      (req.body as any).url,
      (p) => sseBus.emit("benchpack-mutation-progress", p),
      await compat()
    );
    return { path: getConfigPath(), created: false, config: saved };
  });

  api.post("/benchpacks/:benchPackId/update", async (req) => {
    const { config } = await loadOrCreateConfig();
    const saved = await updateBenchPackFromRegistry(
      config,
      (req.params as any).benchPackId,
      (p) => sseBus.emit("benchpack-mutation-progress", p),
      await compat()
    );
    return { path: getConfigPath(), created: false, config: saved };
  });

  api.post("/benchpacks/:benchPackId/uninstall", async (req) => {
    const { config } = await loadOrCreateConfig();
    const saved = await uninstallBenchPack(
      config,
      (req.params as any).benchPackId,
      (p) => sseBus.emit("benchpack-mutation-progress", p)
    );
    return { path: getConfigPath(), created: false, config: saved };
  });

  // --- active runs ---
  api.get("/benchpacks/active-runs", () => activeRunManager.listActive());

  // --- run ---
  api.post("/benchpacks/run", async (req) => {
    const input = req.body as any;
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
          onEvent: (event) =>
            sseBus.emit("run-event", { tabId: input.tabId, event }),
        },
        await compat()
      );
    } finally {
      activeRunManager.clearActive(input.tabId);
    }
  });

  // --- retry scenario ---
  api.post("/benchpacks/retry-scenario", async (req) => {
    const input = req.body as any;
    const { config } = await loadOrCreateConfig();
    return retryScenarioForBenchPackRun(
      config,
      input.benchPackId,
      {
        runId: input.runId,
        scenarioId: input.scenarioId,
        modelId: input.modelId,
        generation: input.generation,
        onEvent: (event) =>
          sseBus.emit("run-event", { tabId: input.tabId, event }),
      },
      await compat()
    );
  });

  // --- resume run ---
  api.post("/benchpacks/resume-run", async (req) => {
    const input = req.body as any;
    const { config } = await loadOrCreateConfig();
    const controller = new AbortController();
    activeRunManager.setActive(input.tabId, {
      benchPackId: input.benchPackId,
      controller,
    });

    try {
      return await resumeBenchPackRun(
        config,
        input.benchPackId,
        {
          runId: input.runId,
          executionMode: input.executionMode,
          generation: input.generation,
          abortSignal: controller.signal,
          onEvent: (event) =>
            sseBus.emit("run-event", { tabId: input.tabId, event }),
        },
        await compat()
      );
    } finally {
      activeRunManager.clearActive(input.tabId);
    }
  });

  // --- stop ---
  api.post("/benchpacks/stop", async (req) => {
    const { tabId } = req.body as any;
    const active = activeRunManager.getActive(tabId);
    if (!active) return { stopped: false };
    active.controller.abort(new Error("Run cancelled by user."));
    return { stopped: true };
  });

  // --- history ---
  api.get("/benchpacks/:benchPackId/history", async (req) => {
    const { config } = await loadOrCreateConfig();
    return listRunHistoryForBenchPack(config, (req.params as any).benchPackId);
  });

  api.get("/benchpacks/:benchPackId/history/:runId", async (req) => {
    const { config } = await loadOrCreateConfig();
    return loadRunSummaryForBenchPack(
      config,
      (req.params as any).benchPackId,
      (req.params as any).runId
    );
  });

  api.post("/benchpacks/:benchPackId/history/clear", async (req) => {
    const { config } = await loadOrCreateConfig();
    return clearRunHistoryForBenchPack(config, (req.params as any).benchPackId);
  });

  // --- verifiers ---
  api.get("/verifiers", async () => {
    const { config } = await loadOrCreateConfig();
    const inspections = await inspectConfiguredBenchPacks(
      config,
      await compat()
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

  api.post("/verifiers/start", async (req) => {
    const { config } = await loadOrCreateConfig();
    const status = await getConfiguredBenchPackVerifierStatus(
      config,
      (req.body as any).benchPackId
    );
    return startConfiguredBenchPackVerifiers(
      config,
      (req.body as any).benchPackId,
      {
        onProgress: (p) =>
          sseBus.emit("verifier-progress", {
            benchPackId: (req.body as any).benchPackId,
            event: {
              type: "verifier_preparing",
              benchPackId: (req.body as any).benchPackId,
              benchPackName: status.benchPackName,
              verifierId: p.verifierId,
              phase: p.phase,
              message: p.message,
            },
          }),
      }
    );
  });

  api.post("/verifiers/stop", async (req) => {
    const { config } = await loadOrCreateConfig();
    return stopConfiguredBenchPackVerifiers(
      config,
      (req.body as any).benchPackId
    );
  });

  api.post("/verifiers/cancel-start", async () => ({ cancelled: false }));

  api.post("/verifiers/delete-image", async (req) => {
    const { config } = await loadOrCreateConfig();
    return deleteConfiguredBenchPackVerifierImage(
      config,
      (req.body as any).benchPackId,
      (req.body as any).verifierId
    );
  });

  // --- themes ---
  api.get("/themes", () => listAvailableThemes());
  api.get("/themes/:themeId", async (req) =>
    loadAvailableTheme((req.params as any).themeId)
  );

  // --- models ---
  api.post("/models/discover", async (req) =>
    discoverProviderModels((req.body as any).provider)
  );
}
```

### 3.6 Extracted helpers (no Electron)

Three small files extracted from `app/src/main/` with Electron imports removed:

| Source                               | Target                   | Change                                                              |
| ------------------------------------ | ------------------------ | ------------------------------------------------------------------- |
| `main/themes.ts`                     | `server/themes.ts`       | Remove `app` import, use `import.meta.url` for theme dir resolution |
| `main/app-metadata.ts`               | `server/app-metadata.ts` | Remove `app.getVersion()` fallback, read `package.json` directly    |
| `main/ipc.ts` (model discovery only) | `server/models.ts`       | Remove `ipcRenderer`, keep fetch-based model discovery logic        |

### 3.7 React API client

**`app/src/renderer/src/api/client.ts`** — replaces `window.benchlocal` IPC bridge with fetch + EventSource.

```typescript
const BASE = "/api";

async function api<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json();
}

export const bl = {
  config: {
    load: () => api("GET", "/config"),
    save: (c: any) => api("PUT", "/config", { config: c }),
  },
  workspaces: {
    load: () => api("GET", "/workspaces"),
    save: (s: any) => api("PUT", "/workspaces", { state: s }),
    export: (id: string, state: any) =>
      api("POST", "/workspaces/export", { workspaceId: id, state }),
    import: (data: any) => api("POST", "/workspaces/import", data),
  },
  benchPacks: {
    list: () => api("GET", "/benchpacks"),
    registry: () => api("GET", "/benchpacks/registry"),
    install: (id: string) => api("POST", `/benchpacks/${id}/install`),
    installFromUrl: (url: string) =>
      api("POST", "/benchpacks/install-from-url", { url }),
    update: (id: string) => api("POST", `/benchpacks/${id}/update`),
    uninstall: (id: string) => api("POST", `/benchpacks/${id}/uninstall`),
    activeRuns: () => api("GET", "/benchpacks/active-runs"),
    run: (input: any) => api("POST", "/benchpacks/run", input),
    retryScenario: (input: any) =>
      api("POST", "/benchpacks/retry-scenario", input),
    resumeRun: (input: any) => api("POST", "/benchpacks/resume-run", input),
    stop: (tabId: string) => api("POST", "/benchpacks/stop", { tabId }),
    history: (id: string) => api("GET", `/benchpacks/${id}/history`),
    loadHistory: (id: string, runId: string) =>
      api("GET", `/benchpacks/${id}/history/${runId}`),
    clearHistory: (id: string) =>
      api("POST", `/benchpacks/${id}/history/clear`),
  },
  verifiers: {
    list: () => api("GET", "/verifiers"),
    start: (id: string) => api("POST", "/verifiers/start", { benchPackId: id }),
    stop: (id: string) => api("POST", "/verifiers/stop", { benchPackId: id }),
    cancelStart: (id: string) =>
      api("POST", "/verifiers/cancel-start", { benchPackId: id }),
    deleteImage: (benchPackId: string, verifierId: string) =>
      api("POST", "/verifiers/delete-image", { benchPackId, verifierId }),
  },
  themes: {
    list: () => api("GET", "/themes"),
    load: (id: string) => api("GET", `/themes/${id}`),
  },
  models: {
    discover: (provider: any) => api("POST", "/models/discover", { provider }),
  },
  app: {
    metadata: () => api("GET", "/metadata"),
  },
  sse: () => new EventSource(`${BASE}/events/sse`),
};
```

### 3.8 App.tsx changes

In `App.tsx`, every `window.benchlocal` call maps to `bl.*`:

| Desktop                                                          | Web                                             |
| ---------------------------------------------------------------- | ----------------------------------------------- |
| `window.benchlocal.config.load()`                                | `bl.config.load()`                              |
| `window.benchlocal.config.save(c)`                               | `bl.config.save(c)`                             |
| `window.benchlocal.workspaces.load()`                            | `bl.workspaces.load()`                          |
| `window.benchlocal.workspaces.save(s)`                           | `bl.workspaces.save(s)`                         |
| `window.benchlocal.benchPacks.run(i)`                            | `bl.benchPacks.run(i)`                          |
| `window.benchlocal.benchPacks.stop({tabId})`                     | `bl.benchPacks.stop(tabId)`                     |
| `window.benchlocal.benchPacks.list()`                            | `bl.benchPacks.list()`                          |
| `window.benchlocal.benchPacks.registry()`                        | `bl.benchPacks.registry()`                      |
| `window.benchlocal.benchPacks.history({benchPackId})`            | `bl.benchPacks.history(benchPackId)`            |
| `window.benchlocal.benchPacks.loadHistory({benchPackId, runId})` | `bl.benchPacks.loadHistory(benchPackId, runId)` |
| `window.benchlocal.verifiers.list()`                             | `bl.verifiers.list()`                           |
| `window.benchlocal.verifiers.start({benchPackId})`               | `bl.verifiers.start(benchPackId)`               |
| `window.benchlocal.verifiers.stop({benchPackId})`                | `bl.verifiers.stop(benchPackId)`                |
| `window.benchlocal.themes.list()`                                | `bl.themes.list()`                              |
| `window.benchlocal.themes.load({themeId})`                       | `bl.themes.load(themeId)`                       |
| `window.benchlocal.models.discover({provider})`                  | `bl.models.discover(provider)`                  |
| `window.benchlocal.app.metadata()`                               | `bl.app.metadata()`                             |
| `window.benchlocal.updates.*`                                    | removed (no-op)                                 |
| `window.benchlocal.logs.*`                                       | removed (no-op)                                 |

**SSE event listeners** replace `onRunEvent` / `onMutationProgress` / `onProgress`:

```typescript
// In App.tsx useEffect, replace:
//   window.benchlocal.benchPacks.onRunEvent(({ tabId, event }) => { ... });
//   window.benchlocal.benchPacks.onMutationProgress((p) => { ... });
//   window.benchlocal.verifiers.onProgress(({ benchPackId, event }) => { ... });

// With:
const sse = bl.sse();
sse.addEventListener("run-event", (e: MessageEvent) => {
  const { tabId, event } = JSON.parse(e.data);
  // same handler logic as current App.tsx
});
sse.addEventListener("benchpack-mutation-progress", (e: MessageEvent) => {
  const progress = JSON.parse(e.data);
  // same handler logic
});
sse.addEventListener("verifier-progress", (e: MessageEvent) => {
  const { benchPackId, event } = JSON.parse(e.data);
  // same handler logic
});

// cleanup on unmount
return () => sse.close();
```

**Removed UI features** (desktop-only, not needed in single-user web):

- App update banner / check-for-updates button
- Detached logs window (keep the inline log drawer, remove the "open detached" button)
- `onOpenAbout` / `onOpenSettings` IPC channels (keep the modals, trigger via UI buttons only)
- System keyboard shortcut Cmd+, (Electron Menu → Settings)

**Workspace import/export**: replace Electron file dialogs with browser-native equivalents:

- Export: POST `/api/workspaces/export` → triggers browser download via `Content-Disposition` header
- Import: `<input type="file" accept=".json">` → read file with `FileReader` → POST `/api/workspaces/import`

### 3.9 Build configuration

**`app/vite.config.web.ts`** — standalone Vite config for the renderer (no Electron).

```typescript
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

**New scripts** in root `package.json`:

```json
{
  "scripts": {
    "web:dev:renderer": "vite --config app/vite.config.web.ts",
    "web:dev:server": "tsx watch app/src/server/index.ts",
    "web:dev": "concurrently \"npm run web:dev:renderer\" \"npm run web:dev:server\"",
    "web:build": "npm run build:compile && vite build --config app/vite.config.web.ts && esbuild app/src/server/index.ts --bundle --platform=node --target=node20 --format=esm --outfile=dist/server.js --external:@benchlocal/*",
    "web:start": "node dist/server.js"
  }
}
```

New dependency in `app/package.json`:

```json
{
  "dependencies": {
    "fastify": "^5.0.0",
    "@fastify/static": "^8.0.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "concurrently": "^9.0.0",
    "esbuild": "^0.25.0"
  }
}
```

---

## 4. REST API reference

All endpoints prefixed with `/api/`. No auth required.

### Config

| Method | Path      | Body         | Response                    |
| ------ | --------- | ------------ | --------------------------- |
| GET    | `/config` | —            | `{ path, created, config }` |
| PUT    | `/config` | `{ config }` | `{ path, created, config }` |

### Workspaces

| Method | Path                 | Body                     | Response                   |
| ------ | -------------------- | ------------------------ | -------------------------- |
| GET    | `/workspaces`        | —                        | `{ path, created, state }` |
| PUT    | `/workspaces`        | `{ state }`              | `{ path, created, state }` |
| POST   | `/workspaces/export` | `{ workspaceId, state }` | JSON file download         |
| POST   | `/workspaces/import` | `{ workspace, tabs }`    | `{ imported }`             |

### Bench Packs

| Method | Path                             | Body                                                              | Notes                   |
| ------ | -------------------------------- | ----------------------------------------------------------------- | ----------------------- |
| GET    | `/benchpacks`                    | —                                                                 | Inspect installed packs |
| GET    | `/benchpacks/registry`           | —                                                                 | Official registry       |
| POST   | `/benchpacks/:id/install`        | —                                                                 | SSE: mutation progress  |
| POST   | `/benchpacks/install-from-url`   | `{ url }`                                                         | Third-party install     |
| POST   | `/benchpacks/:id/update`         | —                                                                 | SSE: mutation progress  |
| POST   | `/benchpacks/:id/uninstall`      | —                                                                 | SSE: mutation progress  |
| GET    | `/benchpacks/active-runs`        | —                                                                 | Active run list         |
| POST   | `/benchpacks/run`                | `{ tabId, benchPackId, modelIds?, executionMode?, generation? }`  | SSE: run events         |
| POST   | `/benchpacks/retry-scenario`     | `{ tabId, benchPackId, runId, scenarioId, modelId, generation? }` | SSE: run events         |
| POST   | `/benchpacks/resume-run`         | `{ tabId, benchPackId, runId, executionMode?, generation? }`      | SSE: run events         |
| POST   | `/benchpacks/stop`               | `{ tabId }`                                                       | —                       |
| GET    | `/benchpacks/:id/history`        | —                                                                 | Run history list        |
| GET    | `/benchpacks/:id/history/:runId` | —                                                                 | Run summary             |
| POST   | `/benchpacks/:id/history/clear`  | —                                                                 | —                       |

### Verifiers

| Method | Path                      | Body                          | Notes                  |
| ------ | ------------------------- | ----------------------------- | ---------------------- |
| GET    | `/verifiers`              | —                             | Status list            |
| POST   | `/verifiers/start`        | `{ benchPackId }`             | SSE: verifier progress |
| POST   | `/verifiers/stop`         | `{ benchPackId }`             | —                      |
| POST   | `/verifiers/cancel-start` | —                             | —                      |
| POST   | `/verifiers/delete-image` | `{ benchPackId, verifierId }` | —                      |

### Themes

| Method | Path               | Response              |
| ------ | ------------------ | --------------------- |
| GET    | `/themes`          | Theme descriptor list |
| GET    | `/themes/:themeId` | Theme definition      |

### Models

| Method | Path               | Body           | Response              |
| ------ | ------------------ | -------------- | --------------------- |
| POST   | `/models/discover` | `{ provider }` | Discovered model list |

### App

| Method | Path        | Response                        |
| ------ | ----------- | ------------------------------- |
| GET    | `/metadata` | `{ productName, version, ... }` |

### Events (SSE)

| Path              | Events                                                          |
| ----------------- | --------------------------------------------------------------- |
| GET `/events/sse` | `run-event`, `benchpack-mutation-progress`, `verifier-progress` |

---

## 5. Files summary

### New files (8)

| File                                 | Purpose                                              |
| ------------------------------------ | ---------------------------------------------------- |
| `app/src/server/index.ts`            | Fastify server entry, SPA serving, graceful shutdown |
| `app/src/server/api-routes.ts`       | All REST endpoint handlers                           |
| `app/src/server/sse-route.ts`        | SSE stream endpoint                                  |
| `app/src/server/sse-bus.ts`          | In-process event bus                                 |
| `app/src/server/run-manager.ts`      | Active run tracking + shutdown                       |
| `app/src/server/themes.ts`           | Theme loader (Electron-free)                         |
| `app/src/server/app-metadata.ts`     | App metadata (Electron-free)                         |
| `app/src/server/models.ts`           | Model discovery (Electron-free)                      |
| `app/src/renderer/src/api/client.ts` | HTTP + SSE API client                                |
| `app/vite.config.web.ts`             | Renderer-only Vite config                            |

### Modified files (3)

| File                            | Change                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `app/src/renderer/src/App.tsx`  | `window.benchlocal.*` → `bl.*`; IPC listeners → SSE; remove update/detached-logs UI |
| `app/src/renderer/src/main.tsx` | Remove Electron preload check; no change to React bootstrap                         |
| `app/package.json`              | Add `fastify`, `@fastify/static`, `tsx`, `esbuild`, `concurrently`                  |

### Unchanged packages (3)

| Package                      | Status                             |
| ---------------------------- | ---------------------------------- |
| `@benchlocal/core`           | Unchanged — no Electron dependency |
| `@benchlocal/benchpack-host` | Unchanged — no Electron dependency |
| `@benchlocal/sdk`            | Unchanged                          |

---

## 6. Data flow

```
Browser SPA ── fetch() ──► Fastify routes ──► @benchlocal/benchpack-host
  ▲                                           (run, install, Docker...)
  │           SSE /api/events/sse             │
  └──── EventSource ◄─────────────────────────┘
                                │
                                ▼
                          ~/.benchlocal/
                    (config.toml, state.json, runs/, benchpacks/)
```

---

## 7. What stays the same

- `~/.benchlocal/` layout, `config.toml`, `state.json`
- All Bench Pack artifacts and registry
- Docker verifier management
- Run storage format (`summary.json`, `events.jsonl`, `host.log`)
- Theme JSON files
- React UI styling (Tailwind + CSS variables)
- Workspace/tab concept (organizational, not multi-user)
- `@benchlocal/core` and `@benchlocal/benchpack-host` packages

---

## 8. What goes away

| Feature                           | Reason                                        |
| --------------------------------- | --------------------------------------------- |
| Auto-updater (`electron-updater`) | No desktop update mechanism in web mode       |
| Detached logs window              | No `BrowserWindow` — keep inline log drawer   |
| Electron system menu              | Not applicable                                |
| Native about panel                | Custom React modal is sufficient              |
| Window state persistence          | Browser handles window size                   |
| File dialog (save/open)           | Browser download/upload                       |
| `logs` IPC namespace              | Removed entirely                              |
| `updates` IPC namespace           | Removed (stubbed where App.tsx references it) |

---

## 9. Deployment

### Direct (npm)

```bash
npm install
npm run web:build
npm run web:start
# → http://0.0.0.0:3540
```

### Docker

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run web:build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist/server.js ./
COPY --from=builder /app/app/out/renderer-out ./renderer-out
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/themes ./themes
EXPOSE 3540
CMD ["node", "server.js"]
```

```bash
docker build -f Dockerfile.web -t benchlocal-web .
docker run -p 3540:3540 \
  -v ~/.benchlocal:/root/.benchlocal \
  -v /var/run/docker.sock:/var/run/docker.sock \
  benchlocal-web
```

### systemd service (Linux)

```ini
[Unit]
Description=BenchLocal Web
After=network.target

[Service]
Type=simple
User=benchlocal
WorkingDirectory=/opt/benchlocal
ExecStart=/usr/bin/node /opt/benchlocal/dist/server.js
Restart=on-failure
Environment=NODE_ENV=production
Environment=BENCHLOCAL_PORT=3540
Environment=BENCHLOCAL_HOST=0.0.0.0

[Install]
WantedBy=multi-user.target
```

---

## 10. Environment variables

| Variable          | Default       | Description                       |
| ----------------- | ------------- | --------------------------------- |
| `BENCHLOCAL_PORT` | `3540`        | HTTP port                         |
| `BENCHLOCAL_HOST` | `0.0.0.0`     | Bind address                      |
| `NODE_ENV`        | `development` | `production` disables dev logging |

---

## 11. Effort estimate

| Task                                                       | Effort      |
| ---------------------------------------------------------- | ----------- |
| Server backend (api-routes.ts, SSE, run-manager)           | 2 days      |
| Extract Electron-free helpers (themes, metadata, models)   | 0.5 day     |
| React API client (client.ts)                               | 0.5 day     |
| Adapt App.tsx (IPC → fetch + SSE, remove desktop features) | 2 days      |
| Build config (vite.config.web.ts, scripts)                 | 0.5 day     |
| Dockerfile + systemd unit                                  | 0.5 day     |
| Testing & polish                                           | 1 day       |
| **Total**                                                  | **~7 days** |

---

## 12. Known limitations (acceptable for single-user)

- **No auto-update** — update by pulling new code and restarting the server
- **No file dialog** — workspace import uses `<input type="file">`, export uses browser download
- **No detached logs window** — the inline log drawer at the bottom of the page is sufficient
- **SSE reconnect** — on network drop, the client reconnects automatically via `EventSource`'s built-in reconnection. Any run events missed during the gap are recoverable by calling `/api/benchpacks/active-runs` and `/api/benchpacks/:id/history/:runId` after reconnect.
