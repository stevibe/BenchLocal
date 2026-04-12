import { promises as fs } from "node:fs";
import { dialog, ipcMain } from "electron";
import type { BenchLocalConfig, BenchLocalProviderConfig, BenchLocalWorkspaceState, GenerationRequest } from "@core";
import type { BenchLocalDiscoveredModel, DetachedLogsState } from "@/shared/desktop-api";
import {
  getConfigPath,
  getWorkspaceStatePath,
  loadOrCreateConfig,
  loadOrCreateWorkspaceState,
  saveConfigFile,
  saveWorkspaceStateFile
} from "@core";
import {
  getConfiguredBenchPackVerifierStatus,
  installBenchPackFromRegistry,
  installBenchPackFromUrl,
  inspectConfiguredBenchPacks,
  listRunHistoryForBenchPack,
  loadBenchPackRegistry,
  loadRunSummaryForBenchPack,
  runConfiguredBenchPack,
  startConfiguredBenchPackVerifiers,
  stopConfiguredBenchPackVerifiers,
  uninstallBenchPack,
  updateBenchPackFromRegistry
} from "@benchpack-host";
import { closeDetachedLogsWindow, openDetachedLogsWindow, publishDetachedLogsState } from "./log-window";
import { listAvailableThemes, loadAvailableTheme } from "./themes";

const CONFIG_LOAD_CHANNEL = "benchlocal:config:load";
const CONFIG_SAVE_CHANNEL = "benchlocal:config:save";
export const APP_OPEN_SETTINGS_CHANNEL = "benchlocal:app:open-settings";
const MODELS_DISCOVER_CHANNEL = "benchlocal:models:discover";
const THEMES_LIST_CHANNEL = "benchlocal:themes:list";
const THEMES_LOAD_CHANNEL = "benchlocal:themes:load";
const WORKSPACES_LOAD_CHANNEL = "benchlocal:workspaces:load";
const WORKSPACES_SAVE_CHANNEL = "benchlocal:workspaces:save";
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
const BENCH_PACK_STOP_CHANNEL = "benchlocal:benchpacks:stop";
const BENCH_PACK_HISTORY_CHANNEL = "benchlocal:benchpacks:history";
const BENCH_PACK_HISTORY_LOAD_CHANNEL = "benchlocal:benchpacks:history-load";
const BENCH_PACK_RUN_EVENT_CHANNEL = "benchlocal:benchpacks:run-event";
const VERIFIERS_LIST_CHANNEL = "benchlocal:verifiers:list";
const VERIFIERS_START_CHANNEL = "benchlocal:verifiers:start";
const VERIFIERS_STOP_CHANNEL = "benchlocal:verifiers:stop";
const LOGS_OPEN_DETACHED_CHANNEL = "benchlocal:logs:open-detached";
const LOGS_CLOSE_DETACHED_CHANNEL = "benchlocal:logs:close-detached";
const LOGS_PUBLISH_STATE_CHANNEL = "benchlocal:logs:publish-state";

const activeBenchPackRuns = new Map<
  string,
  {
    benchPackId: string;
    controller: AbortController;
  }
>();

function providerSupportsModelDiscovery(provider: BenchLocalProviderConfig): boolean {
  return provider.kind === "openrouter" || provider.kind === "openai_compatible";
}

function providerModelsUrl(baseUrl: string): string {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL("models", normalizedBaseUrl).toString();
}

function formatModelPricing(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const prompt = typeof record.prompt === "string" || typeof record.prompt === "number" ? String(record.prompt) : null;
  const completion =
    typeof record.completion === "string" || typeof record.completion === "number" ? String(record.completion) : null;

  if (prompt && completion) {
    return `In ${prompt} · Out ${completion}`;
  }

  if (prompt) {
    return `Prompt ${prompt}`;
  }

  if (completion) {
    return `Completion ${completion}`;
  }

  return undefined;
}

