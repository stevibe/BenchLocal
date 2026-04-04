# BenchLocal Implementation Plan

## Objective

Build BenchLocal as an Electron desktop host for benchmark plugins while preserving standalone operation for:

- ToolCall-15
- BugFind-15
- DataExtract-15
- InstructFollow-15
- ReasonMath-15
- StructOutput-15

This plan is sequenced to reduce risk:

1. prove the shared host config model
2. prove plugin loading
3. prove one simple benchmark plugin
4. prove one verifier-backed plugin
5. expand to the full six-plugin system

## Scope Boundaries

BenchLocal v0 should include:

- desktop shell
- settings UI
- config persistence
- plugin registry
- local plugin loading
- benchmark execution
- result persistence
- sidecar lifecycle for Docker HTTP validators

BenchLocal v0 does not need:

- cloud sync
- online marketplace
- sandboxed untrusted plugin execution
- custom plugin-authored renderer UI

## Proposed Repository Layout

```text
BenchLocal/
  README.md
  ARCHITECTURE.md
  BENCH_PROTOCOL_V1.md
  CONFIG_SCHEMA_V1.md
  IMPLEMENTATION_PLAN.md
  SETTINGS_UI_SPEC.md
  app/
    package.json
    electron-builder.yml
    src/
      main/
      preload/
      renderer/
  packages/
    benchlocal-core/
    benchlocal-sdk/
    plugin-host/
```

## Package Responsibilities

### `app/`

Electron application.

Contains:

- Electron main process
- preload bridge
- renderer UI
- desktop packaging config

### `packages/benchlocal-core`

Shared runtime types and core host logic.

Contains:

- protocol types
- config schema types
- config parser and validator
- run event types
- provider and model registry types
- filesystem path helpers

### `packages/benchlocal-sdk`

Plugin authoring helpers.

Contains:

- TypeScript interfaces for plugins
- manifest helpers
- result helpers
- optional adapters for standalone `.env` mode

### `packages/plugin-host`

Node process that loads and executes plugins.

Contains:

- plugin loader
- manifest validator
- isolated execution wrapper
- IPC bridge back to Electron main process

## Milestone Plan

## Milestone 1. Core Config And Desktop Shell

### Goal

BenchLocal can launch, load `~/.benchlocal/config.toml`, and render a settings UI.

### Deliverables

- Electron app boots locally
- config file auto-created if missing
- UI screens for Providers, Models, Generation, Plugins
- save and reload cycle works

### Work Items

- choose Electron + React tooling
- implement config path resolver
- implement TOML load and save
- implement config validation
- implement default config bootstrap
- build initial navigation shell

### Exit Criteria

- editing settings in UI updates `~/.benchlocal/config.toml`
- invalid config is surfaced clearly
- app restart preserves changes

## Milestone 2. Plugin Registry And Local Install

### Goal

BenchLocal can register and inspect plugins from local paths.

### Deliverables

- plugin registry loader
- plugin manifest validator
- plugin list UI
- local-path plugin add flow

### Work Items

- build manifest validation
- build plugin install record in config
- implement local path add dialog
- inspect plugin metadata and scenarios

### Exit Criteria

- local `DataExtract-15` can be added as a plugin reference
- manifest loads and displays in UI

## Milestone 3. Plugin Host And Run Engine

### Goal

BenchLocal can execute one plugin and stream progress to the UI.

### Deliverables

- plugin host child process
- plugin loading by manifest entrypoint
- progress event IPC
- run manager
- run result persistence

### Work Items

- define IPC contract
- implement `prepare`, `runScenario`, `dispose`
- add run history storage under `~/.benchlocal/runs`
- build run screen with live matrix

### Exit Criteria

- BenchLocal can run one scenario for one model in one plugin
- progress updates reach UI
- result is stored to disk

## Milestone 4. First Real Plugin Conversion

### Goal

Convert `DataExtract-15` as the first production plugin.

### Why First

It has:

- no sidecars
- no tool loop
- deterministic single-turn grading

It is the lowest-risk proof of the protocol.

### Deliverables

- `benchlocal.plugin.json` in `DataExtract-15`
- `src/benchlocal/index.ts`
- shared core between standalone and BenchLocal mode

