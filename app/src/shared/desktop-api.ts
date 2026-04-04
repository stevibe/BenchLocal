import type {
  BenchLocalConfig,
  ProgressEvent,
  BenchLocalWorkspaceState,
  PluginInspection,
  PluginRunHistoryEntry,
  PluginRunSummary
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

export interface BenchLocalDesktopApi {
  config: {
    load(): Promise<ConfigLoadResult>;
    save(config: BenchLocalConfig): Promise<ConfigLoadResult>;
  };
  workspaces: {
    load(): Promise<{ path: string; created: boolean; state: BenchLocalWorkspaceState }>;
    save(state: BenchLocalWorkspaceState): Promise<{ path: string; created: boolean; state: BenchLocalWorkspaceState }>;
    export(input: { workspaceId: string; state: BenchLocalWorkspaceState }): Promise<{ exported: boolean; filePath?: string }>;
    import(): Promise<{ imported: boolean; workspace?: BenchLocalWorkspaceState["workspaces"][string]; tabs?: BenchLocalWorkspaceState["tabs"] }>;
  };
  plugins: {
    list(): Promise<PluginInspection[]>;
    activeRuns(): Promise<Array<{ tabId: string; pluginId: string }>>;
    run(input: { tabId: string; pluginId: string; modelIds?: string[]; executionMode?: "serial" | "parallel_by_model" | "parallel_by_test_case" | "full_parallel" }): Promise<PluginRunSummary>;
    stop(input: { tabId: string }): Promise<{ stopped: boolean }>;
    history(input: { pluginId: string }): Promise<PluginRunHistoryEntry[]>;
    loadHistory(input: { pluginId: string; runId: string }): Promise<PluginRunSummary>;
    onRunEvent(listener: (payload: { tabId: string; event: ProgressEvent }) => void): () => void;
  };
  logs: {
    openDetachedWindow(): Promise<{ opened: boolean }>;
    closeDetachedWindow(): Promise<{ closed: boolean }>;
    publishDetachedState(state: DetachedLogsState): Promise<void>;
    onDetachedState(listener: (state: DetachedLogsState) => void): () => void;
    onDetachedWindowClosed(listener: () => void): () => void;
  };
}
