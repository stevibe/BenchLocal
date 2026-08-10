import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  RadarController,
  RadialLinearScale,
  Tooltip,
  type ChartConfiguration,
  type Plugin
} from "chart.js";
import type {
  BenchLocalModelConfig,
  BenchLocalProviderConfig,
  BenchPackRunSummary,
  ScenarioMeta,
  ScenarioResult
} from "@core";
import benchlocalIconUrl from "../../../../../assets/benchlocal-icon.png";
import displayFontUrl from "../../assets/fonts/InterVariable.woff2";
import monoFontUrl from "../../assets/fonts/JetBrainsMonoVariable.woff2";

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  RadarController,
  RadialLinearScale,
  Tooltip
);

export type ShareResultsChartType = "overview" | "categories" | "radar" | "heatmap";
export type ShareResultsFormatId = "social" | "presentation" | "square";
export type ShareResultsTheme = "dark" | "light";
export type ShareResultStatus = "pass" | "partial" | "fail" | "error" | "missing";

export type ShareResultsModelSource = Pick<
  BenchLocalModelConfig,
  "id" | "provider" | "model" | "label"
> & {
  displayLabel?: string;
};

export type ShareResultsCategory = {
  id: string;
  label: string;
};

export type ShareResultsScenario = {
  id: string;
  title: string;
};

export type ShareResultsModel = {
  id: string;
  label: string;
  providerName: string;
  modelIdentifier: string;
  totalScore: number | null;
  categoryScores: Record<string, number>;
  statusCounts: Record<ShareResultStatus, number>;
  scenarioStatuses: Record<string, ShareResultStatus>;
  medianDurationMs: number | null;
};

export type ShareResultsData = {
  runId: string;
  benchPackId: string;
  benchPackName: string;
  runDateLabel: string;
  runModeLabel: string;
  runsPerTest: number;
  scenarioCount: number;
  completedAt: string;
  isIncomplete: boolean;
  categories: ShareResultsCategory[];
  scenarios: ShareResultsScenario[];
  models: ShareResultsModel[];
};

export type ShareResultsRenderOptions = {
  chartType: ShareResultsChartType;
  formatId: ShareResultsFormatId;
  theme: ShareResultsTheme;
  modelIds: string[];
  categoryIds: string[];
  title: string;
  subtitle: string;
  insight: string;
  footerNote: string;
  showInsight: boolean;
  showDate: boolean;
  showRunDetails: boolean;
  showProviders: boolean;
  showBranding: boolean;
};

export const SHARE_RESULTS_FORMATS: Record<
  ShareResultsFormatId,
  { label: string; description: string; width: number; height: number }
> = {
  social: {
    label: "Social",
    description: "2:1 landscape",
    width: 2400,
    height: 1260
  },
  presentation: {
    label: "Presentation",
    description: "16:9 slide",
    width: 3200,
    height: 1800
  },
  square: {
    label: "Square",
    description: "1:1 post",
    width: 2160,
    height: 2160
  }
};

export const SHARE_RESULTS_CHARTS: Array<{
  id: ShareResultsChartType;
  label: string;
  description: string;
  maxModels: number;
}> = [
  {
    id: "overview",
    label: "Overview",
    description: "Ranked total scores",
    maxModels: 8
  },
  {
    id: "categories",
    label: "Categories",
    description: "Grouped category comparison",
    maxModels: 4
  },
  {
    id: "radar",
    label: "Radar",
    description: "Model capability profiles",
    maxModels: 4
  },
  {
    id: "heatmap",
    label: "Heatmap",
    description: "Scenario-level outcomes",
    maxModels: 8
  }
];

const DISPLAY_FONT_FAMILY = "BenchLocal Share Results Inter";
const MONO_FONT_FAMILY = "BenchLocal Share Results Mono";
const MODEL_COLORS_DARK = ["#2da7ff", "#68d391", "#f4b95f", "#b68cff", "#ff7f7f", "#52d6c5", "#f38ac5", "#9fb7ff"];
const MODEL_COLORS_LIGHT = ["#087bbd", "#218c56", "#b36b00", "#7549bd", "#c43d4e", "#13877c", "#b84284", "#496fc4"];

let assetsPromise: Promise<{ logo: HTMLImageElement | null }> | null = null;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

