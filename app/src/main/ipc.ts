import { promises as fs } from "node:fs";
import { BrowserWindow, dialog, ipcMain } from "electron";
import type { BenchLocalAgentEvent, BenchLocalConfig, BenchLocalProviderConfig, BenchLocalWorkspaceState, GenerationRequest, ProgressEvent } from "@core";
import type { DetachedLogsState } from "@/shared/desktop-api";
import { closeDetachedLogsWindow, openDetachedLogsWindow, publishDetachedLogsState } from "./log-window";
import { loadAppMetadata } from "./app-metadata";
import { listAvailableThemes, loadAvailableTheme } from "./themes";
import { checkForAppUpdates, getAppUpdateState, installDownloadedAppUpdate } from "./updater";
import { benchLocalController } from "./controller";
import { agentServer } from "./agent-server";

const CONFIG_LOAD_CHANNEL = "benchlocal:config:load";
const CONFIG_SAVE_CHANNEL = "benchlocal:config:save";
const CONFIG_UPDATED_CHANNEL = "benchlocal:config:updated";
const APP_METADATA_CHANNEL = "benchlocal:app:metadata";
export const APP_OPEN_ABOUT_CHANNEL = "benchlocal:app:open-about";
export const APP_OPEN_SETTINGS_CHANNEL = "benchlocal:app:open-settings";
const APP_UPDATE_GET_STATE_CHANNEL = "benchlocal:updates:get-state";
const APP_UPDATE_CHECK_CHANNEL = "benchlocal:updates:check";
const APP_UPDATE_INSTALL_CHANNEL = "benchlocal:updates:install";
const MODELS_DISCOVER_CHANNEL = "benchlocal:models:discover";
const MODELS_AVAILABILITY_CHANNEL = "benchlocal:models:availability";
const THEMES_LIST_CHANNEL = "benchlocal:themes:list";
const THEMES_LOAD_CHANNEL = "benchlocal:themes:load";
const WORKSPACES_LOAD_CHANNEL = "benchlocal:workspaces:load";
const WORKSPACES_SAVE_CHANNEL = "benchlocal:workspaces:save";
const WORKSPACES_UPDATED_CHANNEL = "benchlocal:workspaces:updated";
const WORKSPACES_EXPORT_CHANNEL = "benchlocal:workspaces:export";
const WORKSPACES_IMPORT_CHANNEL = "benchlocal:workspaces:import";
const BENCH_PACK_LIST_CHANNEL = "benchlocal:benchpacks:list";
const BENCH_PACK_REGISTRY_CHANNEL = "benchlocal:benchpacks:registry";
const BENCH_PACK_INSTALL_CHANNEL = "benchlocal:benchpacks:install";
const BENCH_PACK_INSTALL_FROM_URL_CHANNEL = "benchlocal:benchpacks:install-from-url";
const BENCH_PACK_UPDATE_CHANNEL = "benchlocal:benchpacks:update";
const BENCH_PACK_UNINSTALL_CHANNEL = "benchlocal:benchpacks:uninstall";
const BENCH_PACK_MUTATION_PROGRESS_CHANNEL = "benchlocal:benchpacks:mutation-progress";
const BENCH_PACK_ACTIVE_RUNS_CHANNEL = "benchlocal:benchpacks:active-runs";
const BENCH_PACK_RUN_CHANNEL = "benchlocal:benchpacks:run";
const BENCH_PACK_RETRY_SCENARIO_CHANNEL = "benchlocal:benchpacks:retry-scenario";
const BENCH_PACK_RESUME_RUN_CHANNEL = "benchlocal:benchpacks:resume-run";
const BENCH_PACK_STOP_CHANNEL = "benchlocal:benchpacks:stop";
const BENCH_PACK_HISTORY_CHANNEL = "benchlocal:benchpacks:history";
const BENCH_PACK_HISTORY_LOAD_CHANNEL = "benchlocal:benchpacks:history-load";
const BENCH_PACK_HISTORY_CLEAR_CHANNEL = "benchlocal:benchpacks:history-clear";
const BENCH_PACK_HISTORY_DELETE_CHANNEL = "benchlocal:benchpacks:history-delete";
const BENCH_PACK_RUN_EVENT_CHANNEL = "benchlocal:benchpacks:run-event";
const VERIFIERS_LIST_CHANNEL = "benchlocal:verifiers:list";
const VERIFIERS_START_CHANNEL = "benchlocal:verifiers:start";
const VERIFIERS_STOP_CHANNEL = "benchlocal:verifiers:stop";
const VERIFIERS_CANCEL_START_CHANNEL = "benchlocal:verifiers:cancel-start";
const VERIFIERS_DELETE_IMAGE_CHANNEL = "benchlocal:verifiers:delete-image";
const VERIFIERS_PROGRESS_CHANNEL = "benchlocal:verifiers:progress";
const LOGS_OPEN_DETACHED_CHANNEL = "benchlocal:logs:open-detached";
const LOGS_CLOSE_DETACHED_CHANNEL = "benchlocal:logs:close-detached";
const LOGS_PUBLISH_STATE_CHANNEL = "benchlocal:logs:publish-state";
const AGENT_STATE_CHANNEL = "benchlocal:agent:state";
const AGENT_GET_STATE_CHANNEL = "benchlocal:agent:get-state";
const AGENT_CONFIGURE_CHANNEL = "benchlocal:agent:configure";
const AGENT_REGENERATE_TOKEN_CHANNEL = "benchlocal:agent:regenerate-token";

