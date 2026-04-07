import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse, stringify } from "smol-toml";
import { z } from "zod";

export type BenchLocalProviderKind =
  | "openrouter"
  | "ollama"
  | "llamacpp"
  | "mlx"
  | "lmstudio"
  | "openai_compatible";

export type BenchLocalProviderConfig = {
  kind: BenchLocalProviderKind;
  name: string;
  enabled: boolean;
  base_url: string;
  api_key?: string;
  api_key_env?: string;
};

export type BenchLocalModelConfig = {
  id: string;
  provider: string;
  model: string;
  label: string;
  group: string;
  enabled: boolean;
};

export type BenchLocalVerifierMode = "cloud" | "docker" | "custom_url";

export type BenchLocalVerifierConfig = {
  mode: BenchLocalVerifierMode;
  port?: number;
  auto_start: boolean;
  custom_url?: string;
  cloud_url?: string;
  docker_image?: string;
};

export type BenchLocalSidecarConfig = BenchLocalVerifierConfig;

export type BenchLocalPluginConfig = {
  enabled: boolean;
  source: "github" | "local" | "git";
  repo?: string;
  path?: string;
  ref?: string;
  version?: string;
  auto_update?: boolean;
  verifiers?: Record<string, BenchLocalVerifierConfig>;
  sidecars?: Record<string, BenchLocalSidecarConfig>;
};

export type BenchLocalRegistryConfig = {
  official_url: string;
};

export type BenchLocalConfig = {
  schema_version: 1;
  default_plugin: string;
  run_storage_dir: string;
  plugin_storage_dir: string;
  log_storage_dir: string;
  cache_dir: string;
  registry: BenchLocalRegistryConfig;
  ui: {
    theme: "system" | "light" | "dark";
    show_secondary_table: boolean;
  };
  defaults: {
    temperature: number;
    top_p: number;
    top_k: number;
    min_p: number;
    repetition_penalty: number;
    request_timeout_seconds: number;
    max_concurrent_models: number;
    max_concurrent_runs: number;
  };
  providers: Record<string, BenchLocalProviderConfig>;
  models: BenchLocalModelConfig[];
  plugins: Record<string, BenchLocalPluginConfig>;
};

export type LoadedBenchLocalConfig = {
  path: string;
  created: boolean;
  config: BenchLocalConfig;
};

const ProviderSchema = z.object({
  kind: z
    .enum(["openrouter", "ollama", "llamacpp", "mlx", "lmstudio", "openai_compatible"])
    .optional(),
  name: z.string().trim().min(1).optional(),
  enabled: z.boolean().default(true),
  base_url: z.string().trim().min(1),
  api_key: z.string().trim().min(1).optional(),
  api_key_env: z.string().trim().min(1).optional()
});

const ModelSchema = z.object({
  id: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  label: z.string().trim().min(1),
  group: z.string().trim().min(1).default("primary"),
  enabled: z.boolean().default(true)
});

const VerifierSchema = z.object({
  mode: z.enum(["cloud", "docker", "custom_url"]).default("docker"),
  port: z.number().int().min(1).max(65535).optional(),
  auto_start: z.boolean().default(true),
  custom_url: z.string().trim().min(1).optional(),
  cloud_url: z.string().trim().min(1).optional(),
  docker_image: z.string().trim().min(1).optional()
});

const PluginSchema = z
  .object({
    enabled: z.boolean().default(true),
    source: z.enum(["github", "local", "git"]).default("github"),
    repo: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1).optional(),
    ref: z.string().trim().min(1).optional(),
    version: z.string().trim().min(1).optional(),
    auto_update: z.boolean().optional(),
    verifiers: z.record(z.string(), VerifierSchema).optional(),
    sidecars: z.record(z.string(), VerifierSchema).optional()
  })
  .superRefine((value, context) => {
    if (value.source === "github" && !value.repo) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "GitHub plugins require a repo value."
      });
    }

    if (value.source === "local" && !value.path) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Local plugins require a path value."
      });
    }
  });

