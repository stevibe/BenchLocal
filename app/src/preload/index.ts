import { contextBridge, ipcRenderer } from "electron";
import type { BenchLocalConfig, BenchLocalWorkspaceState, ProgressEvent } from "@core";
import type { BenchLocalDesktopApi } from "@/shared/desktop-api";

const PLUGIN_RUN_EVENT_CHANNEL = "benchlocal:plugins:run-event";

const api: BenchLocalDesktopApi = {
  config: {
    load: () => ipcRenderer.invoke("benchlocal:config:load"),
    save: (config: BenchLocalConfig) => ipcRenderer.invoke("benchlocal:config:save", config)
  },
  workspaces: {
    load: () => ipcRenderer.invoke("benchlocal:workspaces:load"),
    save: (state: BenchLocalWorkspaceState) => ipcRenderer.invoke("benchlocal:workspaces:save", state)
  },
  plugins: {
    list: () => ipcRenderer.invoke("benchlocal:plugins:list"),
    activeRuns: () => ipcRenderer.invoke("benchlocal:plugins:active-runs"),
    run: (input: { tabId: string; pluginId: string; modelIds?: string[]; executionMode?: "serial" | "parallel_models" | "parallel_scenarios" | "full_parallel" }) =>
      ipcRenderer.invoke("benchlocal:plugins:run", input),
    stop: (input: { tabId: string }) => ipcRenderer.invoke("benchlocal:plugins:stop", input),
    onRunEvent: (listener: (payload: { tabId: string; event: ProgressEvent }) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, payload: { tabId: string; event: ProgressEvent }) => {
        listener(payload);
      };

      ipcRenderer.on(PLUGIN_RUN_EVENT_CHANNEL, wrapped);
      return () => ipcRenderer.removeListener(PLUGIN_RUN_EVENT_CHANNEL, wrapped);
    }
  }
};

contextBridge.exposeInMainWorld("benchlocal", api);
