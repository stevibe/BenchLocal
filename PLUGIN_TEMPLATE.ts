import {
  createHostHelpers,
  defineBenchPlugin,
  definePluginManifest,
  requireScoredResults,
  type ProgressEmitter,
  type ScenarioResult,
  type ScenarioRunInput
} from "@benchlocal/sdk";

const SCENARIOS = [
  {
    id: "EX-01",
    title: "Example Scenario",
    description: "Replace this with real benchmark metadata."
  }
] as const;

export const manifest = definePluginManifest({
  id: "example-plugin",
  name: "Example Plugin",
  version: "0.1.0",
  description: "Minimal BenchLocal plugin template.",
  entry: "./dist/benchlocal/index.js",
  samplingDefaults: {
    temperature: 0
  },
  capabilities: {
    tools: false,
    multiTurn: false,
    streamingProgress: true,
    sidecars: false,
    standaloneWebApp: false
  }
});

export default defineBenchPlugin({
  manifest,

  async listScenarios() {
    return [...SCENARIOS];
  },

  async prepare(context) {
    const helpers = createHostHelpers(context);

    return {
      async runScenario(input: ScenarioRunInput, emit: ProgressEmitter): Promise<ScenarioResult> {
        const scenario = helpers.getScenarioById(SCENARIOS, input.scenario.id);

        await emit({
          type: "model_progress",
          modelId: input.model.id,
          scenarioId: scenario.id,
          message: "Running example scenario"
        });

        return {
          scenarioId: scenario.id,
          status: "pass",
          score: 1,
          summary: "Replace this with real benchmark logic.",
          rawLog: `scenario=${scenario.id}\nmodel=${input.model.id}`
        };
      },

      async dispose() {}
    };
  },

  scoreModelResults(results) {
    const scored = requireScoredResults(results);

    return {
      totalScore: scored.reduce((total, result) => total + result.score, 0),
      categories: [
        {
          id: "overall",
          label: "Overall",
          score: scored.length === 0 ? 0 : scored.reduce((total, result) => total + result.score, 0) / scored.length
        }
      ]
    };
  }
});
