import {
  BAR_GLYPHS,
  type BarGlyphs,
  type BarMarker,
  type BarTheme,
  capsWidth,
  type CellPaint,
  filledCells,
  renderBar,
} from "../bar.ts";
import { type Paint, paint } from "../style.ts";
import type { Component } from "../tui.ts";
import { truncateToWidth, visibleWidth } from "../width.ts";

/**
 * Measured progress, passed to the text callbacks.
 *
 * @category Progress & status
 */
export interface ProgressStats {
  /** Units per second over the last few seconds; 0 until progress was set twice. */
  readonly rate: number;
  /** Seconds left at `rate`: 0 when complete, undefined while unknown or indeterminate. */
  readonly eta: number | undefined;
  /** Seconds since the first `setProgress`/`setParts`. */
  readonly elapsed: number;
  /** Whether the total is unknown. */
  readonly indeterminate: boolean;
}

/**
 * Text drawn next to or over the bar; may contain styles.
 *
 * @category Progress & status
 */
export type ProgressText = (
  value: number,
  total: number,
  stats: ProgressStats,
) => string;

/**
 * A bar theme plus paints for the text around the bar.
 *
 * @category Progress & status
 */
export interface ProgressTheme extends BarTheme {
  /** The label left of the bar. */
  readonly label?: Paint;
  /** The text right of the bar (`format`). */
  readonly text?: Paint;
}

/**
 * The parts of a bar's look that `setStyle` can change later.
 *
 * @category Progress & status
 */
export interface ProgressBarStyle {
  /** Default `BAR_GLYPHS.blocks`. */
  glyphs?: BarGlyphs;
  /**
   * Paints for fill, track, caps, labels, sections, and parts. A theme given
   * here replaces the default as a whole: with none, the track is grey, as
   * background when empty cells are spaces and as foreground otherwise;
   * `theme: {}` draws everything unpainted.
   */
  theme?: ProgressTheme;
  /** Per-cell paint merged over the theme, e.g. `gradient` or `thresholds`. */
  cellPaint?: CellPaint;
  /** Fixed indicators, like a limit or a target. */
  markers?: readonly BarMarker[];
}

/**
 * Options of {@linkcode ProgressBar}.
 *
 * @category Progress & status
 */
export interface ProgressBarOptions extends ProgressBarStyle {
  /** Value that counts as complete. Default 1. */
  total?: number;
  /** Text left of the bar; truncated or dropped when the row is narrow. */
  label?: string;
  /** Maximum number of bar cells, caps excluded. Default: fill the row. */
  barWidth?: number;
  /** Text right of the bar. Default: whole percent (`100%` only when complete); nothing while indeterminate. */
  format?: ProgressText;
  /** Text over the track just past the fill edge, moving with it. */
  edgeLabel?: ProgressText;
  /** Text over the right end of the bar, inside the caps. */
  endLabel?: ProgressText;
  /** Cells between the label, the bar and the text after it. Default 1. */
  gap?: number;
  /** The bar is dropped below this many cells rather than drawn uselessly short. Default 4. */
  minBar?: number;
  /** Ends a label or text that is cut to fit the row. Default `…`. */
  ellipsis?: string;
  /** Total unknown: while started, a segment slides back and forth. */
  indeterminate?: boolean;
  /** While started, a bright cell runs over the filled part. */
  shimmer?: boolean;
  /** Redraws animation frames; required by `start()`. */
  host?: { requestRender(): void };
  /** Animation frame interval. Default 80 ms. */
  intervalMs?: number;
  /** Millisecond clock for rate, time left, and elapsed. Default `performance.now`. */
  clock?: () => number;
}

/** Rate is measured over this window. */
const RATE_WINDOW_MS = 5_000;
/** Frames between two shimmer passes. */
const SHIMMER_PAUSE = 8;
const TRACK_BACKGROUND: ProgressTheme = { track: { bg: 238 } };
const TRACK_FOREGROUND: ProgressTheme = { track: { fg: 240 } };

