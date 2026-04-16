import type {
  BenchPackRegistryEntry,
  BenchLocalConfig,
  BenchLocalThemeDefinition,
  BenchLocalThemeDescriptor,
  GenerationRequest,
  ProgressEvent,
  BenchLocalWorkspaceState,
  BenchPackInspection,
  BenchPackRunHistoryEntry,
  BenchPackRunSummary,
  VerifierEndpoint
} from "@core";

export type DetachedLogsState = {
  workspaceName: string;
  tabTitle: string;
  eventCount: number;
  events: ProgressEvent[];
};

export type BenchLocalAppMetadata = {
  productName: string;
  description: string;
  version: string;
  author: string;
  license?: string;
  copyright?: string;
};

export type ConfigLoadResult = {
  path: string;
  created: boolean;
  config: BenchLocalConfig;
};

export type BenchPackVerifierStatus = {
  benchPackId: string;
  benchPackName: string;
  docker: {
    state: "ready" | "not_installed" | "not_running";
    available: boolean;
    details?: string;
    simulated?: boolean;
  };
  verifiers: VerifierEndpoint[];
};

export type BenchPackMutationProgress = {
  benchPackId: string;
  action: "install" | "update" | "uninstall";
  phase: "resolving" | "downloading" | "extracting" | "hydrating" | "validating" | "activating" | "removing" | "complete";
  message: string;
};

export type BenchLocalDiscoveredModel = {
  id: string;
  name?: string;
  ownedBy?: string;
  contextLength?: number;
  pricing?: string;
  modality?: string;
};

export interface BenchLocalDesktopApi {
  app: {
    metadata(): Promise<BenchLocalAppMetadata>;
    onOpenAbout(listener: () => void): () => void;
    onOpenSettings(listener: () => void): () => void;
  };
  config: {
    load(): Promise<ConfigLoadResult>;
    save(config: BenchLocalConfig): Promise<ConfigLoadResult>;
  };
  models: {
    discover(input: { provider: BenchLocalConfig["providers"][string] }): Promise<BenchLocalDiscoveredModel[]>;
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
  benchPacks: {
    list(): Promise<BenchPackInspection[]>;
    registry(): Promise<BenchPackRegistryEntry[]>;
    install(input: { benchPackId: string }): Promise<ConfigLoadResult>;
    installFromUrl(input: { url: string }): Promise<ConfigLoadResult>;
    update(input: { benchPackId: string }): Promise<ConfigLoadResult>;
    uninstall(input: { benchPackId: string }): Promise<ConfigLoadResult>;
    onMutationProgress(listener: (payload: BenchPackMutationProgress) => void): () => void;
    activeRuns(): Promise<Array<{ tabId: string; benchPackId: string }>>;
    run(input: {
      tabId: string;
      benchPackId: string;
      modelIds?: string[];
      executionMode?: "serial" | "serial_by_model" | "parallel_by_model" | "parallel_by_test_case" | "full_parallel";
      generation?: GenerationRequest;
    }): Promise<BenchPackRunSummary>;
    retryScenario(input: {
      tabId: string;
      benchPackId: string;
      runId: string;
      scenarioId: string;
      modelId: string;
      generation?: GenerationRequest;
    }): Promise<BenchPackRunSummary>;
    resumeRun(input: {
      tabId: string;
      benchPackId: string;
      runId: string;
      executionMode?: "serial" | "serial_by_model" | "parallel_by_model" | "parallel_by_test_case" | "full_parallel";
      generation?: GenerationRequest;
    }): Promise<BenchPackRunSummary>;
    stop(input: { tabId: string }): Promise<{ stopped: boolean }>;
    history(input: { benchPackId: string }): Promise<BenchPackRunHistoryEntry[]>;
    loadHistory(input: { benchPackId: string; runId: string }): Promise<BenchPackRunSummary>;
    clearHistory(input: { benchPackId: string }): Promise<{ removed: boolean }>;
    onRunEvent(listener: (payload: { tabId: string; event: ProgressEvent }) => void): () => void;
  };
  verifiers: {
    list(): Promise<BenchPackVerifierStatus[]>;
    start(input: { benchPackId: string }): Promise<BenchPackVerifierStatus>;
    stop(input: { benchPackId: string }): Promise<BenchPackVerifierStatus>;
  };
  logs: {
    openDetachedWindow(): Promise<{ opened: boolean }>;
    closeDetachedWindow(): Promise<{ closed: boolean }>;
    publishDetachedState(state: DetachedLogsState): Promise<void>;
    onDetachedState(listener: (state: DetachedLogsState) => void): () => void;
    onDetachedWindowClosed(listener: () => void): () => void;
  };
}
