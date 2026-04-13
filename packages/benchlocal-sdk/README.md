# @benchlocal/sdk

SDK for authoring Bench Packs that run inside BenchLocal.

This package sits on top of `@benchlocal/core` and provides the thin authoring layer used by official Bench Packs:

- typed manifest loading
- Bench Pack runtime definition helpers
- host-context lookup helpers
- result helpers for scoring

## Install

```bash
npm install @benchlocal/sdk
```

## Typical usage

Keep your benchmark logic in your own repo code, and use the SDK only inside `benchlocal/index.ts`.

```ts
import {
  createHostHelpers,
  defineBenchPack,
  loadBenchPackManifest,
  requireScoredResults
} from "@benchlocal/sdk";

const manifest = loadBenchPackManifest(__dirname);

export { manifest };

export default defineBenchPack({
  manifest,
  async listScenarios() {
    return [];
  },
  async prepare(context) {
    const helpers = createHostHelpers(context);

    return {
      async runScenario(input) {
        const provider = helpers.getRequiredProvider(input.model.provider, { enabledOnly: true });

        return {
          scenarioId: input.scenario.id,
          status: "pass",
          summary: provider.baseUrl
        };
      },
      async dispose() {}
    };
  },
  scoreModelResults(results) {
    const scored = requireScoredResults(results);

    return {
      totalScore: scored.reduce((sum, result) => sum + result.score, 0),
      categories: []
    };
  }
});
```

## Main helpers

- `loadBenchPackManifest(__dirname)`
- `defineBenchPack(...)`
- `defineBenchPackManifest(...)`
- `createHostHelpers(context)`
- `requireScoredResults(results)`

`@benchlocal/sdk` also re-exports the main public types from `@benchlocal/core`.

## Authoring model

- keep canonical Bench Pack metadata in `benchlocal.pack.json`
- load and export that metadata from `benchlocal/index.ts`
- keep benchmark logic in your own repo modules such as `lib/`
- use the SDK only for the BenchLocal adapter layer

## Repository

- BenchLocal monorepo: https://github.com/stevibe/BenchLocal
- Issues: https://github.com/stevibe/BenchLocal/issues