### Exit Criteria

- BenchLocal runs full DataExtract benchmark
- standalone Next.js app still works

## Milestone 5. Sidecar Lifecycle Proof

### Goal

Convert `BugFind-15` and prove Docker-sidecar management.

### Deliverables

- sidecar manager in Electron main process
- port allocation logic
- healthcheck UI
- plugin receives verifier URL through host context

### Exit Criteria

- BenchLocal starts BugFind verifier automatically
- BugFind benchmark runs from desktop UI
- standalone BugFind scripts still work

## Milestone 6. Tool Loop Proof

### Goal

Convert `ToolCall-15`.

### Deliverables

- plugin core supports tool call traces
- result viewer supports tool call and tool result artifacts

### Exit Criteria

- full ToolCall benchmark runs through BenchLocal
- trace viewer can inspect tool activity

## Milestone 7. Remaining Plugins

Convert:

- InstructFollow-15
- ReasonMath-15
- StructOutput-15

### Exit Criteria

- all six benchmarks run in BenchLocal
- all six remain runnable standalone

## Milestone 8. Quality And Packaging

### Deliverables

- app packaging
- config migration support
- crash recovery
- better logs
- import and export config

### Exit Criteria

- installable desktop build exists
- config survives upgrades

## Technical Decisions To Lock Early

### 1. Monorepo Or Single App Repo

Recommendation:

- keep `BenchLocal` as its own workspace with internal packages

Reason:

- plugin host, SDK, and UI should version together at first

### 2. UI Stack

Recommendation:

- Electron
- React
- Vite
- TypeScript

Reason:

- simpler than running Next.js inside the desktop host

### 3. Config Format

Locked:

- `~/.benchlocal/config.toml`

### 4. Result Storage

Recommendation:

- filesystem-first JSON artifacts under `~/.benchlocal/runs/<run-id>/`

Reason:

- easy to inspect
- easy to debug
- no embedded DB needed for v0

### 5. Secret Storage

Recommendation:

- config-stored API key first
- env fallback

## Run Storage Model

Suggested structure:

```text
~/.benchlocal/runs/<run-id>/
  run.json
  events.jsonl
  results.json
  traces/
```

`run.json`

- plugin ID
- plugin version
- models used
- generation params
- timestamps

`events.jsonl`

- chronological progress event stream

`results.json`

- normalized scenario results
- aggregate scores

`traces/`

- optional large raw trace artifacts

## Initial Developer Tasks

### Task Group A. BenchLocal Skeleton

- create Electron app shell
- create package workspaces
- create config bootstrap
- create placeholder settings screens

### Task Group B. Core Runtime

- define shared TypeScript types
- implement config parser
- implement plugin manifest loader
- implement plugin host IPC

### Task Group C. First Plugin Migration

- adapt `DataExtract-15` into plugin mode
- preserve standalone `.env` mode

### Task Group D. Verifier Support

- implement Docker HTTP sidecar manager
- adapt `BugFind-15`

## Risk Register

### Risk: Plugin And Standalone Code Drift

Mitigation:

- keep benchmark logic outside framework-specific entrypoints

### Risk: Sidecar Startup Complexity

Mitigation:

- start with one sidecar kind only: `docker-http`

### Risk: Config Rewrite Corruption

Mitigation:

- write atomically
- keep backup
- validate before replace

### Risk: Over-abstracting Too Early

Mitigation:

- prove protocol against `DataExtract-15` and `BugFind-15` before expanding

## Recommended Execution Order

1. scaffold BenchLocal workspace
2. implement config management
3. implement settings UI
4. implement plugin registry
5. implement plugin host
6. migrate DataExtract-15
7. implement sidecar manager
8. migrate BugFind-15
9. migrate ToolCall-15
10. migrate the remaining three plugins

## Definition Of Done For BenchLocal v0

BenchLocal v0 is done when:

- the desktop app edits and persists shared config
- at least one simple plugin and one sidecar-backed plugin run successfully
- results persist to disk
- the six benchmark repos remain standalone-compatible
- BenchLocal is clearly the shared host for providers, models, and generation parameters