const ConfigSchema = z.object({
  schema_version: z.literal(1).default(1),
  default_plugin: z.string().trim().default(""),
  run_storage_dir: z.string().trim().min(1),
  plugin_storage_dir: z.string().trim().min(1),
  log_storage_dir: z.string().trim().min(1),
  cache_dir: z.string().trim().min(1),
  registry: z
    .object({
      official_url: z.string().trim().min(1)
    })
    .default({
      official_url: "https://raw.githubusercontent.com/stevibe/benchlocal-registry/main/registry.json"
    }),
  ui: z
    .object({
      theme: z.enum(["system", "light", "dark"]).default("system"),
      show_secondary_table: z.boolean().default(true)
    })
    .default({
      theme: "system",
      show_secondary_table: true
    }),
  defaults: z
    .object({
      temperature: z.number().default(0),
      top_p: z.number().default(1),
      top_k: z.number().default(0),
      min_p: z.number().default(0),
      repetition_penalty: z.number().default(1),
      request_timeout_seconds: z.number().int().min(1).default(30),
      max_concurrent_models: z.number().int().min(1).default(8),
      max_concurrent_runs: z.number().int().min(1).default(1)
    })
    .default({
      temperature: 0,
      top_p: 1,
      top_k: 0,
      min_p: 0,
      repetition_penalty: 1,
      request_timeout_seconds: 30,
      max_concurrent_models: 8,
      max_concurrent_runs: 1
    }),
  providers: z.record(z.string(), ProviderSchema).default({}),
  models: z.array(ModelSchema).default([]),
  plugins: z.record(z.string(), PluginSchema).default({})
});

export function getBenchLocalHome(): string {
  return path.join(os.homedir(), ".benchlocal");
}

export function expandHomePath(input: string): string {
  if (input === "~") {
    return os.homedir();
  }

  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }

  return input;
}

export function getConfigPath(): string {
  return path.join(getBenchLocalHome(), "config.toml");
}

function createDefaultProviders(): Record<string, BenchLocalProviderConfig> {
  return {
    openrouter: {
      kind: "openrouter",
      name: "OpenRouter",
      enabled: true,
      base_url: "https://openrouter.ai/api/v1",
      api_key_env: "OPENROUTER_API_KEY"
    },
    ollama: {
      kind: "ollama",
      name: "Ollama",
      enabled: true,
      base_url: "http://127.0.0.1:11434/v1"
    },
    llamacpp: {
      kind: "llamacpp",
      name: "llama.cpp",
      enabled: false,
      base_url: "http://127.0.0.1:8080/v1"
    },
    mlx: {
      kind: "mlx",
      name: "MLX",
      enabled: false,
      base_url: "http://127.0.0.1:8082/v1"
    },
    lmstudio: {
      kind: "lmstudio",
      name: "LM Studio",
      enabled: false,
      base_url: "http://127.0.0.1:1234/v1"
    }
  };
}

function inferProviderKind(providerId: string): BenchLocalProviderKind {
  switch (providerId) {
    case "openrouter":
      return "openrouter";
    case "ollama":
      return "ollama";
    case "llamacpp":
      return "llamacpp";
    case "mlx":
      return "mlx";
    case "lmstudio":
      return "lmstudio";
    default:
      return "openai_compatible";
  }
}

function inferProviderName(providerId: string, kind: BenchLocalProviderKind): string {
  switch (kind) {
    case "openrouter":
      return "OpenRouter";
    case "ollama":
      return "Ollama";
    case "llamacpp":
      return "llama.cpp";
    case "mlx":
      return "MLX";
    case "lmstudio":
      return "LM Studio";
    case "openai_compatible":
    default: {
      const cleaned = providerId.replace(/[_-]+/g, " ").trim();
      if (!cleaned) {
        return "OpenAI Compatible";
      }

      return cleaned.replace(/\b\w/g, (segment) => segment.toUpperCase());
    }
  }
}

export function createDefaultConfig(): BenchLocalConfig {
  const home = getBenchLocalHome();

  return {
    schema_version: 1,
    default_plugin: "",
    run_storage_dir: path.join(home, "runs"),
    plugin_storage_dir: path.join(home, "plugins"),
    log_storage_dir: path.join(home, "logs"),
    cache_dir: path.join(home, "cache"),
    registry: {
      official_url: "https://raw.githubusercontent.com/stevibe/benchlocal-registry/main/registry.json"
    },
    ui: {
      theme: "system",
      show_secondary_table: true
    },
    defaults: {
      temperature: 0,
      top_p: 1,
      top_k: 0,
      min_p: 0,
      repetition_penalty: 1,
      request_timeout_seconds: 30,
      max_concurrent_models: 8,
      max_concurrent_runs: 1
    },
    providers: createDefaultProviders(),
    models: [
      {
        id: "openrouter:openai/gpt-4.1",
        provider: "openrouter",
        model: "openai/gpt-4.1",
        label: "GPT-4.1 via OpenRouter",
        group: "primary",
        enabled: true
      },
      {
        id: "ollama:qwen3.5:4b",
        provider: "ollama",
        model: "qwen3.5:4b",
        label: "Qwen3.5 4B via Ollama",
        group: "primary",
        enabled: false
      }
    ],
    plugins: {}
  };
}

