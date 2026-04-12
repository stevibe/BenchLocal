import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CircleAlert,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Cog,
  FolderCog,
  FolderOpen,
  GripVertical,
  LayoutList,
  Logs,
  Pencil,
  Palette,
  Play,
  PlugZap,
  Plus,
  RotateCcw,
  Save,
  Square,
  Server,
  Settings2,
  Sidebar,
  SlidersHorizontal,
  LoaderCircle,
  Trash2,
  Wrench,
  X
} from "lucide-react";
import type {
  BenchLocalConfig,
  BenchLocalExecutionMode,
  BenchLocalModelConfig,
  BenchLocalProviderConfig,
  BenchLocalProviderKind,
  BenchLocalThemeDefinition,
  BenchLocalThemeDescriptor,
  BenchLocalVerifierConfig,
  BenchLocalWorkspace,
  BenchLocalWorkspaceState,
  BenchLocalWorkspaceTab,
  BenchLocalWorkspaceTabModelSelection,
  GenerationRequest,
  ProgressEvent,
  ScenarioResult,
  PluginInspection,
  PluginRunHistoryEntry,
  PluginRunSummary,
  ScenarioPackRegistryEntry
} from "@core";
import type { DetachedLogsState, PluginVerifierStatus, ScenarioPackMutationProgress } from "@/shared/desktop-api";

const DETACHED_LOGS_VIEW =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "logs";

type SettingsTab = "providers" | "models" | "plugins" | "verification" | "advanced";

type LoadState = {
  path: string;
  created: boolean;
  config: BenchLocalConfig;
};

type ProviderFormState = {
  id: string;
  kind: BenchLocalProviderKind;
  name: string;
  enabled: boolean;
  base_url: string;
  api_key: string;
};

type ProviderModalState =
  | {
      mode: "create";
      initialId?: undefined;
      form: ProviderFormState;
    }
  | {
      mode: "edit";
      initialId: string;
      form: ProviderFormState;
    };

type ModelFormState = {
  provider: string;
  model: string;
  label: string;
  group: string;
  enabled: boolean;
};

type ModelModalState =
  | {
      mode: "create";
      index?: undefined;
      form: ModelFormState;
    }
  | {
      mode: "edit";
      index: number;
      form: ModelFormState;
    };

type DetailModalState = {
  pluginId: string;
  modelId: string;
  scenarioId: string;
  summary: string;
  rawLog: string;
  status: "pass" | "partial" | "fail";
};

type TabModelsModalState = {
  tabId: string;
  selections: BenchLocalWorkspaceTabModelSelection[];
};

type SamplingFormState = {
  temperature: string;
  top_p: string;
  top_k: string;
  min_p: string;
  repetition_penalty: string;
  request_timeout_seconds: string;
};

type SamplingModalState = {
  tabId: string;
  pluginId: string;
  pluginName: string;
  defaults: GenerationRequest;
  form: SamplingFormState;
};

type ModelAliasModalState = {
  tabId: string;
  modelId: string;
  baseLabel: string;
  alias: string;
};

type HistoryModalState = {
  pluginId: string;
  pluginName: string;
  entries: PluginRunHistoryEntry[];
};

type WorkspaceModalState =
  | {
      mode: "rename";
      workspaceId: string;
      name: string;
    }
  | null;

type WorkspaceContextMenuState = {
  workspaceId: string;
  workspaceName: string;
  x: number;
  y: number;
} | null;

type ConfirmDialogState =
  | {
      title: string;
      subtitle: string;
      confirmLabel: string;
      tone?: "danger" | "neutral";
      onConfirm: () => void;
    }
  | null;

type ResolvedTabModel = BenchLocalModelConfig & {
  displayLabel: string;
  alias?: string;
};

type LiveRunState = {
  events: ProgressEvent[];
  resultsByModel: Record<string, ScenarioResult[]>;
  activeCellKeys: string[];
};

type ActiveRunEntry = {
  pluginId: string;
};

type LoadedHistoryEntry = {
  runId: string;
  startedAt: string;
};

type ScenarioPackMutationState = ScenarioPackMutationProgress;

function resolveThemeLabel(themeId: string, themes: BenchLocalThemeDescriptor[], prefersDark: boolean): string {
  if (themeId === "system") {
    return `System (${prefersDark ? "Dark" : "Light"})`;
  }

  return themes.find((theme) => theme.id === themeId)?.name ?? themeId;
}

const EXECUTION_MODE_OPTIONS: Array<{ value: BenchLocalExecutionMode; label: string }> = [
  { value: "serial", label: "Serial" },
  { value: "parallel_by_model", label: "Parallel per Model" },
  { value: "parallel_by_test_case", label: "Parallel per Test Case" },
  { value: "full_parallel", label: "Parallel for All" }
];

const SIDEBAR_OPEN_STORAGE_KEY = "benchlocal.sidebar-open";

const PROVIDER_KIND_OPTIONS: Array<{ value: BenchLocalProviderKind; label: string }> = [
  { value: "openai_compatible", label: "OpenAI Compatible" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "ollama", label: "Ollama" },
  { value: "llamacpp", label: "llama.cpp" },
  { value: "mlx", label: "MLX" },
  { value: "lmstudio", label: "LM Studio" }
];

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string; blurb: string; icon: ReactNode }> = [
  { id: "providers", label: "Providers", blurb: "Provider endpoints and credentials.", icon: <Server size={16} /> },
  { id: "models", label: "Models", blurb: "Shared model registry across scenario packs.", icon: <Bot size={16} /> },
  { id: "plugins", label: "Scenario Packs", blurb: "Browse, install, update, and remove official scenario packs.", icon: <PlugZap size={16} /> },
  { id: "verification", label: "Verification", blurb: "Managed verifiers and dependency modes.", icon: <Wrench size={16} /> },
  { id: "advanced", label: "Advanced", blurb: "Storage paths and registry options.", icon: <FolderCog size={16} /> }
];

const SAMPLING_FIELDS: Array<{
  key: keyof SamplingFormState;
  label: string;
  placeholder: string;
  integer?: boolean;
}> = [
  { key: "temperature", label: "Temperature", placeholder: "Leave blank" },
  { key: "top_p", label: "Top P", placeholder: "Leave blank" },
  { key: "top_k", label: "Top K", placeholder: "Leave blank", integer: true },
  { key: "min_p", label: "Min P", placeholder: "Leave blank" },
  { key: "repetition_penalty", label: "Repetition Penalty", placeholder: "Leave blank" },
  { key: "request_timeout_seconds", label: "Request Timeout Seconds", placeholder: "Leave blank", integer: true }
];

function cloneConfig(config: BenchLocalConfig): BenchLocalConfig {
  return structuredClone(config);
}

