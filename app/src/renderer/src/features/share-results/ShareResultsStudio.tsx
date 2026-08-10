import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Check,
  Copy,
  Grid3x3,
  ImageDown,
  Moon,
  Presentation,
  Radar,
  Sun,
  X
} from "lucide-react";
import {
  SHARE_RESULTS_CHARTS,
  SHARE_RESULTS_FORMATS,
  buildShareResultsInsight,
  getShareResultsFileName,
  getShareResultsChartTitle,
  renderShareResultsCanvas,
  shareResultsCanvasToBlob,
  type ShareResultsChartType,
  type ShareResultsData,
  type ShareResultsFormatId,
  type ShareResultsRenderOptions,
  type ShareResultsTheme
} from "./share-results";

const CHART_ICONS = {
  overview: BarChart3,
  categories: Presentation,
  radar: Radar,
  heatmap: Grid3x3
} satisfies Record<ShareResultsChartType, typeof BarChart3>;

const IS_MACOS = typeof navigator !== "undefined" && /Macintosh|Mac OS X/u.test(navigator.userAgent);

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timeoutId);
  }, [delayMs, value]);

  return debouncedValue;
}

function createInitialModelSelections(data: ShareResultsData): Record<ShareResultsChartType, string[]> {
  return Object.fromEntries(SHARE_RESULTS_CHARTS.map((chart) => [
    chart.id,
    data.models.slice(0, chart.maxModels).map((model) => model.id)
  ])) as Record<ShareResultsChartType, string[]>;
}

