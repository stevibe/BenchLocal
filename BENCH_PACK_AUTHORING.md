# Bench Pack Authoring Guide

## Purpose

This document describes how to build a Bench Pack that BenchLocal can load.

BenchLocal Bench Packs should be thin adapters over benchmark logic that already exists in a repo.

Recommended split:

- benchmark core
  - scenarios
  - prompts
  - scoring
  - verifier logic
  - model transport
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

Each Bench Pack repo should expose:

```text
benchlocal.pack.json
dist/benchlocal/index.js
```

Recommended source layout:

```text
app/
components/
lib/
benchlocal/
  index.ts
cli/
verification/     # optional
scripts/          # optional
```

Layout rules:

- `lib/` owns the benchmark logic, scenario definitions, grading, and transport code.
- `benchlocal/index.ts` is the only place that should depend on `@benchlocal/sdk`.
- `benchlocal.pack.json` is the static install/discovery manifest and should mirror the runtime manifest metadata.
- `verification/` is optional and only used when exact validation needs a helper runtime.
- Scenario packs declare the verifier's internal `listenPort`; BenchLocal assigns the host port automatically.

## Runtime Surface

BenchLocal loads the compiled Bench Pack entry and expects:

```ts
export const manifest: BenchPackManifest;

export default defineBenchPack({
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

Scenario pack repos should import from `@benchlocal/sdk` only in the BenchLocal adapter layer.

During local development, Bench Pack repos can depend on the SDK and core packages with local `file:` dependencies, for example:

```json
{
  "dependencies": {
    "@benchlocal/core": "file:../BenchLocal/packages/benchlocal-core",
    "@benchlocal/sdk": "file:../BenchLocal/packages/benchlocal-sdk"
  }
}
```

Useful exports:

- `defineBenchPackManifest(...)`
- `defineBenchPack(...)`
- `createHostHelpers(context)`
- `requireScoredResults(results)`
- all core protocol types re-exported from `@benchlocal/core`

### Example

```ts
import {
  createHostHelpers,
  defineBenchPack,
  defineBenchPackManifest,
  requireScoredResults,
  type ScenarioRunInput,
  type ScenarioResult
} from "@benchlocal/sdk";

import { SCENARIOS, getScenarioCards, scoreModelResults } from "../lib/benchmark";
import { runScenarioForModel } from "../lib/orchestrator";

const manifest = defineBenchPackManifest({
  id: "dataextract-15",
  name: "DataExtract-15",
  author: "Your Name",
  version: "0.1.0",
  description: "Deterministic LLM data extraction benchmark with 15 fixed scenarios.",
  entry: "./dist/benchlocal/index.js",
  samplingDefaults: {
    temperature: 0
  },
  theme: {
    accent: "#0891b2"
  },
  capabilities: {
    tools: false,
    multiTurn: false,
    streamingProgress: true,
    verification: false,
    standaloneWebApp: true
  }
});

export { manifest };

export default defineBenchPack({
  manifest,

  async listScenarios() {
    return getScenarioCards().map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      category: scenario.category,
      description: scenario.description,
      promptText: scenario.userMessage,
      detailCards: [
        {
          title: "What this tests",
          content: scenario.description
        },
        {
          title: "Success case",
          content: scenario.successCase
        },
        {
          title: "Failure case",
          content: scenario.failureCase
        }
      ]
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
- `context.verifiers`

For Bench Pack sampling defaults, declare them on the SDK manifest:

- `manifest.samplingDefaults`

BenchLocal merges Bench Pack sampling defaults with per-tab user overrides from the `Samplings` button. If a field is left blank in both places, BenchLocal does not send that value to the model provider.

## Verifiers

If a benchmark requires a verifier or helper service:

- declare it in `benchlocal.pack.json`
- declare it in the runtime manifest too
- do not hardcode host-side startup policy in the Bench Pack

BenchLocal owns lifecycle:

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
4. Keep `benchlocal.pack.json` aligned with the runtime manifest metadata.
5. Map host context into the repo's existing runtime types.
6. Compile that adapter to `dist/benchlocal/index.js`.

## Current Trust Model

BenchLocal currently assumes Bench Packs are trusted.

That means Bench Pack authors should treat the host runtime surface as privileged and avoid unnecessary file access, process spawning, or side effects.
