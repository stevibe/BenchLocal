# @benchlocal/core

Core types and shared runtime contracts for BenchLocal and Bench Packs.

This package is the low-level foundation for the BenchLocal ecosystem. It defines the data structures that the BenchLocal desktop app, Bench Pack host runtime, and Bench Pack SDK all agree on.

Use `@benchlocal/core` when you need the protocol and storage shapes directly. If you are authoring a Bench Pack, you will usually import from `@benchlocal/sdk` instead.

## Install

```bash
npm install @benchlocal/core
```

## What this package contains

- Bench Pack manifest and runtime protocol types
- provider, model, secret, and verifier types
- workspace state types
- config loading and normalization helpers
- theme types

The public entrypoint exports:

- `config`
- `protocol`
- `theme`
- `workspaces`

## Intended users

- BenchLocal app and host code
- Bench Pack tooling
- ecosystem tooling that needs to read or validate BenchLocal config or workspace state

## Stability

`@benchlocal/core` is part of the public BenchLocal ecosystem surface, but it is lower-level than `@benchlocal/sdk`. Bench Pack authors should prefer the SDK unless they specifically need direct access to the core protocol or config types.

## Repository

- BenchLocal monorepo: https://github.com/stevibe/BenchLocal
- Issues: https://github.com/stevibe/BenchLocal/issues
