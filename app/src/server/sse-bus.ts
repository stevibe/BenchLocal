type Handler = (data: unknown) => void;

export class SseBus {
	private subs = new Map<string, Set<Handler>>();

	on(channel: string, handler: Handler): () => void {
		const set = this.subs.get(channel) || new Set<Handler>();
		set.add(handler);
		this.subs.set(channel, set);
		return () => set.delete(handler);
	}

	emit(channel: string, data: unknown) {
		for (const handler of this.subs.get(channel) || []) {
			handler(data);
		}
	}
}

export const sseBus = new SseBus();