function mapDiscoveredModel(input: unknown): BenchLocalDiscoveredModel | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const record = input as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";

  if (!id) {
    return null;
  }

  const name = typeof record.name === "string" ? record.name.trim() : undefined;
  const ownedBy = typeof record.owned_by === "string" ? record.owned_by.trim() : undefined;
  const topProvider =
    typeof record.top_provider === "object" && record.top_provider !== null
      ? (record.top_provider as Record<string, unknown>)
      : null;
  const architecture =
    typeof record.architecture === "object" && record.architecture !== null
      ? (record.architecture as Record<string, unknown>)
      : null;
  const contextLength =
    typeof record.context_length === "number"
      ? record.context_length
      : typeof topProvider?.context_length === "number"
        ? (topProvider.context_length as number)
        : undefined;
  const modality =
    Array.isArray(architecture?.modality)
      ? architecture.modality.filter((value): value is string => typeof value === "string").join(", ")
      : Array.isArray(record.input_modalities)
        ? record.input_modalities.filter((value): value is string => typeof value === "string").join(", ")
        : Array.isArray(record.output_modalities)
          ? record.output_modalities.filter((value): value is string => typeof value === "string").join(", ")
          : undefined;

  return {
    id,
    name,
    ownedBy,
    contextLength,
    pricing: formatModelPricing(record.pricing),
    modality
  };
}