/**
 * One-row progress bar: `label ███████▍     42%`. Determinate, stacked
 * (`setParts`), or indeterminate. Passive like `Text`: after changing it,
 * call `tui.requestRender()`. Animation (indeterminate, shimmer) runs between
 * `start()` and `stop()`; a started bar keeps the process alive.
 *
 * @example Show a download with its rate
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { ProgressBar } from "@neonbyte/tui";
 *
 * let now = 0;
 * const bar = new ProgressBar({
 *   label: "Download",
 *   total: 100,
 *   barWidth: 10,
 *   theme: {},
 *   clock: () => now,
 *   format: (value, total, stats) => `${value}/${total} ${stats.rate}/s`,
 * });
 *
 * bar.setProgress(0);
 * now = 1000;
 * bar.setProgress(50);
 *
 * assertEquals(bar.render(40), ["Download █████      50/100 50/s"]);
 * ```
 *
 * @category Progress & status
 */
export class ProgressBar implements Component {
  private readonly barWidth: number;
  private readonly format: ProgressText | undefined;
  private readonly edgeLabel: ProgressText | undefined;
  private readonly endLabel: ProgressText | undefined;
  private readonly shimmer: boolean;
  private readonly host: { requestRender(): void } | undefined;
  private readonly intervalMs: number;
  private readonly clock: () => number;
  private readonly gap: number;
  private readonly minBar: number;
  private readonly ellipsis: string;

  private glyphs: BarGlyphs;
  private theme: ProgressTheme | undefined;
  private cellPaint: CellPaint | undefined;
  private markers: readonly BarMarker[];
  private styleVersion = 0;

  private total: number;
  private parts: readonly number[] = [0];
  private value = 0;
  private label: string;
  private indeterminate: boolean;
  private startedAt: number | undefined;
  private samples: { t: number; v: number }[] = [];

  private timer: ReturnType<typeof setInterval> | undefined;
  private frame = 0;
  private cacheKey = "";
  private cache: readonly string[] = [];

  /**
   * Create a bar at 0 of `total`.
   *
   * @param options Total, label, text, look and animation; see {@linkcode ProgressBarOptions}.
   */
  public constructor(options: ProgressBarOptions = {}) {
    const total = options.total ?? 1;

    this.total = Number.isFinite(total) && total > 0 ? total : 1;
    this.label = options.label ?? "";
    this.barWidth = Math.max(1, Math.floor(options.barWidth ?? Infinity));
    this.format = options.format;
    this.edgeLabel = options.edgeLabel;
    this.endLabel = options.endLabel;
    this.indeterminate = options.indeterminate ?? false;
    this.shimmer = options.shimmer ?? false;
    this.host = options.host;
    this.intervalMs = options.intervalMs ?? 80;
    this.gap = Math.max(0, Math.floor(options.gap ?? 1));
    this.minBar = Math.max(1, Math.floor(options.minBar ?? 4));
    this.ellipsis = options.ellipsis ?? "…";
    this.clock = options.clock ?? (() => performance.now());
    this.glyphs = options.glyphs ?? BAR_GLYPHS.blocks;
    this.theme = options.theme;
    this.cellPaint = options.cellPaint;
    this.markers = options.markers ?? [];
  }

  /** Current value: the sum of the parts, clamped to `[0, total]`. */
  public get progress(): number {
    return this.value;
  }

  /** Whether a determinate bar has reached its total. Always false while indeterminate. */
  public get complete(): boolean {
    return !this.indeterminate && this.value >= this.total;
  }

  /** Whether the animation is started. */
  public get running(): boolean {
    return this.timer !== undefined;
  }

