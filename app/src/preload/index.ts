import { contextBridge, ipcRenderer } from "electron";
import type { BenchLocalConfig, BenchLocalWorkspaceState, GenerationRequest, ProgressEvent } from "@core";
import type { BenchLocalDesktopApi, BenchPackVerifierPreparationEvent, DetachedLogsState } from "@/shared/desktop-api";

const THEMES_LIST_CHANNEL = "benchlocal:themes:list";
const THEMES_LOAD_CHANNEL = "benchlocal:themes:load";
const APP_METADATA_CHANNEL = "benchlocal:app:metadata";
const APP_OPEN_ABOUT_CHANNEL = "benchlocal:app:open-about";
const APP_OPEN_SETTINGS_CHANNEL = "benchlocal:app:open-settings";
const MODELS_DISCOVER_CHANNEL = "benchlocal:models:discover";
const BENCH_PACK_RUN_EVENT_CHANNEL = "benchlocal:benchpacks:run-event";
const BENCH_PACK_MUTATION_PROGRESS_CHANNEL = "benchlocal:benchpacks:mutation-progress";
const VERIFIERS_PROGRESS_CHANNEL = "benchlocal:verifiers:progress";
const DETACHED_LOGS_STATE_CHANNEL = "benchlocal:logs:state";
const DETACHED_LOGS_CLOSED_CHANNEL = "benchlocal:logs:closed";

