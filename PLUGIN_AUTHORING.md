# Plugin Authoring Guide

## Purpose

This document describes how to build a benchmark plugin that BenchLocal can load.

BenchLocal plugins should be thin adapters over benchmark logic that already exists in a repo.

Recommended split:

- benchmark core
  - scenarios
  - prompts
  - tool loop
  - verifier logic
  - scoring
- standalone adapter
  - Next.js app
  - `.env`
  - repo-local scripts
- BenchLocal adapter
  - manifest
  - scenario listing
  - host-context mapping
  - run lifecycle

## Required Files

Each plugin repo should expose:

```text
benchlocal.plugin.json
dist/benchlocal/index.js
```

Recommended source layout:

```text
benchlocal/
  index.ts
lib/
  benchmark.ts
  orchestrator.ts
```

## Runtime Surface

BenchLocal loads the compiled plugin entry and expects:

```ts
export const manifest: PluginManifest;

export default defineBenchPlugin({
  manifest,
  async listScenarios() {
    return [];
  },
  async prepare(context) {
    return {
      async runScenario(input, emit) {
        return {
          scenarioId: input.scenario.id,
          status: "pass",
          summary: "ok",
          rawLog: ""
        };
      },
      async dispose() {}
    };
  },
  scoreModelResults(results) {
    return {
      totalScore: 0,
      categories: []
    };
  }
});
```

## SDK

Plugin repos should import from `@benchlocal/sdk`.

During local development, benchmark repos can depend on the SDK and core packages with local `file:` dependencies, for example:

```json
{
  "dependencies": {
    "@benchlocal/core": "file:../BenchLocal/packages/benchlocal-core",
    "@benchlocal/sdk": "file:../BenchLocal/packages/benchlocal-sdk"
  }
}
```

Useful exports:

- `definePluginManifest(...)`
- `defineBenchPlugin(...)`
- `createHostHelpers(context)`
- `requireScoredResults(results)`
- all core protocol types re-exported from `@benchlocal/core`

### Example

```ts
import {
  createHostHelpers,
  defineBenchPlugin,
  definePluginManifest,
  requireScoredResults,
  type ScenarioRunInput,
  type ScenarioResult
} from "@benchlocal/sdk";

import { SCENARIOS, scoreModelResults } from "../lib/benchmark";
import { runScenarioForModel } from "../lib/orchestrator";

const manifest = definePluginManifest({
  id: "dataextract-15",
  name: "DataExtract-15",
  version: "0.1.0",
  description: "Deterministic LLM data extraction benchmark with 15 fixed scenarios.",
  entry: "./dist/benchlocal/index.js",
  theme: {
    accent: "#0891b2"
  },
  capabilities: {
    tools: false,
    multiTurn: false,
    streamingProgress: true,
    sidecars: false,
    standaloneWebApp: true
  }
});

export { manifest };

export default defineBenchPlugin({
  manifest,

  async listScenarios() {
    return SCENARIOS.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      category: scenario.category,
      description: scenario.description
    }));
  },

  async prepare(context) {
    const helpers = createHostHelpers(context);

    return {
      async runScenario(input, emit): Promise<ScenarioResult> {
        const scenario = helpers.getScenarioById(SCENARIOS, input.scenario.id);
        const provider = helpers.getRequiredProvider(input.model.provider, { enabledOnly: true });

        return runScenarioForModel(
          {
            id: input.model.id,
            label: input.model.label,
            provider: input.model.provider as "openrouter" | "ollama" | "llamacpp" | "mlx" | "lmstudio",
            model: input.model.model,
            baseUrl: provider.baseUrl,
            apiKey: helpers.getSecretValue(input.model.provider)
          },
          scenario,
          emit,
          {
            ...helpers.resolveGenerationRequest(input.generation),
            signal: input.abortSignal
          }
        );
      },
      async dispose() {}
    };
  },

  scoreModelResults(results) {
    const summary = scoreModelResults(requireScoredResults(results));

    return {
      totalScore: summary.finalScore,
      categories: summary.categoryScores.map((category) => ({
        id: category.category,
        label: category.label,
        score: category.averageScore,
        weight: category.weight
      })),
      summary: summary.rating
    };
  }
});
```

## Host Context Rules

In BenchLocal mode:

- do not read provider config from `.env` as the primary source
- do not hardcode base URLs
- do not own API key lookup outside the host context
- do not invent separate model registries

Use the host context instead:

- `context.providers`
- `context.models`
- `context.secrets`
- `context.sidecars`

For scenario pack sampling defaults, declare them on the SDK manifest:

- `manifest.samplingDefaults`

BenchLocal merges scenario pack sampling defaults with per-tab user overrides from the `Samplings` button. If a field is left blank in both places, BenchLocal does not send that value to the model provider.

## Sidecars

If a benchmark requires a verifier or helper service:

- declare it in `benchlocal.plugin.json`
- do not hardcode host-side startup policy in the plugin

BenchLocal should own lifecycle:

- start
- stop
- healthcheck
- port assignment
- logs

## Migration Advice

When converting an existing benchmark repo:

1. Keep standalone code intact.
2. Reuse existing benchmark logic from `lib/`.
3. Add a thin `benchlocal/index.ts`.
4. Map host context into the repo's existing runtime types.
5. Compile that adapter to `dist/benchlocal/index.js`.

## Current Trust Model

BenchLocal currently assumes plugins are trusted.

That means plugin authors should treat the host runtime surface as privileged and avoid unnecessary file access, process spawning, or side effects.
