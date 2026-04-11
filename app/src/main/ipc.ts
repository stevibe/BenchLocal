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
import {
  getConfiguredPluginVerifierStatus,
  installScenarioPackFromRegistry,
  inspectConfiguredPlugins,
  listRunHistoryForPlugin,
  loadScenarioPackRegistry,
  loadRunSummaryForPlugin,
  runConfiguredPluginBenchmark,
  startConfiguredPluginVerifiers,
  stopConfiguredPluginVerifiers,
  uninstallScenarioPack,
  updateScenarioPackFromRegistry
} from "@plugin-host";
import { closeDetachedLogsWindow, openDetachedLogsWindow, publishDetachedLogsState } from "./log-window";
import { listAvailableThemes, loadAvailableTheme } from "./themes";

const CONFIG_LOAD_CHANNEL = "benchlocal:config:load";
const CONFIG_SAVE_CHANNEL = "benchlocal:config:save";
export const APP_OPEN_SETTINGS_CHANNEL = "benchlocal:app:open-settings";
const THEMES_LIST_CHANNEL = "benchlocal:themes:list";
const THEMES_LOAD_CHANNEL = "benchlocal:themes:load";
const WORKSPACES_LOAD_CHANNEL = "benchlocal:workspaces:load";
const WORKSPACES_SAVE_CHANNEL = "benchlocal:workspaces:save";
const WORKSPACES_EXPORT_CHANNEL = "benchlocal:workspaces:export";
const WORKSPACES_IMPORT_CHANNEL = "benchlocal:workspaces:import";
const PLUGIN_LIST_CHANNEL = "benchlocal:plugins:list";
const PLUGIN_REGISTRY_CHANNEL = "benchlocal:plugins:registry";
const PLUGIN_INSTALL_CHANNEL = "benchlocal:plugins:install";
const PLUGIN_UPDATE_CHANNEL = "benchlocal:plugins:update";
const PLUGIN_UNINSTALL_CHANNEL = "benchlocal:plugins:uninstall";
const PLUGIN_MUTATION_PROGRESS_CHANNEL = "benchlocal:plugins:mutation-progress";
const PLUGIN_ACTIVE_RUNS_CHANNEL = "benchlocal:plugins:active-runs";
const PLUGIN_RUN_CHANNEL = "benchlocal:plugins:run";
const PLUGIN_STOP_CHANNEL = "benchlocal:plugins:stop";
const PLUGIN_HISTORY_CHANNEL = "benchlocal:plugins:history";
const PLUGIN_HISTORY_LOAD_CHANNEL = "benchlocal:plugins:history-load";
const PLUGIN_RUN_EVENT_CHANNEL = "benchlocal:plugins:run-event";
const VERIFIERS_LIST_CHANNEL = "benchlocal:verifiers:list";
const VERIFIERS_START_CHANNEL = "benchlocal:verifiers:start";
const VERIFIERS_STOP_CHANNEL = "benchlocal:verifiers:stop";
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

  ipcMain.handle(THEMES_LIST_CHANNEL, async () => {
    return listAvailableThemes();
  });

  ipcMain.handle(THEMES_LOAD_CHANNEL, async (_event, input: { themeId: string }) => {
    return loadAvailableTheme(input.themeId);
  });

  ipcMain.handle(WORKSPACES_LOAD_CHANNEL, async () => {
    await loadOrCreateConfig();
    return loadOrCreateWorkspaceState(getWorkspaceStatePath());
  });

  ipcMain.handle(WORKSPACES_SAVE_CHANNEL, async (_event, state: BenchLocalWorkspaceState) => {
    await loadOrCreateConfig();
    const saved = await saveWorkspaceStateFile(state, getWorkspaceStatePath());

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

  ipcMain.handle(PLUGIN_REGISTRY_CHANNEL, async () => {
    const { config } = await loadOrCreateConfig();
    return loadScenarioPackRegistry(config);
  });

  ipcMain.handle(PLUGIN_INSTALL_CHANNEL, async (_event, input: { pluginId: string }) => {
    const { config } = await loadOrCreateConfig();
    const saved = await installScenarioPackFromRegistry(config, input.pluginId, (progress) => {
      _event.sender.send(PLUGIN_MUTATION_PROGRESS_CHANNEL, progress);
    });
    return {
      path: getConfigPath(),
      created: false,
      config: saved
    };
  });

  ipcMain.handle(PLUGIN_UPDATE_CHANNEL, async (_event, input: { pluginId: string }) => {
    const { config } = await loadOrCreateConfig();
    const saved = await updateScenarioPackFromRegistry(config, input.pluginId, (progress) => {
      _event.sender.send(PLUGIN_MUTATION_PROGRESS_CHANNEL, progress);
    });
    return {
      path: getConfigPath(),
      created: false,
      config: saved
    };
  });

  ipcMain.handle(PLUGIN_UNINSTALL_CHANNEL, async (_event, input: { pluginId: string }) => {
    const { config } = await loadOrCreateConfig();
    const saved = await uninstallScenarioPack(config, input.pluginId, (progress) => {
      _event.sender.send(PLUGIN_MUTATION_PROGRESS_CHANNEL, progress);
    });
    return {
      path: getConfigPath(),
      created: false,
      config: saved
    };
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

  ipcMain.handle(VERIFIERS_LIST_CHANNEL, async () => {
    const { config } = await loadOrCreateConfig();
    const inspections = await inspectConfiguredPlugins(config);
    const relevant = inspections.filter((inspection) => inspection.manifest?.capabilities.verification || inspection.manifest?.capabilities.sidecars);
    return Promise.all(relevant.map((inspection) => getConfiguredPluginVerifierStatus(config, inspection.id)));
  });

  ipcMain.handle(VERIFIERS_START_CHANNEL, async (_event, input: { pluginId: string }) => {
    const { config } = await loadOrCreateConfig();
    return startConfiguredPluginVerifiers(config, input.pluginId);
  });

  ipcMain.handle(VERIFIERS_STOP_CHANNEL, async (_event, input: { pluginId: string }) => {
    const { config } = await loadOrCreateConfig();
    return stopConfiguredPluginVerifiers(config, input.pluginId);
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
