# Bench Pack Authoring Guide

## Purpose

This guide describes the recommended structure for a Bench Pack that BenchLocal can install and run.

Bench Packs should be plain benchmark repos by default:

- a standalone web app is optional
- a CLI runner is recommended
- a verifier runtime is optional and only needed when the benchmark requires exact external validation

## Canonical metadata source

All Bench Pack metadata belongs in:

```text
benchlocal.pack.json
```

That file is the single authored metadata source.

Do not duplicate name, version, author, description, sampling defaults, or verifier metadata inside `benchlocal/index.ts`.

The runtime entry should load and export the JSON manifest.

## Required runtime artifact

BenchLocal expects every built artifact to include:

```text
benchlocal.pack.json
dist/benchlocal/index.js
```

Optional runtime content:

- `verification/`
- `README.md`
- `METHODOLOGY.md`

## Recommended repo shapes

### Minimal Bench Pack

```text
benchlocal.pack.json
benchlocal/
  index.ts
cli/
  run.ts
lib/
package.json
tsconfig.json
tsconfig.benchlocal.json
tsconfig.cli.json
README.md
METHODOLOGY.md
LICENSE
```

### Verifier-dependent Bench Pack

```text
benchlocal.pack.json
benchlocal/
  index.ts
cli/
  run.ts
lib/
verification/
  Dockerfile
  server.mjs
  core.mjs
scripts/          # optional local verifier helpers
package.json
tsconfig.json
tsconfig.benchlocal.json
tsconfig.cli.json
README.md
METHODOLOGY.md
LICENSE
```

## Source layout rules

- `lib/` owns benchmark behavior
  - scenarios
  - prompts
  - scoring
  - provider requests
  - verifier client logic where needed
- `benchlocal/index.ts` is the BenchLocal adapter layer
- `cli/` is recommended for local testing and debugging
- `verification/` is only for exact external validation that cannot live entirely inside the pack runtime

## Package dependencies

Bench Packs should depend on the published public packages:

```json
{
  "dependencies": {
    "@benchlocal/core": "0.2.0",
    "@benchlocal/sdk": "0.2.0"
  }
}
```

Use the current published version in real packs. The version above is an example, not a promise that it will stay current.

## `benchlocal/index.ts`

`benchlocal/index.ts` should stay thin.

Its job is to:

- load the manifest from `benchlocal.pack.json`
- export the manifest
- list scenarios for the desktop UI
- bridge `HostContext` into the pack's runtime logic
- return deterministic `ScenarioResult` values

Example:

```ts
import {
  createHostHelpers,
  defineBenchPack,
  loadBenchPackManifest,
  requireScoredResults,
  type ScenarioRunInput,
  type ScenarioResult
} from "@benchlocal/sdk";

import { SCENARIOS, getScenarioCards, scoreModelResults } from "../lib/benchmark";
import { runScenarioForModel } from "../lib/orchestrator";

const manifest = loadBenchPackManifest(__dirname);

export { manifest };

export default defineBenchPack({
  manifest,

  async listScenarios() {
    return SCENARIOS.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      category: scenario.category,
      detailCards: getScenarioCards(scenario)
    }));
  },

  async prepare(context) {
    const helpers = createHostHelpers(context);

    return {
      async runScenario(input: ScenarioRunInput): Promise<ScenarioResult> {
        return runScenarioForModel(input, helpers);
      },
      async dispose() {}
    };
  },

  scoreModelResults(results) {
    return scoreModelResults(requireScoredResults(results));
  }
});
```

## Sampling defaults

Bench Pack authors can declare recommended defaults in `benchlocal.pack.json`:

```json
{
  "samplingDefaults": {
    "temperature": 0
  }
}
```

Behavior:

- if a Bench Pack provides a default, BenchLocal uses it unless the user overrides it in that tab
- if a field is omitted, BenchLocal does not send that field

## Compatibility requirements

If your pack depends on a newer BenchLocal client feature, declare that in `benchlocal.pack.json` so older clients fail early and clearly.

Example:

```json
{
  "requirements": {
    "benchlocal": {
      "minVersion": "0.2.0"
    },
    "hostFeatures": ["inferenceEndpoints", "dockerInferenceEndpoints"]
  }
}
```

Use this when your pack requires:

- a minimum BenchLocal client release
- a host-managed runtime feature such as inference endpoints
- an upper client-version bound for a future breaking change

## Non-verifier vs verifier-dependent packs

### Non-verifier packs

The common case is a pack that only needs model access and scoring logic.

These packs:

- do not declare `verifiers`
- do not ship `verification/`
- rely only on provider/model access from `HostContext`

If your pack embeds an external agent runtime that expects its own OpenAI-compatible base URL, prefer `createHostHelpers(context).getRequiredInferenceEndpoint(modelId)` over wiring provider secrets into the pack runtime directly. This keeps model selection and upstream credentials owned by BenchLocal.

If that runtime lives inside a Docker verifier, forward `dockerBaseUrl ?? baseUrl` to the verifier rather than the upstream provider credentials.

### Verifier-dependent packs

Use a verifier only when the benchmark genuinely needs external execution or exact checking.

If a pack requires a verifier:

- declare it in `benchlocal.pack.json`
- include the runtime in `verification/`
- use `createHostHelpers(context).getRequiredVerifier(...)` to consume the resolved endpoint

Example manifest fragment:

```json
{
  "verifiers": [
    {
      "id": "verifier",
      "transport": "http",
      "required": true,
      "defaultMode": "docker",
      "docker": {
        "buildContext": "./verification",
        "listenPort": 4010,
        "healthcheckPath": "/health"
      }
    }
  ]
}
```

Important:

- BenchLocal assigns the host port automatically
- the pack only declares the internal `listenPort`

## CLI testing

The CLI runner is not required by BenchLocal, but it is useful for:

- local benchmark debugging
- methodology verification
- reproducing pack behavior outside the desktop app

## Recommended scripts

```json
{
  "scripts": {
    "build:benchlocal": "tsc -p tsconfig.benchlocal.json && tsc-alias -p tsconfig.benchlocal.json",
    "build:cli": "tsc -p tsconfig.cli.json && tsc-alias -p tsconfig.cli.json",
    "cli": "npm run build:cli && node dist-cli/cli/run.js"
  }
}
```

## Packaging checklist

When shipping a Bench Pack artifact:

- keep `benchlocal.pack.json` at repo root
- compile the BenchLocal adapter to `dist/benchlocal/index.js`
- include `verification/` only if the pack actually requires it
- avoid shipping repo-local development files that are not needed at runtime

BenchLocal validates the artifact before activation, so the runtime surface should stay small, deterministic, and explicit.
