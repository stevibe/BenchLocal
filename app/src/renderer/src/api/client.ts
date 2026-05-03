const BASE = "/api";

async function api<T = any>(
	method: string,
	path: string,
	body?: unknown,
): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		method,
		headers: body ? { "Content-Type": "application/json" } : {},
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`API ${res.status}: ${text}`);
	}
	return res.json() as T;
}

export const bl = {
	config: {
		load: () => api("GET", "/config"),
		save: (c: any) => api("PUT", "/config", { config: c }),
	},
	workspaces: {
		load: () => api("GET", "/workspaces"),
		save: (s: any) => api("PUT", "/workspaces", { state: s }),
		export: (id: string, state: any) =>
			api("POST", "/workspaces/export", { workspaceId: id, state }),
		import: (data: any) => api("POST", "/workspaces/import", data),
	},
	benchPacks: {
		list: () => api("GET", "/benchpacks"),
		registry: () => api("GET", "/benchpacks/registry"),
		install: (id: string) => api("POST", `/benchpacks/${id}/install`),
		installFromUrl: (url: string) =>
			api("POST", "/benchpacks/install-from-url", { url }),
		update: (id: string) => api("POST", `/benchpacks/${id}/update`),
		uninstall: (id: string) => api("POST", `/benchpacks/${id}/uninstall`),
		activeRuns: () => api("GET", "/benchpacks/active-runs"),
		run: (input: any) => api("POST", "/benchpacks/run", input),
		retryScenario: (input: any) =>
			api("POST", "/benchpacks/retry-scenario", input),
		resumeRun: (input: any) => api("POST", "/benchpacks/resume-run", input),
		stop: (tabId: string) => api("POST", "/benchpacks/stop", { tabId }),
		history: (id: string) => api("GET", `/benchpacks/${id}/history`),
		loadHistory: (id: string, runId: string) =>
			api("GET", `/benchpacks/${id}/history/${runId}`),
		clearHistory: (id: string) =>
			api("POST", `/benchpacks/${id}/history/clear`),
		// Stubs for Electron IPC event listeners (replaced by SSE in web mode)
		onRunEvent: (listener: (payload: any) => void) => () => {},
		onMutationProgress: (listener: (payload: any) => void) => () => {},
	},
	verifiers: {
		list: () => api("GET", "/verifiers"),
		start: (id: string) => api("POST", "/verifiers/start", { benchPackId: id }),
		stop: (id: string) => api("POST", "/verifiers/stop", { benchPackId: id }),
		cancelStart: (id: string) =>
			api("POST", "/verifiers/cancel-start", { benchPackId: id }),
		deleteImage: (benchPackId: string, verifierId: string) =>
			api("POST", "/verifiers/delete-image", { benchPackId, verifierId }),
		onProgress: (listener: (payload: any) => void) => () => {},
	},
	themes: {
		list: () => api("GET", "/themes"),
		load: (id: string) => api("GET", `/themes/${id}`),
	},
	models: {
		discover: (provider: any) => api("POST", "/models/discover", { provider }),
	},
	app: {
		metadata: () => api("GET", "/metadata"),
		// Stubs for Electron IPC (not available in web mode)
		onOpenAbout: (listener: () => void) => () => {},
		onOpenSettings: (listener: () => void) => () => {},
	},
	updates: {
		state: () =>
			Promise.resolve({
				status: "unsupported" as const,
				currentVersion: "0.0.0",
			} as any),
		check: () =>
			Promise.resolve({
				status: "unsupported" as const,
				currentVersion: "0.0.0",
			} as any),
		install: () => Promise.resolve({ started: false }),
		onState: (listener: (state: any) => void) => () => {},
	},
	logs: {
		closeDetachedWindow: () => Promise.resolve({ closed: false }),
		openDetachedWindow: () => Promise.resolve({ opened: false }),
		publishDetachedState: (_state: any) => Promise.resolve(),
		onDetachedState: (listener: (state: any) => void) => () => {},
		onDetachedWindowClosed: (listener: () => void) => () => {},
	},
	// SSE connection
	sse: () => new EventSource(`${BASE}/events/sse`),
} as const;
