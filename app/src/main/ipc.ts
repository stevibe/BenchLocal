import { promises as fs } from "node:fs";
import { dialog, ipcMain } from "electron";
import type { BenchLocalConfig, BenchLocalWorkspaceState } from "@core";
import type { DetachedLogsState } from "@/shared/desktop-api";
import {
  getConfigPath,
  getWorkspaceStatePath,
  loadOrCreateConfig,
  loadOrCreateWorkspaceState,
  saveConfigFile,
  saveWorkspaceStateFile
} from "@core";
import { inspectConfiguredPlugins, listRunHistoryForPlugin, loadRunSummaryForPlugin, runConfiguredPluginBenchmark } from "@plugin-host";
import { closeDetachedLogsWindow, openDetachedLogsWindow, publishDetachedLogsState } from "./log-window";

const CONFIG_LOAD_CHANNEL = "benchlocal:config:load";
const CONFIG_SAVE_CHANNEL = "benchlocal:config:save";
const WORKSPACES_LOAD_CHANNEL = "benchlocal:workspaces:load";
const WORKSPACES_SAVE_CHANNEL = "benchlocal:workspaces:save";
const WORKSPACES_EXPORT_CHANNEL = "benchlocal:workspaces:export";
const WORKSPACES_IMPORT_CHANNEL = "benchlocal:workspaces:import";
const PLUGIN_LIST_CHANNEL = "benchlocal:plugins:list";
const PLUGIN_ACTIVE_RUNS_CHANNEL = "benchlocal:plugins:active-runs";
const PLUGIN_RUN_CHANNEL = "benchlocal:plugins:run";
const PLUGIN_STOP_CHANNEL = "benchlocal:plugins:stop";
const PLUGIN_HISTORY_CHANNEL = "benchlocal:plugins:history";
const PLUGIN_HISTORY_LOAD_CHANNEL = "benchlocal:plugins:history-load";
const PLUGIN_RUN_EVENT_CHANNEL = "benchlocal:plugins:run-event";
const LOGS_OPEN_DETACHED_CHANNEL = "benchlocal:logs:open-detached";
const LOGS_CLOSE_DETACHED_CHANNEL = "benchlocal:logs:close-detached";
const LOGS_PUBLISH_STATE_CHANNEL = "benchlocal:logs:publish-state";

const activePluginRuns = new Map<
  string,
  {
    pluginId: string;
    controller: AbortController;
  }
>();

export function registerIpcHandlers(): void {
  const preloadPath = new URL("../preload/index.js", import.meta.url).pathname;

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

  ipcMain.handle(
    WORKSPACES_EXPORT_CHANNEL,
    async (_event, input: { workspaceId: string; state: BenchLocalWorkspaceState }) => {
      const workspace = input.state.workspaces[input.workspaceId];

      if (!workspace) {
        throw new Error(`Workspace "${input.workspaceId}" was not found.`);
      }

      const tabs = Object.fromEntries(
        workspace.tabIds
          .map((tabId) => input.state.tabs[tabId])
          .filter((tab): tab is BenchLocalWorkspaceState["tabs"][string] => Boolean(tab))
          .map((tab) => [tab.id, tab])
      );

      const result = await dialog.showSaveDialog({
        title: "Export Workspace",
        defaultPath: `${workspace.name.replace(/[^\w.-]+/g, "-").toLowerCase() || "workspace"}.benchlocal-workspace.json`,
        filters: [{ name: "BenchLocal Workspace", extensions: ["json"] }]
      });

      if (result.canceled || !result.filePath) {
        return { exported: false };
      }

      await fs.writeFile(
        result.filePath,
        JSON.stringify(
          {
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            workspace,
            tabs
          },
          null,
          2
        ),
        "utf8"
      );

      return { exported: true, filePath: result.filePath };
    }
  );

  ipcMain.handle(WORKSPACES_IMPORT_CHANNEL, async () => {
    const result = await dialog.showOpenDialog({
      title: "Import Workspace",
      properties: ["openFile"],
      filters: [{ name: "BenchLocal Workspace", extensions: ["json"] }]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { imported: false };
    }

    const raw = await fs.readFile(result.filePaths[0], "utf8");
    const parsed = JSON.parse(raw) as {
      workspace?: BenchLocalWorkspaceState["workspaces"][string];
      tabs?: BenchLocalWorkspaceState["tabs"];
    };

    if (!parsed.workspace || !parsed.tabs) {
      throw new Error("Imported workspace file is missing workspace or tab data.");
    }

    return {
      imported: true,
      workspace: parsed.workspace,
      tabs: parsed.tabs
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

  ipcMain.handle(PLUGIN_HISTORY_CHANNEL, async (_event, input: { pluginId: string }) => {
    const { config } = await loadOrCreateConfig();
    return listRunHistoryForPlugin(config, input.pluginId);
  });

  ipcMain.handle(PLUGIN_HISTORY_LOAD_CHANNEL, async (_event, input: { pluginId: string; runId: string }) => {
    const { config } = await loadOrCreateConfig();
    return loadRunSummaryForPlugin(config, input.pluginId, input.runId);
  });

  ipcMain.handle(LOGS_OPEN_DETACHED_CHANNEL, async () => {
    await openDetachedLogsWindow(preloadPath);
    return { opened: true };
  });

  ipcMain.handle(LOGS_CLOSE_DETACHED_CHANNEL, async () => {
    return { closed: closeDetachedLogsWindow() };
  });

  ipcMain.handle(LOGS_PUBLISH_STATE_CHANNEL, async (_event, state: DetachedLogsState) => {
    publishDetachedLogsState(state);
  });

  ipcMain.handle(
    PLUGIN_RUN_CHANNEL,
    async (
      event,
      input: {
        tabId: string;
        pluginId: string;
        modelIds?: string[];
        executionMode?: "serial" | "parallel_by_model" | "parallel_by_test_case" | "full_parallel";
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