function loadShareResultsAssets(): Promise<{ logo: HTMLImageElement | null }> {
  assetsPromise ??= Promise.all([
    new FontFace(DISPLAY_FONT_FAMILY, `url(${displayFontUrl})`).load(),
    new FontFace(MONO_FONT_FAMILY, `url(${monoFontUrl})`).load(),
    loadImage(benchlocalIconUrl)
  ]).then(([displayFont, monoFont, logo]) => {
    (document.fonts as FontFaceSet & { add(font: FontFace): void }).add(displayFont);
    (document.fonts as FontFaceSet & { add(font: FontFace): void }).add(monoFont);
    return { logo };
  }).catch(async () => ({ logo: await loadImage(benchlocalIconUrl) }));

  return assetsPromise;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function resultStatus(result: ScenarioResult | undefined): ShareResultStatus {
  if (!result) {
    return "missing";
  }

  if (result.errorType === "provider_error" || result.errorType === "execution_error") {
    return "error";
  }

  return result.status;
}

function runModeLabel(value: BenchPackRunSummary["executionMode"]): string {
  switch (value) {
    case "serial":
      return "Serial per Test Case";
    case "serial_by_model":
      return "Serial per Model";
    case "parallel_by_model":
      return "Parallel per Model";
    case "full_parallel":
      return "Parallel for All";
    case "parallel_by_test_case":
    default:
      return "Parallel per Test Case";
  }
}

function fallbackProviderName(providerId: string): string {
  return providerId
    .replaceAll("_", " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase()) || "Unknown Provider";
}

export function buildShareResultsData({
  runSummary,
  models,
  providers,
  scenarios
}: {
  runSummary: BenchPackRunSummary;
  models: ShareResultsModelSource[];
  providers: Record<string, BenchLocalProviderConfig>;
  scenarios: ScenarioMeta[];
}): ShareResultsData {
  const sourceModels = new Map(models.map((model) => [model.id, model]));
  const runStarted = runSummary.events.find((event) => event.type === "run_started");
  const runLabels = new Map(runStarted?.type === "run_started" ? runStarted.models.map((model) => [model.id, model.label]) : []);
  const modelIds = Array.from(new Set([
    ...Object.keys(runSummary.scores),
    ...Object.keys(runSummary.resultsByModel),
    ...(runStarted?.type === "run_started" ? runStarted.models.map((model) => model.id) : [])
  ]));
  const scenarioById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  const scenarioIds = Array.from(new Set([
    ...scenarios.map((scenario) => scenario.id),
    ...Object.values(runSummary.resultsByModel).flatMap((results) => results.map((result) => result.scenarioId))
  ]));
  const normalizedScenarios: ShareResultsScenario[] = scenarioIds.map((scenarioId) => ({
    id: scenarioId,
    title: scenarioById.get(scenarioId)?.title ?? scenarioId
  }));

  while (normalizedScenarios.length < runSummary.scenarioCount) {
    const scenarioNumber = normalizedScenarios.length + 1;
    normalizedScenarios.push({
      id: `unrecorded-${scenarioNumber}`,
      title: `Unrecorded scenario ${scenarioNumber}`
    });
  }
  const categoryMap = new Map<string, ShareResultsCategory>();

  Object.values(runSummary.scores).forEach((score) => {
    score.categories.forEach((category) => {
      if (!categoryMap.has(category.id)) {
        categoryMap.set(category.id, { id: category.id, label: category.label });
      }
    });
  });

  const normalizedModels = modelIds.map((modelId): ShareResultsModel => {
    const source = sourceModels.get(modelId);
    const score = runSummary.scores[modelId];
    const results = runSummary.resultsByModel[modelId] ?? [];
    const resultsByScenario = new Map(results.map((result) => [result.scenarioId, result]));
    const scenarioStatuses: Record<string, ShareResultStatus> = {};
    const statusCounts: Record<ShareResultStatus, number> = {
      pass: 0,
      partial: 0,
      fail: 0,
      error: 0,
      missing: 0
    };

    normalizedScenarios.forEach((scenario) => {
      const status = resultStatus(resultsByScenario.get(scenario.id));
      scenarioStatuses[scenario.id] = status;
      statusCounts[status] += 1;
    });

    const providerName = source
      ? providers[source.provider]?.name?.trim() || fallbackProviderName(source.provider)
      : "Saved run";
    const modelIdentifier = source?.model?.trim() || modelId.split(":").slice(1).join(":") || modelId;
    const categoryScores = Object.fromEntries(score?.categories.map((category) => [category.id, category.score]) ?? []);
    const durations = results
      .map((result) => result.timings?.durationMs)
      .filter((duration): duration is number => typeof duration === "number" && Number.isFinite(duration));

    return {
      id: modelId,
      label: source?.displayLabel?.trim() || source?.label?.trim() || runLabels.get(modelId) || modelIdentifier,
      providerName,
      modelIdentifier,
      totalScore: score && Number.isFinite(score.totalScore) ? score.totalScore : null,
      categoryScores,
      statusCounts,
      scenarioStatuses,
      medianDurationMs: median(durations)
    };
  });

  return {
    runId: runSummary.runId,
    benchPackId: runSummary.benchPackId,
    benchPackName: runSummary.benchPackName || runSummary.benchPackId,
    runDateLabel: formatDate(runSummary.startedAt),
    runModeLabel: runModeLabel(runSummary.executionMode),
    runsPerTest: Math.max(1, Math.round(runSummary.runsPerTest ?? 1)),
    scenarioCount: runSummary.scenarioCount,
    completedAt: runSummary.completedAt,
    isIncomplete: Boolean(runSummary.cancelled || runSummary.error) || normalizedModels.some((model) => model.statusCounts.missing > 0),
    categories: Array.from(categoryMap.values()),
    scenarios: normalizedScenarios,
    models: normalizedModels.sort((left, right) => (right.totalScore ?? -Infinity) - (left.totalScore ?? -Infinity))
  };
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  color: string
): void {
  roundedRect(ctx, x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
}

function truncateText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) {
    return value;
  }

  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${value.slice(0, middle)}…`).width <= maxWidth) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return `${value.slice(0, low)}…`;
}

function inferScaleMax(values: Array<number | null | undefined>): number {
  const maximum = Math.max(0, ...values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
  if (maximum <= 1) return 1;
  if (maximum <= 5) return 5;
  if (maximum <= 10) return 10;
  if (maximum <= 100) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  return Math.ceil(maximum / magnitude) * magnitude;
}

export function getShareResultsChartTitle(chartType: ShareResultsChartType): string {
  switch (chartType) {
    case "categories":
      return "Category comparison";
    case "radar":
      return "Capability profiles";
    case "heatmap":
      return "Scenario outcomes";
    case "overview":
    default:
      return "Model ranking";
  }
}

export function buildShareResultsInsight(
  data: ShareResultsData,
  options: Pick<ShareResultsRenderOptions, "chartType" | "modelIds" | "categoryIds">
): string {
  const selectedModelSet = new Set(options.modelIds);
  const models = data.models.filter((model) => selectedModelSet.has(model.id));

  if (models.length === 0) {
    return "Select models to generate an insight";
  }

  if (options.chartType === "heatmap") {
    const leader = [...models].sort((left, right) => right.statusCounts.pass - left.statusCounts.pass)[0];
    const scenarioLabel = data.scenarioCount === 1 ? "scenario" : "scenarios";
    return `${leader.label} passes ${leader.statusCounts.pass} of ${data.scenarioCount} ${scenarioLabel}`;
  }

  if (options.chartType === "categories" || options.chartType === "radar") {
    const selectedCategorySet = new Set(options.categoryIds);
    const categories = data.categories.filter((category) => selectedCategorySet.has(category.id));
    const averages = models.map((model) => {
      const scores = categories
        .map((category) => model.categoryScores[category.id])
        .filter((score): score is number => Number.isFinite(score));
      return {
        model,
        average: scores.length > 0 ? scores.reduce((total, score) => total + score, 0) / scores.length : null
      };
    }).filter((entry): entry is { model: ShareResultsModel; average: number } => entry.average !== null);
    const leader = averages.sort((left, right) => right.average - left.average)[0];

    if (leader) {
      return `${leader.model.label} has the strongest selected-category average at ${formatScore(leader.average)}`;
    }
  }

  const ranked = models
    .filter((model): model is ShareResultsModel & { totalScore: number } => model.totalScore !== null)
    .sort((left, right) => right.totalScore - left.totalScore);
  const leader = ranked[0];
  const runnerUp = ranked[1];

  if (!leader) {
    return "Scores are not available for the selected models";
  }

  if (!runnerUp) {
    return `${leader.label} scores ${formatScore(leader.totalScore)}`;
  }

  const lead = leader.totalScore - runnerUp.totalScore;
  if (lead === 0) {
    return `${leader.label} and ${runnerUp.label} share the lead at ${formatScore(leader.totalScore)}`;
  }

  return `${leader.label} leads by ${formatScore(lead)} ${lead === 1 ? "point" : "points"}`;
}

function preserveChartFrame(canvas: HTMLCanvasElement, chart: Chart): void {
  const snapshot = document.createElement("canvas");
  snapshot.width = canvas.width;
  snapshot.height = canvas.height;
  snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
  chart.destroy();
  canvas.getContext("2d")?.drawImage(snapshot, 0, 0);
}

function renderBarChart({
  canvas,
  models,
  categories,
  chartType,
  palette,
  fontScale,
  modelColors
}: {
  canvas: HTMLCanvasElement;
  models: ShareResultsModel[];
  categories: ShareResultsCategory[];
  chartType: "overview" | "categories";
  palette: ReturnType<typeof getPalette>;
  fontScale: number;
  modelColors: string[];
}): void {
  const values = chartType === "overview"
    ? models.map((model) => model.totalScore)
    : models.flatMap((model) => categories.map((category) => model.categoryScores[category.id]));
  const scaleMax = inferScaleMax(values);
  const valueLabels: Plugin<"bar"> = {
    id: "benchlocal-value-labels",
    afterDatasetsDraw(chart) {
      if (chartType !== "overview") {
        return;
      }

      const chartContext = chart.ctx;
      chartContext.save();
      chartContext.fillStyle = palette.text;
      chartContext.font = `800 ${Math.round(20 * fontScale)}px "${MONO_FONT_FAMILY}", monospace`;
      chartContext.textBaseline = "middle";
      chart.data.datasets.forEach((dataset, datasetIndex) => {
        const meta = chart.getDatasetMeta(datasetIndex);
        meta.data.forEach((element, index) => {
          const value = dataset.data[index];
          if (typeof value !== "number") return;
          const bar = element as BarElement;
          chartContext.fillText(formatScore(value), bar.x + 14 * fontScale, bar.y);
        });
      });
      chartContext.restore();
    }
  };

  const commonOptions = {
    responsive: false,
    animation: false as const,
    devicePixelRatio: 1,
    events: [],
    maintainAspectRatio: false,
    layout: {
      padding: {
        top: Math.round(18 * fontScale),
        right: Math.round(66 * fontScale),
        bottom: Math.round(12 * fontScale),
        left: Math.round(8 * fontScale)
      }
    },
    plugins: {
      tooltip: { enabled: false },
      legend: {
        display: chartType === "categories",
        position: "bottom" as const,
        labels: {
          color: palette.muted,
          boxWidth: Math.round(14 * fontScale),
          boxHeight: Math.round(14 * fontScale),
          padding: Math.round(20 * fontScale),
          font: {
            family: DISPLAY_FONT_FAMILY,
            size: Math.round(16 * fontScale),
            weight: 650 as const
          }
        }
      }
    },
    scales: {
      x: {
        beginAtZero: true,
        max: scaleMax,
        grid: { color: palette.grid, drawTicks: false },
        border: { display: false },
        ticks: {
          color: palette.faint,
          padding: Math.round(10 * fontScale),
          font: { family: MONO_FONT_FAMILY, size: Math.round(14 * fontScale), weight: 650 as const }
        }
      },
      y: {
        grid: { display: false },
        border: { display: false },
        ticks: {
          color: palette.text,
          padding: Math.round(14 * fontScale),
          font: { family: DISPLAY_FONT_FAMILY, size: Math.round(17 * fontScale), weight: 650 as const }
        }
      }
    }
  };

  const configuration: ChartConfiguration<"bar", Array<number | null>, string> = chartType === "overview"
    ? {
        type: "bar",
        data: {
          labels: models.map((model) => model.label),
          datasets: [{
            label: "Score",
            data: models.map((model) => model.totalScore),
            backgroundColor: models.map((_, index) => modelColors[index % modelColors.length]),
            borderRadius: Math.round(9 * fontScale),
            borderSkipped: false,
            barPercentage: 0.62
          }]
        },
        options: { ...commonOptions, indexAxis: "y" },
        plugins: [valueLabels]
      }
    : {
        type: "bar",
        data: {
          labels: categories.map((category) => category.label),
          datasets: models.map((model, index) => ({
            label: model.label,
            data: categories.map((category) => model.categoryScores[category.id] ?? null),
            backgroundColor: modelColors[index % modelColors.length],
            borderRadius: Math.round(5 * fontScale),
            borderSkipped: false,
            barPercentage: 0.78,
            categoryPercentage: 0.72
          }))
        },
        options: { ...commonOptions, indexAxis: "y" }
      };

  const chart = new Chart(canvas, configuration);
  chart.update("none");
  preserveChartFrame(canvas, chart);
}

function renderRadarChart({
  canvas,
  models,
  categories,
  palette,
  fontScale,
  modelColors
}: {
  canvas: HTMLCanvasElement;
  models: ShareResultsModel[];
  categories: ShareResultsCategory[];
  palette: ReturnType<typeof getPalette>;
  fontScale: number;
  modelColors: string[];
}): void {
  const scaleMax = inferScaleMax(models.flatMap((model) => categories.map((category) => model.categoryScores[category.id])));
  const configuration: ChartConfiguration<"radar", Array<number | null>, string> = {
    type: "radar",
    data: {
      labels: categories.map((category) => category.label),
      datasets: models.map((model, index) => ({
        label: model.label,
        data: categories.map((category) => model.categoryScores[category.id] ?? null),
        borderColor: modelColors[index % modelColors.length],
        backgroundColor: `${modelColors[index % modelColors.length]}24`,
        pointBackgroundColor: modelColors[index % modelColors.length],
        pointBorderColor: palette.panel,
        borderWidth: Math.max(2, Math.round(2 * fontScale)),
        pointRadius: Math.round(3 * fontScale),
        pointHoverRadius: 0,
        fill: true
      }))
    },
    options: {
      responsive: false,
      animation: false,
      devicePixelRatio: 1,
      events: [],
      maintainAspectRatio: false,
      layout: { padding: Math.round(22 * fontScale) },
      plugins: {
        tooltip: { enabled: false },
        legend: {
          display: true,
          position: "bottom",
          labels: {
            color: palette.muted,
            padding: Math.round(20 * fontScale),
            font: { family: DISPLAY_FONT_FAMILY, size: Math.round(16 * fontScale), weight: 650 }
          }
        }
      },
      scales: {
        r: {
          beginAtZero: true,
          max: scaleMax,
          angleLines: { color: palette.grid },
          grid: { color: palette.grid },
          pointLabels: {
            color: palette.text,
            font: { family: DISPLAY_FONT_FAMILY, size: Math.round(15 * fontScale), weight: 650 }
          },
          ticks: {
            color: palette.faint,
            backdropColor: "transparent",
            showLabelBackdrop: false,
            stepSize: scaleMax <= 10 ? scaleMax / 5 : undefined,
            font: { family: MONO_FONT_FAMILY, size: Math.round(12 * fontScale), weight: 650 }
          }
        }
      }
    }
  };

  const chart = new Chart(canvas, configuration);
  chart.update("none");
  preserveChartFrame(canvas, chart);
}

function getPalette(theme: ShareResultsTheme) {
  return theme === "light"
    ? {
        background: "#f2f2ee",
        panel: "#ffffff",
        panelStrong: "#f7f7f3",
        border: "#d8d8d1",
        text: "#171716",
        muted: "#5f605d",
        faint: "#858681",
        grid: "rgba(23, 23, 22, 0.12)",
        accent: "#087bbd",
        accentSoft: "rgba(8, 123, 189, 0.10)",
        pass: "#218c56",
        partial: "#b36b00",
        fail: "#c43d4e",
        error: "#7549bd",
        missing: "#c8c9c3"
      }
    : {
        background: "#030303",
        panel: "#101010",
        panelStrong: "#171717",
        border: "#333333",
        text: "#f7f7f3",
        muted: "#b8b8ae",
        faint: "#77776f",
        grid: "rgba(255, 255, 255, 0.10)",
        accent: "#f4f4ec",
        accentSoft: "rgba(255, 255, 255, 0.08)",
        pass: "#49cf76",
        partial: "#e1a82d",
        fail: "#ef626f",
        error: "#b68cff",
        missing: "#444848"
      };
}

function formatScore(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1).replace(/\.0$/u, "");
}

function renderHeatmap({
  ctx,
  x,
  y,
  width,
  height,
  models,
  scenarios,
  palette,
  scale
}: {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  height: number;
  models: ShareResultsModel[];
  scenarios: ShareResultsScenario[];
  palette: ReturnType<typeof getPalette>;
  scale: number;
}): void {
  const visibleScenarios = scenarios.slice(0, 20);
  const labelWidth = Math.min(width * 0.22, 330 * scale);
  const headerHeight = 70 * scale;
  const legendHeight = 58 * scale;
  const gridWidth = width - labelWidth;
  const gridHeight = height - headerHeight - legendHeight;
  const cellWidth = gridWidth / Math.max(1, visibleScenarios.length);
  const rowHeight = gridHeight / Math.max(1, models.length);
  const statusColors: Record<ShareResultStatus, string> = {
    pass: palette.pass,
    partial: palette.partial,
    fail: palette.fail,
    error: palette.error,
    missing: palette.missing
  };

  ctx.save();
  ctx.font = `700 ${Math.round(12 * scale)}px "${MONO_FONT_FAMILY}", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = palette.muted;
  visibleScenarios.forEach((scenario, index) => {
    ctx.fillText(truncateText(ctx, scenario.id, Math.max(28 * scale, cellWidth - 6 * scale)), x + labelWidth + cellWidth * (index + 0.5), y + headerHeight * 0.52);
  });

  models.forEach((model, rowIndex) => {
    const rowY = y + headerHeight + rowHeight * rowIndex;
    ctx.textAlign = "left";
    ctx.font = `700 ${Math.round(18 * scale)}px "${DISPLAY_FONT_FAMILY}", sans-serif`;
    ctx.fillStyle = palette.text;
    ctx.fillText(truncateText(ctx, model.label, labelWidth - 28 * scale), x + 10 * scale, rowY + rowHeight / 2);

    visibleScenarios.forEach((scenario, columnIndex) => {
      const status = model.scenarioStatuses[scenario.id] ?? "missing";
      const cellX = x + labelWidth + cellWidth * columnIndex;
      fillRoundedRect(
        ctx,
        cellX + 4 * scale,
        rowY + 5 * scale,
        Math.max(4, cellWidth - 8 * scale),
        Math.max(4, rowHeight - 10 * scale),
        Math.min(10 * scale, cellWidth * 0.22),
        statusColors[status]
      );
    });
  });

  const legendEntries: Array<[ShareResultStatus, string]> = [
    ["pass", "Pass"],
    ["partial", "Partial"],
    ["fail", "Fail"],
    ["error", "Error"],
    ["missing", "Missing"]
  ];
  let legendX = x + labelWidth;
  const legendY = y + height - 24 * scale;
  ctx.font = `650 ${Math.round(15 * scale)}px "${DISPLAY_FONT_FAMILY}", sans-serif`;
  ctx.textAlign = "left";
  legendEntries.forEach(([status, label]) => {
    fillRoundedRect(ctx, legendX, legendY - 10 * scale, 16 * scale, 16 * scale, 4 * scale, statusColors[status]);
    ctx.fillStyle = palette.muted;
    ctx.fillText(label, legendX + 24 * scale, legendY);
    legendX += (ctx.measureText(label).width + 60 * scale);
  });

  if (scenarios.length > visibleScenarios.length) {
    ctx.textAlign = "right";
    ctx.fillStyle = palette.faint;
    ctx.fillText(`+${scenarios.length - visibleScenarios.length} scenarios`, x + width, legendY);
  }
  ctx.restore();
}

export async function renderShareResultsCanvas(
  canvas: HTMLCanvasElement,
  data: ShareResultsData,
  options: ShareResultsRenderOptions
): Promise<void> {
  const format = SHARE_RESULTS_FORMATS[options.formatId];
  const palette = getPalette(options.theme);
  const modelColors = options.theme === "light" ? MODEL_COLORS_LIGHT : MODEL_COLORS_DARK;
  const selectedModelSet = new Set(options.modelIds);
  const selectedCategorySet = new Set(options.categoryIds);
  const chartDefinition = SHARE_RESULTS_CHARTS.find((chart) => chart.id === options.chartType) ?? SHARE_RESULTS_CHARTS[0];
  const selectedModels = data.models.filter((model) => selectedModelSet.has(model.id)).slice(0, chartDefinition.maxModels);
  const models = options.showProviders
    ? selectedModels.map((model) => ({ ...model, label: `${model.label} · ${model.providerName}` }))
    : selectedModels;
  const categories = data.categories.filter((category) => selectedCategorySet.has(category.id)).slice(0, 8);
  const { logo } = await loadShareResultsAssets();

  canvas.width = format.width;
  canvas.height = format.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not create the share-results canvas.");
  }

  const scale = Math.min(format.width / 2400, format.height / 1260);
  const chartFontScale = Math.max(2.35, scale * 2.2);
  const margin = Math.round(70 * scale);
  const headerHeight = Math.round((options.formatId === "square" ? 460 : 390) * scale);
  const footerHeight = Math.round(96 * scale);
  const panelX = margin;
  const panelY = margin + headerHeight;
  const panelWidth = format.width - margin * 2;
  const panelHeight = format.height - panelY - margin - footerHeight;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (options.theme === "dark") {
    const frameScale = Math.max(1, scale);
    const frameInset = Math.round(36 * frameScale);
    const frameRadius = Math.round(34 * frameScale);
    const frameWidth = format.width - frameInset * 2;
    const frameHeight = format.height - frameInset * 2;
    const gridSpacing = Math.round(64 * frameScale);
    ctx.save();
    roundedRect(ctx, frameInset, frameInset, frameWidth, frameHeight, frameRadius);
    ctx.clip();
    const frameGradient = ctx.createRadialGradient(
      format.width * 0.76,
      frameInset,
      80 * frameScale,
      format.width * 0.45,
      format.height * 0.52,
      format.width * 0.64
    );
    frameGradient.addColorStop(0, "#3a3a3a");
    frameGradient.addColorStop(0.22, "#1f1f1f");
    frameGradient.addColorStop(0.52, "#101010");
    frameGradient.addColorStop(1, "#070707");
    ctx.fillStyle = frameGradient;
    ctx.fillRect(frameInset, frameInset, frameWidth, frameHeight);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.045)";
    ctx.lineWidth = Math.max(1, frameScale);
    for (let gridX = frameInset + gridSpacing; gridX < frameInset + frameWidth; gridX += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(gridX, frameInset);
      ctx.lineTo(gridX, frameInset + frameHeight);
      ctx.stroke();
    }
    for (let gridY = frameInset + gridSpacing; gridY < frameInset + frameHeight; gridY += gridSpacing) {
      ctx.beginPath();
      ctx.moveTo(frameInset, gridY);
      ctx.lineTo(frameInset + frameWidth, gridY);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.26)";
    ctx.lineWidth = Math.max(1.5, 1.5 * frameScale);
    roundedRect(ctx, frameInset, frameInset, frameWidth, frameHeight, frameRadius);
    ctx.stroke();
  } else {
    const glow = ctx.createRadialGradient(format.width * 0.78, 0, 0, format.width * 0.78, 0, format.width * 0.72);
    glow.addColorStop(0, "rgba(45, 167, 255, 0.16)");
    glow.addColorStop(1, "rgba(45, 167, 255, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, format.width, format.height);
  }

  if (options.showBranding && logo) {
    const logoSize = Math.round(108 * scale);
    ctx.drawImage(logo, margin, margin, logoSize, logoSize);
  }
  if (options.showBranding) {
    ctx.font = `800 ${Math.round(62 * scale)}px "${DISPLAY_FONT_FAMILY}", sans-serif`;
    ctx.fillStyle = palette.text;
    ctx.textBaseline = "middle";
    ctx.fillText("BenchLocal", logo ? margin + 132 * scale : margin, margin + 56 * scale);
  }

  const badgeScale = Math.max(1, scale);
  const badgeHeight = Math.round(108 * badgeScale);
  const badgePaddingX = Math.round(44 * badgeScale);
  const badgeRadius = Math.round(28 * badgeScale);
  const badgeMaxWidth = Math.min(format.width * 0.56, 960 * badgeScale);
  const badgeFontSize = Math.round(48 * badgeScale);
  ctx.font = `800 ${badgeFontSize}px "${MONO_FONT_FAMILY}", monospace`;
  const badgeText = truncateText(ctx, data.benchPackName.toUpperCase(), badgeMaxWidth - badgePaddingX * 2);
  const badgeWidth = Math.min(badgeMaxWidth, Math.ceil(ctx.measureText(badgeText).width) + badgePaddingX * 2);
  const badgeX = format.width - margin - badgeWidth;
  const badgeY = margin;
  fillRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, badgeRadius, palette.accentSoft);
  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = Math.max(2, 2 * badgeScale);
  roundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, badgeRadius);
  ctx.stroke();
  ctx.fillStyle = palette.accent;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const badgeTextMetrics = ctx.measureText(badgeText);
  const badgeTextAscent = badgeTextMetrics.actualBoundingBoxAscent || badgeFontSize * 0.74;
  const badgeTextDescent = badgeTextMetrics.actualBoundingBoxDescent || badgeFontSize * 0.2;
  const badgeTextBaseline = badgeY + badgeHeight / 2 + (badgeTextAscent - badgeTextDescent) / 2;
  ctx.fillText(badgeText, badgeX + badgeWidth / 2, badgeTextBaseline);
  ctx.textAlign = "left";

  ctx.font = `850 ${Math.round((options.formatId === "square" ? 90 : 80) * scale)}px "${DISPLAY_FONT_FAMILY}", sans-serif`;
  ctx.fillStyle = palette.text;
  ctx.textBaseline = "alphabetic";
  const title = options.title.trim() || getShareResultsChartTitle(options.chartType);
  ctx.fillText(truncateText(ctx, title, format.width - margin * 2), margin, margin + 232 * scale);

  ctx.font = `650 ${Math.round(30 * scale)}px "${DISPLAY_FONT_FAMILY}", sans-serif`;
  ctx.fillStyle = palette.muted;
  const automaticSubtitle = `${models.length} model${models.length === 1 ? "" : "s"} · ${data.scenarioCount} scenarios · ${data.runModeLabel}${data.isIncomplete ? " · Incomplete run" : ""}`;
  const subtitle = options.subtitle.trim() || automaticSubtitle;
  ctx.fillText(truncateText(ctx, subtitle, format.width - margin * 2), margin, margin + 298 * scale);

  if (options.showInsight) {
    const insight = options.insight.trim() || buildShareResultsInsight(data, options);
    const insightY = margin + 348 * scale;
    ctx.fillStyle = palette.accent;
    ctx.fillRect(margin, insightY - 17 * scale, Math.max(5, 6 * scale), 34 * scale);
    ctx.font = `750 ${Math.round(26 * scale)}px "${DISPLAY_FONT_FAMILY}", sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(truncateText(ctx, insight, format.width - margin * 2 - 26 * scale), margin + 22 * scale, insightY);
  }

  fillRoundedRect(ctx, panelX, panelY, panelWidth, panelHeight, 34 * scale, palette.panel);
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = Math.max(1, 2 * scale);
  roundedRect(ctx, panelX, panelY, panelWidth, panelHeight, 34 * scale);
  ctx.stroke();

  const chartInset = Math.round(42 * scale);
  const chartX = panelX + chartInset;
  const chartY = panelY + chartInset;
  const chartWidth = panelWidth - chartInset * 2;
  const chartHeight = panelHeight - chartInset * 2;

  if (models.length === 0) {
    ctx.font = `700 ${Math.round(38 * scale)}px "${DISPLAY_FONT_FAMILY}", sans-serif`;
    ctx.fillStyle = palette.muted;
    ctx.textAlign = "center";
    ctx.fillText("Select at least one model", panelX + panelWidth / 2, panelY + panelHeight / 2);
    ctx.textAlign = "left";
  } else if ((options.chartType === "categories" || options.chartType === "radar") && categories.length === 0) {
    ctx.font = `700 ${Math.round(38 * scale)}px "${DISPLAY_FONT_FAMILY}", sans-serif`;
    ctx.fillStyle = palette.muted;
    ctx.textAlign = "center";
    ctx.fillText("No category scores are available", panelX + panelWidth / 2, panelY + panelHeight / 2);
    ctx.textAlign = "left";
  } else if (options.chartType === "heatmap") {
    renderHeatmap({
      ctx,
      x: chartX,
      y: chartY,
      width: chartWidth,
      height: chartHeight,
      models,
      scenarios: data.scenarios,
      palette,
      scale: chartFontScale
    });
  } else {
    const chartCanvas = document.createElement("canvas");
    chartCanvas.width = chartWidth;
    chartCanvas.height = chartHeight;
    if (options.chartType === "radar") {
      renderRadarChart({ canvas: chartCanvas, models, categories, palette, fontScale: chartFontScale, modelColors });
    } else {
      renderBarChart({
        canvas: chartCanvas,
        models,
        categories,
        chartType: options.chartType,
        palette,
        fontScale: chartFontScale,
        modelColors
      });
    }
    ctx.drawImage(chartCanvas, chartX, chartY);
  }

  const footerParts = [
    options.footerNote.trim() || null,
    options.showDate ? data.runDateLabel : null,
    options.showRunDetails ? `${data.runsPerTest}x run${data.runsPerTest === 1 ? "" : "s"}` : null
  ].filter((part): part is string => Boolean(part));
  const footerY = format.height - margin - footerHeight / 2;
  if (footerParts.length > 0) {
    ctx.font = `650 ${Math.round(24 * scale)}px "${DISPLAY_FONT_FAMILY}", sans-serif`;
    ctx.fillStyle = palette.muted;
    ctx.textBaseline = "middle";
    ctx.fillText(
      truncateText(ctx, footerParts.join(" · "), format.width - margin * 2 - (options.showBranding ? 320 * scale : 0)),
      margin,
      footerY
    );
  }
  if (options.showBranding) {
    ctx.font = `800 ${Math.round(24 * scale)}px "${MONO_FONT_FAMILY}", monospace`;
    ctx.fillStyle = palette.text;
    ctx.textAlign = "right";
    ctx.fillText("benchlocal.com", format.width - margin, footerY);
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

export function shareResultsCanvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("Could not render the share-results image."));
      }
    }, "image/png");
  });
}

function sanitizeFileName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 90) || "benchlocal-results";
}

export function getShareResultsFileName(data: ShareResultsData, options: ShareResultsRenderOptions): string {
  return `${sanitizeFileName(`benchlocal-${data.benchPackName}-${options.chartType}-${options.formatId}`)}.png`;
}
