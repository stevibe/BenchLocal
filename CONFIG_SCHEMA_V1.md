# BenchLocal Config Schema v1

## Purpose

This document defines the first durable user configuration model for BenchLocal.

Primary config path:

`~/.benchlocal/config.toml`

This file is edited by:

- the BenchLocal settings UI
- advanced users manually

It should remain stable, readable, and migration-friendly.

## Layout

```text
~/.benchlocal/
  config.toml
  state.json
  plugins/
  runs/
  logs/
  cache/
```

## Rules

- `config.toml` stores durable user config.
- `state.json` stores ephemeral UI state.
- provider API keys may be stored directly in `config.toml` in the current BenchLocal implementation.
- all paths should support `~` expansion.

## Top-Level Schema

```toml
schema_version = 1
default_plugin = "toolcall-15"
run_storage_dir = "~/.benchlocal/runs"
plugin_storage_dir = "~/.benchlocal/plugins"
log_storage_dir = "~/.benchlocal/logs"
cache_dir = "~/.benchlocal/cache"

[ui]
theme = "system"

[providers.openrouter]
kind = "openrouter"
name = "OpenRouter"
enabled = true
base_url = "https://openrouter.ai/api/v1"
api_key = "sk-or-v1-..."
api_key_env = "OPENROUTER_API_KEY"

[providers.ollama]
kind = "ollama"
name = "Ollama"
enabled = true
base_url = "http://127.0.0.1:11434/v1"

[providers.my_vendor]
kind = "openai_compatible"
name = "My Vendor"
enabled = true
base_url = "https://llm.example.com/v1"
api_key = "sk-live-..."

[[models]]
id = "openrouter:openai/gpt-4.1"
provider = "openrouter"
model = "openai/gpt-4.1"
label = "GPT-4.1 via OpenRouter"
group = "primary"
enabled = true

[plugins.toolcall-15]
enabled = true
source = "github"
repo = "stevibe/ToolCall-15"

[plugins.bugfind-15]
enabled = true
source = "github"
repo = "stevibe/BugFind-15"

[plugins.bugfind-15.sidecars.verifier]
kind = "docker-http"
port = 4010
auto_start = true
```

## Top-Level Fields

### `schema_version`

- type: integer
- required: yes
- initial value: `1`

### `default_plugin`

- type: string
- required: no
- meaning: plugin selected by default on launch

### `run_storage_dir`

- type: string
- required: yes

### `plugin_storage_dir`

- type: string
- required: yes

### `log_storage_dir`

- type: string
- required: yes

### `cache_dir`

- type: string
- required: yes

## `[ui]`

Desktop UI preferences.

Supported fields:

- `theme = "system" | "light" | "dark"`

This section should stay small. Temporary window state belongs in `state.json`.

## `[providers.<provider-id>]`

Provider registry entries.

Known built-in provider IDs:

- `openrouter`
- `ollama`
- `llamacpp`
- `mlx`
- `lmstudio`

Supported fields:

- `kind`
- `name`
- `enabled`
- `base_url`
- `api_key`
- `api_key_env`

Examples:

```toml
[providers.openrouter]
kind = "openrouter"
name = "OpenRouter"
enabled = true
base_url = "https://openrouter.ai/api/v1"
api_key = "sk-or-v1-..."
api_key_env = "OPENROUTER_API_KEY"

[providers.my_vendor]
kind = "openai_compatible"
name = "My Vendor"
enabled = true
base_url = "https://llm.example.com/v1"
api_key = "sk-live-..."
```

```toml
[providers.ollama]
enabled = true
base_url = "http://127.0.0.1:11434/v1"
```

## `[[models]]`

Model registry entries.

Supported fields:

- `id`
- `provider`
- `model`
- `label`
- `group`
- `enabled`

Rules:

- `id` must be unique
- `provider` must reference an enabled provider
- `group` is free-form but defaults to `primary` or `secondary`

Example:

```toml
[[models]]
id = "ollama:qwen3.5:4b"
provider = "ollama"
model = "qwen3.5:4b"
label = "Qwen3.5 4B via Ollama"
group = "primary"
enabled = true
```

## `[plugins.<plugin-id>]`

Plugin registry entries.

Supported fields:

- `enabled`
- `source`
- `repo`
- `path`
- `ref`
- `auto_update`

Rules:

- `source = "github"` requires `repo`
- `source = "git"` requires clone URL support in future
- `source = "local"` requires `path`

Example:

```toml
[plugins.structoutput-15]
enabled = true
source = "local"
path = "/Users/example/dev/StructOutput-15"
```

## `[plugins.<plugin-id>.sidecars.<sidecar-id>]`

Host-managed sidecar config.

Supported fields:

- `kind`
- `port`
- `auto_start`

Example:

```toml
[plugins.structoutput-15.sidecars.verifier]
kind = "docker-http"
port = 4011
auto_start = true
```

BenchLocal should validate this against the plugin manifest.

## Secrets Policy

Current policy:

- allow direct local API key storage in `config.toml`
- allow environment variable fallback via `api_key_env`
- do not duplicate provider secrets inside plugin repos

BenchLocal should expose this in the settings UI clearly:

- key present
- env fallback configured
- key missing

## UI Editing Rules

The settings UI should be the primary editor for `config.toml`.

Required UI sections:

- Providers
- Models
- Generation
- Plugins
- Sidecars
- Advanced

The UI must:

- validate before save
- preserve comments only if a TOML library supports stable round-tripping
- rewrite atomically
- back up the old config on migration

## Validation Rules

BenchLocal should reject invalid config on load if:

- `schema_version` is unsupported
- any configured model ID is duplicated
- a model references a missing provider
- a provider `base_url` is malformed
- a plugin entry is missing its required source fields
- a sidecar entry conflicts with manifest requirements

BenchLocal should surface these as actionable settings errors in the UI.

## Migration Rules

When schema changes:

- preserve old file
- write migrated file
- record migration in logs

Future versions should support:

- v1 to v2 migration
- missing-field defaulting
- provider additions without breaking old configs

## State File

Ephemeral UI state belongs in:

`~/.benchlocal/state.json`

Examples:

- selected tab
- last used plugin
- open trace viewer item
- last window bounds

This file should be safe to delete without losing benchmark configuration.

## Immediate Follow-Up

After this schema is accepted, the next implementation documents should be:

1. plugin manifest JSON schema
2. SDK TypeScript package layout
3. BenchLocal settings UI wireframe and data model
