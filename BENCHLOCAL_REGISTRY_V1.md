# BenchLocal Registry v1

`benchlocal-registry` is the source of truth for official Bench Packs published by the BenchLocal project.

BenchLocal does not hardcode the official catalog in local config. Instead:

- the registry publishes the official list
- BenchLocal fetches that list when available
- local config stores only install state and user overrides

If the registry is unreachable, BenchLocal should still start and installed Bench Packs should remain usable.

## Goals

- define the official Bench Pack catalog
- provide install metadata for official packs
- keep local user state separate from public catalog metadata
- leave room for future integrity checks such as checksums or signatures

## Current registry shape

BenchLocal currently expects this top-level structure:

```json
{
  "schemaVersion": 1,
  "packs": [
    {
      "id": "dataextract-15",
      "name": "DataExtract-15",
      "author": "stevibe",
      "description": "Deterministic data extraction benchmark with 15 fixed scenarios.",
      "version": "1.0.0",
      "source": {
        "type": "github",
        "repo": "stevibe/DataExtract-15",
        "tag": "v1.0.0"
      },
      "homepage": "https://github.com/stevibe/DataExtract-15",
      "license": "MIT",
      "scenarioCount": 15,
      "capabilities": {
        "tools": false,
        "multiTurn": false,
        "verification": false,
        "standaloneWebApp": false
      }
    }
  ]
}
```

## Entry fields

Required:

- `id`
- `name`
- `version`
- `source`

Common optional fields:

- `author`
- `description`
- `homepage`
- `license`
- `scenarioCount`
- `capabilities`

## Source types

### GitHub source

```json
{
  "source": {
    "type": "github",
    "repo": "stevibe/ToolCall-15",
    "tag": "v1.0.0"
  }
}
```

BenchLocal converts that into a GitHub archive download for installation.

### Archive source

```json
{
  "source": {
    "type": "archive",
    "url": "https://example.com/toolcall-15-v1.0.0.tar.gz"
  }
}
```

This is useful for local registries or alternate distribution channels.

## What the registry does not store

The registry is not user state.

It does not store:

- local install paths
- enabled or disabled state per user
- selected models
- verifier mode preferences
- theme preferences

Those belong in `~/.benchlocal/config.toml` and `~/.benchlocal/state.json`.

## Official vs third-party

The official registry only covers Bench Packs maintained by the BenchLocal project.

Third-party Bench Packs are installed directly by URL from the desktop app. They are maintained by their authors, not by BenchLocal.

Those installs are stored in local config as `source = "archive"` and do not appear in the official registry unless the project chooses to adopt them.

## Local development note

During local registry development, the server can package a repo directly from disk, for example:

```bash
cd /path/to/StructOutput-15
npm run build:benchlocal
```

That local packaging flow is a development convenience, not part of the public registry contract.

## Future extensions

The current registry intentionally stays small.

Reasonable future additions include:

- checksums for Bench Pack bundles
- signatures
- minimum BenchLocal app version
- release notes
- richer capability metadata
