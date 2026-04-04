# BenchLocal Registry V1

`benchlocal-registry` should be the single source of truth for official scenario packs.

BenchLocal the desktop app should not hardcode official plugins in user config. Instead:

- `benchlocal-registry` publishes the official index
- BenchLocal reads that index
- `~/.benchlocal/config.toml` stores only local install state and user overrides

## Goals

- define one canonical list of official scenario packs
- let BenchLocal distinguish official vs local/dev plugins
- support version and channel metadata without coupling it to user config
- prepare for future checksum or signature verification

## Index Shape

Registry file:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-04-09T00:00:00.000Z",
  "plugins": [
    {
      "id": "dataextract-15",
      "name": "DataExtract-15",
      "publisher": "stevibe",
      "official": true,
      "description": "Deterministic data extraction benchmark with 15 fixed scenarios.",
      "repository": {
        "type": "git",
        "url": "https://github.com/stevibe/DataExtract-15.git"
      },
      "install": {
        "type": "git",
        "defaultRef": "main"
      },
      "manifest": {
        "schemaVersion": 1,
        "protocolVersion": 1,
        "entry": "./dist/benchlocal/index.js"
      },
      "channels": {
        "stable": {
          "version": "0.1.0",
          "ref": "main"
        }
      },
      "sidecars": [],
      "tags": ["official", "data-extraction"]
    }
  ]
}
```

## Required Fields

Top level:

- `schemaVersion`
- `generatedAt`
- `plugins`

Per plugin:

- `id`
- `name`
- `publisher`
- `official`
- `repository`
- `install`
- `manifest`
- `channels`

## Install Model

Registry metadata should describe how BenchLocal installs an official plugin, but not where the user installed it locally.

Registry:

- canonical repo URL
- default branch or tag
- available channels
- official metadata

Local config:

- enabled/disabled
- local install path if overridden
- pinned ref if user overrides
- local sidecar overrides such as ports

## Local Config Relationship

BenchLocal should eventually move to:

```toml
[registry]
url = "https://raw.githubusercontent.com/<org>/benchlocal-registry/main/registry.json"
channel = "stable"

[plugins.dataextract-15]
enabled = true
source = "registry"
channel = "stable"

[plugins.structoutput-15]
enabled = true
source = "local"
path = "/path/to/StructOutput-15"
```

Meaning:

- official plugins can come from the registry
- local development plugins can still be loaded directly from disk
- BenchLocal can merge registry metadata with local overrides

## Trust Model

`official = true` should mean:

- listed by the registry
- published by an approved maintainer
- expected to follow BenchLocal protocol and packaging rules

It should not yet imply full sandboxing or cryptographic verification. Those can be added in a later registry version.

## Future Extensions

- checksums for plugin bundles
- signatures
- release notes per channel
- minimum BenchLocal app version
- plugin capability compatibility matrix
- sidecar image metadata for host-managed Docker startup
