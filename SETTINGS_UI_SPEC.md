# BenchLocal Settings UI Spec

## Purpose

This document defines the initial settings and management UI for BenchLocal.

The settings UI is a core product requirement. It is not optional polish.

BenchLocal exists partly so users do not need to edit multiple `.env` files across six separate repos.

## Principles

- one place for shared model and provider configuration
- clear status for dependencies and secrets
- low-friction editing for common tasks
- advanced configuration still possible through `config.toml`

## Main Navigation

BenchLocal should expose these primary sections:

- Benchmarks
- Runs
- Settings
- Logs

Inside `Settings`, use these tabs:

- Providers
- Models
- Generation
- Bench Packs
- Sidecars
- Advanced

## Providers Tab

### Purpose

Configure provider endpoints and credentials.

### Required UI

Each provider row should show:

- provider name
- enabled toggle
- base URL
- credential status
- connection test button

### Known Providers

- OpenRouter
- Ollama
- llama.cpp
- mlx_lm
- LM Studio

### Provider Actions

- enable or disable
- edit base URL
- set or replace credential
- test connection

### Validation

- base URL must be valid HTTP or HTTPS
- provider requiring auth must show missing secret state
- connection test should report success or failure explicitly

## Models Tab

### Purpose

Manage the shared model registry used by all benchpacks.

### Required UI

Table columns:

- enabled
- label
- provider
- model identifier
- group
- actions

### Actions

- add model
- edit model
- disable model
- delete model
- move between groups

### Add/Edit Model Form

Fields:

- provider
- model ID
- display label
- group
- enabled

### Validation

- provider must exist
- model ID must be non-empty
- generated `provider:model` ID must be unique

## Generation Tab

### Purpose

Manage host-level default request parameters.

### Required Controls

- temperature
- top_p
- top_k
- min_p
- repetition_penalty
- request timeout seconds
- max concurrent models
- max concurrent runs

### UX Notes

- show default values
- explain which fields may be ignored by some providers
- allow restore defaults

## Bench Packs Tab

### Purpose

Install, inspect, update, and remove Bench Packs.

### Required UI

Each Bench Pack row should show:

- Bench Pack name
- Bench Pack ID
- installed version
- source
- capabilities
- install status
- standalone support

### Actions

- install from local path
- install from git repo
- update
- remove
- inspect manifest

### Bench Pack detail view

Show:

- manifest metadata
- supported scenarios
- sidecar requirements
- install path
- current status

## Sidecars Tab

### Purpose

Manage benchmark-specific verification dependencies.

### Required UI

Each sidecar row should show:

- Bench Pack
- sidecar ID
- kind
- auto-start toggle
- configured port
- status
- healthcheck result

### Actions

- start
- stop
- restart
- view logs
- change port

### UX Notes

- surface port conflicts clearly
- show last healthcheck timestamp
- show the effective URL the Bench Pack receives

## Advanced Tab

### Purpose

Expose filesystem and maintenance operations.

### Required UI

- config file path
- Bench Pack directory path
- runs directory path
- logs directory path
- export config
- import config
- open config file
- reset UI state

### Dangerous Actions

- clear cache
- remove all run history

These must require confirmation.

## Settings Persistence Rules

### Save Strategy

Use explicit save for multi-field forms, not per-keystroke file writes.

Recommended behavior:

- form edits stay local
- save button validates and writes atomically
- cancel button discards local changes

### Error Surface

Validation errors should be shown:

- inline for fields
- as section-level summaries where useful

Do not hide file write failures.

## First-Run Experience

On first launch, BenchLocal should guide the user through:

1. select or confirm config location
2. configure one provider
3. add at least one model
4. install or register at least one Bench Pack

This can be a lightweight setup flow, not a mandatory wizard.

## Benchmarks Screen

This is not part of Settings, but the settings model directly supports it.

The Benchmarks screen should show:

- installed benchpacks
- Bench Pack status
- scenario count
- whether sidecars are ready
- quick launch buttons

## Runs Screen

This is also outside Settings, but should consume normalized result data.

Required features:

- current run progress
- recent runs
- per-scenario matrix
- raw trace viewer
- aggregate score summary

## Default Empty States

### No Providers

Show:

- message that no providers are configured
- shortcut to Providers tab

### No Models

Show:

- message that no models are configured
- shortcut to Models tab

### No Bench Packs

Show:

- install Bench Pack CTA
- explain local-path and repo-based install

## Accessibility And Practical UX

Required:

- keyboard navigable forms
- readable status colors
- explicit text labels in addition to color cues
- copyable paths and URLs

## Suggested Implementation Order

1. Providers
2. Models
3. Generation
4. Bench Packs
5. Sidecars
6. Advanced

This order matches the minimum path needed for a user to successfully run a benchmark.
