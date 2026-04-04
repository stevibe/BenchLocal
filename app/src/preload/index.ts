import { contextBridge, ipcRenderer } from "electron";
import type { BenchLocalConfig, BenchLocalWorkspaceState, ProgressEvent } from "@core";
import type { BenchLocalDesktopApi, DetachedLogsState } from "@/shared/desktop-api";

const PLUGIN_RUN_EVENT_CHANNEL = "benchlocal:plugins:run-event";
const DETACHED_LOGS_STATE_CHANNEL = "benchlocal:logs:state";
const DETACHED_LOGS_CLOSED_CHANNEL = "benchlocal:logs:closed";

const api: BenchLocalDesktopApi = {
  config: {
    load: () => ipcRenderer.invoke("benchlocal:config:load"),
    save: (config: BenchLocalConfig) => ipcRenderer.invoke("benchlocal:config:save", config)
  },
  workspaces: {
    load: () => ipcRenderer.invoke("benchlocal:workspaces:load"),
    save: (state: BenchLocalWorkspaceState) => ipcRenderer.invoke("benchlocal:workspaces:save", state),
    export: (input: { workspaceId: string; state: BenchLocalWorkspaceState }) =>
      ipcRenderer.invoke("benchlocal:workspaces:export", input),
    import: () => ipcRenderer.invoke("benchlocal:workspaces:import")
  },
  plugins: {
    list: () => ipcRenderer.invoke("benchlocal:plugins:list"),
    activeRuns: () => ipcRenderer.invoke("benchlocal:plugins:active-runs"),
    run: (input: { tabId: string; pluginId: string; modelIds?: string[]; executionMode?: "serial" | "parallel_by_model" | "parallel_by_test_case" | "full_parallel" }) =>
      ipcRenderer.invoke("benchlocal:plugins:run", input),
    stop: (input: { tabId: string }) => ipcRenderer.invoke("benchlocal:plugins:stop", input),
    history: (input: { pluginId: string }) => ipcRenderer.invoke("benchlocal:plugins:history", input),
    loadHistory: (input: { pluginId: string; runId: string }) => ipcRenderer.invoke("benchlocal:plugins:history-load", input),
    onRunEvent: (listener: (payload: { tabId: string; event: ProgressEvent }) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: { tabId: string; event: ProgressEvent }) => {
        listener(payload);
      };

      ipcRenderer.on(PLUGIN_RUN_EVENT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(PLUGIN_RUN_EVENT_CHANNEL, wrapped);
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