const api: BenchLocalDesktopApi = {
  app: {
    metadata: () => ipcRenderer.invoke(APP_METADATA_CHANNEL),
    onOpenAbout: (listener) => {
      const wrapped = () => {
        listener();
      };

      ipcRenderer.on(APP_OPEN_ABOUT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(APP_OPEN_ABOUT_CHANNEL, wrapped);
    },
    onOpenSettings: (listener) => {
      const wrapped = () => {
        listener();
      };

      ipcRenderer.on(APP_OPEN_SETTINGS_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(APP_OPEN_SETTINGS_CHANNEL, wrapped);
    }
  },
  config: {
    load: () => ipcRenderer.invoke("benchlocal:config:load"),
    save: (config: BenchLocalConfig) => ipcRenderer.invoke("benchlocal:config:save", config)
  },
  models: {
    discover: (input: { provider: BenchLocalConfig["providers"][string] }) =>
      ipcRenderer.invoke(MODELS_DISCOVER_CHANNEL, input)
  },
  themes: {
    list: () => ipcRenderer.invoke(THEMES_LIST_CHANNEL),
    load: (input: { themeId: string }) => ipcRenderer.invoke(THEMES_LOAD_CHANNEL, input)
  },
  workspaces: {
    load: () => ipcRenderer.invoke("benchlocal:workspaces:load"),
    save: (state: BenchLocalWorkspaceState) => ipcRenderer.invoke("benchlocal:workspaces:save", state),
    export: (input: { workspaceId: string; state: BenchLocalWorkspaceState }) =>
      ipcRenderer.invoke("benchlocal:workspaces:export", input),
    import: () => ipcRenderer.invoke("benchlocal:workspaces:import")
  },
  benchPacks: {
    list: () => ipcRenderer.invoke("benchlocal:benchpacks:list"),
    registry: () => ipcRenderer.invoke("benchlocal:benchpacks:registry"),
    install: (input: { benchPackId: string }) => ipcRenderer.invoke("benchlocal:benchpacks:install", input),
    installFromUrl: (input: { url: string }) => ipcRenderer.invoke("benchlocal:benchpacks:install-from-url", input),
    update: (input: { benchPackId: string }) => ipcRenderer.invoke("benchlocal:benchpacks:update", input),
    uninstall: (input: { benchPackId: string }) => ipcRenderer.invoke("benchlocal:benchpacks:uninstall", input),
    onMutationProgress: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => {
        listener(payload);
      };

      ipcRenderer.on(BENCH_PACK_MUTATION_PROGRESS_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(BENCH_PACK_MUTATION_PROGRESS_CHANNEL, wrapped);
    },
    activeRuns: () => ipcRenderer.invoke("benchlocal:benchpacks:active-runs"),
    run: (input: { tabId: string; benchPackId: string; modelIds?: string[]; executionMode?: "serial" | "serial_by_model" | "parallel_by_model" | "parallel_by_test_case" | "full_parallel"; generation?: GenerationRequest }) =>
      ipcRenderer.invoke("benchlocal:benchpacks:run", input),
    retryScenario: (input: { tabId: string; benchPackId: string; runId: string; scenarioId: string; modelId: string; generation?: GenerationRequest }) =>
      ipcRenderer.invoke("benchlocal:benchpacks:retry-scenario", input),
    resumeRun: (input: { tabId: string; benchPackId: string; runId: string; executionMode?: "serial" | "serial_by_model" | "parallel_by_model" | "parallel_by_test_case" | "full_parallel"; generation?: GenerationRequest }) =>
      ipcRenderer.invoke("benchlocal:benchpacks:resume-run", input),
    stop: (input: { tabId: string }) => ipcRenderer.invoke("benchlocal:benchpacks:stop", input),
    history: (input: { benchPackId: string }) => ipcRenderer.invoke("benchlocal:benchpacks:history", input),
    loadHistory: (input: { benchPackId: string; runId: string }) => ipcRenderer.invoke("benchlocal:benchpacks:history-load", input),
    clearHistory: (input: { benchPackId: string }) => ipcRenderer.invoke("benchlocal:benchpacks:history-clear", input),
    onRunEvent: (listener: (payload: { tabId: string; event: ProgressEvent }) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: { tabId: string; event: ProgressEvent }) => {
        listener(payload);
      };

      ipcRenderer.on(BENCH_PACK_RUN_EVENT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(BENCH_PACK_RUN_EVENT_CHANNEL, wrapped);
    }
  },
  verifiers: {
    list: () => ipcRenderer.invoke("benchlocal:verifiers:list"),
    start: (input: { benchPackId: string }) => ipcRenderer.invoke("benchlocal:verifiers:start", input),
    stop: (input: { benchPackId: string }) => ipcRenderer.invoke("benchlocal:verifiers:stop", input),
    cancelStart: (input: { benchPackId: string }) => ipcRenderer.invoke("benchlocal:verifiers:cancel-start", input),
    deleteImage: (input: { benchPackId: string; verifierId: string }) =>
      ipcRenderer.invoke("benchlocal:verifiers:delete-image", input),
    onProgress: (listener: (payload: { benchPackId: string; event: BenchPackVerifierPreparationEvent }) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: { benchPackId: string; event: BenchPackVerifierPreparationEvent }) => {
        listener(payload);
      };

      ipcRenderer.on(VERIFIERS_PROGRESS_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(VERIFIERS_PROGRESS_CHANNEL, wrapped);
    }
  },
  logs: {
    openDetachedWindow: () => ipcRenderer.invoke("benchlocal:logs:open-detached"),
    closeDetachedWindow: () => ipcRenderer.invoke("benchlocal:logs:close-detached"),
    publishDetachedState: (state: DetachedLogsState) => ipcRenderer.invoke("benchlocal:logs:publish-state", state),
    onDetachedState: (listener: (state: DetachedLogsState) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: DetachedLogsState) => {
        listener(state);
      };

      ipcRenderer.on(DETACHED_LOGS_STATE_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(DETACHED_LOGS_STATE_CHANNEL, wrapped);
    },
    onDetachedWindowClosed: (listener: () => void) => {
      const wrapped = () => {
        listener();
      };

      ipcRenderer.on(DETACHED_LOGS_CLOSED_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(DETACHED_LOGS_CLOSED_CHANNEL, wrapped);
    }
  }
};

contextBridge.exposeInMainWorld("benchlocal", api);