  /**
   * Set the value (clamped to `[0, total]`), optionally changing the total.
   * Call it regularly: the rate and time left are measured between calls.
   *
   * @param value The new value, in the same unit as the total.
   * @param total Value that counts as complete. Default: the current total.
   *
   * @example Report progress with a measured rate
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { ProgressBar } from "@neonbyte/tui";
   *
   * let now = 0;
   * const bar = new ProgressBar({
   *   total: 100,
   *   barWidth: 10,
   *   theme: {},
   *   clock: () => now,
   * });
   *
   * bar.setProgress(0);
   * now = 1000;
   * bar.setProgress(50);
   *
   * assertEquals(bar.render(30), ["█████       50%"]);
   * assertEquals(bar.stats.rate, 50);
   * assertEquals(bar.stats.eta, 1);
   * ```
   */
  public setProgress(value: number, total?: number): void {
    this.setParts([value], total);
  }

  /**
   * Stacked bar: one value per part, drawn left to right (e.g. done, failed,
   * skipped). The progress is the sum of the parts.
   *
   * @param values One value per part; negative and non-finite values count as 0.
   * @param total Value that counts as complete. Default: the current total.
   *
   * @example Show passed, failed and skipped tests
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { BAR_GLYPHS, ProgressBar } from "@neonbyte/tui";
   *
   * const bar = new ProgressBar({
   *   barWidth: 10,
   *   glyphs: BAR_GLYPHS.ascii,
   *   theme: {},
   * });
   *
   * bar.setParts([5, 2, 1], 10);
   *
   * assertEquals(bar.progress, 8);
   * assertEquals(bar.render(40), ["[########..]  80%"]);
   * ```
   */
  public setParts(values: readonly number[], total = this.total): void {
    this.total = Number.isFinite(total) && total > 0 ? total : 1;
    this.parts = values.map((v) => Number.isFinite(v) && v > 0 ? v : 0);
    this.value = Math.min(this.total, this.parts.reduce((a, b) => a + b, 0));

    const t = this.clock();
    const last = this.samples.at(-1);

    if (last !== undefined && this.value < last.v) {
      this.samples = [];
    } // restarted

    if (this.samples.length === 0) {
      this.startedAt = t;
    }

    this.samples.push({ t, v: this.value });

    while (this.samples.length > 2 && t - this.samples[0].t > RATE_WINDOW_MS) {
      this.samples.shift();
    }
  }

  /**
   * Switch between a known and an unknown total. While indeterminate and
   * started, a segment slides over the bar and no percentage is shown.
   *
   * @param indeterminate Whether the total is unknown.
   *
   * @example Switch to a known total
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { ProgressBar } from "@neonbyte/tui";
   *
   * const bar = new ProgressBar({ indeterminate: true });
   *
   * bar.setIndeterminate(false);
   * bar.setProgress(1);
   *
   * assertEquals(bar.complete, true);
   * ```
   */
  public setIndeterminate(indeterminate: boolean): void {
    this.indeterminate = indeterminate;
  }

  /**
   * Change the text left of the bar.
   *
   * @param label The new label; empty removes it.
   *
   * @example Name the current step
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { BAR_GLYPHS, ProgressBar } from "@neonbyte/tui";
   *
   * const bar = new ProgressBar({
   *   barWidth: 4,
   *   glyphs: BAR_GLYPHS.ascii,
   *   theme: {},
   * });
   *
   * bar.setLabel("Unpack");
   *
   * assertEquals(bar.render(30), ["Unpack [....]   0%"]);
   * ```
   */
  public setLabel(label: string): void {
    this.label = label;
  }

  /**
   * Change the look, e.g. turn the bar red on failure. Keys that are present
   * replace the current value, even when undefined.
   *
   * @param style The glyphs, theme, cell paint and markers to change; see {@linkcode ProgressBarStyle}.
   *
   * @example Switch to ASCII glyphs
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { BAR_GLYPHS, ProgressBar } from "@neonbyte/tui";
   *
   * const bar = new ProgressBar({ barWidth: 6, theme: {} });
   *
   * bar.setProgress(0.5);
   * bar.setStyle({ glyphs: BAR_GLYPHS.ascii });
   *
   * assertEquals(bar.render(30), ["[###...]  50%"]);
   * ```
   */
  public setStyle(style: ProgressBarStyle): void {
    if ("glyphs" in style) {
      this.glyphs = style.glyphs ?? BAR_GLYPHS.blocks;
    }

    if ("theme" in style) {
      this.theme = style.theme;
    }

    if ("cellPaint" in style) {
      this.cellPaint = style.cellPaint;
    }

    if ("markers" in style) {
      this.markers = style.markers ?? [];
    }

    this.styleVersion++;
  }

