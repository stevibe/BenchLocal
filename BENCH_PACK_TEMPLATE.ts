import {
  createHostHelpers,
  defineBenchPack,
  loadBenchPackManifest,
  requireScoredResults,
  type ProgressEmitter,
  type ScenarioResult,
  type ScenarioRunInput
} from "@benchlocal/sdk";

const SCENARIOS = [
  {
    id: "EX-01",
    title: "Example Scenario",
    description: "Replace this with real benchmark metadata.",
    successCase: "Describe what a correct answer should do.",
    failureCase: "Describe the common miss that should fail."
  }
] as const;

export const manifest = loadBenchPackManifest(__dirname);

export default defineBenchPack({
  manifest,

  async listScenarios() {
    return SCENARIOS.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      description: scenario.description,
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