function scoreLabel(value: number | null): string {
  if (value === null) {
    return "No score";
  }
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

export function ShareResultsStudio({
  data,
  onClose
}: {
  data: ShareResultsData;
  onClose: () => void;
}) {
  const [chartType, setChartType] = useState<ShareResultsChartType>("overview");
  const [formatId, setFormatId] = useState<ShareResultsFormatId>("social");
  const [theme, setTheme] = useState<ShareResultsTheme>("dark");
  const [modelSelections, setModelSelections] = useState(() => createInitialModelSelections(data));
  const [categoryIds, setCategoryIds] = useState(() => data.categories.slice(0, 8).map((category) => category.id));
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [insight, setInsight] = useState("");
  const [footerNote, setFooterNote] = useState("");
  const [showInsight, setShowInsight] = useState(true);
  const [showDate, setShowDate] = useState(true);
  const [showRunDetails, setShowRunDetails] = useState(true);
  const [showProviders, setShowProviders] = useState(false);
  const [showBranding, setShowBranding] = useState(true);
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<"idle" | "copied">("idle");
  const studioRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderSequenceRef = useRef(0);
  const chartDefinition = SHARE_RESULTS_CHARTS.find((chart) => chart.id === chartType) ?? SHARE_RESULTS_CHARTS[0];
  const format = SHARE_RESULTS_FORMATS[formatId];
  const modelIds = modelSelections[chartType];
  const storyDraft = useMemo(() => ({ title, subtitle, insight, footerNote }), [footerNote, insight, subtitle, title]);
  const debouncedStory = useDebouncedValue(storyDraft, 320);
  const storyPending = storyDraft.title !== debouncedStory.title
    || storyDraft.subtitle !== debouncedStory.subtitle
    || storyDraft.insight !== debouncedStory.insight
    || storyDraft.footerNote !== debouncedStory.footerNote;
  const automaticInsight = useMemo(
    () => buildShareResultsInsight(data, { chartType, modelIds, categoryIds }),
    [categoryIds, chartType, data, modelIds]
  );
  const options = useMemo<ShareResultsRenderOptions>(() => ({
    chartType,
    formatId,
    theme,
    modelIds,
    categoryIds,
    title: debouncedStory.title,
    subtitle: debouncedStory.subtitle,
    insight: debouncedStory.insight,
    footerNote: debouncedStory.footerNote,
    showInsight,
    showDate,
    showRunDetails,
    showProviders,
    showBranding
  }), [
    categoryIds,
    chartType,
    debouncedStory,
    formatId,
    modelIds,
    showBranding,
    showDate,
    showInsight,
    showProviders,
    showRunDetails,
    theme,
  ]);

  useEffect(() => {
    if (!IS_MACOS) {
      return;
    }

    void window.benchlocal.windowControls.setWindowButtonsVisible(false).catch(() => undefined);
    return () => {
      void window.benchlocal.windowControls.setWindowButtonsVisible(true).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !studioRef.current) {
        return;
      }

      const focusable = Array.from(
        studioRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        )
      );
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) {
        event.preventDefault();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      returnFocus?.focus();
    };
  }, [onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const sequence = ++renderSequenceRef.current;
    setRendering(true);
    setError(null);
    setActionStatus("idle");

    const timeoutId = window.setTimeout(() => {
      void renderShareResultsCanvas(canvas, data, options)
        .then(() => {
          if (sequence === renderSequenceRef.current) {
            setRendering(false);
          }
        })
        .catch((renderError) => {
          if (sequence === renderSequenceRef.current) {
            setRendering(false);
            setError(renderError instanceof Error ? renderError.message : String(renderError));
          }
        });
    }, 90);

    return () => {
      window.clearTimeout(timeoutId);
      if (sequence === renderSequenceRef.current) {
        renderSequenceRef.current += 1;
      }
    };
  }, [data, options]);

  useEffect(() => {
    if (actionStatus === "idle") {
      return;
    }

    const timeoutId = window.setTimeout(() => setActionStatus("idle"), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [actionStatus]);

  const selectChart = (nextChartType: ShareResultsChartType) => {
    setChartType(nextChartType);
  };

  const updateModelIds = (updater: (current: string[]) => string[]) => {
    setModelSelections((current) => ({
      ...current,
      [chartType]: updater(current[chartType])
    }));
  };

  const toggleModel = (modelId: string) => {
    updateModelIds((current) => {
      if (current.includes(modelId)) {
        return current.length === 1 ? current : current.filter((candidate) => candidate !== modelId);
      }

      if (current.length >= chartDefinition.maxModels) {
        return current;
      }

      return [...current, modelId];
    });
  };

  const selectAllModels = () => {
    updateModelIds(() => data.models.slice(0, chartDefinition.maxModels).map((model) => model.id));
  };

  const resetStory = () => {
    setTitle("");
    setSubtitle("");
    setInsight("");
    setFooterNote("");
    setShowInsight(true);
    setShowDate(true);
    setShowRunDetails(true);
    setShowProviders(false);
    setShowBranding(true);
  };

  const toggleCategory = (categoryId: string) => {
    setCategoryIds((current) => {
      if (current.includes(categoryId)) {
        return current.length === 1 ? current : current.filter((candidate) => candidate !== categoryId);
      }

      return current.length >= 8 ? current : [...current, categoryId];
    });
  };

  const savePng = async () => {
    const canvas = canvasRef.current;
    if (!canvas || rendering || storyPending) return;
    const blob = await shareResultsCanvasToBlob(canvas);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = getShareResultsFileName(data, options);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const copyImage = async () => {
    type ClipboardItemConstructor = new (items: Record<string, Blob>) => ClipboardItem;
    const clipboardItem = (window as typeof window & { ClipboardItem?: ClipboardItemConstructor }).ClipboardItem;
    const canvas = canvasRef.current;

    if (!canvas || rendering || storyPending || !navigator.clipboard?.write || !clipboardItem) {
      return;
    }

    const blob = await shareResultsCanvasToBlob(canvas);
    await navigator.clipboard.write([new clipboardItem({ "image/png": blob })]);
    setActionStatus("copied");
  };

  return (
    <div className="share-results-backdrop">
      <div
        ref={studioRef}
        className={`share-results-studio${IS_MACOS ? " is-macos" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-results-title"
      >
        <header className="share-results-header">
          <div className="share-results-heading">
            <span className="eyebrow">Share Results</span>
            <h2 id="share-results-title">{data.benchPackName}</h2>
            <p>{data.models.length} models · {data.scenarioCount} scenarios · {data.runDateLabel}</p>
          </div>
          <div className="share-results-header-controls">
            <button
              ref={closeButtonRef}
              type="button"
              className="share-results-close"
              onClick={onClose}
              aria-label="Close Share Results"
            >
              <X size={18} />
            </button>
            <div className="share-results-header-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => void copyImage().catch((copyError) => setError(String(copyError)))}
                disabled={rendering || storyPending || Boolean(error)}
              >
                {actionStatus === "copied" ? <Check size={15} /> : <Copy size={15} />}
                {actionStatus === "copied" ? "Copied" : "Copy Image"}
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void savePng().catch((saveError) => setError(String(saveError)))}
                disabled={rendering || storyPending || Boolean(error)}
              >
                <ImageDown size={15} />
                Save PNG
              </button>
            </div>
          </div>
        </header>

        <div className="share-results-layout">
          <aside className="share-results-controls" aria-label="Share image controls">
            <section className="share-results-control-section">
              <div className="share-results-section-heading">
                <span>Chart</span>
                <span>{chartDefinition.maxModels} models max</span>
              </div>
              <div className="share-results-choice-list">
                {SHARE_RESULTS_CHARTS.map((chart) => {
                  const Icon = CHART_ICONS[chart.id];
                  return (
                    <button
                      key={chart.id}
                      type="button"
                      className={`share-results-choice${chartType === chart.id ? " is-active" : ""}`}
                      onClick={() => selectChart(chart.id)}
                      aria-pressed={chartType === chart.id}
                    >
                      <Icon size={17} />
                      <span>
                        <strong>{chart.label}</strong>
                        <small>{chart.description}</small>
                      </span>
                      {chartType === chart.id ? <Check size={15} /> : null}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="share-results-control-section">
              <div className="share-results-section-heading">
                <span>Format</span>
                <span>{format.width}×{format.height}</span>
              </div>
              <div className="share-results-format-grid">
                {(Object.entries(SHARE_RESULTS_FORMATS) as Array<[ShareResultsFormatId, typeof format]>).map(([id, entry]) => (
                  <button
                    key={id}
                    type="button"
                    className={`share-results-format${formatId === id ? " is-active" : ""}`}
                    onClick={() => setFormatId(id)}
                    aria-pressed={formatId === id}
                    title={`${entry.label}: ${entry.description}`}
                  >
                    <strong>{entry.label}</strong>
                    <small>{entry.description}</small>
                  </button>
                ))}
              </div>
              <div className="share-results-theme-toggle" aria-label="Image theme">
                <button
                  type="button"
                  className={theme === "dark" ? "is-active" : ""}
                  onClick={() => setTheme("dark")}
                  aria-pressed={theme === "dark"}
                >
                  <Moon size={14} /> Dark
                </button>
                <button
                  type="button"
                  className={theme === "light" ? "is-active" : ""}
                  onClick={() => setTheme("light")}
                  aria-pressed={theme === "light"}
                >
                  <Sun size={14} /> Light
                </button>
              </div>
            </section>

            <section className="share-results-control-section">
              <div className="share-results-section-heading">
                <span>Story</span>
                <button type="button" className="share-results-text-action" onClick={resetStory}>Reset</button>
              </div>
              <div className="share-results-story-fields">
                <label className="share-results-story-field">
                  <span>Title</span>
                  <input
                    type="text"
                    value={title}
                    maxLength={72}
                    placeholder={getShareResultsChartTitle(chartType)}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label className="share-results-story-field">
                  <span>Subtitle</span>
                  <input
                    type="text"
                    value={subtitle}
                    maxLength={120}
                    placeholder="Automatic run summary"
                    onChange={(event) => setSubtitle(event.target.value)}
                  />
                </label>
                <label className="share-results-story-field">
                  <span>Insight</span>
                  <input
                    type="text"
                    value={insight}
                    maxLength={140}
                    placeholder={automaticInsight}
                    disabled={!showInsight}
                    onChange={(event) => setInsight(event.target.value)}
                  />
                </label>
                <label className="share-results-story-field">
                  <span>Footer note</span>
                  <input
                    type="text"
                    value={footerNote}
                    maxLength={90}
                    placeholder="Optional context"
                    onChange={(event) => setFooterNote(event.target.value)}
                  />
                </label>
              </div>
              <div className="share-results-detail-options" aria-label="Export details">
                <label><input type="checkbox" checked={showInsight} onChange={(event) => setShowInsight(event.target.checked)} /> Insight</label>
                <label><input type="checkbox" checked={showBranding} onChange={(event) => setShowBranding(event.target.checked)} /> Brand</label>
                <label><input type="checkbox" checked={showDate} onChange={(event) => setShowDate(event.target.checked)} /> Date</label>
                <label><input type="checkbox" checked={showRunDetails} onChange={(event) => setShowRunDetails(event.target.checked)} /> Runs</label>
                <label><input type="checkbox" checked={showProviders} onChange={(event) => setShowProviders(event.target.checked)} /> Providers</label>
              </div>
            </section>

            <section className="share-results-control-section share-results-selection-section">
              <div className="share-results-section-heading">
                <span>Models</span>
                <div className="share-results-heading-tools">
                  <span>{modelIds.length}/{chartDefinition.maxModels}</span>
                  <button type="button" className="share-results-text-action" onClick={selectAllModels}>All</button>
                </div>
              </div>
              <div className="share-results-check-list">
                {data.models.map((model) => {
                  const checked = modelIds.includes(model.id);
                  const atLimit = !checked && modelIds.length >= chartDefinition.maxModels;
                  return (
                    <label key={model.id} className={`share-results-check${atLimit ? " is-disabled" : ""}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={atLimit}
                        onChange={() => toggleModel(model.id)}
                      />
                      <span>
                        <strong>{model.label}</strong>
                        <small>{model.providerName}</small>
                      </span>
                      <em>{scoreLabel(model.totalScore)}</em>
                    </label>
                  );
                })}
              </div>
            </section>

            {(chartType === "categories" || chartType === "radar") && data.categories.length > 0 ? (
              <section className="share-results-control-section share-results-selection-section">
                <div className="share-results-section-heading">
                  <span>Categories</span>
                  <span>{categoryIds.length}/8</span>
                </div>
                <div className="share-results-check-list">
                  {data.categories.map((category) => {
                    const checked = categoryIds.includes(category.id);
                    const atLimit = !checked && categoryIds.length >= 8;
                    return (
                      <label key={category.id} className={`share-results-check${atLimit ? " is-disabled" : ""}`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={atLimit}
                          onChange={() => toggleCategory(category.id)}
                        />
                        <span><strong>{category.label}</strong></span>
                      </label>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </aside>

          <main className="share-results-preview-area">
            <div className="share-results-preview-toolbar">
              <div>
                <span className="eyebrow">Static Preview</span>
                <strong>{SHARE_RESULTS_CHARTS.find((chart) => chart.id === chartType)?.label}</strong>
              </div>
              <span>{format.label} PNG · {theme}</span>
            </div>
            <div className={`share-results-preview${rendering || storyPending ? " is-rendering" : ""}`}>
              <canvas
                ref={canvasRef}
                width={format.width}
                height={format.height}
                role="img"
                aria-label={`${data.benchPackName} combined ${chartType} share-image preview`}
              />
              {rendering || storyPending ? <div className="share-results-rendering"><span className="spinner" /> Updating preview</div> : null}
              {error ? <div className="share-results-error">{error}</div> : null}
            </div>
            <div className="share-results-preview-footer">
              <span>Export size {format.width}×{format.height} PNG</span>
              <span>{getShareResultsFileName(data, options)}</span>
            </div>
            <span className="sr-only" aria-live="polite">
              {actionStatus === "copied" ? "Image copied" : ""}
            </span>
          </main>
        </div>
      </div>
    </div>
  );
}
