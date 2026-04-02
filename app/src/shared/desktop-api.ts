import type {
  BenchLocalConfig,
  ProgressEvent,
  BenchLocalWorkspaceState,
  PluginInspection,
  PluginRunSummary
} from "@core";

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
  };
  plugins: {
    list(): Promise<PluginInspection[]>;
    activeRuns(): Promise<Array<{ tabId: string; pluginId: string }>>;
    run(input: { tabId: string; pluginId: string; modelIds?: string[]; executionMode?: "serial" | "parallel_models" | "parallel_scenarios" | "full_parallel" }): Promise<PluginRunSummary>;
    stop(input: { tabId: string }): Promise<{ stopped: boolean }>;
    onRunEvent(listener: (payload: { tabId: string; event: ProgressEvent }) => void): () => void;
  };
}
