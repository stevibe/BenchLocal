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
  | "pico"
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
  auto_start: boolean;
  custom_url?: string;
  cloud_url?: string;
  docker_image?: string;
};

export type BenchLocalSidecarConfig = BenchLocalVerifierConfig;

export type BenchLocalBenchPackConfig = {
  enabled: boolean;
  source: "registry" | "archive" | "github" | "local" | "git";
  repo?: string;
  path?: string;
  url?: string;
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
  default_benchpack: string;
  run_storage_dir: string;
  benchpack_storage_dir: string;
  log_storage_dir: string;
  cache_dir: string;
  registry: BenchLocalRegistryConfig;
  ui: {
    theme: string;
  };
  providers: Record<string, BenchLocalProviderConfig>;
  models: BenchLocalModelConfig[];
  benchpacks: Record<string, BenchLocalBenchPackConfig>;
};

export type LoadedBenchLocalConfig = {
  path: string;
  created: boolean;
  config: BenchLocalConfig;
};

const ProviderSchema = z.object({
  kind: z
    .enum(["openrouter", "ollama", "llamacpp", "mlx", "lmstudio", "pico", "openai_compatible"])
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
  auto_start: z.boolean().default(true),
  custom_url: z.string().trim().min(1).optional(),
  cloud_url: z.string().trim().min(1).optional(),
  docker_image: z.string().trim().min(1).optional()
});

const BenchPackSchema = z
  .object({
    enabled: z.boolean().default(true),
    source: z.enum(["registry", "archive", "github", "local", "git"]).default("registry"),
    repo: z.string().trim().min(1).optional(),
    path: z.string().trim().min(1).optional(),
    url: z.string().trim().min(1).optional(),
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
        message: "GitHub Bench Packs require a repo value."
      });
    }

    if (value.source === "local" && !value.path) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Local Bench Packs require a path value."
      });
    }

    if (value.source === "archive" && !value.url) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Archive Bench Packs require a url value."
      });
    }
  });

const ConfigSchema = z.object({
  schema_version: z.literal(1).default(1),
  default_benchpack: z.string().trim().default(""),
  run_storage_dir: z.string().trim().min(1),
  benchpack_storage_dir: z.string().trim().min(1),
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
      theme: z.string().trim().min(1).default("system")
    })
    .default({
      theme: "system"
  }),
  providers: z.record(z.string(), ProviderSchema).default({}),
  models: z.array(ModelSchema).default([]),
  benchpacks: z.record(z.string(), BenchPackSchema).default({})
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
    case "pico":
      return "pico";
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
    case "pico":
      return "Pico";
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
    default_benchpack: "",
    run_storage_dir: path.join(home, "runs"),
    benchpack_storage_dir: path.join(home, "benchpacks"),
    log_storage_dir: path.join(home, "logs"),
    cache_dir: path.join(home, "cache"),
    registry: {
      official_url: "https://raw.githubusercontent.com/stevibe/benchlocal-registry/main/registry.json"
    },
    ui: {
      theme: "system"
    },
    providers: {},
    models: [],
    benchpacks: {}
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
  const rawRecord = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const parsed = ConfigSchema.parse({
    ...rawRecord,
    default_benchpack:
      typeof rawRecord.default_benchpack === "string"
        ? rawRecord.default_benchpack
        : typeof rawRecord.default_bench_pack === "string"
          ? rawRecord.default_bench_pack
        : typeof rawRecord.default_plugin === "string"
          ? rawRecord.default_plugin
          : undefined,
    benchpack_storage_dir:
      typeof rawRecord.benchpack_storage_dir === "string"
        ? rawRecord.benchpack_storage_dir
        : typeof rawRecord.bench_pack_storage_dir === "string"
          ? rawRecord.bench_pack_storage_dir
        : typeof rawRecord.plugin_storage_dir === "string"
          ? rawRecord.plugin_storage_dir
          : undefined,
    benchpacks:
      rawRecord.benchpacks && typeof rawRecord.benchpacks === "object"
        ? rawRecord.benchpacks
        : rawRecord.bench_packs && typeof rawRecord.bench_packs === "object"
          ? rawRecord.bench_packs
        : rawRecord.plugins && typeof rawRecord.plugins === "object"
          ? rawRecord.plugins
          : undefined
  });
  const normalizedProviders = Object.fromEntries(
    Object.entries(parsed.providers).map(([providerId, provider]) => {
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
    providers: normalizedProviders,
    benchpacks: Object.fromEntries(
      Object.entries(parsed.benchpacks).map(([benchPackId, benchPack]) => [
        benchPackId,
        {
          ...benchPack,
          verifiers: benchPack.verifiers ?? benchPack.sidecars
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

  for (const [benchPackId, benchPack] of Object.entries(config.benchpacks)) {
    for (const [verifierId, verifier] of Object.entries(benchPack.verifiers ?? {})) {
      if (verifier.custom_url) {
        assertValidHttpUrl(verifier.custom_url, `benchpacks.${benchPackId}.verifiers.${verifierId}.custom_url`);
      }

      if (verifier.cloud_url) {
        assertValidHttpUrl(verifier.cloud_url, `benchpacks.${benchPackId}.verifiers.${verifierId}.cloud_url`);
      }
    }
  }

  return config;
}

async function ensureHomeAndStorageDirs(config: BenchLocalConfig): Promise<void> {
  const dirs = [
    getBenchLocalHome(),
    expandHomePath(config.run_storage_dir),
    expandHomePath(config.benchpack_storage_dir),
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
