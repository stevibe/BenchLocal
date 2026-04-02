import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getBenchLocalHome } from "./config.js";

export type BenchLocalExecutionMode =
  | "serial"
  | "parallel_models"
  | "parallel_scenarios"
  | "full_parallel";

export type BenchLocalWorkspaceTabModelSelection = {
  modelId: string;
  alias?: string;
};

export type BenchLocalWorkspaceTab = {
  id: string;
  title: string;
  pluginId: string | null;
  focusedScenarioId: string | null;
  modelSelections: BenchLocalWorkspaceTabModelSelection[];
  executionMode: BenchLocalExecutionMode;
  createdAt: string;
  updatedAt: string;
};

export type BenchLocalWorkspace = {
  id: string;
  name: string;
  tabIds: string[];
  activeTabId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BenchLocalWorkspaceState = {
  schema_version: 1;
  activeWorkspaceId: string | null;
  workspaceOrder: string[];
  workspaces: Record<string, BenchLocalWorkspace>;
  tabs: Record<string, BenchLocalWorkspaceTab>;
};

export type LoadedBenchLocalWorkspaceState = {
  path: string;
  created: boolean;
  state: BenchLocalWorkspaceState;
};

const WorkspaceTabSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  pluginId: z.string().trim().min(1).nullable(),
  focusedScenarioId: z.string().trim().min(1).nullable(),
  modelSelections: z
    .array(
      z.object({
        modelId: z.string().trim().min(1),
        alias: z.string().trim().min(1).optional()
      })
    )
    .default([]),
  executionMode: z.enum(["serial", "parallel_models", "parallel_scenarios", "full_parallel"]).default("parallel_models"),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1)
});

const WorkspaceSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  tabIds: z.array(z.string().trim().min(1)).default([]),
  activeTabId: z.string().trim().min(1).nullable(),
  createdAt: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1)
});

const WorkspaceStateSchema = z.object({
  schema_version: z.literal(1).default(1),
  activeWorkspaceId: z.string().trim().min(1).nullable(),
  workspaceOrder: z.array(z.string().trim().min(1)).default([]),
  workspaces: z.record(z.string(), WorkspaceSchema).default({}),
  tabs: z.record(z.string(), WorkspaceTabSchema).default({})
});

export function getWorkspaceStatePath(): string {
  return path.join(getBenchLocalHome(), "state.json");
}

export function createDefaultWorkspaceState(defaultPlugin = "toolcall-15"): BenchLocalWorkspaceState {
  const now = new Date().toISOString();
  const workspaceId = `workspace-${randomUUID()}`;
  const tabId = `tab-${randomUUID()}`;

  return {
    schema_version: 1,
    activeWorkspaceId: workspaceId,
    workspaceOrder: [workspaceId],
    workspaces: {
      [workspaceId]: {
        id: workspaceId,
        name: "My Workspace",
        tabIds: [tabId],
        activeTabId: tabId,
        createdAt: now,
        updatedAt: now
      }
    },
    tabs: {
      [tabId]: {
        id: tabId,
        title: defaultPlugin,
        pluginId: defaultPlugin,
        focusedScenarioId: null,
        modelSelections: [],
        executionMode: "parallel_models",
        createdAt: now,
        updatedAt: now
      }
    }
  };
}

function normalizeWorkspaceState(raw: unknown, defaultPlugin = "toolcall-15"): BenchLocalWorkspaceState {
  const defaults = createDefaultWorkspaceState(defaultPlugin);
  const parsed = WorkspaceStateSchema.parse(raw ?? {});

  const workspaces = { ...parsed.workspaces };
  const tabs = { ...parsed.tabs };
  const workspaceOrder = parsed.workspaceOrder.filter((workspaceId) => workspaces[workspaceId]);

  for (const [workspaceId, workspace] of Object.entries(workspaces)) {
    const validTabIds = workspace.tabIds.filter((tabId) => tabs[tabId]);
    const activeTabId = workspace.activeTabId && validTabIds.includes(workspace.activeTabId) ? workspace.activeTabId : validTabIds[0] ?? null;
    workspaces[workspaceId] = {
      ...workspace,
      tabIds: validTabIds,
      activeTabId
    };
  }

  for (const [tabId, tab] of Object.entries(tabs)) {
    tabs[tabId] = {
      ...tab,
      modelSelections: (tab.modelSelections ?? []).filter((selection) => Boolean(selection.modelId)),
      executionMode: tab.executionMode ?? "parallel_models"
    };
  }

  const normalizedOrder = workspaceOrder.length > 0 ? workspaceOrder : Object.keys(workspaces);
  const activeWorkspaceId =
    parsed.activeWorkspaceId && workspaces[parsed.activeWorkspaceId]
      ? parsed.activeWorkspaceId
      : normalizedOrder[0] ?? null;

  if (normalizedOrder.length === 0) {
    return defaults;
  }

  return {
    schema_version: 1,
    activeWorkspaceId,
    workspaceOrder: normalizedOrder,
    workspaces,
    tabs
  };
}

export async function loadWorkspaceStateFile(
  statePath = getWorkspaceStatePath(),
  defaultPlugin = "toolcall-15"
): Promise<BenchLocalWorkspaceState> {
  const raw = await fs.readFile(statePath, "utf8");
  return normalizeWorkspaceState(JSON.parse(raw), defaultPlugin);
}

export async function loadOrCreateWorkspaceState(
  statePath = getWorkspaceStatePath(),
  defaultPlugin = "toolcall-15"
): Promise<LoadedBenchLocalWorkspaceState> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });

  try {
    const state = await loadWorkspaceStateFile(statePath, defaultPlugin);
    return {
      path: statePath,
      created: false,
      state
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown workspace bootstrap error.";

    if (!/ENOENT/.test(message)) {
      throw error;
    }
  }

  const state = createDefaultWorkspaceState(defaultPlugin);
  await saveWorkspaceStateFile(state, statePath, defaultPlugin);

  return {
    path: statePath,
    created: true,
    state
  };
}

export async function saveWorkspaceStateFile(
  state: BenchLocalWorkspaceState,
  statePath = getWorkspaceStatePath(),
  defaultPlugin = "toolcall-15"
): Promise<BenchLocalWorkspaceState> {
  const normalized = normalizeWorkspaceState(state, defaultPlugin);
  await fs.mkdir(path.dirname(statePath), { recursive: true });

  const tempPath = `${statePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(normalized, null, 2), "utf8");
  await fs.rename(tempPath, statePath);

  return normalized;
}
