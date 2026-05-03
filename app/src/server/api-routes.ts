import {
	clearRunHistoryForBenchPack,
	deleteConfiguredBenchPackVerifierImage,
	getConfiguredBenchPackVerifierStatus,
	inspectConfiguredBenchPacks,
	installBenchPackFromRegistry,
	installBenchPackFromUrl,
	listRunHistoryForBenchPack,
	loadBenchPackRegistry,
	loadRunSummaryForBenchPack,
	resumeBenchPackRun,
	retryScenarioForBenchPackRun,
	runConfiguredBenchPack,
	startConfiguredBenchPackVerifiers,
	stopConfiguredBenchPackVerifiers,
	uninstallBenchPack,
	updateBenchPackFromRegistry,
} from "@benchlocal/benchpack-host";
import {
	getConfigPath,
	getWorkspaceStatePath,
	loadOrCreateConfig,
	loadOrCreateWorkspaceState,
	saveConfigFile,
	saveWorkspaceStateFile,
} from "@benchlocal/core";
import type { FastifyInstance } from "fastify";
import { loadAppMetadata } from "./app-metadata";
import { discoverProviderModels } from "./models";
import { activeRunManager } from "./run-manager";
import { sseBus } from "./sse-bus";
import { listAvailableThemes, loadAvailableTheme } from "./themes";

async function compat() {
	const meta = await loadAppMetadata();
	return { benchLocalVersion: meta.version };
}

