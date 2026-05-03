export class ActiveRunManager {
	private runs = new Map<
		string,
		{ benchPackId: string; controller: AbortController }
	>();

	setActive(
		tabId: string,
		run: { benchPackId: string; controller: AbortController },
	) {
		this.runs.set(tabId, run);
	}

	getActive(tabId: string) {
		return this.runs.get(tabId);
	}

	clearActive(tabId: string) {
		this.runs.delete(tabId);
	}

	listActive() {
		return Array.from(this.runs.entries()).map(([tabId, run]) => ({
			tabId,
			benchPackId: run.benchPackId,
		}));
	}

	async shutdown() {
		for (const run of this.runs.values()) {
			run.controller.abort(new Error("Server shutting down."));
		}
		this.runs.clear();
	}
}

export const activeRunManager = new ActiveRunManager();
