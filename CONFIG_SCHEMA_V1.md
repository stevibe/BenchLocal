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
- secrets should not be stored in plain text by default.
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
show_secondary_table = true

[defaults]
temperature = 0
top_p = 1
top_k = 0
min_p = 0
repetition_penalty = 1
request_timeout_seconds = 30
max_concurrent_models = 8
max_concurrent_runs = 1

[providers.openrouter]
enabled = true
base_url = "https://openrouter.ai/api/v1"
secret_ref = "keychain:benchlocal/openrouter"
api_key_env = "OPENROUTER_API_KEY"

[providers.ollama]
enabled = true
base_url = "http://127.0.0.1:11434/v1"

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
- `show_secondary_table = true | false`

This section should stay small. Temporary window state belongs in `state.json`.

## `[defaults]`

Global generation and scheduler defaults.

Supported fields:

- `temperature`
- `top_p`
- `top_k`
- `min_p`
- `repetition_penalty`
- `request_timeout_seconds`
- `max_concurrent_models`
- `max_concurrent_runs`

These are host-level defaults, not plugin-owned settings.

## `[providers.<provider-id>]`

Provider registry entries.

Known built-in provider IDs:

- `openrouter`
- `ollama`
- `llamacpp`
- `mlx`
- `lmstudio`

Supported fields:

- `enabled`
- `base_url`
- `secret_ref`
- `api_key_env`

`secret_ref` is an indirection, not the raw secret.

Examples:

```toml
[providers.openrouter]
enabled = true
base_url = "https://openrouter.ai/api/v1"
secret_ref = "keychain:benchlocal/openrouter"
api_key_env = "OPENROUTER_API_KEY"
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

Default policy:

- store secret references in `config.toml`
- store raw secret values in OS keychain
- allow environment variable fallback

BenchLocal should expose this in the settings UI clearly:

- key present
- key missing
- env fallback configured

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
