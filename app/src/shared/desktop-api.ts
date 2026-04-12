import type {
  BenchLocalConfig,
  BenchLocalThemeDefinition,
  BenchLocalThemeDescriptor,
  GenerationRequest,
  ProgressEvent,
  BenchLocalWorkspaceState,
  PluginInspection,
  PluginRunHistoryEntry,
  PluginRunSummary,
  ScenarioPackRegistryEntry,
  VerifierEndpoint
} from "@core";

export type DetachedLogsState = {
  workspaceName: string;
  tabTitle: string;
  eventCount: number;
  events: ProgressEvent[];
};

export type ConfigLoadResult = {
  path: string;
  created: boolean;
  config: BenchLocalConfig;
};

export type PluginVerifierStatus = {
  pluginId: string;
  pluginName: string;
  docker: {
    available: boolean;
    details?: string;
  };
  verifiers: VerifierEndpoint[];
};

export type ScenarioPackMutationProgress = {
  pluginId: string;
  action: "install" | "update" | "uninstall";
  phase: "resolving" | "downloading" | "extracting" | "hydrating" | "validating" | "activating" | "removing" | "complete";
  message: string;
};

export interface BenchLocalDesktopApi {
  app: {
    onOpenSettings(listener: () => void): () => void;
  };
  config: {
    load(): Promise<ConfigLoadResult>;
    save(config: BenchLocalConfig): Promise<ConfigLoadResult>;
  };
  themes: {
    list(): Promise<BenchLocalThemeDescriptor[]>;
    load(input: { themeId: string }): Promise<BenchLocalThemeDefinition | null>;
  };
  workspaces: {
    load(): Promise<{ path: string; created: boolean; state: BenchLocalWorkspaceState }>;
    save(state: BenchLocalWorkspaceState): Promise<{ path: string; created: boolean; state: BenchLocalWorkspaceState }>;
    export(input: { workspaceId: string; state: BenchLocalWorkspaceState }): Promise<{ exported: boolean; filePath?: string }>;
    import(): Promise<{ imported: boolean; workspace?: BenchLocalWorkspaceState["workspaces"][string]; tabs?: BenchLocalWorkspaceState["tabs"] }>;
  };
  plugins: {
    list(): Promise<PluginInspection[]>;
    registry(): Promise<ScenarioPackRegistryEntry[]>;
    install(input: { pluginId: string }): Promise<ConfigLoadResult>;
    update(input: { pluginId: string }): Promise<ConfigLoadResult>;
    uninstall(input: { pluginId: string }): Promise<ConfigLoadResult>;
    onMutationProgress(listener: (payload: ScenarioPackMutationProgress) => void): () => void;
    activeRuns(): Promise<Array<{ tabId: string; pluginId: string }>>;
    run(input: {
      tabId: string;
      pluginId: string;
      modelIds?: string[];
      executionMode?: "serial" | "parallel_by_model" | "parallel_by_test_case" | "full_parallel";
      generation?: GenerationRequest;
    }): Promise<PluginRunSummary>;
    stop(input: { tabId: string }): Promise<{ stopped: boolean }>;
    history(input: { pluginId: string }): Promise<PluginRunHistoryEntry[]>;
    loadHistory(input: { pluginId: string; runId: string }): Promise<PluginRunSummary>;
    onRunEvent(listener: (payload: { tabId: string; event: ProgressEvent }) => void): () => void;
  };
  verifiers: {
    list(): Promise<PluginVerifierStatus[]>;
    start(input: { pluginId: string }): Promise<PluginVerifierStatus>;
    stop(input: { pluginId: string }): Promise<PluginVerifierStatus>;
  };
  logs: {
    openDetachedWindow(): Promise<{ opened: boolean }>;
    closeDetachedWindow(): Promise<{ closed: boolean }>;
    publishDetachedState(state: DetachedLogsState): Promise<void>;
    onDetachedState(listener: (state: DetachedLogsState) => void): () => void;
    onDetachedWindowClosed(listener: () => void): () => void;
  };
}
