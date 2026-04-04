import type {
  BenchPlugin,
  BenchmarkScore,
  GenerationRequest,
  HostContext,
  PluginManifest,
  ProgressEmitter,
  ProgressEvent,
  ProviderConfig,
  RegisteredModel,
  ScenarioResult,
  ScenarioRunInput,
  ScenarioMeta,
  SecretResolution,
  SidecarEndpoint
} from "@benchlocal/core";
export type {
  BenchPlugin,
  BenchmarkScore,
  GenerationRequest,
  HostContext,
  PluginManifest,
  ProgressEmitter,
  ProgressEvent,
  ProviderConfig,
  RegisteredModel,
  ScenarioResult,
  ScenarioRunInput,
  ScenarioMeta,
  SecretResolution,
  SidecarEndpoint
} from "@benchlocal/core";

export const BENCHLOCAL_SCHEMA_VERSION = 1 as const;
export const BENCHLOCAL_PROTOCOL_VERSION = 1 as const;

export type PluginManifestInput = Omit<PluginManifest, "schemaVersion" | "protocolVersion">;

export type ProviderLookupOptions = {
  enabledOnly?: boolean;
  required?: boolean;
};

export type SidecarLookupOptions = {
  required?: boolean;
  runningOnly?: boolean;
};

export type HostHelpers = {
  getProvider: (providerId: string, options?: ProviderLookupOptions) => ProviderConfig | undefined;
  getRequiredProvider: (providerId: string, options?: Omit<ProviderLookupOptions, "required">) => ProviderConfig;
  getSecret: (providerId: string) => SecretResolution | undefined;
  getSecretValue: (providerId: string) => string | undefined;
  getRequiredSecretValue: (providerId: string) => string;
  getRegisteredModel: (modelId: string) => RegisteredModel | undefined;
  getRequiredModel: (modelId: string) => RegisteredModel;
  getSidecar: (sidecarId: string, options?: SidecarLookupOptions) => SidecarEndpoint | undefined;
  getRequiredSidecar: (sidecarId: string, options?: Omit<SidecarLookupOptions, "required">) => SidecarEndpoint;
  resolveGenerationRequest: (overrides?: GenerationRequest) => GenerationRequest;
  getScenarioById: <TScenario extends Pick<ScenarioMeta, "id">>(scenarios: readonly TScenario[], scenarioId: string) => TScenario;
};

export type ScoredScenarioResult = ScenarioResult & {
  score: number;
};

function createLookupError(kind: string, id: string, detail?: string): Error {
  return new Error(detail ? `${kind} "${id}" ${detail}` : `${kind} "${id}" was not found.`);
}

export function definePluginManifest<const TManifest extends PluginManifestInput>(
  manifest: TManifest
): PluginManifest & TManifest {
  return {
    schemaVersion: BENCHLOCAL_SCHEMA_VERSION,
    protocolVersion: BENCHLOCAL_PROTOCOL_VERSION,
    ...manifest
  };
}

export function defineBenchPlugin<const TPlugin extends BenchPlugin>(plugin: TPlugin): TPlugin {
  return plugin;
}

export function createHostHelpers(context: HostContext): HostHelpers {
  const providerMap = new Map(context.providers.map((provider) => [provider.id, provider]));
  const secretMap = new Map(context.secrets.map((secret) => [secret.providerId, secret]));
  const modelMap = new Map(context.models.map((model) => [model.id, model]));
  const sidecarMap = new Map(context.sidecars.map((sidecar) => [sidecar.id, sidecar]));

  return {
    getProvider(providerId, options) {
      const provider = providerMap.get(providerId);

      if (!provider) {
        if (options?.required) {
          throw createLookupError("Provider", providerId);
        }

        return undefined;
      }

      if (options?.enabledOnly && !provider.enabled) {
        if (options.required) {
          throw createLookupError("Provider", providerId, "is configured but disabled.");
        }

        return undefined;
      }

      return provider;
    },

    getRequiredProvider(providerId, options) {
      return this.getProvider(providerId, {
        ...options,
        required: true
      }) as ProviderConfig;
    },

    getSecret(providerId) {
      return secretMap.get(providerId);
    },

    getSecretValue(providerId) {
      return secretMap.get(providerId)?.value;
    },

    getRequiredSecretValue(providerId) {
      const secret = secretMap.get(providerId);

      if (!secret?.value) {
        throw createLookupError("Secret", providerId, "is missing.");
      }

      return secret.value;
    },

    getRegisteredModel(modelId) {
      return modelMap.get(modelId);
    },

    getRequiredModel(modelId) {
      const model = modelMap.get(modelId);

      if (!model) {
        throw createLookupError("Model", modelId);
      }

      return model;
    },

    getSidecar(sidecarId, options) {
      const sidecar = sidecarMap.get(sidecarId);

      if (!sidecar) {
        if (options?.required) {
          throw createLookupError("Sidecar", sidecarId);
        }

        return undefined;
      }

      if (options?.runningOnly && sidecar.status !== "running") {
        if (options.required) {
          throw createLookupError("Sidecar", sidecarId, "is present but not running.");
        }

        return undefined;
      }

      return sidecar;
    },

    getRequiredSidecar(sidecarId, options) {
      return this.getSidecar(sidecarId, {
        ...options,
        required: true
      }) as SidecarEndpoint;
    },

    resolveGenerationRequest(overrides) {
      return {
        temperature: overrides?.temperature ?? context.defaults.temperature,
        top_p: overrides?.top_p ?? context.defaults.top_p,
        top_k: overrides?.top_k ?? context.defaults.top_k,
        min_p: overrides?.min_p ?? context.defaults.min_p,
        repetition_penalty: overrides?.repetition_penalty ?? context.defaults.repetition_penalty,
        request_timeout_seconds: overrides?.request_timeout_seconds ?? context.defaults.request_timeout_seconds
      };
    },

    getScenarioById(scenarios, scenarioId) {
      const scenario = scenarios.find((candidate) => candidate.id === scenarioId);

      if (!scenario) {
        throw createLookupError("Scenario", scenarioId);
      }

      return scenario;
    }
  };
}

export function requireScoredResults(results: ScenarioResult[]): ScoredScenarioResult[] {
  return results.map((result) => ({
    ...result,
    score: result.score ?? 0
  }));
}