  /**
   * Replace some paints; others keep their values. Without a theme given
   * before, the grey default track counts as set and is kept unless
   * `track` is given. Requests a render from `host`, if any.
   *
   * @param theme Paints to change; see {@linkcode ProgressTheme}.
   *
   * @example Colour the fill
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { ProgressBar } from "@neonbyte/tui";
   *
   * const bar = new ProgressBar({ barWidth: 4, theme: {} });
   *
   * bar.setProgress(1);
   * bar.setTheme({ fill: { fg: "red" } });
   *
   * assertEquals(bar.render(20), ["\x1b[31m████\x1b[39m 100%"]);
   * ```
   */
  public setTheme(theme: ProgressTheme): void {
    this.theme = { ...(this.theme ?? this.defaultTheme()), ...theme };
    this.styleVersion++;

    this.host?.requestRender();
  }

  /** Measured rate, time left and time elapsed, as passed to the text callbacks. */
  public get stats(): ProgressStats {
    const now = this.clock();
    const first = this.samples[0];
    const last = this.samples.at(-1);
    const span = first && last ? (last.t - first.t) / 1000 : 0;
    const rate = first && last && span > 0 ? (last.v - first.v) / span : 0;
    let eta: number | undefined;

    if (!this.indeterminate) {
      if (this.value >= this.total) {
        eta = 0;
      } else if (rate > 0) {
        eta = (this.total - this.value) / rate;
      }
    }

    return {
      rate,
      eta,
      elapsed: this.startedAt === undefined ? 0 : (now - this.startedAt) / 1000,
      indeterminate: this.indeterminate,
    };
  }

  /**
   * Start animating (indeterminate segment, shimmer): every `intervalMs` the
   * frame advances and `host` is asked to redraw. A started bar keeps the
   * process alive until {@linkcode ProgressBar.stop}. Does nothing when
   * already started.
   *
   * @throws {Error} When the bar was created without a `host`.
   *
   * @example Animate an indeterminate bar
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { FakeTime } from "@std/testing/time";
   * import { ProgressBar } from "@neonbyte/tui";
   *
   * using time = new FakeTime();
   * let frames = 0;
   * const bar = new ProgressBar({
   *   indeterminate: true,
   *   host: { requestRender: () => frames++ },
   * });
   *
   * bar.start();
   * time.tick(240);
   * bar.stop();
   *
   * assertEquals(frames, 3);
   * ```
   */
  public start(): void {
    if (this.timer !== undefined) {
      return;
    }

    const host = this.host;

    if (host === undefined) {
      throw new Error("ProgressBar.start() needs the `host` option");
    }

    this.timer = setInterval(() => {
      this.frame++;

      host.requestRender();
    }, this.intervalMs);
  }

  /**
   * Stop the animation so the process can exit. Safe to call when not running.
   *
   * @example Stop animating when the work ends
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { ProgressBar } from "@neonbyte/tui";
   *
   * const bar = new ProgressBar({
   *   indeterminate: true,
   *   host: { requestRender() {} },
   * });
   *
   * bar.start();
   * bar.stop();
   *
   * assertEquals(bar.running, false);
   * ```
   */
  public stop(): void {
    clearInterval(this.timer);

    this.timer = undefined;
  }

  /** Drop the cached row so the next render draws it again. */
  public invalidate(): void {
    this.cacheKey = "";
  }