async function discoverProviderModels(provider: BenchLocalProviderConfig): Promise<BenchLocalDiscoveredModel[]> {
  if (!providerSupportsModelDiscovery(provider)) {
    throw new Error(`${provider.name} does not support model browsing yet.`);
  }

  const headers = new Headers({
    Accept: "application/json"
  });
  const apiKey = provider.api_key?.trim() || (provider.api_key_env ? process.env[provider.api_key_env]?.trim() : "");

  if (apiKey) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }

  const response = await fetch(providerModelsUrl(provider.base_url), {
    method: "GET",
    headers
  });

  if (!response.ok) {
    throw new Error(`Failed to load models from ${provider.name}: ${response.status} ${response.statusText}`.trim());
  }

  const payload = (await response.json()) as { data?: unknown[] } | unknown[];
  const entries = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : [];

  return entries
    .map((entry) => mapDiscoveredModel(entry))
    .filter((entry): entry is BenchLocalDiscoveredModel => Boolean(entry))
    .sort((left, right) => (left.name ?? left.id).localeCompare(right.name ?? right.id));
}

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

  ipcMain.handle(MODELS_DISCOVER_CHANNEL, async (_event, input: { provider: BenchLocalProviderConfig }) => {
    return discoverProviderModels(input.provider);
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

  ipcMain.handle(BENCH_PACK_LIST_CHANNEL, async () => {
    const { config } = await loadOrCreateConfig();
    return inspectConfiguredBenchPacks(config);
  });

  ipcMain.handle(BENCH_PACK_REGISTRY_CHANNEL, async () => {
    const { config } = await loadOrCreateConfig();
    return loadBenchPackRegistry(config);
  });

  ipcMain.handle(BENCH_PACK_INSTALL_CHANNEL, async (_event, input: { benchPackId: string }) => {
    const { config } = await loadOrCreateConfig();
    const saved = await installBenchPackFromRegistry(config, input.benchPackId, (progress) => {
      _event.sender.send(BENCH_PACK_MUTATION_PROGRESS_CHANNEL, progress);
    });
    return {
      path: getConfigPath(),
      created: false,
      config: saved
    };
  });

  ipcMain.handle(BENCH_PACK_INSTALL_FROM_URL_CHANNEL, async (_event, input: { url: string }) => {
    const { config } = await loadOrCreateConfig();
    const saved = await installBenchPackFromUrl(config, input.url, (progress) => {
      _event.sender.send(BENCH_PACK_MUTATION_PROGRESS_CHANNEL, progress);
    });
    return {
      path: getConfigPath(),
      created: false,
      config: saved
    };
  });

  ipcMain.handle(BENCH_PACK_UPDATE_CHANNEL, async (_event, input: { benchPackId: string }) => {
    const { config } = await loadOrCreateConfig();
    const saved = await updateBenchPackFromRegistry(config, input.benchPackId, (progress) => {
      _event.sender.send(BENCH_PACK_MUTATION_PROGRESS_CHANNEL, progress);
    });
    return {
      path: getConfigPath(),
      created: false,
      config: saved
    };
  });

  ipcMain.handle(BENCH_PACK_UNINSTALL_CHANNEL, async (_event, input: { benchPackId: string }) => {
    const { config } = await loadOrCreateConfig();
    const saved = await uninstallBenchPack(config, input.benchPackId, (progress) => {
      _event.sender.send(BENCH_PACK_MUTATION_PROGRESS_CHANNEL, progress);
    });
    return {
      path: getConfigPath(),
      created: false,
      config: saved
    };
  });

  ipcMain.handle(BENCH_PACK_ACTIVE_RUNS_CHANNEL, async () => {
    return Array.from(activeBenchPackRuns.entries()).map(([tabId, run]) => ({
      tabId,
      benchPackId: run.benchPackId
    }));
  });

  ipcMain.handle(BENCH_PACK_HISTORY_CHANNEL, async (_event, input: { benchPackId: string }) => {
    const { config } = await loadOrCreateConfig();
    return listRunHistoryForBenchPack(config, input.benchPackId);
  });

  ipcMain.handle(BENCH_PACK_HISTORY_LOAD_CHANNEL, async (_event, input: { benchPackId: string; runId: string }) => {
    const { config } = await loadOrCreateConfig();
    return loadRunSummaryForBenchPack(config, input.benchPackId, input.runId);
  });

  ipcMain.handle(VERIFIERS_LIST_CHANNEL, async () => {
    const { config } = await loadOrCreateConfig();
    const inspections = await inspectConfiguredBenchPacks(config);
    const relevant = inspections.filter((inspection) => inspection.manifest?.capabilities.verification || inspection.manifest?.capabilities.sidecars);
    return Promise.all(relevant.map((inspection) => getConfiguredBenchPackVerifierStatus(config, inspection.id)));
  });

  ipcMain.handle(VERIFIERS_START_CHANNEL, async (_event, input: { benchPackId: string }) => {
    const { config } = await loadOrCreateConfig();
    return startConfiguredBenchPackVerifiers(config, input.benchPackId);
  });

  ipcMain.handle(VERIFIERS_STOP_CHANNEL, async (_event, input: { benchPackId: string }) => {
    const { config } = await loadOrCreateConfig();
    return stopConfiguredBenchPackVerifiers(config, input.benchPackId);
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
      event,
      input: {
        tabId: string;
        benchPackId: string;
        modelIds?: string[];
        executionMode?: "serial" | "parallel_by_model" | "parallel_by_test_case" | "full_parallel";
        generation?: GenerationRequest;
      }
    ) => {
      if (activeBenchPackRuns.has(input.tabId)) {
        throw new Error("A benchmark run is already active for this tab.");
      }

      const { config } = await loadOrCreateConfig();
      const controller = new AbortController();
      activeBenchPackRuns.set(input.tabId, {
        benchPackId: input.benchPackId,
        controller
      });

      try {
        return await runConfiguredBenchPack(config, input.benchPackId, {
          modelIds: input.modelIds,
          executionMode: input.executionMode,
          generation: input.generation,
          abortSignal: controller.signal,
          onEvent: (progressEvent) => {
            event.sender.send(BENCH_PACK_RUN_EVENT_CHANNEL, {
              tabId: input.tabId,
              event: progressEvent
            });
          }
        });
      } finally {
        activeBenchPackRuns.delete(input.tabId);
      }
    }
  );

  ipcMain.handle(BENCH_PACK_STOP_CHANNEL, async (_event, input: { tabId: string }) => {
    const activeRun = activeBenchPackRuns.get(input.tabId);

    if (!activeRun) {
      return { stopped: false };
    }

    activeRun.controller.abort(new Error("Run cancelled by user."));
    return { stopped: true };
  });
}