function providerKindLabel(kind: BenchLocalProviderKind): string {
  return PROVIDER_KIND_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

function defaultProviderName(kind: BenchLocalProviderKind): string {
  return providerKindLabel(kind);
}

function scenarioPackMutationLabel(mutation: ScenarioPackMutationState): string {
  switch (mutation.action) {
    case "install":
      return mutation.phase === "complete" ? "Installed" : "Installing...";
    case "update":
      return mutation.phase === "complete" ? "Updated" : "Updating...";
    case "uninstall":
      return mutation.phase === "complete" ? "Removed" : "Removing...";
    default:
      return mutation.message;
  }
}

function defaultProviderBaseUrl(kind: BenchLocalProviderKind): string {
  switch (kind) {
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "ollama":
      return "http://127.0.0.1:11434/v1";
    case "llamacpp":
      return "http://127.0.0.1:8080/v1";
    case "mlx":
      return "http://127.0.0.1:8082/v1";
    case "lmstudio":
      return "http://127.0.0.1:1234/v1";
    case "openai_compatible":
    default:
      return "https://api.example.com/v1";
  }
}

function createEmptyProvider(): ProviderFormState {
  return {
    id: `openai_compatible-${crypto.randomUUID()}`,
    kind: "openai_compatible",
    name: "",
    enabled: true,
    base_url: "https://api.example.com/v1",
    api_key: ""
  };
}

function createEmptyModel(providerId = "openrouter"): ModelFormState {
  return {
    provider: providerId,
    model: "",
    label: "",
    group: "primary",
    enabled: true
  };
}

function createSamplingForm(input?: GenerationRequest): SamplingFormState {
  return {
    temperature: input?.temperature?.toString() ?? "",
    top_p: input?.top_p?.toString() ?? "",
    top_k: input?.top_k?.toString() ?? "",
    min_p: input?.min_p?.toString() ?? "",
    repetition_penalty: input?.repetition_penalty?.toString() ?? "",
    request_timeout_seconds: input?.request_timeout_seconds?.toString() ?? ""
  };
}

function parseSamplingForm(form: SamplingFormState): { value?: GenerationRequest; error?: string } {
  const result: GenerationRequest = {};

  for (const field of SAMPLING_FIELDS) {
    const rawValue = form[field.key].trim();

    if (!rawValue) {
      continue;
    }

    const parsed = field.integer ? Number.parseInt(rawValue, 10) : Number(rawValue);

    if (!Number.isFinite(parsed)) {
      return { error: `${field.label} must be a valid number.` };
    }

    if (field.integer && parsed <= 0) {
      return { error: `${field.label} must be greater than zero.` };
    }

    result[field.key as keyof GenerationRequest] = parsed;
  }

  return { value: result };
}

function toProviderForm(id: string, provider: BenchLocalProviderConfig): ProviderFormState {
  return {
    id,
    kind: provider.kind,
    name: provider.name,
    enabled: provider.enabled,
    base_url: provider.base_url,
    api_key: provider.api_key ?? ""
  };
}

function toModelForm(model: BenchLocalModelConfig): ModelFormState {
  return {
    provider: model.provider,
    model: model.model,
    label: model.label,
    group: model.group,
    enabled: model.enabled
  };
}

function buildModelConfig(
  form: ModelFormState,
  providers: Record<string, BenchLocalProviderConfig>
): BenchLocalModelConfig {
  const provider = providers[form.provider.trim()];
  const providerLabel = provider?.name?.trim() || form.provider.trim();

  return {
    id: `${form.provider}:${form.model}`.trim(),
    provider: form.provider.trim(),
    model: form.model.trim(),
    label: form.label.trim() || `${form.model.trim()} via ${providerLabel}`,
    group: form.group.trim() || "primary",
    enabled: form.enabled
  };
}

function createWorkspaceName(existingCount: number): string {
  return existingCount === 0 ? "My Workspace" : `Workspace ${existingCount + 1}`;
}

function createTabTitle(pluginId: string, inspections: PluginInspection[]): string {
  return inspections.find((inspection) => inspection.id === pluginId)?.manifest?.name ?? pluginId;
}

function normalizeTabModelSelections(
  selections: BenchLocalWorkspaceTabModelSelection[]
): BenchLocalWorkspaceTabModelSelection[] {
  const seen = new Set<string>();

  return selections
    .filter((selection) => {
      const modelId = selection.modelId.trim();

      if (!modelId || seen.has(modelId)) {
        return false;
      }

      seen.add(modelId);
      return true;
    })
    .map((selection) => ({
      modelId: selection.modelId.trim(),
      alias: selection.alias?.trim() || undefined
    }));
}

function getTableScrollbarThumbWidth(metrics: {
  clientWidth: number;
  scrollWidth: number;
  scrollLeft: number;
}): number {
  if (metrics.scrollWidth <= 0 || metrics.clientWidth <= 0) {
    return 0;
  }

  const ratio = metrics.clientWidth / metrics.scrollWidth;
  return Math.max(56, Math.round(metrics.clientWidth * ratio));
}

function resolveTabModels(tab: BenchLocalWorkspaceTab | null, models: BenchLocalModelConfig[]): ResolvedTabModel[] {
  const enabledModels = models.filter((model) => model.enabled);
  const modelMap = new Map(enabledModels.map((model) => [model.id, model]));

  return normalizeTabModelSelections(tab?.modelSelections ?? []).reduce<ResolvedTabModel[]>((resolved, selection) => {
      const model = modelMap.get(selection.modelId);

      if (!model) {
        return resolved;
      }

      resolved.push({
        ...model,
        alias: selection.alias,
        displayLabel: selection.alias || model.label
      });

      return resolved;
    }, []);
}

function upsertTabModelAlias(
  tab: BenchLocalWorkspaceTab,
  models: BenchLocalModelConfig[],
  modelId: string,
  alias: string
): BenchLocalWorkspaceTabModelSelection[] {
  const normalized = normalizeTabModelSelections(tab.modelSelections);
  const nextAlias = alias.trim() || undefined;
  let found = false;

  const next = normalized.map((selection) => {
    if (selection.modelId !== modelId) {
      return selection;
    }

    found = true;
    return {
      ...selection,
      alias: nextAlias
    };
  });

  if (!found) {
    next.push({
      modelId,
      alias: nextAlias
    });
  }

  return next;
}

function pushScenarioResult(
  current: Record<string, ScenarioResult[]>,
  modelId: string,
  result: ScenarioResult
): Record<string, ScenarioResult[]> {
  return {
    ...current,
    [modelId]: [...(current[modelId] ?? []).filter((candidate) => candidate.scenarioId !== result.scenarioId), result]
  };
}

function updateLiveRunState(
  current: LiveRunState | undefined,
  event: ProgressEvent
): LiveRunState {
  const next: LiveRunState = current ?? {
    events: [],
    resultsByModel: {},
    activeCellKeys: []
  };

  const eventKey =
    "modelId" in event && "scenarioId" in event ? `${event.modelId}::${event.scenarioId}` : null;

  next.events = [...next.events, event];

  if (event.type === "model_progress" && eventKey && !next.activeCellKeys.includes(eventKey)) {
    next.activeCellKeys = [...next.activeCellKeys, eventKey];
  }

  if (event.type === "scenario_result" && eventKey) {
    next.resultsByModel = pushScenarioResult(next.resultsByModel, event.modelId, event.result);
    next.activeCellKeys = next.activeCellKeys.filter((key) => key !== eventKey);
  }

  if (event.type === "run_finished" || event.type === "run_error") {
    next.activeCellKeys = [];
  }

  return next;
}

export function App() {
  if (DETACHED_LOGS_VIEW) {
    return <DetachedLogsWindow />;
  }

  const [loadState, setLoadState] = useState<LoadState | null>(null);
  const [draft, setDraft] = useState<BenchLocalConfig | null>(null);
  const [workspaceState, setWorkspaceState] = useState<BenchLocalWorkspaceState | null>(null);
  const [pluginInspections, setPluginInspections] = useState<PluginInspection[]>([]);
  const [registryEntries, setRegistryEntries] = useState<ScenarioPackRegistryEntry[]>([]);
  const [availableThemes, setAvailableThemes] = useState<BenchLocalThemeDescriptor[]>([]);
  const [activeThemeDefinition, setActiveThemeDefinition] = useState<BenchLocalThemeDefinition | null>(null);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false
  );
  const [verifierStatuses, setVerifierStatuses] = useState<Record<string, PluginVerifierStatus>>({});
  const [tabMenuOpen, setTabMenuOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }

    return window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY) !== "false";
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("providers");
  const [providerModal, setProviderModal] = useState<ProviderModalState | null>(null);
  const [modelModal, setModelModal] = useState<ModelModalState | null>(null);
  const [tabModelsModal, setTabModelsModal] = useState<TabModelsModalState | null>(null);
  const [samplingModal, setSamplingModal] = useState<SamplingModalState | null>(null);
  const [modelAliasModal, setModelAliasModal] = useState<ModelAliasModalState | null>(null);
  const [workspaceModal, setWorkspaceModal] = useState<WorkspaceModalState>(null);
  const [workspaceContextMenu, setWorkspaceContextMenu] = useState<WorkspaceContextMenuState>(null);
  const [historyModal, setHistoryModal] = useState<HistoryModalState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [editingTab, setEditingTab] = useState<{ tabId: string; value: string; width: number } | null>(null);
  const [activeRuns, setActiveRuns] = useState<Record<string, ActiveRunEntry>>({});
  const [stoppingRuns, setStoppingRuns] = useState<Record<string, true>>({});
  const [runSummaries, setRunSummaries] = useState<Record<string, PluginRunSummary>>({});
  const [runHistories, setRunHistories] = useState<Record<string, PluginRunHistoryEntry[]>>({});
  const [liveRuns, setLiveRuns] = useState<Record<string, LiveRunState>>({});
  const [loadedHistoryRuns, setLoadedHistoryRuns] = useState<Record<string, LoadedHistoryEntry>>({});
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsAutoScroll, setLogsAutoScroll] = useState(true);
  const [logsDetached, setLogsDetached] = useState(false);
  const [logDrawerHeight, setLogDrawerHeight] = useState(240);
  const [detailModal, setDetailModal] = useState<DetailModalState | null>(null);
  const [isBusy, setIsBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scenarioPackMutations, setScenarioPackMutations] = useState<Record<string, ScenarioPackMutationState>>({});
  const themeMenuRef = useRef<HTMLDivElement | null>(null);

  const providerIds = useMemo(() => Object.keys(draft?.providers ?? {}), [draft]);
  const themeOptions = useMemo(() => ["system", ...availableThemes.map((theme) => theme.id)], [availableThemes]);
  const currentThemeLabel = useMemo(
    () => resolveThemeLabel(draft?.ui.theme ?? "system", availableThemes, systemPrefersDark),
    [draft?.ui.theme, availableThemes, systemPrefersDark]
  );
  const readyInspections = useMemo(() => pluginInspections.filter((inspection) => inspection.status === "ready"), [pluginInspections]);
  const activeWorkspace = useMemo<BenchLocalWorkspace | null>(
    () => (workspaceState?.activeWorkspaceId ? workspaceState.workspaces[workspaceState.activeWorkspaceId] ?? null : null),
    [workspaceState]
  );
  const workspaceTabs = useMemo<BenchLocalWorkspaceTab[]>(
    () =>
      activeWorkspace?.tabIds
        .map((tabId) => workspaceState?.tabs[tabId])
        .filter((tab): tab is BenchLocalWorkspaceTab => Boolean(tab)) ?? [],
    [activeWorkspace, workspaceState]
  );
  const activeTab = useMemo<BenchLocalWorkspaceTab | null>(
    () => (activeWorkspace?.activeTabId ? workspaceState?.tabs[activeWorkspace.activeTabId] ?? null : workspaceTabs[0] ?? null),
    [activeWorkspace, workspaceState, workspaceTabs]
  );
  const activeInspection = useMemo(
    () => pluginInspections.find((inspection) => inspection.id === activeTab?.pluginId) ?? null,
    [pluginInspections, activeTab]
  );
  const activeTabModels = useMemo(() => (draft ? resolveTabModels(activeTab, draft.models) : []), [draft, activeTab]);
  const activeRunSummary = useMemo(() => (activeTab ? runSummaries[activeTab.id] ?? null : null), [runSummaries, activeTab]);
  const activeLiveRun = useMemo(() => (activeTab ? liveRuns[activeTab.id] ?? null : null), [liveRuns, activeTab]);
  const activeLoadedHistory = useMemo(
    () => (activeTab ? loadedHistoryRuns[activeTab.id] ?? null : null),
    [loadedHistoryRuns, activeTab]
  );
  const activeLogEvents = activeLiveRun?.events ?? activeRunSummary?.events ?? [];
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const tabStripShellRef = useRef<HTMLDivElement | null>(null);
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const tabChipRefs = useRef(new Map<string, HTMLButtonElement>());
  const appliedThemeKeysRef = useRef<string[]>([]);
  const [tabStripOverflow, setTabStripOverflow] = useState(false);
  const [activeTabMask, setActiveTabMask] = useState<{ left: number; width: number } | null>(null);

  const hasUnsavedChanges =
    loadState && draft ? JSON.stringify(loadState.config) !== JSON.stringify(draft) : false;
  const effectiveThemeId = useMemo(() => {
    const requested = draft?.ui.theme ?? "system";

    if (requested === "system") {
      return systemPrefersDark ? "dark" : "light";
    }

    return requested;
  }, [draft?.ui.theme, systemPrefersDark]);

  const updateDraft = (updater: (current: BenchLocalConfig) => BenchLocalConfig) => {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      return updater(cloneConfig(current));
    });
  };

  const persistWorkspaceState = async (nextState: BenchLocalWorkspaceState) => {
    setWorkspaceState(nextState);

    try {
      const saved = await window.benchlocal.workspaces.save(nextState);
      setWorkspaceState(saved.state);
    } catch (workspaceError) {
      setError(workspaceError instanceof Error ? workspaceError.message : "Failed to save workspace state.");
    }
  };

  const updateWorkspaceState = (updater: (current: BenchLocalWorkspaceState) => BenchLocalWorkspaceState) => {
    setWorkspaceState((current) => {
      if (!current) {
        return current;
      }

      const next = updater(structuredClone(current));
      void persistWorkspaceState(next);
      return next;
    });
  };

  const loadPluginInspections = async () => {
    try {
      const inspections = await window.benchlocal.plugins.list();
      setPluginInspections(inspections);
    } catch (pluginError) {
      setError(pluginError instanceof Error ? pluginError.message : "Failed to inspect configured scenario packs.");
    }
  };

  const loadRegistryEntries = async () => {
    try {
      const entries = await window.benchlocal.plugins.registry();
      setRegistryEntries(entries);
    } catch (registryError) {
      setError(registryError instanceof Error ? registryError.message : "Failed to load scenario pack registry.");
    }
  };

  const loadVerifierStatuses = async () => {
    try {
      const statuses = await window.benchlocal.verifiers.list();
      setVerifierStatuses(Object.fromEntries(statuses.map((status) => [status.pluginId, status])));
    } catch (verifierError) {
      setError(verifierError instanceof Error ? verifierError.message : "Failed to load verifier status.");
    }
  };

  const loadThemes = async () => {
    try {
      const themes = await window.benchlocal.themes.list();
      setAvailableThemes(themes);
    } catch (themeError) {
      setError(themeError instanceof Error ? themeError.message : "Failed to load available themes.");
    }
  };

  const loadHistoryForPlugin = async (pluginId: string) => {
    try {
      const history = await window.benchlocal.plugins.history({ pluginId });
      setRunHistories((current) => ({
        ...current,
        [pluginId]: history
      }));
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : "Failed to load scenario pack history.");
    }
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsBusy(true);
      setError(null);

      try {
        const result = await window.benchlocal.config.load();
        const workspaceResult = await window.benchlocal.workspaces.load();
        const inspections = await window.benchlocal.plugins.list();
        const registry = await window.benchlocal.plugins.registry();
        const themes = await window.benchlocal.themes.list();
        const verifierStatusList = await window.benchlocal.verifiers.list();
        const activeRunsResult = await window.benchlocal.plugins.activeRuns();

        if (cancelled) {
          return;
        }

        setLoadState(result);
        setDraft(cloneConfig(result.config));
        setWorkspaceState(workspaceResult.state);
        setPluginInspections(inspections);
        setRegistryEntries(registry);
        setAvailableThemes(themes);
        setVerifierStatuses(Object.fromEntries(verifierStatusList.map((status) => [status.pluginId, status])));
        setActiveRuns(
          Object.fromEntries(activeRunsResult.map((run) => [run.tabId, { pluginId: run.pluginId }]))
        );
        setNotice(result.created ? "Created a fresh ~/.benchlocal/config.toml bootstrap." : null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load BenchLocal config.");
        }
      } finally {
        if (!cancelled) {
          setIsBusy(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      setSystemPrefersDark(media.matches);
    };

    handleChange();
    media.addEventListener("change", handleChange);

    return () => {
      media.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadTheme = async () => {
      const theme = await window.benchlocal.themes.load({ themeId: effectiveThemeId });

      if (!cancelled) {
        setActiveThemeDefinition(theme);
      }
    };

    void loadTheme();

    return () => {
      cancelled = true;
    };
  }, [effectiveThemeId]);

  useEffect(() => {
    if (!activeThemeDefinition || typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;

    for (const key of appliedThemeKeysRef.current) {
      root.style.removeProperty(key);
    }

    for (const [key, value] of Object.entries(activeThemeDefinition.variables)) {
      root.style.setProperty(key, value);
    }

    appliedThemeKeysRef.current = Object.keys(activeThemeDefinition.variables);
    root.style.setProperty("color-scheme", activeThemeDefinition.colorScheme);
    root.dataset.theme = activeThemeDefinition.id;
  }, [activeThemeDefinition]);

  useEffect(() => {
    return window.benchlocal.plugins.onRunEvent(({ tabId, event }) => {
      if (event.type === "run_finished" || event.type === "run_error") {
        setActiveRuns((current) => {
          if (!current[tabId]) {
            return current;
          }

          const next = { ...current };
          delete next[tabId];
          return next;
        });
        setStoppingRuns((current) => {
          if (!current[tabId]) {
            return current;
          }

          const next = { ...current };
          delete next[tabId];
          return next;
        });
      }

      setLiveRuns((current) => ({
        ...current,
        [tabId]: updateLiveRunState(current[tabId], event)
      }));
    });
  }, []);

  useEffect(() => {
    return window.benchlocal.plugins.onMutationProgress((payload) => {
      setScenarioPackMutations((current) => ({
        ...current,
        [payload.pluginId]: payload
      }));
    });
  }, []);

  useEffect(() => {
    if (!settingsOpen || settingsTab !== "verification") {
      return;
    }

    void loadVerifierStatuses();
  }, [settingsOpen, settingsTab]);

  useEffect(() => {
    if (!settingsOpen || settingsTab !== "advanced") {
      return;
    }

    void loadThemes();
  }, [settingsOpen, settingsTab]);

  useEffect(() => {
    if (!logsOpen || !logsAutoScroll || !logContainerRef.current) {
      return;
    }

    logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
  }, [activeLogEvents, logsOpen, logsAutoScroll]);

  useEffect(() => {
    if (!activeInspection?.id || activeInspection.status !== "ready") {
      return;
    }

    void loadHistoryForPlugin(activeInspection.id);
  }, [activeInspection?.id, activeInspection?.status]);

  useEffect(() => {
    const dispose = window.benchlocal.logs.onDetachedWindowClosed(() => {
      setLogsDetached(false);
    });

    return dispose;
  }, []);

  useEffect(() => {
    void window.benchlocal.logs.publishDetachedState({
      workspaceName: activeWorkspace?.name ?? "No Workspace",
      tabTitle: activeTab?.title ?? "No Active Tab",
      eventCount: activeLogEvents.length,
      events: activeLogEvents
    });
  }, [activeWorkspace?.name, activeTab?.title, activeLogEvents]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const shell = document.querySelector<HTMLElement>(".desktop-shell");

      if (!shell || !document.body.dataset.logResizeActive) {
        return;
      }

      const shellRect = shell.getBoundingClientRect();
      const nextHeight = Math.min(420, Math.max(160, shellRect.bottom - event.clientY - 30));
      setLogDrawerHeight(nextHeight);
    };

    const handleUp = () => {
      delete document.body.dataset.logResizeActive;
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, []);

  useEffect(() => {
    if (!workspaceContextMenu) {
      return;
    }

    const closeMenu = () => {
      setWorkspaceContextMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("mousedown", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [workspaceContextMenu]);

  useEffect(() => {
    if (!themeMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!themeMenuRef.current?.contains(target)) {
        setThemeMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setThemeMenuOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [themeMenuOpen]);

  useEffect(() => {
    return window.benchlocal.app.onOpenSettings(() => {
      setSettingsOpen(true);
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(sidebarOpen));
  }, [sidebarOpen]);

  useEffect(() => {
    const updateOverflow = () => {
      const element = tabStripRef.current;

      if (!element) {
        setTabStripOverflow(false);
        return;
      }

      setTabStripOverflow(element.scrollWidth > element.clientWidth + 4);
    };

    updateOverflow();
    window.addEventListener("resize", updateOverflow);

    return () => {
      window.removeEventListener("resize", updateOverflow);
    };
  }, [workspaceTabs.length, activeWorkspace?.id, sidebarOpen]);

  useEffect(() => {
    const shell = tabStripShellRef.current;
    const strip = tabStripRef.current;
    const activeTabId = activeTab?.id;

    if (!shell || !strip || !activeTabId) {
      setActiveTabMask(null);
      return;
    }

    const updateMask = () => {
      const activeElement = tabChipRefs.current.get(activeTabId);

      if (!activeElement) {
        setActiveTabMask(null);
        return;
      }

      const shellRect = shell.getBoundingClientRect();
      const tabRect = activeElement.getBoundingClientRect();

      setActiveTabMask({
        left: Math.round(tabRect.left - shellRect.left),
        width: Math.round(tabRect.width)
      });
    };

    const frameId = window.requestAnimationFrame(updateMask);
    window.addEventListener("resize", updateMask);
    strip.addEventListener("scroll", updateMask, { passive: true });

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateMask);
      strip.removeEventListener("scroll", updateMask);
    };
  }, [activeTab?.id, workspaceTabs, sidebarOpen, tabStripOverflow]);

  const save = async (): Promise<boolean> => {
    if (!draft) {
      return false;
    }

    setIsBusy(true);
    setError(null);

    try {
      const result = await window.benchlocal.config.save(draft);
      setLoadState(result);
      setDraft(cloneConfig(result.config));
      await loadPluginInspections();
      await loadRegistryEntries();
      setNotice("Saved ~/.benchlocal/config.toml");
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save BenchLocal config.");
      return false;
    } finally {
      setIsBusy(false);
    }
  };

  const refreshScenarioPackState = async (result?: LoadState) => {
    const nextLoadState = result ?? (await window.benchlocal.config.load());
    const inspections = await window.benchlocal.plugins.list();
    const registry = await window.benchlocal.plugins.registry();
    const verifierStatusList = await window.benchlocal.verifiers.list();

    setLoadState(nextLoadState);
    setDraft(cloneConfig(nextLoadState.config));
    setPluginInspections(inspections);
    setRegistryEntries(registry);
    setVerifierStatuses(Object.fromEntries(verifierStatusList.map((status) => [status.pluginId, status])));
  };

  const ensureScenarioPackMutationReady = async (): Promise<boolean> => {
    if (!hasUnsavedChanges) {
      return true;
    }

    return save();
  };

  const installScenarioPack = async (pluginId: string) => {
    if (!(await ensureScenarioPackMutationReady())) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setScenarioPackMutations((current) => ({
      ...current,
      [pluginId]: {
        pluginId,
        action: "install",
        phase: "resolving",
        message: "Resolving scenario pack from registry."
      }
    }));

    try {
      const result = await window.benchlocal.plugins.install({ pluginId });
      await refreshScenarioPackState(result);
      setNotice(`Installed ${pluginId}.`);
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : `Failed to install ${pluginId}.`);
    } finally {
      setIsBusy(false);
      setScenarioPackMutations((current) => {
        const next = { ...current };
        delete next[pluginId];
        return next;
      });
    }
  };

  const updateScenarioPack = async (pluginId: string) => {
    if (!(await ensureScenarioPackMutationReady())) {
      return;
    }

    setIsBusy(true);
    setError(null);
    setScenarioPackMutations((current) => ({
      ...current,
      [pluginId]: {
        pluginId,
        action: "update",
        phase: "resolving",
        message: "Resolving scenario pack update."
      }
    }));

    try {
      const result = await window.benchlocal.plugins.update({ pluginId });
      await refreshScenarioPackState(result);
      setNotice(`Updated ${pluginId}.`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : `Failed to update ${pluginId}.`);
    } finally {
      setIsBusy(false);
      setScenarioPackMutations((current) => {
        const next = { ...current };
        delete next[pluginId];
        return next;
      });
    }
  };

  const uninstallInstalledScenarioPack = async (pluginId: string) => {
    if (!(await ensureScenarioPackMutationReady())) {
      return;
    }

    if (Object.values(activeRuns).some((run) => run.pluginId === pluginId)) {
      setError("Stop active scenario pack runs before uninstalling this pack.");
      return;
    }

    setIsBusy(true);
    setError(null);
    setScenarioPackMutations((current) => ({
      ...current,
      [pluginId]: {
        pluginId,
        action: "uninstall",
        phase: "removing",
        message: "Removing scenario pack."
      }
    }));

    try {
      const result = await window.benchlocal.plugins.uninstall({ pluginId });
      await refreshScenarioPackState(result);
      setNotice(`Uninstalled ${pluginId}.`);
    } catch (uninstallError) {
      setError(uninstallError instanceof Error ? uninstallError.message : `Failed to uninstall ${pluginId}.`);
    } finally {
      setIsBusy(false);
      setScenarioPackMutations((current) => {
        const next = { ...current };
        delete next[pluginId];
        return next;
      });
    }
  };

  const reset = () => {
    if (!loadState) {
      return;
    }

    setDraft(cloneConfig(loadState.config));
    setProviderModal(null);
    setModelModal(null);
    setNotice("Reverted unsaved changes.");
    setError(null);
  };

  const scrollTabStrip = (delta: number) => {
    tabStripRef.current?.scrollBy({
      left: delta,
      behavior: "smooth"
    });
  };

  const handleTabStripWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const strip = tabStripRef.current;

    if (!strip || !tabStripOverflow) {
      return;
    }

    const horizontalDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;

    if (Math.abs(horizontalDelta) < 1) {
      return;
    }

    event.preventDefault();
    strip.scrollBy({
      left: horizontalDelta,
      behavior: "auto"
    });
  };

  const runTab = async (tab: BenchLocalWorkspaceTab) => {
    setError(null);
    setNotice(null);

    if (!tab.pluginId) {
      setError("Select a scenario pack for this tab first.");
      return;
    }

    const pluginId = tab.pluginId;

    const selectedModels = draft ? resolveTabModels(tab, draft.models) : [];

    if (selectedModels.length === 0) {
      setError("Select at least one enabled model for this tab before running the scenario pack.");
      return;
    }

    if (hasUnsavedChanges) {
      const saved = await save();

      if (!saved) {
        return;
      }
    }

    setActiveRuns((current) => ({
      ...current,
      [tab.id]: { pluginId }
    }));
    setStoppingRuns((current) => {
      if (!current[tab.id]) {
        return current;
      }

      const next = { ...current };
      delete next[tab.id];
      return next;
    });
    setLiveRuns((current) => ({
      ...current,
      [tab.id]: {
        events: [],
        resultsByModel: {},
        activeCellKeys: []
      }
    }));
    setRunSummaries((current) => {
      if (!current[tab.id]) {
        return current;
      }

      const next = { ...current };
      delete next[tab.id];
      return next;
    });
    setLoadedHistoryRuns((current) => {
      if (!current[tab.id]) {
        return current;
      }

      const next = { ...current };
      delete next[tab.id];
      return next;
    });

    try {
      const result = await window.benchlocal.plugins.run({
        tabId: tab.id,
        pluginId,
        modelIds: selectedModels.map((model) => model.id),
        executionMode: tab.executionMode,
        generation: tab.samplingOverrides
      });
      setRunSummaries((current) => ({
        ...current,
        [tab.id]: result
      }));
      if (result.cancelled) {
        setNotice(`Stopped ${result.pluginName}.`);
      } else {
        setNotice(`Completed ${result.pluginName} across ${result.scenarioCount} scenarios and ${result.modelCount} model${result.modelCount === 1 ? "" : "s"}.`);
      }
      await loadPluginInspections();
      await loadHistoryForPlugin(pluginId);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : `Failed to run scenario pack for ${pluginId}.`);
    } finally {
      setActiveRuns((current) => {
        const next = { ...current };
        delete next[tab.id];
        return next;
      });
      setStoppingRuns((current) => {
        const next = { ...current };
        delete next[tab.id];
        return next;
      });
      setLiveRuns((current) => {
        const next = { ...current };
        delete next[tab.id];
        return next;
      });
      setLoadedHistoryRuns((current) => {
        const next = { ...current };
        delete next[tab.id];
        return next;
      });
    }
  };

  const stopTabRun = async (tabId: string) => {
    setStoppingRuns((current) => ({
      ...current,
      [tabId]: true
    }));

    try {
      const result = await window.benchlocal.plugins.stop({ tabId });

      if (!result.stopped) {
        setNotice("That scenario pack run was no longer active.");
        setActiveRuns((current) => {
          const next = { ...current };
          delete next[tabId];
          return next;
        });
        setStoppingRuns((current) => {
          const next = { ...current };
          delete next[tabId];
          return next;
        });
        return;
      }

      setNotice("Stopping scenario pack run...");
    } catch (stopError) {
      setStoppingRuns((current) => {
        const next = { ...current };
        delete next[tabId];
        return next;
      });
      setError(stopError instanceof Error ? stopError.message : "Failed to stop scenario pack run.");
    }
  };

  const createWorkspace = () => {
    updateWorkspaceState((current) => {
      const now = new Date().toISOString();
      const workspaceId = `workspace-${crypto.randomUUID()}`;
      const tabId = `tab-${crypto.randomUUID()}`;

      current.workspaceOrder.push(workspaceId);
      current.activeWorkspaceId = workspaceId;
      current.workspaces[workspaceId] = {
        id: workspaceId,
        name: createWorkspaceName(current.workspaceOrder.length - 1),
        tabIds: [tabId],
        activeTabId: tabId,
        createdAt: now,
        updatedAt: now
      };
      current.tabs[tabId] = {
        id: tabId,
        title: "New Tab",
        pluginId: null,
        focusedScenarioId: null,
        modelSelections: [],
        samplingOverrides: {},
        executionMode: "parallel_by_model",
        createdAt: now,
        updatedAt: now
      };

      return current;
    });
  };

  const renameWorkspace = (workspaceId: string, name: string) => {
    updateWorkspaceState((current) => {
      const workspace = current.workspaces[workspaceId];

      if (!workspace) {
        return current;
      }

      workspace.name = name.trim();
      workspace.updatedAt = new Date().toISOString();
      return current;
    });
  };

  const deleteWorkspace = (workspaceId: string) => {
    const removedTabIds = new Set(workspaceState?.workspaces[workspaceId]?.tabIds ?? []);

    if (Array.from(removedTabIds).some((tabId) => activeRuns[tabId])) {
      setError("Stop active scenario pack runs before deleting this workspace.");
      return;
    }

    updateWorkspaceState((current) => {
      const workspace = current.workspaces[workspaceId];

      if (!workspace) {
        return current;
      }

      for (const tabId of workspace.tabIds) {
        delete current.tabs[tabId];
      }

      delete current.workspaces[workspaceId];
      current.workspaceOrder = current.workspaceOrder.filter((id) => id !== workspaceId);

      if (current.workspaceOrder.length === 0) {
        const now = new Date().toISOString();
        const nextWorkspaceId = `workspace-${crypto.randomUUID()}`;
        const nextTabId = `tab-${crypto.randomUUID()}`;

        current.workspaceOrder = [nextWorkspaceId];
        current.activeWorkspaceId = nextWorkspaceId;
        current.workspaces[nextWorkspaceId] = {
          id: nextWorkspaceId,
          name: "My Workspace",
          tabIds: [nextTabId],
          activeTabId: nextTabId,
          createdAt: now,
          updatedAt: now
        };
        current.tabs[nextTabId] = {
          id: nextTabId,
          title: "New Tab",
          pluginId: null,
          focusedScenarioId: null,
          modelSelections: [],
          samplingOverrides: {},
          executionMode: "parallel_by_model",
          createdAt: now,
          updatedAt: now
        };
      } else if (current.activeWorkspaceId === workspaceId) {
        current.activeWorkspaceId = current.workspaceOrder[0] ?? null;
      }

      return current;
    });

    if (removedTabIds.size > 0) {
      setRunSummaries((current) =>
        Object.fromEntries(Object.entries(current).filter(([tabId]) => !removedTabIds.has(tabId)))
      );
      setLiveRuns((current) =>
        Object.fromEntries(Object.entries(current).filter(([tabId]) => !removedTabIds.has(tabId)))
      );
      setActiveRuns((current) =>
        Object.fromEntries(Object.entries(current).filter(([tabId]) => !removedTabIds.has(tabId)))
      );
      setStoppingRuns((current) =>
        Object.fromEntries(Object.entries(current).filter(([tabId]) => !removedTabIds.has(tabId))) as Record<string, true>
      );
    }
  };

  const exportWorkspace = async (workspaceId: string) => {
    if (!workspaceState) {
      return;
    }

    try {
      const result = await window.benchlocal.workspaces.export({
        workspaceId,
        state: workspaceState
      });

      if (result.exported) {
        setNotice(`Exported workspace to ${result.filePath}.`);
      }
    } catch (workspaceError) {
      setError(workspaceError instanceof Error ? workspaceError.message : "Failed to export workspace.");
    }
  };

  const importWorkspace = async () => {
    try {
      const result = await window.benchlocal.workspaces.import();

      if (!result.imported || !result.workspace || !result.tabs) {
        return;
      }

      const importedWorkspace = result.workspace;
      const importedTabs = result.tabs;
      const workspaceIdMap = new Map<string, string>();
      const tabIdMap = new Map<string, string>();
      const newWorkspaceId = `workspace-${crypto.randomUUID()}`;
      workspaceIdMap.set(importedWorkspace.id, newWorkspaceId);

      updateWorkspaceState((current) => {
        const now = new Date().toISOString();
        const nextTabIds = importedWorkspace.tabIds.map((tabId) => {
          const nextTabId = `tab-${crypto.randomUUID()}`;
          tabIdMap.set(tabId, nextTabId);
          const importedTab = importedTabs[tabId];

          if (importedTab) {
            current.tabs[nextTabId] = {
              ...importedTab,
              id: nextTabId,
              samplingOverrides: importedTab.samplingOverrides ?? {},
              createdAt: importedTab.createdAt ?? now,
              updatedAt: now
            };
          }

          return nextTabId;
        });

        current.workspaceOrder.push(newWorkspaceId);
        current.activeWorkspaceId = newWorkspaceId;
        current.workspaces[newWorkspaceId] = {
          ...importedWorkspace,
          id: newWorkspaceId,
          name:
            Object.values(current.workspaces).some((workspace) => workspace.name === importedWorkspace.name)
              ? `${importedWorkspace.name} Imported`
              : importedWorkspace.name,
          tabIds: nextTabIds,
          activeTabId: importedWorkspace.activeTabId ? tabIdMap.get(importedWorkspace.activeTabId) ?? nextTabIds[0] ?? null : nextTabIds[0] ?? null,
          createdAt: importedWorkspace.createdAt ?? now,
          updatedAt: now
        };

        return current;
      });

      setNotice(`Imported workspace "${importedWorkspace.name}".`);
    } catch (workspaceError) {
      setError(workspaceError instanceof Error ? workspaceError.message : "Failed to import workspace.");
    }
  };

  const activateWorkspace = (workspaceId: string) => {
    setWorkspaceContextMenu(null);
    updateWorkspaceState((current) => {
      current.activeWorkspaceId = workspaceId;
      return current;
    });
  };

  const createTab = (pluginId: string) => {
    if (!activeWorkspace) {
      return;
    }

    updateWorkspaceState((current) => {
      const workspace = current.workspaces[activeWorkspace.id];

      if (!workspace) {
        return current;
      }

      const now = new Date().toISOString();
      const tabId = `tab-${crypto.randomUUID()}`;
      current.tabs[tabId] = {
        id: tabId,
        title: createTabTitle(pluginId, pluginInspections),
        pluginId,
        focusedScenarioId: null,
        modelSelections: [],
        samplingOverrides: {},
        executionMode: "parallel_by_model",
        createdAt: now,
        updatedAt: now
      };
      workspace.tabIds.push(tabId);
      workspace.activeTabId = tabId;
      workspace.updatedAt = now;
      return current;
    });
    setTabMenuOpen(false);
  };

  const assignScenarioPackToTab = (tabId: string, pluginId: string) => {
    updateWorkspaceState((current) => {
      const tab = current.tabs[tabId];

      if (!tab) {
        return current;
      }

      tab.title = createTabTitle(pluginId, pluginInspections);
      tab.pluginId = pluginId;
      tab.focusedScenarioId = null;
      tab.samplingOverrides = {};
      tab.updatedAt = new Date().toISOString();

      return current;
    });
    setTabMenuOpen(false);
  };

  const activateTab = (tabId: string) => {
    if (!activeWorkspace) {
      return;
    }

    updateWorkspaceState((current) => {
      const workspace = current.workspaces[activeWorkspace.id];

      if (!workspace) {
        return current;
      }

      workspace.activeTabId = tabId;
      workspace.updatedAt = new Date().toISOString();
      return current;
    });
  };

  const startEditingTab = (tabId: string, currentTitle: string) => {
    const width = tabChipRefs.current.get(tabId)?.offsetWidth ?? 180;
    setEditingTab({
      tabId,
      value: currentTitle,
      width
    });
  };

  const commitEditingTab = () => {
    if (!editingTab) {
      return;
    }

    const nextTitle = editingTab.value.trim() || "New Tab";

    updateWorkspaceState((current) => {
      const tab = current.tabs[editingTab.tabId];

      if (!tab) {
        return current;
      }

      tab.title = nextTitle;
      tab.updatedAt = new Date().toISOString();
      return current;
    });

    setEditingTab(null);
  };

  const cancelEditingTab = () => {
    setEditingTab(null);
  };

  const reorderTab = (draggedId: string, targetId: string) => {
    if (!activeWorkspace || draggedId === targetId) {
      return;
    }

    updateWorkspaceState((current) => {
      const workspace = current.workspaces[activeWorkspace.id];

      if (!workspace) {
        return current;
      }

      const nextTabIds = [...workspace.tabIds];
      const fromIndex = nextTabIds.indexOf(draggedId);
      const toIndex = nextTabIds.indexOf(targetId);

      if (fromIndex < 0 || toIndex < 0) {
        return current;
      }

      const [moved] = nextTabIds.splice(fromIndex, 1);
      nextTabIds.splice(toIndex, 0, moved);
      workspace.tabIds = nextTabIds;
      workspace.updatedAt = new Date().toISOString();
      return current;
    });
  };

  const closeTab = (tabId: string) => {
    if (!activeWorkspace) {
      return;
    }

    if (activeRuns[tabId]) {
      setError("Stop the scenario pack run before closing this tab.");
      return;
    }

    updateWorkspaceState((current) => {
      const workspace = current.workspaces[activeWorkspace.id];

      if (!workspace) {
        return current;
      }

      workspace.tabIds = workspace.tabIds.filter((id) => id !== tabId);
      delete current.tabs[tabId];

      workspace.activeTabId =
        workspace.activeTabId === tabId ? workspace.tabIds[workspace.tabIds.length - 1] ?? null : workspace.activeTabId;
      workspace.updatedAt = new Date().toISOString();

      if (workspace.tabIds.length === 0) {
        const replacementTabId = `tab-${crypto.randomUUID()}`;
        current.tabs[replacementTabId] = {
          id: replacementTabId,
          title: "New Tab",
          pluginId: null,
          focusedScenarioId: null,
          modelSelections: [],
          samplingOverrides: {},
          executionMode: "parallel_by_model",
          createdAt: workspace.updatedAt,
          updatedAt: workspace.updatedAt
        };
        workspace.tabIds = [replacementTabId];
        workspace.activeTabId = replacementTabId;
      }

      return current;
    });
    setRunSummaries((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });
    setLiveRuns((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });
    setActiveRuns((current) => {
      const next = { ...current };
      delete next[tabId];
      return next;
    });
  };

  const restoreHistoryRun = async (pluginId: string, runId: string) => {
    if (!activeTab) {
      return;
    }

    try {
      const summary = await window.benchlocal.plugins.loadHistory({ pluginId, runId });
      setRunSummaries((current) => ({
        ...current,
        [activeTab.id]: summary
      }));
      setLiveRuns((current) => {
        const next = { ...current };
        delete next[activeTab.id];
        return next;
      });
      setLoadedHistoryRuns((current) => ({
        ...current,
        [activeTab.id]: {
          runId,
          startedAt: summary.startedAt
        }
      }));
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : "Failed to load scenario pack history.");
    }
  };

  const clearLoadedHistoryRun = (tabId: string) => {
    setLoadedHistoryRuns((current) => {
      if (!current[tabId]) {
        return current;
      }

      const next = { ...current };
      delete next[tabId];
      return next;
    });
    setRunSummaries((current) => {
      if (!current[tabId]) {
        return current;
      }

      const next = { ...current };
      delete next[tabId];
      return next;
    });
    setLiveRuns((current) => {
      if (!current[tabId]) {
        return current;
      }

      const next = { ...current };
      delete next[tabId];
      return next;
    });
  };

  const saveProviderModal = () => {
    if (!providerModal) {
      return;
    }

    const providerId = providerModal.form.id.trim();

    updateDraft((current) => {
      current.providers[providerId] = {
        kind: providerModal.form.kind,
        name: providerModal.form.name.trim() || defaultProviderName(providerModal.form.kind),
        enabled: providerModal.form.enabled,
        base_url: providerModal.form.base_url.trim(),
        api_key: providerModal.form.api_key.trim() || undefined
      };

      return current;
    });

    setProviderModal(null);
    setNotice(providerModal.mode === "create" ? "Added provider draft entry." : "Updated provider draft entry.");
  };

  const deleteProvider = (providerId: string) => {
    const removedModelIds = new Set((draft?.models ?? []).filter((model) => model.provider === providerId).map((model) => model.id));

    updateDraft((current) => {
      delete current.providers[providerId];
      current.models = current.models.filter((model) => model.provider !== providerId);
      return current;
    });

    if (removedModelIds.size > 0) {
      updateWorkspaceState((current) => {
        for (const tab of Object.values(current.tabs)) {
          tab.modelSelections = tab.modelSelections.filter((selection) => !removedModelIds.has(selection.modelId));
        }
        return current;
      });
    }

    setNotice(`Deleted provider "${providerId}".`);
  };

  const confirmDeleteProvider = (providerId: string) => {
    const provider = draft?.providers[providerId];
    const linkedModelCount = (draft?.models ?? []).filter((model) => model.provider === providerId).length;

    setConfirmDialog({
      title: "Delete Provider",
      subtitle:
        linkedModelCount > 0
          ? `Delete ${provider?.name ?? "this provider"}? This will also delete ${linkedModelCount} linked ${linkedModelCount === 1 ? "model" : "models"} and remove them from any tab selections.`
          : `Delete ${provider?.name ?? "this provider"}?`,
      confirmLabel: "Delete Provider",
      tone: "danger",
      onConfirm: () => {
        deleteProvider(providerId);
        setProviderModal(null);
      }
    });
  };

  const saveModelModal = () => {
    if (!modelModal) {
      return;
    }

    const modelConfig = buildModelConfig(modelModal.form, draft?.providers ?? {});

    if (!modelConfig.provider || !modelConfig.model) {
      setError("Model provider and model identifier are required.");
      return;
    }

    if (!draft?.providers[modelConfig.provider]) {
      setError(`Model provider "${modelConfig.provider}" does not exist yet.`);
      return;
    }

    const previousModelId = modelModal.mode === "edit" ? draft?.models[modelModal.index]?.id ?? null : null;

    updateDraft((current) => {
      if (modelModal.mode === "create") {
        current.models.push(modelConfig);
      } else {
        current.models[modelModal.index] = modelConfig;
      }

      return current;
    });

    if (previousModelId && previousModelId !== modelConfig.id) {
      updateWorkspaceState((current) => {
        for (const tab of Object.values(current.tabs)) {
          tab.modelSelections = tab.modelSelections.map((selection) =>
            selection.modelId === previousModelId ? { ...selection, modelId: modelConfig.id } : selection
          );
        }
        return current;
      });
    }

    setModelModal(null);
    setNotice(modelModal.mode === "create" ? "Added model draft entry." : "Updated model draft entry.");
  };

  const deleteModel = (index: number) => {
    const removedModelId = draft?.models[index]?.id ?? null;

    updateDraft((current) => {
      current.models.splice(index, 1);
      return current;
    });

    if (removedModelId) {
      updateWorkspaceState((current) => {
        for (const tab of Object.values(current.tabs)) {
          tab.modelSelections = tab.modelSelections.filter((selection) => selection.modelId !== removedModelId);
        }
        return current;
      });
    }

    setNotice("Deleted model.");
  };

  const confirmDeleteModel = (index: number) => {
    const model = draft?.models[index];
    if (!model) {
      return;
    }

    const linkedTabCount = workspaceState
      ? Object.values(workspaceState.tabs).filter((tab) =>
          tab.modelSelections.some((selection) => selection.modelId === model.id)
        ).length
      : 0;

    setConfirmDialog({
      title: "Delete Model",
      subtitle:
        linkedTabCount > 0
          ? `Delete ${model.label}? This will also remove it from ${linkedTabCount} tab ${linkedTabCount === 1 ? "selection" : "selections"}.`
          : `Delete ${model.label}?`,
      confirmLabel: "Delete Model",
      tone: "danger",
      onConfirm: () => {
        deleteModel(index);
        setModelModal(null);
      }
    });
  };

  return (
    <div>
      <main className="page-shell">
        <section className="desktop-shell">
          <header className="topbar">
            <div className="topbar-leading">
              <button
                type="button"
                onClick={() => setSidebarOpen((current) => !current)}
                className="toolbar-icon-button"
                aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
                title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
              >
                <Sidebar size={16} />
              </button>
            </div>

            <div className="topbar-main">
	              <div className="app-brand">
	                <h1>BenchLocal</h1>
	              </div>

              {!settingsOpen ? (
                <div className="toolbar-cluster">
	                  <ScenarioPackPickerTrigger
	                    inspections={readyInspections}
	                    open={tabMenuOpen}
	                    setOpen={setTabMenuOpen}
	                    onCreateTab={(pluginId) => {
                        if (activeTab && !activeTab.pluginId) {
                          assignScenarioPackToTab(activeTab.id, pluginId);
                          return;
                        }

                        createTab(pluginId);
                      }}
	                    disabled={!activeWorkspace}
	                  />
	                  <button
	                    type="button"
	                    onClick={() => setSettingsOpen(true)}
                    className="ghost-button"
                    aria-label="Open settings"
                    title="Settings"
                  >
                    <Cog size={16} />
                    Settings
                  </button>
                </div>
              ) : draft ? (
                <div className="toolbar-cluster">
                  <div ref={themeMenuRef} className="settings-theme-dropdown">
                    <button
                      type="button"
                      className="ghost-button run-mode-button settings-theme-button"
                      onClick={() => setThemeMenuOpen((current) => !current)}
                      aria-haspopup="menu"
                      aria-expanded={themeMenuOpen}
                    >
                      <Palette size={15} />
                      <span className="settings-theme-button-label">Theme: {currentThemeLabel}</span>
                      <ChevronDown size={14} />
                    </button>
                    {themeMenuOpen ? (
                      <div className="run-mode-menu settings-theme-menu" role="menu">
                        {themeOptions.map((themeId) => (
                          <button
                            key={themeId}
                            type="button"
                            role="menuitemradio"
                            aria-checked={draft.ui.theme === themeId}
                            className={`run-mode-menu-item${draft.ui.theme === themeId ? " is-active" : ""}`}
                            onClick={() => {
                              updateDraft((current) => {
                                current.ui.theme = themeId;
                                return current;
                              });
                              setThemeMenuOpen(false);
                            }}
                          >
                            {resolveThemeLabel(themeId, availableThemes, systemPrefersDark)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </header>

          {settingsOpen && draft ? (
            <SettingsScene
              settingsTab={settingsTab}
              setSettingsTab={setSettingsTab}
              draft={draft}
              loadState={loadState}
              hasUnsavedChanges={hasUnsavedChanges}
              isBusy={isBusy}
              providerIds={providerIds}
              pluginInspections={pluginInspections}
              registryEntries={registryEntries}
              scenarioPackMutations={scenarioPackMutations}
              verifierStatuses={verifierStatuses}
              onBack={() => setSettingsOpen(false)}
              onSave={() => void save()}
              onReset={reset}
              onCreateProvider={() => setProviderModal({ mode: "create", form: createEmptyProvider() })}
              onEditProvider={(providerId) =>
                setProviderModal({
                  mode: "edit",
                  initialId: providerId,
                  form: toProviderForm(providerId, draft.providers[providerId])
                })
              }
              onCreateModel={() => setModelModal({ mode: "create", form: createEmptyModel(providerIds[0] ?? "openrouter") })}
              onEditModel={(index) => setModelModal({ mode: "edit", index, form: toModelForm(draft.models[index]) })}
              onStartVerifier={async (pluginId) => {
                try {
                  const status = await window.benchlocal.verifiers.start({ pluginId });
                  setVerifierStatuses((current) => ({ ...current, [pluginId]: status }));
                } catch (verifierError) {
                  setError(verifierError instanceof Error ? verifierError.message : "Failed to start verifier.");
                }
              }}
              onStopVerifier={async (pluginId) => {
                try {
                  const status = await window.benchlocal.verifiers.stop({ pluginId });
                  setVerifierStatuses((current) => ({ ...current, [pluginId]: status }));
                } catch (verifierError) {
                  setError(verifierError instanceof Error ? verifierError.message : "Failed to stop verifier.");
                }
              }}
              onRefreshRegistry={() => void loadRegistryEntries()}
              onInstallScenarioPack={(pluginId) => void installScenarioPack(pluginId)}
              onUpdateScenarioPack={(pluginId) => void updateScenarioPack(pluginId)}
              onUninstallScenarioPack={(pluginId) => void uninstallInstalledScenarioPack(pluginId)}
              updateDraft={updateDraft}
            />
          ) : (
            <div className={`desktop-layout${sidebarOpen ? "" : " sidebar-collapsed"}`}>
	            <aside className={`desktop-sidebar${sidebarOpen ? "" : " is-hidden"}`}>
	              <div className="sidebar-section">
                  <div className="sidebar-section-header">
	                <p className="sidebar-label">Workspaces</p>
                    <button
                      type="button"
                      onClick={createWorkspace}
                      className="sidebar-section-action"
                      aria-label="Create workspace"
                      title="Create workspace"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
	              </div>

	              <div className="sidebar-section">
	                {workspaceState?.workspaceOrder.length ? (
	                  workspaceState.workspaceOrder.map((workspaceId) => {
	                    const workspace = workspaceState.workspaces[workspaceId];

	                    if (!workspace) {
	                      return null;
	                    }

	                    return (
	                      <div
	                        key={workspace.id}
                          role="button"
                          tabIndex={0}
	                        onClick={() => activateWorkspace(workspace.id)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            activateWorkspace(workspace.id);
                            setWorkspaceContextMenu({
                              workspaceId: workspace.id,
                              workspaceName: workspace.name,
                              x: event.clientX,
                              y: event.clientY
                            });
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              activateWorkspace(workspace.id);
                            }
                          }}
	                        className={`sidebar-item${activeWorkspace?.id === workspace.id ? " is-active" : ""}`}
		                      >
		                        <div className="sidebar-item-main">
		                          <div className="sidebar-item-title">{workspace.name}</div>
                              <div className="sidebar-item-footer">
		                            <div className="sidebar-item-meta">{workspace.tabIds.length} tab{workspace.tabIds.length === 1 ? "" : "s"}</div>
	                            <div className="sidebar-item-actions">
	                              <button
	                                type="button"
                                className="sidebar-item-action"
                                title="Rename workspace"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setWorkspaceModal({
                                    mode: "rename",
                                    workspaceId: workspace.id,
                                    name: workspace.name
                                  });
                                }}
                              >
                                <Pencil size={13} />
                              </button>
	                            </div>
                              </div>
		                        </div>
		                      </div>
	                    );
	                  })
	                ) : (
	                  <div className="sidebar-empty">No workspaces yet.</div>
	                )}
	              </div>

                <div className="sidebar-footer">
                  <button type="button" onClick={() => void importWorkspace()} className="ghost-button sidebar-footer-button">
                    <FolderOpen size={14} />
                    Import Workspace
                  </button>
                </div>

	            </aside>

	            <section className="desktop-main">
	              {notice ? (
                  <Banner tone="success">
                    <div className="banner-row">
                      <span>{notice}</span>
                      <button
                        type="button"
                        className="banner-dismiss"
                        onClick={() => setNotice(null)}
                        aria-label="Dismiss notice"
                        title="Dismiss"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </Banner>
                ) : null}
	              {error ? <Banner tone="danger">{error}</Banner> : null}
	              {isBusy && !draft ? <Banner tone="neutral">Loading BenchLocal config...</Banner> : null}

	              <div className="workspace-scroll">
	                {draft ? (
	                  activeWorkspace ? (
	                    <div className="tabbed-workspace">
	                      <div ref={tabStripShellRef} className="tab-strip-shell" onWheel={handleTabStripWheel}>
                          {activeTabMask ? (
                            <span
                              className="tab-strip-active-mask"
                              style={{
                                left: `${activeTabMask.left}px`,
                                width: `${activeTabMask.width}px`
                              }}
                            />
                          ) : null}
                          <div ref={tabStripRef} className="tab-strip">
	                          {workspaceTabs.map((tab) => {
	                            const inspection = pluginInspections.find((candidate) => candidate.id === tab.pluginId);
                              const isTabRunning = Boolean(activeRuns[tab.id]);
                              const showWarning = !isTabRunning && inspection && inspection.status !== "ready";
                              const isEditingTab = editingTab?.tabId === tab.id;

		                            return (
		                              <button
		                                key={tab.id}
		                                type="button"
                                      ref={(element) => {
                                        if (element) {
                                          tabChipRefs.current.set(tab.id, element);
                                        } else {
                                          tabChipRefs.current.delete(tab.id);
                                        }
                                      }}
                                      draggable={!isEditingTab}
                                      onDragStart={(event) => {
                                        event.dataTransfer.setData("text/plain", tab.id);
                                        event.dataTransfer.effectAllowed = "move";
                                        setDraggedTabId(tab.id);
                                      }}
                                      onDragEnd={() => setDraggedTabId(null)}
                                      onDragOver={(event) => {
                                        event.preventDefault();
                                        event.dataTransfer.dropEffect = "move";
                                      }}
                                      onDrop={(event) => {
                                        event.preventDefault();
                                        const sourceTabId = event.dataTransfer.getData("text/plain");
                                        reorderTab(sourceTabId, tab.id);
                                        setDraggedTabId(null);
                                      }}
                                      onDoubleClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        startEditingTab(tab.id, tab.title);
                                      }}
		                                onClick={() => {
                                        if (isEditingTab) {
                                          return;
                                        }

                                        activateTab(tab.id);
                                      }}
		                                className={`tab-chip${activeTab?.id === tab.id ? " is-active" : ""}${draggedTabId === tab.id ? " is-dragging" : ""}`}
                                      style={isEditingTab ? { width: `${editingTab.width}px` } : undefined}
		                              >
                                  {isEditingTab ? (
                                    <input
                                      type="text"
                                      value={editingTab.value}
                                      onChange={(event) =>
                                        setEditingTab((current) =>
                                          current && current.tabId === tab.id
                                            ? { ...current, value: event.target.value }
                                            : current
                                        )
                                      }
                                      onClick={(event) => event.stopPropagation()}
                                      onDoubleClick={(event) => event.stopPropagation()}
                                      onBlur={commitEditingTab}
                                      onFocus={(event) => event.currentTarget.select()}
                                      onKeyDown={(event) => {
                                        event.stopPropagation();

                                        if (event.key === "Enter") {
                                          event.preventDefault();
                                          commitEditingTab();
                                        } else if (event.key === "Escape") {
                                          event.preventDefault();
                                          cancelEditingTab();
                                        }
                                      }}
                                      autoFocus
                                      className="tab-chip-title-input"
                                    />
                                  ) : (
	                                  <span className="tab-chip-title">{tab.title}</span>
                                  )}
                                    {isTabRunning ? (
                                      <span className="tab-chip-spinner" title="Scenario pack running">
                                        <span className="spinner" />
                                      </span>
                                    ) : null}
                                    {showWarning ? (
                                      <span className="tab-chip-warning" title={inspection.status.replaceAll("_", " ")}>
                                        <CircleAlert size={14} />
                                      </span>
                                    ) : null}
	                                <span
	                                  role="button"
	                                  tabIndex={0}
	                                  className="tab-chip-close"
	                                  onClick={(event) => {
	                                    event.stopPropagation();
                                      if (isEditingTab) {
                                        cancelEditingTab();
                                      }
                                      setConfirmDialog({
                                        title: "Close Tab",
                                        subtitle: `Close "${tab.title}"? The scenario pack tab will be removed from this workspace.`,
                                        confirmLabel: "Close Tab",
                                        onConfirm: () => closeTab(tab.id)
                                      });
	                                  }}
	                                  onKeyDown={(event) => {
	                                    if (event.key === "Enter" || event.key === " ") {
	                                      event.preventDefault();
	                                      event.stopPropagation();
                                        setConfirmDialog({
                                          title: "Close Tab",
                                          subtitle: `Close "${tab.title}"? The scenario pack tab will be removed from this workspace.`,
                                          confirmLabel: "Close Tab",
                                          onConfirm: () => closeTab(tab.id)
                                        });
	                                    }
	                                  }}
	                                >
	                                  <X size={12} />
	                                </span>
	                              </button>
	                            );
	                          })}
                              <button
                                type="button"
                                onClick={() => setTabMenuOpen(true)}
                                className={`tab-chip-add-button${tabStripOverflow ? " is-sticky" : ""}`}
                                aria-label="New tab"
                                title="New tab"
                              >
                                <Plus size={14} />
                              </button>
                          </div>
                          <div className="tab-strip-controls">
                            <button
                              type="button"
                              onClick={() => scrollTabStrip(-240)}
                              className="tab-strip-nav-button"
                              aria-label="Scroll tabs left"
                              title="Scroll tabs left"
                            >
                              <ChevronLeft size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => scrollTabStrip(240)}
                              className="tab-strip-nav-button"
                              aria-label="Scroll tabs right"
                              title="Scroll tabs right"
                            >
                              <ChevronRight size={14} />
                            </button>
                          </div>
                        </div>
	                      <div className="tabbed-workspace-content">
	                        {activeInspection && activeTab ? (
	                          <BenchmarkSection
	                            inspection={activeInspection}
	                            selectedModels={activeTabModels}
	                            runSummary={activeRunSummary}
                              historyEntries={runHistories[activeInspection.id] ?? []}
	                            liveRun={activeLiveRun}
                              loadedHistory={activeLoadedHistory}
	                            focusedScenarioId={activeTab.focusedScenarioId}
	                            onFocusScenario={(scenarioId) =>
	                              updateWorkspaceState((current) => {
	                                const tab = activeTab ? current.tabs[activeTab.id] : null;
	                                if (!tab) {
	                                  return current;
	                                }
	                                tab.focusedScenarioId = scenarioId;
	                                tab.updatedAt = new Date().toISOString();
	                                return current;
	                              })
	                            }
	                            onEditModels={() =>
	                              setTabModelsModal({
	                                tabId: activeTab.id,
	                                selections: structuredClone(activeTab.modelSelections)
	                              })
	                            }
                              onEditSampling={() =>
                                setSamplingModal({
                                  tabId: activeTab.id,
                                  pluginId: activeInspection.id,
                                  pluginName: activeInspection.manifest?.name ?? activeInspection.id,
                                  defaults: activeInspection.manifest?.samplingDefaults ?? {},
                                  form: createSamplingForm(activeTab.samplingOverrides)
                                })
                              }
	                            executionMode={activeTab.executionMode}
                              isViewingHistory={Boolean(activeLoadedHistory)}
                              onOpenHistory={() =>
                                setHistoryModal({
                                  pluginId: activeInspection.id,
                                  pluginName: activeInspection.manifest?.name ?? activeInspection.id,
                                  entries: runHistories[activeInspection.id] ?? []
                                })
                              }
                              onEditModelAlias={(model) =>
                                setModelAliasModal({
                                  tabId: activeTab.id,
                                  modelId: model.id,
                                  baseLabel: model.label,
                                  alias: model.alias ?? ""
                                })
                              }
	                            onChangeExecutionMode={(executionMode) =>
	                              updateWorkspaceState((current) => {
	                                const tab = activeTab ? current.tabs[activeTab.id] : null;
	                                if (!tab) {
	                                  return current;
	                                }
	                                tab.executionMode = executionMode;
	                                tab.updatedAt = new Date().toISOString();
	                                return current;
	                              })
                            }
	                            isRunning={Boolean(activeRuns[activeTab.id])}
	                            isStopping={Boolean(stoppingRuns[activeTab.id])}
                              onClearHistory={() => clearLoadedHistoryRun(activeTab.id)}
	                            onRun={() => void runTab(activeTab)}
	                            onStop={() => void stopTabRun(activeTab.id)}
	                            onOpenDetail={setDetailModal}
	                          />
	                        ) : (
	                          <EmptyWorkspace
                              hasInstalledScenarioPacks={readyInspections.length > 0}
                              onSelectScenarioPack={
                                activeTab ? () => setTabMenuOpen(true) : undefined
                              }
                            />
	                        )}
	                      </div>
	                    </div>
	                  ) : (
	                    <EmptyWorkspace />
	                  )
	                ) : null}
	              </div>
                {logsOpen && !logsDetached ? (
                  <section className="bottom-drawer" style={{ flexBasis: `${logDrawerHeight}px` }}>
                    <div
                      className="bottom-drawer-resizer"
                      onMouseDown={() => {
                        document.body.dataset.logResizeActive = "true";
                      }}
                    />
                    <div className="bottom-drawer-header">
                      <div>
                        <p className="eyebrow">Run Logs</p>
                        <div className="bottom-drawer-title">
                          {activeTab ? activeTab.title : "No Active Tab"}
                        </div>
                      </div>
                      <div className="section-actions">
                        <label className="drawer-toggle">
                          <input
                            type="checkbox"
                            checked={logsAutoScroll}
                            onChange={(event) => setLogsAutoScroll(event.target.checked)}
                          />
                          <span>Auto Scroll</span>
                        </label>
                        <span className="status-chip status-idle">{activeLogEvents.length} events</span>
                        <button
                          type="button"
                          onClick={() => setLogsOpen(false)}
                          className="toolbar-icon-button"
                          aria-label="Hide logs"
                          title="Hide logs"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                    {activeLogEvents.length > 0 ? (
                      <div ref={logContainerRef} className="event-trail bottom-drawer-log">
                        {activeLogEvents.map((event, index) => (
                          <div key={`${event.type}-${index}`} className="event-row">
                            <span className="event-type">{event.type}</span>
                            <span className="event-payload"> {JSON.stringify(event)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="bottom-drawer-empty">No run logs yet for the active tab.</div>
                    )}
                  </section>
                ) : null}
	            </section>
            </div>
          )}
          {!settingsOpen ? (
            <footer className="status-footer">
              <div className="status-footer-group">
                <span className="status-footer-item">
                  {activeWorkspace?.name ?? "No Workspace"}
                </span>
                <span className="status-footer-divider" />
                <span className="status-footer-item">
                  {activeTab?.title ?? "No Tab"}
                </span>
              </div>
              <div className="status-footer-group">
                <button
                  type="button"
                  onClick={() => setLogsOpen((current) => !current)}
                  className={`status-footer-button${logsOpen ? " is-active" : ""}`}
                >
                  <Logs size={13} />
                  {logsOpen ? "Hide Logs" : "Show Logs"}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (logsDetached) {
                      await window.benchlocal.logs.closeDetachedWindow();
                      setLogsDetached(false);
                      return;
                    }

                    await window.benchlocal.logs.openDetachedWindow();
                    setLogsDetached(true);
                    setLogsOpen(false);
                  }}
                  className={`status-footer-button${logsDetached ? " is-active" : ""}`}
                >
                  <Sidebar size={13} />
                  {logsDetached ? "Close Log Window" : "Detach Logs"}
                </button>
                <span className="status-footer-item">{activeLogEvents.length} events</span>
              </div>
            </footer>
          ) : null}
        </section>

      </main>

      {providerModal ? (
        <Modal
          title={providerModal.mode === "create" ? "Add Provider" : "Edit Provider"}
          subtitle="Create or update a shared provider entry."
          onClose={() => setProviderModal(null)}
          onSubmit={saveProviderModal}
          submitLabel={providerModal.mode === "create" ? "Create Provider" : "Save Provider"}
          leadingActions={
            providerModal.mode === "edit" ? (
              <button
                type="button"
                onClick={() => {
                  confirmDeleteProvider(providerModal.initialId);
                }}
                className="button-danger"
              >
                <Trash2 size={14} />
                Delete Provider
              </button>
            ) : undefined
          }
        >
          <div className="entry-grid two-col">
            <InlineSelectField
              label="Provider Kind"
              value={providerModal.form.kind}
              options={PROVIDER_KIND_OPTIONS.map((option) => option.value)}
              getOptionLabel={(value) => providerKindLabel(value as BenchLocalProviderKind)}
              onChange={(value) =>
                setProviderModal((current) =>
                  current
                    ? {
                        ...current,
                        form: {
                          ...current.form,
                          id:
                            current.mode === "create"
                              ? `${value as BenchLocalProviderKind}-${crypto.randomUUID()}`
                              : current.form.id,
                          kind: value as BenchLocalProviderKind,
                          name:
                            current.form.name.trim() === "" || current.form.name === defaultProviderName(current.form.kind)
                              ? defaultProviderName(value as BenchLocalProviderKind)
                              : current.form.name,
                          base_url:
                            current.form.base_url === defaultProviderBaseUrl(current.form.kind)
                              ? defaultProviderBaseUrl(value as BenchLocalProviderKind)
                              : current.form.base_url
                        }
                      }
                    : current
                )
              }
            />
            <Field
              label="Display Name"
              value={providerModal.form.name}
              placeholder={defaultProviderName(providerModal.form.kind)}
              onChange={(value) =>
                setProviderModal((current) => current ? { ...current, form: { ...current.form, name: value } } : current)
              }
            />
            <Field
              label="API Key"
              type="password"
              value={providerModal.form.api_key}
              placeholder="sk-or-v1-..."
              onChange={(value) => setProviderModal((current) => current ? { ...current, form: { ...current.form, api_key: value } } : current)}
            />
            <FieldToggle
              label="Enabled"
              checked={providerModal.form.enabled}
              onChange={(checked) => setProviderModal((current) => current ? { ...current, form: { ...current.form, enabled: checked } } : current)}
            />
          </div>
          <Field label="Base URL" value={providerModal.form.base_url} onChange={(value) => setProviderModal((current) => current ? { ...current, form: { ...current.form, base_url: value } } : current)} />
        </Modal>
      ) : null}

      {modelModal ? (
        <Modal
          title={modelModal.mode === "create" ? "Add Model" : "Edit Model"}
          subtitle="Models are shared across every installed scenario pack."
          onClose={() => setModelModal(null)}
          onSubmit={saveModelModal}
          submitLabel={modelModal.mode === "create" ? "Create Model" : "Save Model"}
          leadingActions={
            modelModal.mode === "edit" ? (
              <button
                type="button"
                onClick={() => {
                  confirmDeleteModel(modelModal.index);
                }}
                className="button-danger"
              >
                <Trash2 size={14} />
                Delete Model
              </button>
            ) : undefined
          }
        >
          <div className="entry-grid two-col">
            <InlineSelectField
              label="Provider"
              value={modelModal.form.provider}
              options={providerIds.length > 0 ? providerIds : ["openrouter"]}
              getOptionLabel={(value) => {
                const provider = draft?.providers[value];
                return provider ? provider.name : value;
              }}
              onChange={(value) => setModelModal((current) => current ? { ...current, form: { ...current.form, provider: value } } : current)}
            />
            <Field label="Group" value={modelModal.form.group} placeholder="primary" onChange={(value) => setModelModal((current) => current ? { ...current, form: { ...current.form, group: value } } : current)} />
            <Field label="Model Identifier" value={modelModal.form.model} placeholder="openai/gpt-4.1" onChange={(value) => setModelModal((current) => current ? { ...current, form: { ...current.form, model: value } } : current)} />
            <Field label="Display Label" value={modelModal.form.label} placeholder="GPT-4.1 via OpenRouter" onChange={(value) => setModelModal((current) => current ? { ...current, form: { ...current.form, label: value } } : current)} />
            <Field label="Computed ID" value={`${modelModal.form.provider}:${modelModal.form.model}`.replace(/:$/, "")} readOnly onChange={() => undefined} />
            <FieldToggle
              label="Enabled"
              checked={modelModal.form.enabled}
              onChange={(checked) => setModelModal((current) => current ? { ...current, form: { ...current.form, enabled: checked } } : current)}
            />
          </div>
        </Modal>
      ) : null}

      {tabModelsModal && draft ? (
        <TabModelsModal
          providers={draft.providers}
          models={draft.models}
          selections={tabModelsModal.selections}
          onClose={() => setTabModelsModal(null)}
          onChange={(selections) => setTabModelsModal((current) => (current ? { ...current, selections } : current))}
          onSubmit={() => {
            const nextSelections = normalizeTabModelSelections(tabModelsModal.selections);

            updateWorkspaceState((current) => {
              const tab = current.tabs[tabModelsModal.tabId];

              if (!tab) {
                return current;
              }

              tab.modelSelections = nextSelections;
              tab.updatedAt = new Date().toISOString();
              return current;
            });

            setTabModelsModal(null);
          }}
        />
      ) : null}

      {samplingModal ? (
        <SamplingModal
          pluginName={samplingModal.pluginName}
          defaults={samplingModal.defaults}
          form={samplingModal.form}
          onClose={() => setSamplingModal(null)}
          onChange={(form) => setSamplingModal((current) => (current ? { ...current, form } : current))}
          onSubmit={() => {
            const parsed = parseSamplingForm(samplingModal.form);

            if (parsed.error) {
              setError(parsed.error);
              return;
            }

            updateWorkspaceState((current) => {
              const tab = current.tabs[samplingModal.tabId];

              if (!tab) {
                return current;
              }

              tab.samplingOverrides = parsed.value ?? {};
              tab.updatedAt = new Date().toISOString();
              return current;
            });

            setSamplingModal(null);
          }}
        />
      ) : null}

      {modelAliasModal && draft ? (
        <Modal
          title="Edit Model Alias"
          subtitle={`Override the display name for this model in the current tab only. Default label: ${modelAliasModal.baseLabel}`}
          onClose={() => setModelAliasModal(null)}
          onSubmit={() => {
            updateWorkspaceState((current) => {
              const tab = current.tabs[modelAliasModal.tabId];

              if (!tab) {
                return current;
              }

              tab.modelSelections = upsertTabModelAlias(
                tab,
                draft.models,
                modelAliasModal.modelId,
                modelAliasModal.alias
              );
              tab.updatedAt = new Date().toISOString();
              return current;
            });

            setModelAliasModal(null);
          }}
          submitLabel="Save Alias"
        >
          <Field
            label="Alias"
            value={modelAliasModal.alias}
            placeholder={modelAliasModal.baseLabel}
            onChange={(value) =>
              setModelAliasModal((current) => (current ? { ...current, alias: value } : current))
            }
          />
        </Modal>
      ) : null}

      {workspaceModal ? (
        <Modal
          title="Rename Workspace"
          subtitle="Change the display name for this workspace."
          onClose={() => setWorkspaceModal(null)}
          onSubmit={() => {
            if (!workspaceModal.name.trim()) {
              setError("Workspace name is required.");
              return;
            }

            renameWorkspace(workspaceModal.workspaceId, workspaceModal.name);
            setWorkspaceModal(null);
          }}
          submitLabel="Save Workspace"
        >
          <Field
            label="Workspace Name"
            value={workspaceModal.name}
            onChange={(value) => setWorkspaceModal((current) => (current ? { ...current, name: value } : current))}
          />
        </Modal>
      ) : null}

      {historyModal ? (
        <HistoryModal
          pluginName={historyModal.pluginName}
          entries={historyModal.entries}
          onClose={() => setHistoryModal(null)}
          onOpenRun={(runId) => {
            void restoreHistoryRun(historyModal.pluginId, runId);
            setHistoryModal(null);
          }}
        />
      ) : null}

      {confirmDialog ? (
        <Modal
          title={confirmDialog.title}
          subtitle={confirmDialog.subtitle}
          onClose={() => setConfirmDialog(null)}
          onSubmit={() => {
            confirmDialog.onConfirm();
            setConfirmDialog(null);
          }}
          submitLabel={confirmDialog.confirmLabel}
          submitTone={confirmDialog.tone === "danger" ? "danger" : "primary"}
        />
      ) : null}

      {workspaceContextMenu ? (
        <div
          className="workspace-context-menu"
          style={{
            left: Math.min(workspaceContextMenu.x, window.innerWidth - 196),
            top: Math.min(workspaceContextMenu.y, window.innerHeight - 116)
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="workspace-context-menu-item"
            onClick={() => {
              setWorkspaceContextMenu(null);
              void exportWorkspace(workspaceContextMenu.workspaceId);
            }}
          >
            <Save size={14} />
            <span>Export Workspace</span>
          </button>
          <button
            type="button"
            className="workspace-context-menu-item is-danger"
            onClick={() => {
              setWorkspaceContextMenu(null);
              setConfirmDialog({
                title: "Delete Workspace",
                subtitle: `Delete "${workspaceContextMenu.workspaceName}" and all of its tabs? This cannot be undone.`,
                confirmLabel: "Delete Workspace",
                tone: "danger",
                onConfirm: () => deleteWorkspace(workspaceContextMenu.workspaceId)
              });
            }}
          >
            <Trash2 size={14} />
            <span>Delete Workspace</span>
          </button>
        </div>
      ) : null}

      {detailModal ? (
        <Modal
          title={`${detailModal.pluginId} · ${detailModal.scenarioId}`}
          subtitle={`${detailModal.modelId} · ${detailModal.summary}`}
          onClose={() => setDetailModal(null)}
          onSubmit={() => setDetailModal(null)}
          submitLabel="Close"
        >
          <div className="dialog-summary">
            <div className="dialog-summary-copy">
              <span className="dialog-summary-label">Status</span>
              <span className="dialog-summary-value">Validation Result</span>
            </div>
            <span
              className={`status-chip ${
                detailModal.status === "pass"
                  ? "status-done"
                  : detailModal.status === "partial"
                    ? "status-not-installed"
                    : "status-danger"
              }`}
            >
              {detailModal.status}
            </span>
          </div>
          <pre className="dialog-log">{detailModal.rawLog}</pre>
        </Modal>
      ) : null}
    </div>
  );
}

function ScenarioPackPickerDialog({
  inspections,
  open,
  setOpen,
  onSelectScenarioPack,
  title = "New Tab",
  subtitle = "Pick a scenario pack to open in this workspace.",
  actionLabel = "Open Scenario Pack"
}: {
  inspections: PluginInspection[];
  open: boolean;
  setOpen: (open: boolean) => void;
  onSelectScenarioPack: (pluginId: string) => void;
  title?: string;
  subtitle?: string;
  actionLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const filteredInspections = inspections.filter((inspection) => {
    const haystack = [
      inspection.manifest?.name,
      inspection.id,
      inspection.manifest?.description,
      inspection.manifest?.author
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(query.trim().toLowerCase());
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedInspection =
    filteredInspections.find((inspection) => inspection.id === selectedId) ??
    filteredInspections[0] ??
    null;

  useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedId((current) => {
      if (current && filteredInspections.some((inspection) => inspection.id === current)) {
        return current;
      }

      return filteredInspections[0]?.id ?? null;
    });
  }, [open, filteredInspections]);

  if (!open) {
    return null;
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog-shell dialog-shell-wide scenario-pack-picker-shell">
        <div className="dialog-header">
          <div>
            <h3 className="dialog-title">{title}</h3>
            <p className="section-copy" style={{ marginTop: "12px" }}>{subtitle}</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="dialog-close-button" aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>

        <div className="scenario-pack-picker-body">
          <div className="scenario-pack-picker-list">
            <label className="field-block">
              <span className="field-label">Search</span>
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search scenario packs"
                className="config-input"
              />
            </label>

            <div className="scenario-pack-picker-options">
              {filteredInspections.map((inspection) => (
                <button
                  key={inspection.id}
                  type="button"
                  className={`scenario-pack-option${selectedInspection?.id === inspection.id ? " is-selected" : ""}`}
                  onClick={() => setSelectedId(inspection.id)}
                >
                  <div className="scenario-pack-option-main">
                    <div className="settings-row-primary">{inspection.manifest?.name ?? inspection.id}</div>
                    <div className="settings-row-secondary settings-mono-cell">{inspection.id}</div>
                  </div>
                  <span className={`status-chip ${statusClasses(inspection.status)}`}>
                    {inspection.status.replaceAll("_", " ")}
                  </span>
                </button>
              ))}
              {filteredInspections.length === 0 ? (
                <div className="sidebar-empty">No scenario packs match your search.</div>
              ) : null}
            </div>
          </div>

          <div className="scenario-pack-picker-detail">
            {selectedInspection ? (
              <>
                <div>
                  <p className="eyebrow">Scenario Pack</p>
                  <h3 className="panel-title" style={{ marginTop: "8px" }}>
                    {selectedInspection.manifest?.name ?? selectedInspection.id}
                  </h3>
                  <p className="section-copy" style={{ marginTop: "10px" }}>
                    {selectedInspection.manifest?.description ?? "No description provided."}
                  </p>
                </div>

                <div className="scenario-pack-picker-meta">
                  <div className="scenario-pack-stat-card">
                    <span className="scenario-pack-stat-label">Author</span>
                    <span className="scenario-pack-stat-value scenario-pack-meta-value">
                      {selectedInspection.manifest?.author ?? "Unknown"}
                    </span>
                  </div>
                  <div className="scenario-pack-stat-card">
                    <span className="scenario-pack-stat-label">Tests</span>
                    <span className="scenario-pack-stat-value">{selectedInspection.scenarioCount ?? 0}</span>
                  </div>
                  <div className="scenario-pack-stat-card">
                    <span className="scenario-pack-stat-label">Version</span>
                    <span className="scenario-pack-stat-value scenario-pack-meta-value">
                      {selectedInspection.manifest?.version ?? "n/a"}
                    </span>
                  </div>
                </div>

                <div className="scenario-pack-picker-badges">
                  <span className={`status-chip ${statusClasses(selectedInspection.status)}`}>
                    {selectedInspection.status.replaceAll("_", " ")}
                  </span>
                  <span className="status-chip status-idle">
                    {selectedInspection.manifest?.capabilities.tools ? "Supports tools" : "No tools"}
                  </span>
                  <span className="status-chip status-idle">
                    {selectedInspection.manifest?.capabilities.verification ? "Requires verifier" : "No extra dependencies"}
                  </span>
                </div>

                <div className="scenario-pack-picker-footer">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      onSelectScenarioPack(selectedInspection.id);
                      setOpen(false);
                    }}
                    disabled={selectedInspection.status !== "ready"}
                  >
                    <Plus size={14} />
                    {actionLabel}
                  </button>
                </div>
              </>
            ) : (
              <div className="entry-card" style={{ marginTop: "40px" }}>
                <p className="eyebrow">No Installed Scenario Packs</p>
                <h3 className="panel-title" style={{ marginTop: "8px" }}>Install a scenario pack from Settings</h3>
                <p className="section-copy" style={{ marginTop: "10px" }}>
                  BenchLocal now starts with zero installed scenario packs. Open Settings, go to Scenario Packs, and install one from the official registry.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScenarioPackPickerTrigger({
  inspections,
  open,
  setOpen,
  onCreateTab,
  disabled
}: {
  inspections: PluginInspection[];
  open: boolean;
  setOpen: (open: boolean) => void;
  onCreateTab: (pluginId: string) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ghost-button dropdown-trigger"
        disabled={disabled}
      >
        <Plus size={14} />
        <span>New Tab</span>
      </button>

      <ScenarioPackPickerDialog
        inspections={inspections}
        open={open}
        setOpen={setOpen}
        onSelectScenarioPack={onCreateTab}
      />
    </>
  );
}

function BenchmarkSection({
  inspection,
  selectedModels,
  runSummary,
  historyEntries,
  liveRun,
  loadedHistory,
  focusedScenarioId,
  onFocusScenario,
  onEditModels,
  onEditSampling,
  onEditModelAlias,
  executionMode,
  isViewingHistory,
  onChangeExecutionMode,
  onOpenHistory,
  isRunning,
  isStopping,
  onClearHistory,
  onRun,
  onStop,
  onOpenDetail
}: {
  inspection: PluginInspection;
  selectedModels: ResolvedTabModel[];
  runSummary: PluginRunSummary | null;
  historyEntries: PluginRunHistoryEntry[];
  liveRun: LiveRunState | null;
  loadedHistory: LoadedHistoryEntry | null;
  focusedScenarioId: string | null;
  onFocusScenario: (scenarioId: string) => void;
  onEditModels: () => void;
  onEditSampling: () => void;
  onEditModelAlias: (model: ResolvedTabModel) => void;
  executionMode: BenchLocalExecutionMode;
  isViewingHistory: boolean;
  onChangeExecutionMode: (executionMode: BenchLocalExecutionMode) => void;
  onOpenHistory: () => void;
  isRunning: boolean;
  isStopping: boolean;
  onClearHistory: () => void;
  onRun: () => void;
  onStop: () => void;
  onOpenDetail: (detail: DetailModalState) => void;
}) {
  const [runModeOpen, setRunModeOpen] = useState(false);
  const runModeRef = useRef<HTMLDivElement | null>(null);
  const tableScrollViewportRef = useRef<HTMLDivElement | null>(null);
  const tableScrollbarTrackRef = useRef<HTMLDivElement | null>(null);
  const tableScrollbarDragRef = useRef<{
    startX: number;
    startScrollLeft: number;
  } | null>(null);
  const [tableScrollMetrics, setTableScrollMetrics] = useState({
    clientWidth: 0,
    scrollWidth: 0,
    scrollLeft: 0
  });
  const scenarios = inspection.scenarios ?? [];
  const currentScenario = scenarios.find((scenario) => scenario.id === focusedScenarioId) ?? scenarios[0] ?? null;
  const currentExecutionModeLabel =
    EXECUTION_MODE_OPTIONS.find((option) => option.value === executionMode)?.label ?? "Run Mode";
  const hasHorizontalOverflow = tableScrollMetrics.scrollWidth > tableScrollMetrics.clientWidth + 1;
  const stickyColumnShadow = tableScrollMetrics.scrollLeft > 2;
  const scrollbarThumbWidth = hasHorizontalOverflow ? getTableScrollbarThumbWidth(tableScrollMetrics) : 0;
  const scrollbarThumbOffset =
    hasHorizontalOverflow && tableScrollbarTrackRef.current
      ? ((tableScrollMetrics.scrollLeft / Math.max(1, tableScrollMetrics.scrollWidth - tableScrollMetrics.clientWidth)) *
          Math.max(0, tableScrollbarTrackRef.current.clientWidth - scrollbarThumbWidth))
      : 0;

  useEffect(() => {
    if (!runModeOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideRunMode = runModeRef.current?.contains(target);

      if (!insideRunMode) {
        setRunModeOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRunModeOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [runModeOpen]);

  useEffect(() => {
    const viewport = tableScrollViewportRef.current;
    if (!viewport) {
      return;
    }

    const updateMetrics = () => {
      setTableScrollMetrics({
        clientWidth: viewport.clientWidth,
        scrollWidth: viewport.scrollWidth,
        scrollLeft: viewport.scrollLeft
      });
    };

    const syncFromViewport = () => {
      updateMetrics();
    };

    updateMetrics();
    viewport.addEventListener("scroll", syncFromViewport);
    window.addEventListener("resize", updateMetrics);

    return () => {
      viewport.removeEventListener("scroll", syncFromViewport);
      window.removeEventListener("resize", updateMetrics);
    };
  }, [selectedModels.length, scenarios.length, runSummary, liveRun]);

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const viewport = tableScrollViewportRef.current;
      const track = tableScrollbarTrackRef.current;
      const drag = tableScrollbarDragRef.current;

      if (!viewport || !track || !drag) {
        return;
      }

      const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
      const maxThumbOffset = Math.max(1, track.clientWidth - getTableScrollbarThumbWidth(tableScrollMetrics));
      const deltaX = event.clientX - drag.startX;
      const nextScrollLeft = Math.min(
        maxScrollLeft,
        Math.max(0, drag.startScrollLeft + (deltaX / maxThumbOffset) * maxScrollLeft)
      );
      viewport.scrollLeft = nextScrollLeft;
    };

    const handleUp = () => {
      tableScrollbarDragRef.current = null;
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [tableScrollMetrics]);

  if (inspection.status !== "ready") {
    return (
      <section className="workspace-panel">
        <div className="workspace-toolbar">
          <div className="workspace-toolbar-copy">
            <p className="eyebrow">Scenario Pack Session</p>
            <div className="workspace-toolbar-heading">
              <div className="workspace-toolbar-title">{inspection.manifest?.name ?? inspection.id}</div>
              <div className="workspace-stat-chips">
                <span className="status-chip status-preview">{inspection.scenarioCount ?? 0} scenarios</span>
                <span className="status-chip status-idle">{selectedModels.length} models</span>
                <span className="status-chip status-idle">Idle</span>
              </div>
            </div>
          </div>
          <div className="section-actions">
            <button type="button" onClick={onEditModels} className="ghost-button" disabled={isRunning}>
              <Bot size={14} />
              Edit Models
            </button>
            <span className={`status-chip ${statusClasses(inspection.status)}`}>
              {inspection.status.replaceAll("_", " ")}
            </span>
          </div>
        </div>

        <div className="empty-workspace benchmark-empty-state">
          <div className="empty-workspace-card benchmark-empty-card">
            <div className="benchmark-empty-icon">
              <CircleAlert size={22} />
            </div>
            <p className="eyebrow">Scenario Pack Unavailable</p>
            <h3 className="panel-title" style={{ marginTop: "8px" }}>
              {inspection.manifest?.name ?? inspection.id} cannot run yet
            </h3>
            <p className="muted-copy" style={{ marginTop: "10px", maxWidth: "56ch" }}>
              {inspection.error ?? "This scenario pack is not installed or is missing its BenchLocal runtime entry."}
            </p>
            <div className="category-chip-row" style={{ marginTop: "14px" }}>
              <span className={`status-chip ${statusClasses(inspection.status)}`}>
                {inspection.status.replaceAll("_", " ")}
              </span>
              <span className="status-chip status-idle">{selectedModels.length} selected models</span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  function renderResultCell(modelId: string, scenarioId: string) {
    const result =
      liveRun?.resultsByModel[modelId]?.find((candidate) => candidate.scenarioId === scenarioId) ??
      runSummary?.resultsByModel[modelId]?.find((candidate) => candidate.scenarioId === scenarioId);
    const isActive = liveRun?.activeCellKeys.includes(`${modelId}::${scenarioId}`) ?? false;

    if (!result) {
      return (
        <div className={`result-icon-shell ${isActive ? "result-loading" : "result-idle"}`}>
          {isActive ? <span className="spinner" /> : <span style={{ fontSize: "0.75rem" }}>-</span>}
        </div>
      );
    }

    const tone =
      result.status === "pass" ? "result-pass" : result.status === "partial" ? "result-partial" : "result-fail";

    return (
      <button
        type="button"
        onClick={() =>
          onOpenDetail({
            pluginId: inspection.id,
            modelId,
            scenarioId,
            summary: result.summary,
            rawLog: result.rawLog,
            status: result.status
          })
        }
        className={`result-icon-button ${tone}`}
      >
        {result.status === "pass" ? "✓" : result.status === "partial" ? "!" : "×"}
      </button>
    );
  }

  return (
    <section className="workspace-panel">
      {loadedHistory ? (
        <div className="history-banner">
          <div className="banner-row">
            <span>
              Loaded test history from {new Date(loadedHistory.startedAt).toLocaleString()}.
            </span>
            <button
              type="button"
              className="history-banner-close"
              onClick={onClearHistory}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
      <div className="workspace-toolbar">
        <div className="workspace-toolbar-copy">
          <p className="eyebrow">Scenario Pack Session</p>
          <div className="workspace-toolbar-heading">
            <div className="workspace-toolbar-title">{inspection.manifest?.name ?? inspection.id}</div>
            <div className="workspace-stat-chips">
              <span className="status-chip status-preview">{inspection.scenarioCount ?? 0} scenarios</span>
              <span className="status-chip status-idle">{selectedModels.length} models</span>
              <span className={`status-chip ${isRunning ? "status-live" : runSummary ? "status-done" : "status-idle"}`}>
                {isRunning ? "Live" : runSummary ? "Done" : "Idle"}
              </span>
            </div>
          </div>
        </div>
        <div className="section-actions">
          <button type="button" className="ghost-button" onClick={onOpenHistory} disabled={historyEntries.length === 0}>
            <RotateCcw size={14} />
            Test Histories
          </button>
          <button
            type="button"
            onClick={isRunning ? onStop : onRun}
            disabled={(((inspection.status !== "ready" || selectedModels.length === 0 || isViewingHistory) && !isRunning) || isStopping)}
            className={isRunning ? "button-warn" : "primary-button"}
          >
            {isRunning ? <Square size={15} /> : <Play size={15} />}
            {isStopping ? "Stopping..." : isRunning ? "Stop" : "Run"}
          </button>
        </div>
      </div>

      <div className="workspace-grid">
        <div className="workspace-document">
          <details className="scenario-focus" open>
            <summary className="scenario-focus-header">
              <div>
                <p className="eyebrow">Scenario Detail</p>
                <h3>
                  {currentScenario ? `${currentScenario.id} · ${currentScenario.title}` : "No scenario selected"}
                </h3>
              </div>
              <div className="scenario-focus-summary-actions">
                <ChevronDown size={16} className="scenario-focus-chevron" />
              </div>
            </summary>

            <div className="scenario-detail-grid scenario-detail-grid-main">
              {(currentScenario?.detailCards?.length
                ? currentScenario.detailCards
                : [
                    {
                      title: "What this tests",
                      content:
                        currentScenario?.description ??
                        "Click a scenario column in the scenario pack table below to inspect that scenario."
                    },
                    {
                      title: "Prompt Contract",
                      content:
                        currentScenario?.description ??
                        "The active scenario follows the selected table column. Richer prompt or methodology detail will appear here as scenario pack metadata expands."
                    },
                    {
                      title: "Run Notes",
                      content: runSummary
                        ? "Click a scenario column to switch context. Click any result cell to inspect the trace and summary for that model and scenario."
                        : "Run this scenario pack, then use the scenario columns in the table below to switch the preview context."
                    }
                  ]
              ).map((card) => (
                <DetailCard key={card.title} title={card.title} content={card.content} />
              ))}
            </div>
          </details>

          <div className="table-controls">
            <div className="table-controls-heading">
              <LayoutList size={16} />
              <div className="workspace-toolbar-title">Test Results</div>
            </div>
            <div className="table-controls-actions">
              <div ref={runModeRef} className="run-mode-dropdown">
                <button
                  type="button"
                  className="ghost-button run-mode-button"
                  onClick={() => setRunModeOpen((current) => !current)}
                  disabled={isRunning}
                  aria-haspopup="menu"
                  aria-expanded={runModeOpen}
                  title="Run mode"
                >
                  <SlidersHorizontal size={14} />
                  <span className="run-mode-button-label">Run Mode:</span>
                  <span className="run-mode-button-value">{currentExecutionModeLabel}</span>
                  <ChevronDown size={15} />
                </button>
                {runModeOpen ? (
                  <div className="run-mode-menu" role="menu">
                    {EXECUTION_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={executionMode === option.value}
                        className={`run-mode-menu-item${executionMode === option.value ? " is-active" : ""}`}
                        onClick={() => {
                          onChangeExecutionMode(option.value);
                          setRunModeOpen(false);
                        }}
                      >
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button type="button" onClick={onEditSampling} className="ghost-button" disabled={isRunning}>
                <SlidersHorizontal size={14} />
                Samplings
              </button>
              <button type="button" onClick={onEditModels} className="ghost-button" disabled={isRunning}>
                <Bot size={14} />
                Edit Models
              </button>
            </div>
          </div>

          <section className="table-card table-card-document">
            {selectedModels.length === 0 ? (
              <div className="table-empty-callout">
                <div className="table-empty-callout-icon">
                  <Bot size={22} />
                </div>
                <div className="table-empty-callout-copy">
                  <h3 className="table-empty-callout-title">No models selected</h3>
                  <p className="muted-copy">Add one or more models to start running this scenario pack.</p>
                </div>
                <button type="button" onClick={onEditModels} className="ghost-button" disabled={isRunning}>
                  <Bot size={14} />
                  Add Models
                </button>
              </div>
            ) : (
              <>
                <div ref={tableScrollViewportRef} className="table-scroll">
                  <table className="result-table">
                  <thead>
                    <tr>
                      <th className={`scenario-row-label${stickyColumnShadow ? " has-scroll-shadow" : ""}`}>
                        <span>Model</span>
                      </th>
                      {scenarios.map((scenario) => (
                        <th
                          key={scenario.id}
                          className={`${scenario.id === currentScenario?.id ? "active-column selected-column" : ""}`}
                        >
                          <div className="column-heading">
                            <button
                              type="button"
                              onClick={() => onFocusScenario(scenario.id)}
                              className="column-button"
                              title={`${scenario.id} · ${scenario.title}`}
                            >
                              <span className="scenario-id">{scenario.id}</span>
                            </button>
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedModels.map((model) => (
                      <tr key={model.id}>
                        <td className={`scenario-row-label${stickyColumnShadow ? " has-scroll-shadow" : ""}`}>
                          <button
                            type="button"
                            className="model-badge-button"
                            onClick={() => onEditModelAlias(model)}
                            title="Edit model alias"
                          >
                            <div className="model-badge">{model.displayLabel}</div>
                          </button>
                        </td>
                        {scenarios.map((scenario) => (
                          <td
                            key={`${model.id}-${scenario.id}`}
                            className={`result-icon-cell ${scenario.id === currentScenario?.id ? "active-column" : ""}`}
                          >
                            {renderResultCell(model.id, scenario.id)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </div>
                {hasHorizontalOverflow ? (
                  <div
                    ref={tableScrollbarTrackRef}
                    className="table-scrollbar"
                    aria-hidden="true"
                    onMouseDown={(event) => {
                      const viewport = tableScrollViewportRef.current;
                      const track = tableScrollbarTrackRef.current;

                      if (!viewport || !track) {
                        return;
                      }

                      const rect = track.getBoundingClientRect();
                      const clickX = event.clientX - rect.left;

                      if (clickX >= scrollbarThumbOffset && clickX <= scrollbarThumbOffset + scrollbarThumbWidth) {
                        return;
                      }

                      const nextOffset = Math.max(
                        0,
                        Math.min(track.clientWidth - scrollbarThumbWidth, clickX - scrollbarThumbWidth / 2)
                      );
                      const nextScrollLeft =
                        (nextOffset / Math.max(1, track.clientWidth - scrollbarThumbWidth)) *
                        Math.max(0, viewport.scrollWidth - viewport.clientWidth);
                      viewport.scrollLeft = nextScrollLeft;
                    }}
                  >
                    <div
                      className="table-scrollbar-thumb"
                      style={{
                        width: `${scrollbarThumbWidth}px`,
                        transform: `translateX(${scrollbarThumbOffset}px)`
                      }}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        const viewport = tableScrollViewportRef.current;

                        if (!viewport) {
                          return;
                        }

                        tableScrollbarDragRef.current = {
                          startX: event.clientX,
                          startScrollLeft: viewport.scrollLeft
                        };
                        document.body.style.userSelect = "none";
                      }}
                    />
                  </div>
                ) : null}
              </>
            )}
          </section>

          {runSummary ? (
            <section className="scoreboard">
              {Object.entries(runSummary.scores).map(([modelId, score]) => (
                <div key={modelId} className="score-card score-card-compact">
                  <div>
                    <h3 style={{ margin: 0, fontSize: "1rem" }}>{selectedModels.find((model) => model.id === modelId)?.displayLabel ?? modelId}</h3>
                    <p className="muted-copy" style={{ marginTop: "6px", fontSize: "0.76rem" }}>{modelId}</p>
                  </div>
                  <div className="score-card-foot">
                    <span className="score-value">{score.totalScore}</span>
                    <div className="category-chip-row">
                      {score.categories.map((category) => (
                        <span key={category.id} className="status-chip category-chip">
                          {category.id}: {category.score}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function TabModelsModal({
  providers,
  models,
  selections,
  onClose,
  onChange,
  onSubmit
}: {
  providers: Record<string, BenchLocalProviderConfig>;
  models: BenchLocalModelConfig[];
  selections: BenchLocalWorkspaceTabModelSelection[];
  onClose: () => void;
  onChange: (selections: BenchLocalWorkspaceTabModelSelection[]) => void;
  onSubmit: () => void;
}) {
  const [providerFilter, setProviderFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const enabledModels = models.filter((model) => model.enabled);
  const normalizedSelections = normalizeTabModelSelections(selections);
  const selectionMap = new Map(normalizedSelections.map((selection) => [selection.modelId, selection]));
  const availableIds = new Set(enabledModels.map((model) => model.id));
  const orderedSelectedIds = normalizedSelections.map((selection) => selection.modelId).filter((modelId) => availableIds.has(modelId));
  const selectedIdSet = new Set(orderedSelectedIds);
  const providerOptions = [
    { value: "all", label: "All Providers" },
    ...Array.from(new Set(enabledModels.map((model) => model.provider)))
      .sort((left, right) => (providers[left]?.name ?? left).localeCompare(providers[right]?.name ?? right))
      .map((providerId) => ({
        value: providerId,
        label: providers[providerId]?.name ?? providerId
      }))
  ];
  const groupOptions = [
    { value: "all", label: "All Groups" },
    ...Array.from(new Set(enabledModels.map((model) => model.group.trim() || "__ungrouped__")))
      .sort((left, right) => left.localeCompare(right))
      .map((group) => ({
        value: group,
        label: group === "__ungrouped__" ? "Ungrouped" : group
      }))
  ];
  const filteredAvailableModels = enabledModels.filter((model) => {
    const normalizedGroup = model.group.trim() || "__ungrouped__";
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const haystack = [
      model.label,
      model.id,
      model.group,
      providers[model.provider]?.name ?? model.provider
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return (
      (providerFilter === "all" || model.provider === providerFilter) &&
      (groupFilter === "all" || normalizedGroup === groupFilter) &&
      (!normalizedQuery || haystack.includes(normalizedQuery))
    );
  });
  const selectedModels = orderedSelectedIds
    .map((modelId) => enabledModels.find((model) => model.id === modelId))
    .filter((model): model is BenchLocalModelConfig => Boolean(model));

  const toggleModel = (modelId: string, enabled: boolean) => {
    if (enabled) {
      const existing = selectionMap.get(modelId);
      onChange([...normalizedSelections, { modelId, alias: existing?.alias }]);
      return;
    }

    onChange(normalizedSelections.filter((selection) => selection.modelId !== modelId));
  };

  const updateAlias = (modelId: string, alias: string) => {
    const next = normalizedSelections.map((selection) =>
      selection.modelId === modelId ? { ...selection, alias: alias.trim() || undefined } : selection
    );
    onChange(next);
  };

  const moveSelection = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) {
      return;
    }

    const next = [...normalizedSelections];
    const fromIndex = next.findIndex((selection) => selection.modelId === draggedId);
    const toIndex = next.findIndex((selection) => selection.modelId === targetId);

    if (fromIndex < 0 || toIndex < 0) {
      return;
    }

    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onChange(next);
  };

  useEffect(() => {
    if (providerFilter !== "all" && !providerOptions.some((option) => option.value === providerFilter)) {
      setProviderFilter("all");
    }
  }, [providerFilter, providerOptions]);

  useEffect(() => {
    if (groupFilter !== "all" && !groupOptions.some((option) => option.value === groupFilter)) {
      setGroupFilter("all");
    }
  }, [groupFilter, groupOptions]);

  return (
    <Modal
      title="Edit Tab Models"
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Models"
      size="wide"
    >
      <div className="tab-models-layout">
        <section className="tab-models-column">
          <div className="tab-models-column-header">
            <h4 className="tab-models-column-title">Available Models</h4>
            <span className="status-chip status-idle">{filteredAvailableModels.length}</span>
          </div>
          <div className="entry-grid two-col tab-models-filters">
            <InlineSelectField
              label="Provider Filter"
              value={providerFilter}
              options={providerOptions}
              onChange={setProviderFilter}
            />
            <InlineSelectField
              label="Group Filter"
              value={groupFilter}
              options={groupOptions}
              onChange={setGroupFilter}
            />
            <Field
              label=""
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search models"
              className="tab-models-search"
            />
          </div>
          <div className="tab-models-list">
            {filteredAvailableModels.length === 0 ? (
              <div className="tab-models-empty">
                <p className="muted-copy">No models match the current filters.</p>
              </div>
            ) : filteredAvailableModels.map((model) => {
              const isSelected = selectedIdSet.has(model.id);

              return (
              <div key={model.id} className="tab-model-row">
                <label className="tab-model-toggle">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(event) => toggleModel(model.id, event.target.checked)}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="tab-model-toggle-copy">
                    <span className="settings-row-primary">{model.label}</span>
                    <span className="settings-row-secondary settings-mono-cell">{providers[model.provider]?.name ?? model.provider}</span>
                    <span className="settings-row-secondary settings-mono-cell">{model.id}</span>
                  </span>
                </label>

                <div className="tab-model-row-meta">
                  <span className="status-chip status-idle">{model.group.trim() || "Ungrouped"}</span>
                </div>
              </div>
            );
            })}
          </div>
        </section>

        <section className="tab-models-column">
          <div className="tab-models-column-header">
            <h4 className="tab-models-column-title">Selected Models</h4>
            <span className="status-chip status-preview">{selectedModels.length}</span>
          </div>
          <div className="tab-models-list">
            {selectedModels.length === 0 ? (
              <div className="tab-models-empty">
                <p className="muted-copy">Select models from the left to add them to this tab.</p>
              </div>
            ) : selectedModels.map((model) => {
              const selection = selectionMap.get(model.id);

              return (
                <div
                  key={model.id}
                  className="tab-model-row is-selected"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", model.id);
                    event.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    moveSelection(event.dataTransfer.getData("text/plain"), model.id);
                  }}
                >
                  <label className="tab-model-toggle">
                    <input
                      type="checkbox"
                      checked
                      onChange={(event) => toggleModel(model.id, event.target.checked)}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    <span className="tab-model-toggle-copy">
                      <span className="settings-row-primary">{model.label}</span>
                      <span className="settings-row-secondary settings-mono-cell">{model.id}</span>
                    </span>
                  </label>

                  <div className="tab-model-row-meta">
                    <input
                      type="text"
                      value={selection?.alias ?? ""}
                      placeholder="Optional alias"
                      onChange={(event) => updateAlias(model.id, event.target.value)}
                      className="config-input tab-model-alias-input"
                    />
                    <div className="tab-model-drag-handle" title="Drag to reorder selected models">
                      <GripVertical size={16} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function SamplingModal({
  pluginName,
  defaults,
  form,
  onChange,
  onClose,
  onSubmit
}: {
  pluginName: string;
  defaults: GenerationRequest;
  form: SamplingFormState;
  onChange: (form: SamplingFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const hasPackDefaults = Object.values(defaults).some((value) => value !== undefined);

  return (
    <Modal
      title="Scenario Pack Samplings"
      subtitle={`Configure request sampling overrides for ${pluginName}. Leave fields blank to use the scenario pack defaults, and BenchLocal will omit values that are still unset.`}
      onClose={onClose}
      onSubmit={onSubmit}
      submitLabel="Save Samplings"
      size="wide"
      leadingActions={
        <button
          type="button"
          onClick={() => onChange(createSamplingForm())}
          className="ghost-button"
        >
          <RotateCcw size={14} />
          Reset Overrides
        </button>
      }
    >
      {hasPackDefaults ? (
        <div className="helper-copy">
          <p>
            Scenario pack defaults:
            {" "}
            {SAMPLING_FIELDS.map((field) => {
              const value = defaults[field.key as keyof GenerationRequest];
              return value === undefined ? null : (
                <span key={field.key} className="settings-inline-meta">
                  <strong>{field.label}:</strong> {value}
                </span>
              );
            }).filter(Boolean).reduce<ReactNode[]>((items, item, index) => {
              if (index > 0) {
                items.push(<span key={`sep-${index}`}> · </span>);
              }
              items.push(item);
              return items;
            }, [])}
          </p>
        </div>
      ) : (
        <div className="helper-copy">
          <p>This scenario pack does not define recommended defaults yet. Blank fields mean BenchLocal will not send those sampling values.</p>
        </div>
      )}
      <div className="entry-grid two-col">
        {SAMPLING_FIELDS.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            value={form[field.key]}
            placeholder={defaults[field.key as keyof GenerationRequest] === undefined ? field.placeholder : `Default: ${defaults[field.key as keyof GenerationRequest]}`}
            onChange={(value) => onChange({
              ...form,
              [field.key]: value
            })}
          />
        ))}
      </div>
    </Modal>
  );
}

function EmptyWorkspace({
  hasInstalledScenarioPacks,
  onSelectScenarioPack
}: {
  hasInstalledScenarioPacks: boolean;
  onSelectScenarioPack?: () => void;
}) {
  return (
    <section className="empty-workspace">
      <div className="empty-workspace-card benchmark-empty-card">
        <div className="benchmark-empty-icon">
          <FolderOpen size={22} />
        </div>
        <p className="eyebrow">No Active Scenario Pack</p>
        <h3 className="panel-title">Select a scenario pack to open its workspace</h3>
        <p className="section-copy" style={{ marginTop: "12px", maxWidth: "52ch" }}>
          Install official scenario packs from Settings, then use the pack picker in the toolbar to open them here. BenchLocal keeps providers, models, and shared parameters in one place while each scenario pack owns its scenarios and scoring.
        </p>
        {hasInstalledScenarioPacks && onSelectScenarioPack ? (
          <button type="button" onClick={onSelectScenarioPack} className="primary-button" style={{ marginTop: "18px" }}>
            <FolderOpen size={16} />
            Select Scenario Pack
          </button>
        ) : null}
      </div>
    </section>
  );
}

function DetachedLogsWindow() {
  const [state, setState] = useState<DetachedLogsState>({
    workspaceName: "No Workspace",
    tabTitle: "No Active Tab",
    eventCount: 0,
    events: []
  });
  const [autoScroll, setAutoScroll] = useState(true);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : false
  );
  const [themeDefinition, setThemeDefinition] = useState<BenchLocalThemeDefinition | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const appliedThemeKeysRef = useRef<string[]>([]);

  useEffect(() => {
    return window.benchlocal.logs.onDetachedState((nextState) => {
      setState(nextState);
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      setSystemPrefersDark(media.matches);
    };

    handleChange();
    media.addEventListener("change", handleChange);

    return () => {
      media.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadTheme = async () => {
      const configResult = await window.benchlocal.config.load();
      const requestedThemeId = configResult.config.ui.theme === "system"
        ? systemPrefersDark
          ? "dark"
          : "light"
        : configResult.config.ui.theme;
      const nextTheme = await window.benchlocal.themes.load({ themeId: requestedThemeId });

      if (!cancelled) {
        setThemeDefinition(nextTheme);
      }
    };

    void loadTheme();

    return () => {
      cancelled = true;
    };
  }, [systemPrefersDark]);

  useEffect(() => {
    if (!themeDefinition || typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;

    for (const key of appliedThemeKeysRef.current) {
      root.style.removeProperty(key);
    }

    for (const [key, value] of Object.entries(themeDefinition.variables)) {
      root.style.setProperty(key, value);
    }

    appliedThemeKeysRef.current = Object.keys(themeDefinition.variables);
    root.style.setProperty("color-scheme", themeDefinition.colorScheme);
    root.dataset.theme = themeDefinition.id;
  }, [themeDefinition]);

  useEffect(() => {
    if (!autoScroll || !logContainerRef.current) {
      return;
    }

    logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
  }, [state, autoScroll]);

  useEffect(() => {
    document.title = `Run Logs - ${state.workspaceName} - ${state.tabTitle}`;
  }, [state.workspaceName, state.tabTitle]);

  return (
    <div className="detached-logs-shell">
      <header className="detached-logs-header">
        <div>
          <h2 className="detached-logs-title">{state.workspaceName} · {state.tabTitle}</h2>
        </div>
        <div className="section-actions">
          <label className="drawer-toggle">
            <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
            <span>Auto Scroll</span>
          </label>
          <span className="status-chip status-idle">{state.eventCount} events</span>
          <button
            type="button"
            className="toolbar-icon-button"
            aria-label="Close window"
            title="Close window"
            onClick={() => void window.benchlocal.logs.closeDetachedWindow()}
          >
            <X size={14} />
          </button>
        </div>
      </header>

      {state.events.length > 0 ? (
        <div ref={logContainerRef} className="detached-logs-trail">
          {state.events.map((event, index) => (
            <div key={`${event.type}-${index}`} className="event-row">
              <span className="event-type">{event.type}</span>
              <span className="event-payload"> {JSON.stringify(event)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="detached-logs-empty">No run logs are being streamed yet.</div>
      )}
    </div>
  );
}

function SettingsScene({
  settingsTab,
  setSettingsTab,
  draft,
  loadState,
  hasUnsavedChanges,
  isBusy,
  providerIds,
  pluginInspections,
  registryEntries,
  scenarioPackMutations,
  verifierStatuses,
  onBack,
  onSave,
  onReset,
  onCreateProvider,
  onEditProvider,
  onCreateModel,
  onEditModel,
  onStartVerifier,
  onStopVerifier,
  onRefreshRegistry,
  onInstallScenarioPack,
  onUpdateScenarioPack,
  onUninstallScenarioPack,
  updateDraft
}: {
  settingsTab: SettingsTab;
  setSettingsTab: (tab: SettingsTab) => void;
  draft: BenchLocalConfig;
  loadState: LoadState | null;
  hasUnsavedChanges: boolean;
  isBusy: boolean;
  providerIds: string[];
  pluginInspections: PluginInspection[];
  registryEntries: ScenarioPackRegistryEntry[];
  scenarioPackMutations: Record<string, ScenarioPackMutationState>;
  verifierStatuses: Record<string, PluginVerifierStatus>;
  onBack: () => void;
  onSave: () => void;
  onReset: () => void;
  onCreateProvider: () => void;
  onEditProvider: (providerId: string) => void;
  onCreateModel: () => void;
  onEditModel: (index: number) => void;
  onStartVerifier: (pluginId: string) => Promise<void>;
  onStopVerifier: (pluginId: string) => Promise<void>;
  onRefreshRegistry: () => void;
  onInstallScenarioPack: (pluginId: string) => void;
  onUpdateScenarioPack: (pluginId: string) => void;
  onUninstallScenarioPack: (pluginId: string) => void;
  updateDraft: (updater: (current: BenchLocalConfig) => BenchLocalConfig) => void;
}) {
  return (
    <section className="settings-scene">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-header">
          <button type="button" onClick={onBack} className="settings-back-button">
            <ChevronLeft size={16} />
            Back to Main Scene
          </button>
          <div className="settings-sidebar-title-block">
            <p className="eyebrow">Settings</p>
            <h2 className="settings-sidebar-title">Preferences</h2>
          </div>
        </div>

        <div className="settings-sidebar-group">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSettingsTab(tab.id)}
              className={`settings-sidebar-item${settingsTab === tab.id ? " is-active" : ""}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {hasUnsavedChanges ? (
          <div className="settings-sidebar-footer">
            <button
              type="button"
              onClick={onReset}
              disabled={isBusy}
              className="ghost-button settings-scene-action"
            >
              <RotateCcw size={14} />
              Reset
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={isBusy}
              className="primary-button settings-scene-action"
            >
              <Save size={14} />
              Save
            </button>
          </div>
        ) : null}
      </aside>

      <div className="settings-scene-content">
        <div className="settings-body settings-body-scene">
            {settingsTab === "providers" ? (
              <ProvidersView
                providers={draft.providers}
                models={draft.models}
                onCreate={onCreateProvider}
                onEdit={onEditProvider}
              />
            ) : null}

            {settingsTab === "models" ? (
              <ModelsView
                models={draft.models}
                providerIds={providerIds}
                onCreate={onCreateModel}
                onEdit={onEditModel}
              />
            ) : null}

            {settingsTab === "plugins" ? (
              <ScenarioPackRegistryView
                draft={draft}
                inspections={pluginInspections}
                registryEntries={registryEntries}
                scenarioPackMutations={scenarioPackMutations}
                onRefresh={onRefreshRegistry}
                onInstall={onInstallScenarioPack}
                onUpdate={onUpdateScenarioPack}
                onUninstall={onUninstallScenarioPack}
              />
            ) : null}

            {settingsTab === "verification" ? (
              <VerificationView
                draft={draft}
                statuses={verifierStatuses}
                onUpdate={(pluginId, verifierId, updater) =>
                  updateDraft((current) => {
                    current.plugins[pluginId].verifiers![verifierId] = updater(current.plugins[pluginId].verifiers![verifierId]);
                    return current;
                  })
                }
                onStart={async (pluginId) => {
                  await onStartVerifier(pluginId);
                }}
                onStop={async (pluginId) => {
                  await onStopVerifier(pluginId);
                }}
              />
            ) : null}

            {settingsTab === "advanced" ? (
              <section className="advanced-grid">
                <Panel title="Filesystem" subtitle="BenchLocal-owned storage paths and config location." tone="sky" icon={<FolderOpen size={16} />}>
                  <Field label="Config File" value={loadState?.path ?? ""} readOnly onChange={() => undefined} />
                  <Field label="Run Storage" value={draft.run_storage_dir} onChange={(value) => updateDraft((current) => {
                    current.run_storage_dir = value;
                    return current;
                  })} />
                  <Field label="Scenario Pack Storage" value={draft.plugin_storage_dir} onChange={(value) => updateDraft((current) => {
                    current.plugin_storage_dir = value;
                    return current;
                  })} />
                  <Field label="Log Storage" value={draft.log_storage_dir} onChange={(value) => updateDraft((current) => {
                    current.log_storage_dir = value;
                    return current;
                  })} />
                  <Field label="Cache Storage" value={draft.cache_dir} onChange={(value) => updateDraft((current) => {
                    current.cache_dir = value;
                    return current;
                  })} />
                  <div className="helper-copy">
                    <p>Durable settings live in <strong>config.toml</strong>.</p>
                  </div>
                </Panel>
                <Panel title="Registry" subtitle="Official registry source for scenario pack installs." tone="orange" icon={<Settings2 size={16} />}>
                  <Field label="Official Registry URL" value={draft.registry.official_url} onChange={(value) => updateDraft((current) => {
                    current.registry.official_url = value;
                    return current;
                  })} />
                  <div className="helper-copy">
                    <p>Custom theme JSON files can be added under <strong>~/.benchlocal/themes/</strong>.</p>
                  </div>
                </Panel>
              </section>
            ) : null}
        </div>
      </div>
    </section>
  );
}

function ProvidersView({
  providers,
  models,
  onCreate,
  onEdit
}: {
  providers: Record<string, BenchLocalProviderConfig>;
  models: BenchLocalModelConfig[];
  onCreate: () => void;
  onEdit: (providerId: string) => void;
}) {
  const providerIds = Object.keys(providers);

  return (
    <Panel
      title="Provider Registry"
      subtitle="Provider endpoints, credentials, and activation state shared across all scenario packs."
      tone="sky"
      icon={<Server size={16} />}
      actions={
        <button type="button" onClick={onCreate} className="primary-button"><Plus size={14} />Add Provider</button>
      }
    >
      <div className="settings-list-table-wrap">
        <table className="settings-list-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Type</th>
              <th>Status</th>
              <th>Base URL</th>
              <th>Models</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {providerIds.map((providerId) => {
              const provider = providers[providerId];
              const linkedModels = models.filter((model) => model.provider === providerId).length;

              return (
                <tr key={providerId}>
                  <td>
                    <div className="settings-row-primary">{provider.name}</div>
                  </td>
                  <td>
                    <div className="settings-row-secondary">{providerKindLabel(provider.kind)}</div>
                  </td>
                  <td>
                    <span className={`status-chip ${provider.enabled ? "status-ready" : "status-inactive"}`}>
                      {provider.enabled ? "active" : "inactive"}
                    </span>
                  </td>
                  <td className="settings-mono-cell">{provider.base_url}</td>
                  <td>{linkedModels}</td>
                  <td>
                    <div className="settings-table-actions">
                      <button type="button" onClick={() => onEdit(providerId)} className="ghost-button ghost-button-compact"><Pencil size={14} />Edit</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ModelsView({
  models,
  providerIds,
  onCreate,
  onEdit
}: {
  models: BenchLocalModelConfig[];
  providerIds: string[];
  onCreate: () => void;
  onEdit: (index: number) => void;
}) {
  return (
    <Panel
      title="Shared Model Registry"
      subtitle="Model labels, provider mapping, and activation state available across all scenario packs."
      tone="orange"
      icon={<Bot size={16} />}
      actions={
        <button
          type="button"
          onClick={onCreate}
          disabled={providerIds.length === 0}
          className="primary-button"
        >
          <Plus size={14} />
          Add Model
        </button>
      }
    >
      <div className="settings-list-table-wrap">
        <table className="settings-list-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Status</th>
              <th>Provider</th>
              <th>Model</th>
              <th>Group</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model, index) => (
              <tr key={`${model.id}-${index}`}>
                <td>
                  <div className="settings-row-primary">{model.label}</div>
                  <div className="settings-row-secondary settings-mono-cell">{model.id}</div>
                </td>
                <td>
                  <span className={`status-chip ${model.enabled ? "status-ready" : "status-inactive"}`}>
                    {model.enabled ? "active" : "inactive"}
                  </span>
                </td>
                <td>{model.provider}</td>
                <td className="settings-mono-cell">{model.model}</td>
                <td>{model.group}</td>
                <td>
                  <div className="settings-table-actions">
                    <button type="button" onClick={() => onEdit(index)} className="ghost-button ghost-button-compact"><Pencil size={14} />Edit</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ScenarioPackRegistryView({
  draft,
  inspections,
  registryEntries,
  scenarioPackMutations,
  onRefresh,
  onInstall,
  onUpdate,
  onUninstall
}: {
  draft: BenchLocalConfig;
  inspections: PluginInspection[];
  registryEntries: ScenarioPackRegistryEntry[];
  scenarioPackMutations: Record<string, ScenarioPackMutationState>;
  onRefresh: () => void;
  onInstall: (pluginId: string) => void;
  onUpdate: (pluginId: string) => void;
  onUninstall: (pluginId: string) => void;
}) {
  const inspectionsById = Object.fromEntries(inspections.map((inspection) => [inspection.id, inspection]));
  const unlistedInstalledIds = Object.keys(draft.plugins).filter(
    (pluginId) => !registryEntries.some((entry) => entry.id === pluginId)
  );
  const rows = [
    ...registryEntries.map((entry) => {
      const installed = draft.plugins[entry.id];
      const inspection = inspectionsById[entry.id];
      const mutation = scenarioPackMutations[entry.id];
      const updateAvailable =
        Boolean(installed) &&
        (installed?.version !== entry.version ||
          (entry.source.type === "github" ? installed?.ref !== entry.source.tag : false));

      return {
        id: entry.id,
        name: entry.name,
        description: entry.description ?? "No description provided.",
        version: entry.version,
        installed: Boolean(installed),
        status: installed ? inspection?.status ?? "not_installed" : "not_installed",
        mutation,
        updateAvailable,
        isRegistryEntry: true
      } as const;
    }),
    ...unlistedInstalledIds.map((pluginId) => {
      const installed = draft.plugins[pluginId];
      const inspection = inspectionsById[pluginId];
      const mutation = scenarioPackMutations[pluginId];

      return {
        id: pluginId,
        name: inspection?.manifest?.name ?? pluginId,
        description: "Installed, but not listed in the official registry.",
        version: installed?.version ?? "unknown",
        installed: true,
        status: inspection?.status ?? "not_installed",
        mutation,
        updateAvailable: false,
        isRegistryEntry: false
      } as const;
    })
  ];

  return (
    <Panel
      title="Scenario Pack Registry"
      subtitle="Install and remove official scenario packs from the BenchLocal registry."
      tone="sky"
      icon={<PlugZap size={16} />}
      actions={<button type="button" onClick={onRefresh} className="ghost-button"><RotateCcw size={14} />Refresh Registry</button>}
    >
      <div className="settings-list-table-wrap">
        <table className="settings-list-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Description</th>
              <th>Version</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <div className="settings-row-secondary">No scenario packs are available in the registry.</div>
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isMutating = Boolean(row.mutation);
                return (
                  <tr key={row.id}>
                    <td>
                      <div className="settings-row-primary settings-nowrap-cell">{row.name}</div>
                    </td>
                    <td>{row.description}</td>
                    <td>
                      <div className="settings-table-actions settings-table-actions-inline">
                        <span>v{row.version}</span>
                        {row.installed && row.isRegistryEntry && row.updateAvailable ? (
                          <button
                            type="button"
                            onClick={() => onUpdate(row.id)}
                            className="ghost-button ghost-button-compact"
                            disabled={isMutating}
                          >
                            {row.mutation?.action === "update" ? <LoaderCircle size={14} className="spinner" /> : <RotateCcw size={14} />}
                            {row.mutation?.action === "update" ? scenarioPackMutationLabel(row.mutation) : "Upgrade"}
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span className={`status-chip ${row.installed ? statusClasses(row.status as PluginInspection["status"]) : "status-idle"}`}>
                        {row.mutation ? scenarioPackMutationLabel(row.mutation) : row.installed ? row.status.replaceAll("_", " ") : "available"}
                      </span>
                    </td>
                    <td>
                      <div className="settings-table-actions">
                        {row.installed ? (
                          <>
                            <button
                              type="button"
                              onClick={() => onUninstall(row.id)}
                              className="ghost-button ghost-button-compact"
                              disabled={isMutating}
                            >
                              {row.mutation?.action === "uninstall" ? <LoaderCircle size={14} className="spinner" /> : <Trash2 size={14} />}
                              {row.mutation?.action === "uninstall" ? scenarioPackMutationLabel(row.mutation) : "Uninstall"}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onInstall(row.id)}
                            className="primary-button"
                            disabled={isMutating}
                          >
                            {row.mutation?.action === "install" ? <LoaderCircle size={14} className="spinner" /> : <Plus size={14} />}
                            {row.mutation?.action === "install" ? scenarioPackMutationLabel(row.mutation) : "Install"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function verifierModeLabel(mode: BenchLocalVerifierConfig["mode"]): string {
  switch (mode) {
    case "cloud":
      return "BenchLocal Cloud";
    case "custom_url":
      return "Custom URL";
    case "docker":
    default:
      return "Local Docker";
  }
}

function VerificationView({
  draft,
  statuses,
  onUpdate,
  onStart,
  onStop
}: {
  draft: BenchLocalConfig;
  statuses: Record<string, PluginVerifierStatus>;
  onUpdate: (pluginId: string, verifierId: string, updater: (verifier: BenchLocalVerifierConfig) => BenchLocalVerifierConfig) => void;
  onStart: (pluginId: string) => Promise<void>;
  onStop: (pluginId: string) => Promise<void>;
}) {
  const verificationEntries = Object.entries(draft.plugins).filter(([pluginId]) => {
    const status = statuses[pluginId];
    return Boolean(status && status.verifiers.length > 0);
  });

  const rows = verificationEntries.flatMap(([pluginId, plugin]) => {
    const status = statuses[pluginId];
    const inspectionName = status?.pluginName ?? pluginId;

    return Object.entries(plugin.verifiers ?? {}).map(([verifierId, verifier]) => {
      const runtime = status?.verifiers.find((entry) => entry.id === verifierId);
      return {
        pluginId,
        pluginName: inspectionName,
        verifierId,
        verifier,
        runtime,
        docker: status?.docker
      };
    });
  });

  return (
    <Panel
      title="Verification Runtimes"
      subtitle="BenchLocal manages required verifier runtimes automatically through Local Docker."
      tone="orange"
      icon={<Wrench size={16} />}
    >
      <div className="settings-list-table-wrap">
        <table className="settings-list-table">
          <thead>
            <tr>
              <th>Scenario Pack</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Endpoint</th>
              <th>Auto Start</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <div className="settings-row-secondary">No installed scenario packs currently require a verifier.</div>
                </td>
              </tr>
            ) : (
              rows.map(({ pluginId, pluginName, verifierId, verifier, runtime, docker }) => (
                <tr key={`${pluginId}:${verifierId}`}>
                  <td>
                    <div className="settings-row-primary settings-nowrap-cell">{pluginName}</div>
                  </td>
                  <td>
                    <InlineSelectField
                      label=""
                      value={verifier.mode === "docker" ? verifier.mode : "docker"}
                      options={[
                        { value: "docker", label: verifierModeLabel("docker") },
                        { value: "cloud", label: `${verifierModeLabel("cloud")} (Soon)`, disabled: true },
                        { value: "custom_url", label: `${verifierModeLabel("custom_url")} (Soon)`, disabled: true }
                      ]}
                      onChange={(value) =>
                        onUpdate(pluginId, verifierId, (current) => ({
                          ...current,
                          mode: value as BenchLocalVerifierConfig["mode"]
                        }))
                      }
                    />
                  </td>
                  <td>
                    <span className={`status-chip ${
                      runtime?.status === "running"
                        ? "status-ready"
                        : runtime?.status === "missing_dependency"
                          ? "status-not-installed"
                          : runtime?.status === "failed"
                            ? "status-danger"
                            : "status-idle"
                    }`}>
                      {(runtime?.status ?? "stopped").replaceAll("_", " ")}
                    </span>
                  </td>
                  <td>
                    <div className="settings-row-secondary">
                      {runtime?.url ?? "Managed by BenchLocal"}
                    </div>
                    <div className="settings-row-secondary">
                      Docker: {docker?.available ? docker.details ?? "available" : "not detected"}
                    </div>
                  </td>
                  <td>
                    <div className="settings-table-checkbox-cell">
                      <input
                        type="checkbox"
                        checked={verifier.auto_start}
                        onChange={(event) =>
                          onUpdate(pluginId, verifierId, (current) => ({
                            ...current,
                            auto_start: event.target.checked
                          }))
                        }
                      />
                    </div>
                  </td>
                  <td>
                    <div className="settings-table-actions">
                      {runtime?.status === "running" ? (
                        <button type="button" onClick={() => onStop(pluginId)} className="ghost-button ghost-button-compact">
                          <Square size={14} />
                          Stop
                        </button>
                      ) : (
                        <button type="button" onClick={() => onStart(pluginId)} className="ghost-button ghost-button-compact">
                          <Play size={14} />
                          Start
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Panel({
  title,
  subtitle,
  tone,
  icon,
  actions,
  children
}: {
  title: string;
  subtitle: string;
  tone: "sky" | "orange" | "slate";
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`panel-shell settings-panel settings-panel-${tone}`}>
      <div className="panel-header">
        <div className="panel-header-main">
          <div className={`panel-icon panel-icon-${tone}`}>{icon}</div>
          <div>
            <h3 className="settings-panel-title">{title}</h3>
            <p className="section-copy settings-panel-subtitle">{subtitle}</p>
          </div>
        </div>
        {actions ? <div className="panel-header-actions">{actions}</div> : null}
      </div>
      <div className="settings-panel-body">{children}</div>
    </section>
  );
}

function DetailCard({ title, content }: { title: string; content: string }) {
  const toneClass =
    title === "What this tests"
      ? "is-blue"
      : title === "Prompt Contract"
        ? "is-amber"
        : "is-slate";

  const lines = content.split("\n");

  return (
    <article className={`detail-card ${toneClass}`}>
      <div className="detail-card-summary">
        <h4>{title}</h4>
      </div>
      <p className="detail-copy">
        {lines.map((line, lineIndex) => (
          <span key={`${title}-${lineIndex}`}>
            {line.split(/(`[^`]+`)/g).map((part, partIndex) => {
              if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
                return (
                  <code key={`${title}-${lineIndex}-${partIndex}`} className="detail-inline-code">
                    {part.slice(1, -1)}
                  </code>
                );
              }

              return <span key={`${title}-${lineIndex}-${partIndex}`}>{part}</span>;
            })}
            {lineIndex < lines.length - 1 ? <br /> : null}
          </span>
        ))}
      </p>
    </article>
  );
}

function HistoryModal({
  pluginName,
  entries,
  onClose,
  onOpenRun
}: {
  pluginName: string;
  entries: PluginRunHistoryEntry[];
  onClose: () => void;
  onOpenRun: (runId: string) => void;
}) {
  return (
    <div className="dialog-backdrop">
      <div className="dialog-shell history-dialog-shell">
        <div className="dialog-header">
          <div>
            <h3 className="dialog-title">Test Histories</h3>
            <p className="section-copy" style={{ marginTop: "12px" }}>{pluginName}</p>
          </div>
          <button type="button" onClick={onClose} className="dialog-close-button" aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>

        <div className="history-modal-body">
          <div className="settings-list-table-wrap history-table-wrap">
            <table className="settings-list-table">
              <thead>
                <tr>
                  <th>Date Time</th>
                  <th>Mode</th>
                  <th>Models</th>
                  <th>Cases</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const executionModeLabel =
                    EXECUTION_MODE_OPTIONS.find((option) => option.value === entry.executionMode)?.label ?? "Unknown";

                  return (
                    <tr key={entry.runId}>
                      <td>
                        <div className="settings-row-primary">{new Date(entry.startedAt).toLocaleString()}</div>
                      </td>
                      <td>
                        <span className="status-chip status-idle">{executionModeLabel}</span>
                      </td>
                      <td>
                        <span className="history-table-metric">{entry.modelCount}</span>
                      </td>
                      <td>
                        <span className="history-table-metric">{entry.scenarioCount}</span>
                      </td>
                      <td>
                        <span
                          className={`status-chip ${
                            entry.error ? "status-danger" : entry.cancelled ? "status-not-installed" : "status-done"
                          }`}
                        >
                          {entry.error ? "error" : entry.cancelled ? "stopped" : "completed"}
                        </span>
                      </td>
                      <td>
                        <button type="button" className="ghost-button ghost-button-compact" onClick={() => onOpenRun(entry.runId)}>
                          <RotateCcw size={14} />
                          Open
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Banner({ tone, children }: { tone: "success" | "danger" | "neutral" | "warning"; children: ReactNode }) {
  const toneClass =
    tone === "success"
      ? "banner-success"
      : tone === "danger"
        ? "banner-danger"
        : tone === "warning"
          ? "banner-warning"
          : "banner-neutral";
  return <div className={`banner ${toneClass}`}>{children}</div>;
}

function Modal({
  title,
  subtitle,
  onClose,
  onSubmit,
  submitLabel,
  submitTone = "primary",
  size = "default",
  leadingActions,
  children
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  submitTone?: "primary" | "danger";
  size?: "default" | "wide";
  leadingActions?: ReactNode;
  children?: ReactNode;
}) {
  const hasBody = Boolean(children);
  const hasSubtitle = Boolean(subtitle?.trim());
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const submitButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      const dialog = dialogRef.current;

      if (!dialog) {
        return;
      }

      if (activeElement instanceof HTMLElement && dialog.contains(activeElement)) {
        return;
      }

      submitButtonRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Enter" || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.isComposing) {
        return;
      }

      const target = event.target;

      if (target instanceof HTMLElement && (target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }

      event.preventDefault();
      onSubmit();
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, onSubmit]);

  return (
    <div className="dialog-backdrop">
      <div ref={dialogRef} className={`dialog-shell${size === "wide" ? " dialog-shell-wide" : ""}`} tabIndex={-1}>
        <div className={`dialog-header${hasBody ? "" : " dialog-header-compact"}`}>
          <div>
            <h3 className="dialog-title">{title}</h3>
            {hasSubtitle ? <p className="section-copy" style={{ marginTop: "12px" }}>{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="dialog-close-button" aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>

        {hasBody ? <div style={{ marginTop: "20px", display: "grid", gap: "16px" }}>{children}</div> : null}

        <div className={`modal-actions${hasBody ? "" : " modal-actions-compact"}`}>
          <div className="modal-actions-leading">{leadingActions}</div>
          <button
            ref={submitButtonRef}
            type="button"
            onClick={onSubmit}
            className={submitTone === "danger" ? "button-danger" : "primary-button"}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  readOnly = false,
  className = ""
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  readOnly?: boolean;
  className?: string;
}) {
  return (
    <label className={`field-block${label ? "" : " field-block-no-label"}${className ? ` ${className}` : ""}`}>
      {label ? <span className="field-label">{label}</span> : null}
      <input
        type={type}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="config-input"
      />
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-row">
      <span className="toggle-label">{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
    </label>
  );
}

function FieldToggle({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="field-block">
      <span className="field-label">{label}</span>
      <span className="field-toggle">
        <span className="toggle-label">{checked ? "Enabled" : "Disabled"}</span>
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
      </span>
    </label>
  );
}

function InlineSelectField({
  label,
  value,
  options,
  getOptionLabel,
  onChange
}: {
  label: string;
  value: string;
  options: Array<string | { value: string; label?: string; disabled?: boolean }>;
  getOptionLabel?: (value: string) => string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={`field-block${label ? "" : " field-block-no-label"}`}>
      {label ? <span className="field-label">{label}</span> : null}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="config-input"
      >
        {options.map((option) => {
          const value = typeof option === "string" ? option : option.value;
          const label = typeof option === "string" ? (getOptionLabel ? getOptionLabel(option) : option) : option.label ?? option.value;
          const disabled = typeof option === "string" ? false : Boolean(option.disabled);

          return (
            <option key={value} value={value} disabled={disabled}>
              {label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function statusClasses(status: PluginInspection["status"]): string {
  switch (status) {
    case "ready":
      return "status-ready";
    case "not_installed":
      return "status-not-installed";
    case "manifest_missing":
    case "entry_missing":
      return "status-entry-missing";
    case "invalid_manifest":
    case "load_error":
      return "status-load-error";
  }
}