  /**
   * Draw the label, the bar and the text after it in one row. The label is
   * cut or dropped before the bar gets narrower than `minBar`; below that,
   * only the text is shown.
   *
   * @param width Cells available.
   * @returns One row, empty when `width` is below 1.
   */
  public render(width: number): readonly string[] {
    if (width < 1) {
      return [];
    }

    const stats = this.stats;
    const suffix = this.suffixText(stats);
    const edge = this.edgeLabel?.(this.value, this.total, stats) ?? "";
    const end = this.endLabel?.(this.value, this.total, stats) ?? "";
    const key = [
      width,
      this.parts.join(","),
      this.total,
      this.label,
      this.indeterminate,
      suffix,
      edge,
      end,
      this.running ? this.frame : -1,
      this.styleVersion,
    ].join("\0");

    if (key === this.cacheKey) {
      return this.cache;
    }

    const suffixWidth = visibleWidth(suffix);
    const caps = capsWidth(this.glyphs);
    // Cells left for label + bar, keeping the gap before the suffix.
    const room = width - (suffixWidth > 0 ? suffixWidth + this.gap : 0);
    let label = "";

    if (this.label !== "" && room - this.minBar - caps - this.gap >= 1) {
      label = truncateToWidth(
        this.label,
        room - this.minBar - caps - this.gap,
        this.ellipsis,
      );
    }

    const labelWidth = visibleWidth(label);
    const cells = Math.min(
      this.barWidth,
      room - (labelWidth > 0 ? labelWidth + this.gap : 0) - caps,
    );

    const line = cells < this.minBar
      ? truncateToWidth(suffix.trimStart(), width, this.ellipsis)
      : this.joinBar(cells, label, suffix, edge, end);

    this.cacheKey = key;
    this.cache = [line];

    return this.cache;
  }

  /** Text after the bar: the `format` result, else the percentage (none when indeterminate). */
  private suffixText(stats: ProgressStats): string {
    if (this.format) {
      return this.format(this.value, this.total, stats);
    }

    if (this.indeterminate) {
      return "";
    }

    return `${Math.floor((this.value / this.total) * 100)}%`.padStart(4);
  }

  /** The grey track used when no theme was given: a background for blank empty cells, else a foreground. */
  private defaultTheme(): ProgressTheme {
    return this.glyphs.empty === " " ? TRACK_BACKGROUND : TRACK_FOREGROUND;
  }

  /** The bar of `cells` cells with the label before it and the suffix after it. */
  private joinBar(
    cells: number,
    label: string,
    suffix: string,
    edge: string,
    end: string,
  ): string {
    const theme = this.theme ?? this.defaultTheme();
    const bar = renderBar(
      this.parts.map((part) => part / this.total),
      cells,
      {
        glyphs: this.glyphs,
        theme,
        cellPaint: this.cellPaint,
        markers: this.markers,
        edgeLabel: this.indeterminate ? undefined : edge,
        endLabel: end,
        highlight: this.shimmerCell(cells),
        segment: this.indeterminate ? this.slidingSegment(cells) : undefined,
      },
    );
    const parts = [bar];

    if (label !== "") {
      parts.unshift(paint(label, theme.label));
    }

    if (suffix !== "") {
      parts.push(paint(suffix, theme.text));
    }

    return parts.join(" ".repeat(this.gap));
  }

  /** Index of the shimmering cell this frame, if any. */
  private shimmerCell(cells: number): number | undefined {
    if (!this.shimmer || !this.running || this.complete) {
      return undefined;
    }

    const filled = filledCells(this.value / this.total, cells);

    if (filled === 0) {
      return undefined;
    }

    const position = this.frame % (filled + SHIMMER_PAUSE);

    return position < filled ? position : undefined;
  }

  /** Indeterminate bar: a segment a fifth of the bar wide, bouncing between the ends. */
  private slidingSegment(cells: number): { start: number; length: number } {
    const length = Math.max(2, Math.round(cells / 5));
    const travel = cells - length;
    const phase = travel > 0 ? this.frame % (2 * travel) : 0;

    return { start: phase <= travel ? phase : 2 * travel - phase, length };
  }
}
