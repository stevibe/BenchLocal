# BenchLocal Config Schema v1

## Purpose

This document describes the durable user configuration stored in:

```text
~/.benchlocal/config.toml
```

BenchLocal edits this file through the desktop UI. Advanced users can edit it manually.

## Durable config vs UI state

BenchLocal keeps two different local files:

- `config.toml`
  - durable configuration
  - providers
  - models
  - installed Bench Pack state
  - verifier preferences
  - theme selection
- `state.json`
  - workspaces and tabs
  - selected models per tab
  - sampling overrides per tab
  - execution mode per tab

This document is only about `config.toml`.

## Storage layout

```text
~/.benchlocal/
  config.toml
  state.json
  benchpacks/
  runs/
  logs/
  cache/
  themes/
```

## Current top-level schema

```toml
schema_version = 1
default_benchpack = ""
run_storage_dir = "~/.benchlocal/runs"
benchpack_storage_dir = "~/.benchlocal/benchpacks"
log_storage_dir = "~/.benchlocal/logs"
cache_dir = "~/.benchlocal/cache"

[registry]
official_url = "https://raw.githubusercontent.com/stevibe/benchlocal-registry/main/registry.json"

[ui]
theme = "system"
```

Fresh config starts intentionally blank:

- no providers
- no models
- no installed Bench Packs

BenchLocal does not seed providers or models automatically.

## Providers

Providers live under:

```toml
[providers.<provider-id>]
```

Example:

```toml
[providers.openrouter]
kind = "openrouter"
name = "OpenRouter"
enabled = true
base_url = "https://openrouter.ai/api/v1"
api_key_env = "OPENROUTER_API_KEY"
```

Supported provider kinds:

- `openrouter`
- `ollama`
- `llamacpp`
- `mlx`
- `lmstudio`
- `openai_compatible`

Provider fields:

- `kind`
- `name`
- `enabled`
- `base_url`
- `api_key` optional
- `api_key_env` optional

## Models

Models are stored as an array:

```toml
[[models]]
id = "openrouter:openai/gpt-4.1"
provider = "openrouter"
model = "openai/gpt-4.1"
label = "GPT-4.1 via OpenRouter"
group = "primary"
enabled = true
```

Model fields:

- `id`
- `provider`
- `model`
- `label`
- `group`
- `enabled`

`id` must remain stable because tabs and run history refer to it.

## Installed Bench Packs

Bench Pack install state lives under:

```toml
[benchpacks.<benchpack-id>]
```

Example official install:

```toml
[benchpacks.toolcall-15]
enabled = true
source = "registry"
version = "1.0.0"
```

Example third-party install:

```toml
[benchpacks.third-party-pack]
enabled = true
source = "archive"
url = "https://example.com/benchpack.tar.gz"
version = "1.0.0"
```

Supported stored sources:

- `registry`
- `archive`
- `github`
- `local`
- `git`

In normal product use, the important ones are:

- `registry`
- `archive`

The others remain for compatibility and local development workflows.

Bench Pack fields:

- `enabled`
- `source`
- `version` optional
- `repo` optional
- `path` optional
- `url` optional
- `ref` optional
- `auto_update` optional

## Verifier preferences

Verifier preferences live inside each installed Bench Pack block:

```toml
[benchpacks.structoutput-15.verifiers.verifier]
mode = "docker"
auto_start = true
```

Verifier fields:

- `mode`
  - `docker`
  - `cloud`
  - `custom_url`
- `auto_start`
- `custom_url` optional
- `cloud_url` optional
- `docker_image` optional

BenchLocal manages Docker host ports automatically. Users do not configure them in `config.toml`.

## UI settings

Current UI settings are intentionally small:

```toml
[ui]
theme = "system"
```

Supported built-in values:

- `system`
- `light`
- `dark`
- `night`

Custom themes can be added under:

```text
~/.benchlocal/themes/
```

## Compatibility aliases

BenchLocal still reads a few legacy keys during migration:

- `default_bench_pack`
- `default_plugin`
- `bench_pack_storage_dir`
- `plugin_storage_dir`
- `bench_packs`
- `plugins`

Those aliases are backward-compatibility only. New config should use the `benchpack` forms documented above.