function assertValidHttpUrl(value: string, field: string): void {
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid http:// or https:// URL.`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${field} must use http:// or https://.`);
  }
}

function normalizeConfig(raw: unknown): BenchLocalConfig {
  const defaults = createDefaultConfig();
  const parsed = ConfigSchema.parse(raw ?? {});
  const mergedProviders = {
    ...defaults.providers,
    ...parsed.providers
  };
  const normalizedProviders = Object.fromEntries(
    Object.entries(mergedProviders).map(([providerId, provider]) => {
      const kind = provider.kind ?? inferProviderKind(providerId);

      return [
        providerId,
        {
          ...provider,
          kind,
          name: provider.name ?? inferProviderName(providerId, kind)
        } satisfies BenchLocalProviderConfig
      ];
    })
  ) as Record<string, BenchLocalProviderConfig>;

  const config: BenchLocalConfig = {
    ...defaults,
    ...parsed,
    registry: {
      ...defaults.registry,
      ...parsed.registry
    },
    ui: {
      ...defaults.ui,
      ...parsed.ui
    },
    defaults: {
      ...defaults.defaults,
      ...parsed.defaults
    },
    providers: normalizedProviders,
    plugins: Object.fromEntries(
      Object.entries(parsed.plugins).map(([pluginId, plugin]) => [
        pluginId,
        {
          ...plugin,
          verifiers: plugin.verifiers ?? plugin.sidecars
        }
      ])
    )
  };

  const seenModelIds = new Set<string>();

  for (const [providerId, provider] of Object.entries(config.providers)) {
    assertValidHttpUrl(provider.base_url, `providers.${providerId}.base_url`);
  }

  for (const model of config.models) {
    if (seenModelIds.has(model.id)) {
      throw new Error(`Duplicate model id "${model.id}" found in models.`);
    }

    if (!config.providers[model.provider]) {
      throw new Error(`Model "${model.id}" references unknown provider "${model.provider}".`);
    }

    seenModelIds.add(model.id);
  }

  for (const [pluginId, plugin] of Object.entries(config.plugins)) {
    for (const [verifierId, verifier] of Object.entries(plugin.verifiers ?? {})) {
      if (verifier.custom_url) {
        assertValidHttpUrl(verifier.custom_url, `plugins.${pluginId}.verifiers.${verifierId}.custom_url`);
      }

      if (verifier.cloud_url) {
        assertValidHttpUrl(verifier.cloud_url, `plugins.${pluginId}.verifiers.${verifierId}.cloud_url`);
      }
    }
  }

  return config;
}

async function ensureHomeAndStorageDirs(config: BenchLocalConfig): Promise<void> {
  const dirs = [
    getBenchLocalHome(),
    expandHomePath(config.run_storage_dir),
    expandHomePath(config.plugin_storage_dir),
    expandHomePath(config.log_storage_dir),
    expandHomePath(config.cache_dir)
  ];

  await Promise.all(dirs.map((dir) => fs.mkdir(dir, { recursive: true })));
}

export async function loadConfigFile(configPath = getConfigPath()): Promise<BenchLocalConfig> {
  const raw = await fs.readFile(configPath, "utf8");
  const parsed = parse(raw);
  const config = normalizeConfig(parsed);
  await ensureHomeAndStorageDirs(config);
  return config;
}

export async function loadOrCreateConfig(configPath = getConfigPath()): Promise<LoadedBenchLocalConfig> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  try {
    const config = await loadConfigFile(configPath);
    return {
      path: configPath,
      created: false,
      config
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown config bootstrap error.";

    if (!/ENOENT/.test(message)) {
      throw error;
    }
  }

  const config = createDefaultConfig();
  await saveConfigFile(config, configPath);

  return {
    path: configPath,
    created: true,
    config
  };
}

export async function saveConfigFile(config: BenchLocalConfig, configPath = getConfigPath()): Promise<BenchLocalConfig> {
  const normalized = normalizeConfig(config);
  await ensureHomeAndStorageDirs(normalized);
  await fs.mkdir(path.dirname(configPath), { recursive: true });

  const tempPath = `${configPath}.tmp`;
  await fs.writeFile(tempPath, stringify(normalized), "utf8");
  await fs.rename(tempPath, configPath);

  return normalized;
}
