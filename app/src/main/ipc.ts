import { ipcMain } from "electron";
import type { BenchLocalConfig, BenchLocalWorkspaceState } from "@core";
import {
  getConfigPath,
  getWorkspaceStatePath,
  loadOrCreateConfig,
  loadOrCreateWorkspaceState,
  saveConfigFile,
  saveWorkspaceStateFile
} from "@core";
import { inspectConfiguredPlugins, runConfiguredPluginBenchmark } from "@plugin-host";

const CONFIG_LOAD_CHANNEL = "benchlocal:config:load";
const CONFIG_SAVE_CHANNEL = "benchlocal:config:save";
const WORKSPACES_LOAD_CHANNEL = "benchlocal:workspaces:load";
const WORKSPACES_SAVE_CHANNEL = "benchlocal:workspaces:save";
const PLUGIN_LIST_CHANNEL = "benchlocal:plugins:list";
const PLUGIN_ACTIVE_RUNS_CHANNEL = "benchlocal:plugins:active-runs";
const PLUGIN_RUN_CHANNEL = "benchlocal:plugins:run";
const PLUGIN_STOP_CHANNEL = "benchlocal:plugins:stop";
const PLUGIN_RUN_EVENT_CHANNEL = "benchlocal:plugins:run-event";

const activePluginRuns = new Map<
  string,
  {
    pluginId: string;
    controller: AbortController;
  }
>();

export function registerIpcHandlers(): void {
  ipcMain.handle(CONFIG_LOAD_CHANNEL, async () => {
    return loadOrCreateConfig();
  });

  ipcMain.handle(CONFIG_SAVE_CHANNEL, async (_event, config: BenchLocalConfig) => {
    const saved = await saveConfigFile(config, getConfigPath());

    return {
      path: getConfigPath(),
      created: false,
      config: saved
    };
  });

  ipcMain.handle(WORKSPACES_LOAD_CHANNEL, async () => {
    const { config } = await loadOrCreateConfig();
    return loadOrCreateWorkspaceState(getWorkspaceStatePath(), config.default_plugin);
  });

  ipcMain.handle(WORKSPACES_SAVE_CHANNEL, async (_event, state: BenchLocalWorkspaceState) => {
    const { config } = await loadOrCreateConfig();
    const saved = await saveWorkspaceStateFile(state, getWorkspaceStatePath(), config.default_plugin);

    return {
      path: getWorkspaceStatePath(),
      created: false,
      state: saved
    };
  });

  ipcMain.handle(PLUGIN_LIST_CHANNEL, async () => {
    const { config } = await loadOrCreateConfig();
    return inspectConfiguredPlugins(config);
  });

  ipcMain.handle(PLUGIN_ACTIVE_RUNS_CHANNEL, async () => {
    return Array.from(activePluginRuns.entries()).map(([tabId, run]) => ({
      tabId,
      pluginId: run.pluginId
    }));
  });

  ipcMain.handle(
    PLUGIN_RUN_CHANNEL,
    async (
      event,
      input: {
        tabId: string;
        pluginId: string;
        modelIds?: string[];
        executionMode?: "serial" | "parallel_models" | "parallel_scenarios" | "full_parallel";
      }
    ) => {
      if (activePluginRuns.has(input.tabId)) {
        throw new Error("A benchmark run is already active for this tab.");
      }

      const { config } = await loadOrCreateConfig();
      const controller = new AbortController();
      activePluginRuns.set(input.tabId, {
        pluginId: input.pluginId,
        controller
      });

      try {
        return await runConfiguredPluginBenchmark(config, input.pluginId, {
          modelIds: input.modelIds,
          executionMode: input.executionMode,
          abortSignal: controller.signal,
          onEvent: (progressEvent) => {
            event.sender.send(PLUGIN_RUN_EVENT_CHANNEL, {
              tabId: input.tabId,
              event: progressEvent
            });
          }
        });
      } finally {
        activePluginRuns.delete(input.tabId);
      }
    }
  );

  ipcMain.handle(PLUGIN_STOP_CHANNEL, async (_event, input: { tabId: string }) => {
    const activeRun = activePluginRuns.get(input.tabId);

    if (!activeRun) {
      return { stopped: false };
    }

    activeRun.controller.abort(new Error("Run cancelled by user."));
    return { stopped: true };
  });
}
