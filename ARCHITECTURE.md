# BenchLocal Architecture

## Purpose

BenchLocal is the desktop host for installing, configuring, and running LLM Bench Packs.

The product is split into two layers:

- BenchLocal
  - desktop UI
  - provider and model registry
  - Bench Pack installation and update flow
  - verifier lifecycle management
  - run orchestration and history
- Bench Packs
  - scenarios
  - prompts
  - scoring
  - optional verifier contracts and implementations

## Ownership boundaries

BenchLocal owns the shared runtime:

- user configuration
- shared providers and models
- installed Bench Pack state
- local storage locations
- verifier startup and health checks
- per-tab model selection
- per-tab sampling overrides
- run persistence

Bench Packs own benchmark-specific behavior:

- scenario metadata
- prompt and tool logic
- scoring logic
- traces and summaries
- optional verifier request and response contracts
- recommended default sampling values

Bench Packs do not own shared desktop settings or host-specific infrastructure details such as Docker host ports.

## Main components

```text
app/
  src/main/      Electron main process
  src/preload/   secure renderer bridge
  src/renderer/  desktop UI
packages/
  benchlocal-core/
    shared protocol, config, workspaces, themes
  benchlocal-sdk/
    authoring helpers for Bench Packs
  benchpack-host/
    install, inspection, verifier, and run orchestration
themes/
  built-in desktop themes
scripts/
  local macOS release helpers
```

## Runtime lifecycle

1. BenchLocal loads `~/.benchlocal/config.toml` and `~/.benchlocal/state.json`.
2. BenchLocal inspects installed Bench Packs under `~/.benchlocal/benchpacks`.
3. The renderer shows the current workspace, tabs, providers, models, and available Bench Packs.
4. When a run starts, BenchLocal:
   - resolves the active Bench Pack
   - resolves selected models for the tab
   - resolves provider secrets
   - starts required verifiers when needed
   - constructs a `HostContext`
   - loads the Bench Pack runtime entrypoint
5. The Bench Pack executes scenarios and emits progress events.
6. BenchLocal persists run logs, run summaries, and result history under `~/.benchlocal/runs`.

## Bench Pack installation model

BenchLocal installs Bench Packs as runtime artifacts, not as source checkouts.

An installable artifact contains:

- `benchlocal.pack.json`
- `dist/benchlocal/index.js`
- optional `verification/`
- optional small metadata files such as `README.md` and `METHODOLOGY.md`

BenchLocal supports two product-level sources:

- the official BenchLocal registry
- direct third-party artifact URLs

The host stages and validates a Bench Pack before activation. A failed install should not replace a working install.

## Verifier model

Verifier-dependent Bench Packs declare verifier requirements in `benchlocal.pack.json`.

BenchLocal owns:

- verifier mode selection
  - `docker`
  - `cloud`
  - `custom_url`
- local Docker lifecycle
- dynamic host port assignment
- health checks
- verifier status shown in the UI

Bench Packs own:

- the verifier implementation
- the verifier request and response contract
- use of the resolved verifier endpoint

The important contract detail is:

- the Bench Pack declares the verifier's internal `listenPort`
- BenchLocal assigns the host port automatically

Public terminology is `verifier`. `sidecar` remains only as a backward-compatibility alias in a few internal types.

## Local storage

BenchLocal stores user-owned data under:

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

Use `config.toml` for durable configuration:

- providers
- models
- installed Bench Pack state
- verifier preferences
- theme selection

Use `state.json` for workspace and tab state:

- workspaces
- tabs
- per-tab selected models
- per-tab sampling overrides
- per-tab execution mode

## Public package boundaries

BenchLocal publishes two public npm packages:

- `@benchlocal/core`
- `@benchlocal/sdk`

Bench Pack authors depend on those packages.

The Electron app and host orchestration remain part of the BenchLocal desktop app repo.

## Product assumptions

- BenchLocal must work even when the official registry is unreachable.
- Installed Bench Packs must remain usable offline.
- A Bench Pack does not need a standalone web app.
- A CLI runner is useful for pack development, but it is not required by the host.
- Verifier-dependent Bench Packs are first-class, but non-verifier packs should remain the default and simplest case.

## Related docs

- [README.md](./README.md)
- [BENCH_PACK_AUTHORING.md](./BENCH_PACK_AUTHORING.md)
- [BENCH_PROTOCOL_V1.md](./BENCH_PROTOCOL_V1.md)
- [CONFIG_SCHEMA_V1.md](./CONFIG_SCHEMA_V1.md)
- [BENCHLOCAL_REGISTRY_V1.md](./BENCHLOCAL_REGISTRY_V1.md)
- [docs/macos-release.md](./docs/macos-release.md)