export function registerApiRoutes(server: FastifyInstance) {
	const api = server;

	// --- metadata ---
	api.get("/api/metadata", () => loadAppMetadata());

	// --- config ---
	api.get("/api/config", async () => {
		const r = await loadOrCreateConfig();
		return { path: r.path, created: r.created, config: r.config };
	});

	api.put("/api/config", async (req: any) => {
		const saved = await saveConfigFile(
			(req.body as any).config,
			getConfigPath(),
		);
		return { path: getConfigPath(), created: false, config: saved };
	});

	// --- workspaces ---
	api.get("/api/workspaces", async () => {
		await loadOrCreateConfig();
		const r = await loadOrCreateWorkspaceState(getWorkspaceStatePath());
		return { path: r.path, created: r.created, state: r.state };
	});

	api.put("/api/workspaces", async (req: any) => {
		await loadOrCreateConfig();
		const saved = await saveWorkspaceStateFile(
			(req.body as any).state,
			getWorkspaceStatePath(),
		);
		return { path: getWorkspaceStatePath(), created: false, state: saved };
	});

	// --- workspaces: export (file download) ---
	api.post("/api/workspaces/export", async (req, reply) => {
		const { workspaceId, state } = req.body as any;
		const workspace = state.workspaces[workspaceId];
		if (!workspace) throw new Error(`Workspace "${workspaceId}" not found.`);

		const tabs = Object.fromEntries(
			workspace.tabIds
				.map((id: string) => state.tabs[id])
				.filter(Boolean)
				.map((tab: any) => [tab.id, tab]),
		);

		const name =
			(workspace.name.replace(/[^a-z0-9.-]/gi, "-") || "workspace") +
			".benchlocal-workspace.json";

		reply.header("Content-Disposition", `attachment; filename="${name}"`);
		reply.header("Content-Type", "application/json");
		return {
			schemaVersion: 1,
			exportedAt: new Date().toISOString(),
			workspace,
			tabs,
		};
	});

	// --- workspaces: import (file upload) ---
	api.post("/api/workspaces/import", async (req: any) => {
		const data = req.body as any;
		if (!data.workspace || !data.tabs) {
			throw new Error("Import file is missing workspace or tab data.");
		}
		return { imported: true, workspace: data.workspace, tabs: data.tabs };
	});

	// --- bench packs ---
	api.get("/api/benchpacks", async () => {
		const { config } = await loadOrCreateConfig();
		return inspectConfiguredBenchPacks(config, await compat());
	});

	api.get("/api/benchpacks/registry", async () => {
		const { config } = await loadOrCreateConfig();
		return loadBenchPackRegistry(config);
	});

	api.post("/api/benchpacks/:benchPackId/install", async (req: any) => {
		const { config } = await loadOrCreateConfig();
		const saved = await installBenchPackFromRegistry(
			config,
			(req.params as any).benchPackId,
			(p) => sseBus.emit("benchpack-mutation-progress", p),
			await compat(),
		);
		return { path: getConfigPath(), created: false, config: saved };
	});

	api.post("/api/benchpacks/install-from-url", async (req: any) => {
		const { config } = await loadOrCreateConfig();
		const saved = await installBenchPackFromUrl(
			config,
			(req.body as any).url,
			(p) => sseBus.emit("benchpack-mutation-progress", p),
			await compat(),
		);
		return { path: getConfigPath(), created: false, config: saved };
	});

	api.post("/api/benchpacks/:benchPackId/update", async (req: any) => {
		const { config } = await loadOrCreateConfig();
		const saved = await updateBenchPackFromRegistry(
			config,
			(req.params as any).benchPackId,
			(p) => sseBus.emit("benchpack-mutation-progress", p),
			await compat(),
		);
		return { path: getConfigPath(), created: false, config: saved };
	});

	api.post("/api/benchpacks/:benchPackId/uninstall", async (req: any) => {
		const { config } = await loadOrCreateConfig();
		const saved = await uninstallBenchPack(
			config,
			(req.params as any).benchPackId,
			(p) => sseBus.emit("benchpack-mutation-progress", p),
		);
		return { path: getConfigPath(), created: false, config: saved };
	});

	// --- active runs ---
	api.get("/api/benchpacks/active-runs", () => activeRunManager.listActive());

	// --- run ---
	api.post("/api/benchpacks/run", async (req: any) => {
		const input = req.body as any;
		const { config } = await loadOrCreateConfig();
		const controller = new AbortController();
		activeRunManager.setActive(input.tabId, {
			benchPackId: input.benchPackId,
			controller,
		});

		try {
			return await runConfiguredBenchPack(
				config,
				input.benchPackId,
				{
					modelIds: input.modelIds,
					executionMode: input.executionMode,
					generation: input.generation,
					abortSignal: controller.signal,
					onEvent: (event) =>
						sseBus.emit("run-event", { tabId: input.tabId, event }),
				},
				await compat(),
			);
		} finally {
			activeRunManager.clearActive(input.tabId);
		}
	});

	// --- retry scenario ---
	api.post("/api/benchpacks/retry-scenario", async (req: any) => {
		const input = req.body as any;
		const { config } = await loadOrCreateConfig();
		return retryScenarioForBenchPackRun(
			config,
			input.benchPackId,
			{
				runId: input.runId,
				scenarioId: input.scenarioId,
				modelId: input.modelId,
				generation: input.generation,
				onEvent: (event) =>
					sseBus.emit("run-event", { tabId: input.tabId, event }),
			},
			await compat(),
		);
	});

	// --- resume run ---
	api.post("/api/benchpacks/resume-run", async (req: any) => {
		const input = req.body as any;
		const { config } = await loadOrCreateConfig();
		const controller = new AbortController();
		activeRunManager.setActive(input.tabId, {
			benchPackId: input.benchPackId,
			controller,
		});

		try {
			return await resumeBenchPackRun(
				config,
				input.benchPackId,
				{
					runId: input.runId,
					executionMode: input.executionMode,
					generation: input.generation,
					abortSignal: controller.signal,
					onEvent: (event) =>
						sseBus.emit("run-event", { tabId: input.tabId, event }),
				},
				await compat(),
			);
		} finally {
			activeRunManager.clearActive(input.tabId);
		}
	});

	// --- stop ---
	api.post("/api/benchpacks/stop", async (req: any) => {
		const { tabId } = req.body as any;
		const active = activeRunManager.getActive(tabId);
		if (!active) return { stopped: false };
		active.controller.abort(new Error("Run cancelled by user."));
		return { stopped: true };
	});

	// --- history ---
	api.get("/api/benchpacks/:benchPackId/history", async (req: any) => {
		const { config } = await loadOrCreateConfig();
		return listRunHistoryForBenchPack(config, (req.params as any).benchPackId);
	});

	api.get("/api/benchpacks/:benchPackId/history/:runId", async (req: any) => {
		const { config } = await loadOrCreateConfig();
		return loadRunSummaryForBenchPack(
			config,
			(req.params as any).benchPackId,
			(req.params as any).runId,
		);
	});

	api.post("/api/benchpacks/:benchPackId/history/clear", async (req: any) => {
		const { config } = await loadOrCreateConfig();
		return clearRunHistoryForBenchPack(config, (req.params as any).benchPackId);
	});

	// --- verifiers ---
	api.get("/api/verifiers", async () => {
		const { config } = await loadOrCreateConfig();
		const inspections = await inspectConfiguredBenchPacks(
			config,
			await compat(),
		);
		const relevant = inspections.filter(
			(i) =>
				i.manifest?.capabilities.verification ||
				i.manifest?.capabilities.sidecars,
		);
		return Promise.all(
			relevant.map((i) => getConfiguredBenchPackVerifierStatus(config, i.id)),
		);
	});

	api.post("/api/verifiers/start", async (req: any) => {
		const { config } = await loadOrCreateConfig();
		const status = await getConfiguredBenchPackVerifierStatus(
			config,
			(req.body as any).benchPackId,
		);
		return startConfiguredBenchPackVerifiers(
			config,
			(req.body as any).benchPackId,
			{
				onProgress: (p) =>
					sseBus.emit("verifier-progress", {
						benchPackId: (req.body as any).benchPackId,
						event: {
							type: "verifier_preparing",
							benchPackId: (req.body as any).benchPackId,
							benchPackName: status.benchPackName,
							verifierId: p.verifierId,
							phase: p.phase,
							message: p.message,
						},
					}),
			},
		);
	});

	api.post("/api/verifiers/stop", async (req: any) => {
		const { config } = await loadOrCreateConfig();
		return stopConfiguredBenchPackVerifiers(
			config,
			(req.body as any).benchPackId,
		);
	});

	api.post("/api/verifiers/cancel-start", async () => ({ cancelled: false }));

	api.post("/api/verifiers/delete-image", async (req: any) => {
		const { config } = await loadOrCreateConfig();
		return deleteConfiguredBenchPackVerifierImage(
			config,
			(req.body as any).benchPackId,
			(req.body as any).verifierId,
		);
	});

	// --- themes ---
	api.get("/api/themes", () => listAvailableThemes());
	api.get("/api/themes/:themeId", async (req: any) =>
		loadAvailableTheme((req.params as any).themeId),
	);

	// --- models ---
	api.post("/api/models/discover", async (req: any) =>
		discoverProviderModels((req.body as any).provider),
	);
}
