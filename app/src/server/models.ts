import type {
	BenchLocalConfig,
	BenchLocalProviderConfig,
} from "@benchlocal/core";
import type { BenchLocalDiscoveredModel } from "../shared/desktop-api";

function providerSupportsModelDiscovery(
	provider: BenchLocalProviderConfig,
): boolean {
	return (
		provider.kind === "openrouter" ||
		provider.kind === "huggingface" ||
		provider.kind === "openai_compatible"
	);
}

function providerModelsUrl(baseUrl: string): string {
	const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
	return new URL("models", normalizedBaseUrl).toString();
}

function formatModelPricing(value: unknown): string | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const record = value as Record<string, unknown>;
	const prompt =
		typeof record.prompt === "string" || typeof record.prompt === "number"
			? String(record.prompt)
			: null;
	const completion =
		typeof record.completion === "string" ||
		typeof record.completion === "number"
			? String(record.completion)
			: null;

	if (prompt && completion) {
		return `In ${prompt} · Out ${completion}`;
	}

	if (prompt) {
		return `Prompt ${prompt}`;
	}

	if (completion) {
		return `Completion ${completion}`;
	}

	return undefined;
}

function mapDiscoveredModel(input: unknown): BenchLocalDiscoveredModel | null {
	if (!input || typeof input !== "object") {
		return null;
	}

	const record = input as Record<string, unknown>;
	const id = typeof record.id === "string" ? record.id.trim() : "";

	if (!id) {
		return null;
	}

	const name = typeof record.name === "string" ? record.name.trim() : undefined;
	const ownedBy =
		typeof record.owned_by === "string" ? record.owned_by.trim() : undefined;
	const topProvider =
		typeof record.top_provider === "object" && record.top_provider !== null
			? (record.top_provider as Record<string, unknown>)
			: null;
	const architecture =
		typeof record.architecture === "object" && record.architecture !== null
			? (record.architecture as Record<string, unknown>)
			: null;
	const contextLength =
		typeof record.context_length === "number"
			? record.context_length
			: typeof topProvider?.context_length === "number"
				? (topProvider.context_length as number)
				: undefined;
	const modality = Array.isArray(architecture?.modality)
		? architecture.modality
				.filter((value): value is string => typeof value === "string")
				.join(", ")
		: Array.isArray(record.input_modalities)
			? record.input_modalities
					.filter((value): value is string => typeof value === "string")
					.join(", ")
			: Array.isArray(record.output_modalities)
				? record.output_modalities
						.filter((value): value is string => typeof value === "string")
						.join(", ")
				: undefined;

	return {
		id,
		name,
		ownedBy,
		contextLength,
		pricing: formatModelPricing(record.pricing),
		modality,
	};
}

export async function discoverProviderModels(
	provider: BenchLocalProviderConfig,
): Promise<BenchLocalDiscoveredModel[]> {
	if (!providerSupportsModelDiscovery(provider)) {
		throw new Error(`${provider.name} does not support model browsing yet.`);
	}

	const headers = new Headers({
		Accept: "application/json",
	});
	const apiKey =
		provider.api_key?.trim() ||
		(provider.api_key_env ? process.env[provider.api_key_env]?.trim() : "");

	if (apiKey) {
		headers.set("Authorization", `Bearer ${apiKey}`);
	}

	const response = await fetch(providerModelsUrl(provider.base_url), {
		method: "GET",
		headers,
	});

	if (!response.ok) {
		throw new Error(
			`Failed to load models from ${provider.name}: ${response.status} ${response.statusText}`.trim(),
		);
	}

	const payload = (await response.json()) as { data?: unknown[] } | unknown[];
	const entries = Array.isArray(payload)
		? payload
		: Array.isArray(payload.data)
			? payload.data
			: [];

	return entries
		.map((entry) => mapDiscoveredModel(entry))
		.filter((entry): entry is BenchLocalDiscoveredModel => Boolean(entry))
		.sort((left, right) =>
			(left.name ?? left.id).localeCompare(right.name ?? right.id),
		);
}