export function stopActiveBenchPackRunsForShutdown(options?: { timeoutMs?: number; intervalMs?: number }): Promise<void> {
  return benchLocalController.stopActiveBenchPackRunsForShutdown(options);
}

function sendToAllWindows(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload);
  }
}

function forwardControllerEvent(event: BenchLocalAgentEvent): void {
  if (event.type === "benchpack.run.event") {
    const payload = event.payload as { tabId: string; benchPackId: string; event: ProgressEvent };
    sendToAllWindows(BENCH_PACK_RUN_EVENT_CHANNEL, payload);
    return;
  }

  if (event.type === "verifier.event") {
    sendToAllWindows(VERIFIERS_PROGRESS_CHANNEL, event.payload);
    return;
  }

  if (event.type === "config.updated") {
    sendToAllWindows(CONFIG_UPDATED_CHANNEL, event.payload);
    return;
  }

  if (event.type === "workspace.updated") {
    sendToAllWindows(WORKSPACES_UPDATED_CHANNEL, event.payload);
    return;
  }

  if (event.type === "agent.state.updated") {
    sendToAllWindows(AGENT_STATE_CHANNEL, event.payload);
  }
}

export function registerIpcHandlers(): void {
  const preloadPath = new URL("../preload/index.js", import.meta.url).pathname;
  benchLocalController.onAgentEvent(forwardControllerEvent);

  ipcMain.handle(CONFIG_LOAD_CHANNEL, async () => {
    return benchLocalController.loadConfig();
  });

  ipcMain.handle(CONFIG_SAVE_CHANNEL, async (_event, config: BenchLocalConfig) => {
    return benchLocalController.saveConfig(config);
  });

  ipcMain.handle(APP_METADATA_CHANNEL, async () => {
    return loadAppMetadata();
  });

  ipcMain.handle(APP_UPDATE_GET_STATE_CHANNEL, async () => {
    return getAppUpdateState();
  });

  ipcMain.handle(APP_UPDATE_CHECK_CHANNEL, async () => {
    return checkForAppUpdates();
  });

  ipcMain.handle(APP_UPDATE_INSTALL_CHANNEL, async () => {
    return installDownloadedAppUpdate();
  });

  ipcMain.handle(MODELS_DISCOVER_CHANNEL, async (_event, input: { provider: BenchLocalProviderConfig }) => {
    return benchLocalController.discoverProviderModels(input.provider);
  });

  ipcMain.handle(MODELS_AVAILABILITY_CHANNEL, async (_event, input: { config: BenchLocalConfig; modelIds?: string[] }) => {
    return benchLocalController.checkModelAvailability(input);
  });

  ipcMain.handle(THEMES_LIST_CHANNEL, async () => {
    return listAvailableThemes();
  });

  ipcMain.handle(THEMES_LOAD_CHANNEL, async (_event, input: { themeId: string }) => {
    return loadAvailableTheme(input.themeId);
  });

  ipcMain.handle(WORKSPACES_LOAD_CHANNEL, async () => {
    return benchLocalController.loadWorkspaceState();
  });

  ipcMain.handle(WORKSPACES_SAVE_CHANNEL, async (_event, state: BenchLocalWorkspaceState) => {
    return benchLocalController.saveWorkspaceState(state);
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

  ipcMain.handle(BENCH_PACK_LIST_CHANNEL, async () => {
    return benchLocalController.listBenchPacks();
  });

  ipcMain.handle(BENCH_PACK_REGISTRY_CHANNEL, async () => {
    return benchLocalController.loadBenchPackRegistry();
  });

  ipcMain.handle(BENCH_PACK_INSTALL_CHANNEL, async (_event, input: { benchPackId: string }) => {
    return benchLocalController.installBenchPack(input.benchPackId, (progress) => {
      _event.sender.send(BENCH_PACK_MUTATION_PROGRESS_CHANNEL, progress);
    });
  });

  ipcMain.handle(BENCH_PACK_INSTALL_FROM_URL_CHANNEL, async (_event, input: { url: string }) => {
    return benchLocalController.installBenchPackFromUrl(input.url, (progress) => {
      _event.sender.send(BENCH_PACK_MUTATION_PROGRESS_CHANNEL, progress);
    });
  });

  ipcMain.handle(BENCH_PACK_UPDATE_CHANNEL, async (_event, input: { benchPackId: string }) => {
    return benchLocalController.updateBenchPack(input.benchPackId, (progress) => {
      _event.sender.send(BENCH_PACK_MUTATION_PROGRESS_CHANNEL, progress);
    });
  });

  ipcMain.handle(BENCH_PACK_UNINSTALL_CHANNEL, async (_event, input: { benchPackId: string }) => {
    return benchLocalController.uninstallBenchPack(input.benchPackId, (progress) => {
      _event.sender.send(BENCH_PACK_MUTATION_PROGRESS_CHANNEL, progress);
    });
  });

  ipcMain.handle(BENCH_PACK_ACTIVE_RUNS_CHANNEL, async () => {
    return benchLocalController.listActiveRuns();
  });

  ipcMain.handle(BENCH_PACK_HISTORY_CHANNEL, async (_event, input: { benchPackId: string }) => {
    return benchLocalController.listRunHistory(input.benchPackId);
  });

  ipcMain.handle(BENCH_PACK_HISTORY_LOAD_CHANNEL, async (_event, input: { benchPackId: string; runId: string }) => {
    return benchLocalController.loadRunHistory(input.benchPackId, input.runId);
  });

  ipcMain.handle(BENCH_PACK_HISTORY_CLEAR_CHANNEL, async (_event, input: { benchPackId: string }) => {
    return benchLocalController.clearRunHistory(input.benchPackId);
  });

  ipcMain.handle(BENCH_PACK_HISTORY_DELETE_CHANNEL, async (_event, input: { benchPackId: string; runIds: string[] }) => {
    return benchLocalController.deleteRunHistory(input.benchPackId, input.runIds);
  });

  ipcMain.handle(VERIFIERS_LIST_CHANNEL, async () => {
    return benchLocalController.listVerifiers();
  });

  ipcMain.handle(VERIFIERS_START_CHANNEL, async (_event, input: { benchPackId: string }) => {
    return benchLocalController.startVerifier(input.benchPackId);
  });

  ipcMain.handle(VERIFIERS_STOP_CHANNEL, async (_event, input: { benchPackId: string }) => {
    return benchLocalController.stopVerifier(input.benchPackId);
  });

  ipcMain.handle(VERIFIERS_CANCEL_START_CHANNEL, async (_event, input: { benchPackId: string }) => {
    return benchLocalController.cancelVerifierStart(input.benchPackId);
  });

  ipcMain.handle(VERIFIERS_DELETE_IMAGE_CHANNEL, async (_event, input: { benchPackId: string; verifierId: string }) => {
    return benchLocalController.deleteVerifierImage(input.benchPackId, input.verifierId);
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
    BENCH_PACK_RUN_CHANNEL,
    async (
      _event,
      input: {
        tabId: string;
        benchPackId: string;
        modelIds?: string[];
        executionMode?: "serial" | "serial_by_model" | "parallel_by_model" | "parallel_by_test_case" | "full_parallel";
        runsPerTest?: number;
        generation?: GenerationRequest;
      }
    ) => {
      return benchLocalController.runBenchPack(input);
    }
  );

  ipcMain.handle(
    BENCH_PACK_RETRY_SCENARIO_CHANNEL,
    async (
      _event,
      input: {
        tabId: string;
        benchPackId: string;
        runId: string;
        scenarioId: string;
        modelId: string;
        runsPerTest?: number;
        generation?: GenerationRequest;
      }
    ) => {
      return benchLocalController.retryScenario(input);
    }
  );

  ipcMain.handle(
    BENCH_PACK_RESUME_RUN_CHANNEL,
    async (
      _event,
      input: {
        tabId: string;
        benchPackId: string;
        runId: string;
        executionMode?: "serial" | "serial_by_model" | "parallel_by_model" | "parallel_by_test_case" | "full_parallel";
        runsPerTest?: number;
        generation?: GenerationRequest;
      }
    ) => {
      return benchLocalController.resumeRun(input);
    }
  );

  ipcMain.handle(BENCH_PACK_STOP_CHANNEL, async (_event, input: { tabId: string }) => {
    return benchLocalController.stopRun(input.tabId);
  });

  ipcMain.handle(AGENT_GET_STATE_CHANNEL, async () => {
    return agentServer.getState();
  });

  ipcMain.handle(AGENT_CONFIGURE_CHANNEL, async (_event, input: { enabled: boolean; port?: number }) => {
    return agentServer.configure(input);
  });

  ipcMain.handle(AGENT_REGENERATE_TOKEN_CHANNEL, async () => {
    return agentServer.regenerateToken();
  });
}
