import { type Paint, paint } from "../style.ts";
import type { Component } from "../tui.ts";
import { truncateToWidth, visibleWidth } from "../width.ts";

/**
 * Built-in height steps, lowest first: `blocks`, `dots` and `ascii`. Every
 * glyph must be exactly one cell wide.
 *
 * @category Progress & status
 */
export const SPARKLINE_LEVELS: {
  readonly [Name in "blocks" | "dots" | "ascii"]: readonly string[];
} = {
  /** `▁▂▃▄▅▆▇█` */
  blocks: ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"],
  /** `⣀⣄⣤⣦⣶⣷⣿` braille, filling from the bottom. */
  dots: ["⣀", "⣄", "⣤", "⣦", "⣶", "⣷", "⣿"],
  /** `_.-=+#` for terminals or fonts without block glyphs. */
  ascii: ["_", ".", "-", "=", "+", "#"],
};

/**
 * Paints per element of a sparkline; unset elements keep the surrounding style.
 *
 * @category Progress & status
 */
export interface SparklineTheme {
  /** The graph, under `style`. */
  readonly graph?: Paint;
  /** The text left of the graph. */
  readonly label?: Paint;
  /** The text right of the graph (`format`). */
  readonly suffix?: Paint;
}

/**
 * Options of {@linkcode Sparkline}.
 *
 * @category Progress & status
 */
export interface SparklineOptions {
  /** Text left of the graph. */
  label?: string;
  /** Samples kept; older ones are dropped. Default 256. */
  capacity?: number;
  /** Height steps, lowest first; the largest sample gets the last one. Default `SPARKLINE_LEVELS.blocks`. */
  levels?: readonly string[];
  /** Paints for the graph, label and suffix. */
  theme?: SparklineTheme;
  /** Style for the graph, applied before `theme.graph`; must not change its width. */
  style?: (graph: string) => string;
  /** Text right of the graph, e.g. the latest value; `max` is the largest kept sample. */
  format?: (latest: number, max: number) => string;
  /** Cells between label, graph and suffix. Default 1. */
  gap?: number;
  /** Ends a label or suffix that is cut to fit the row. Default `…`. */
  ellipsis?: string;
}

/**
 * One-row graph of recent samples, `label ▁▂▄▆█▆▅ 12 MB/s`. Newest sample on
 * the right; heights scale to the largest visible sample, with 0 as the
 * floor. Passive: after `push()`, call `tui.requestRender()`.
 *
 * @example Graph a throughput with its latest value
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Sparkline } from "@neonbyte/tui";
 *
 * const graph = new Sparkline({
 *   label: "net",
 *   format: (latest) => `${latest} MB/s`,
 * });
 *
 * for (const value of [1, 4, 8]) {
 *   graph.push(value);
 * }
 *
 * assertEquals(graph.render(30), ["net ▂▅█ 8 MB/s"]);
 * ```
 *
 * @category Progress & status
 */
export class Sparkline implements Component {
  private readonly capacity: number;
  private readonly levels: readonly string[];
  private readonly style: ((graph: string) => string) | undefined;
  private readonly format:
    | ((latest: number, max: number) => string)
    | undefined;
  private readonly gap: number;
  private readonly ellipsis: string;
  private theme: SparklineTheme;
  private label: string;
  private samples: number[] = [];
  private cacheKey = "";
  private cache: readonly string[] = [];

  /**
   * Create an empty sparkline.
   *
   * @param options Label, capacity, glyphs and paints; see {@linkcode SparklineOptions}.
   * @throws {Error} When `options.levels` is empty.
   */
  public constructor(options: SparklineOptions = {}) {
    const levels = options.levels ?? SPARKLINE_LEVELS.blocks;

    if (levels.length === 0) {
      throw new Error("Sparkline levels need at least one glyph");
    }

    this.capacity = Math.max(1, Math.floor(options.capacity ?? 256));
    this.levels = levels;
    this.label = options.label ?? "";
    this.theme = { ...options.theme };
    this.style = options.style;
    this.format = options.format;
    this.gap = Math.max(0, Math.floor(options.gap ?? 1));
    this.ellipsis = options.ellipsis ?? "…";
  }

  /** The kept samples, oldest first. */
  public get values(): readonly number[] {
    return this.samples;
  }

  /**
   * Add a sample; negative and non-finite values count as 0. Once `capacity`
   * samples are kept, the oldest is dropped.
   *
   * @param value The sample, e.g. bytes per second.
   *
   * @example Graph recent samples
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Sparkline } from "@neonbyte/tui";
   *
   * const graph = new Sparkline();
   *
   * for (const value of [0, 4, 8]) {
   *   graph.push(value);
   * }
   *
   * assertEquals(graph.render(20), ["▁▅█"]);
   * ```
   */
  public push(value: number): void {
    this.samples.push(Number.isFinite(value) && value > 0 ? value : 0);

    if (this.samples.length > this.capacity) {
      this.samples.shift();
    }

    this.cacheKey = "";
  }

  /**
   * Drop all samples.
   *
   * @example Start a new series
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Sparkline } from "@neonbyte/tui";
   *
   * const graph = new Sparkline();
   *
   * graph.push(3);
   * graph.clear();
   *
   * assertEquals(graph.values, []);
   * ```
   */
  public clear(): void {
    this.samples = [];
    this.cacheKey = "";
  }

  /**
   * Replace all samples, e.g. with a series kept elsewhere. Negative and
   * non-finite values count as 0; only the newest `capacity` are kept.
   *
   * @param values The samples, oldest first.
   *
   * @example Show a recorded series
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Sparkline } from "@neonbyte/tui";
   *
   * const graph = new Sparkline({ capacity: 3 });
   *
   * graph.setValues([9, 0, 4, 8]);
   *
   * assertEquals(graph.values, [0, 4, 8]);
   * assertEquals(graph.render(20), ["▁▅█"]);
   * ```
   */
  public setValues(values: readonly number[]): void {
    this.samples = values.slice(-this.capacity).map((value) =>
      Number.isFinite(value) && value > 0 ? value : 0
    );
    this.cacheKey = "";
  }

  /**
   * Change the text left of the graph.
   *
   * @param label The new label; empty removes it.
   *
   * @example Rename the series
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Sparkline } from "@neonbyte/tui";
   *
   * const graph = new Sparkline({ label: "cpu" });
   *
   * graph.push(1);
   * graph.setLabel("mem");
   *
   * assertEquals(graph.render(10), ["mem █"]);
   * ```
   */
  public setLabel(label: string): void {
    this.label = label;
  }

  /**
   * Replace some paints; others keep their values.
   *
   * @param theme Paints to change; see {@linkcode SparklineTheme}.
   *
   * @example Paint the label
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Sparkline } from "@neonbyte/tui";
   *
   * const graph = new Sparkline({ label: "cpu" });
   *
   * graph.setTheme({ label: { bold: true } });
   * graph.push(1);
   *
   * assertEquals(graph.render(10)[0].startsWith("\x1b[1m"), true);
   * ```
   */
  public setTheme(theme: SparklineTheme): void {
    this.theme = { ...this.theme, ...theme };
    this.cacheKey = "";
  }

  /** Drop the cached row so the next render draws it again. */
  public invalidate(): void {
    this.cacheKey = "";
  }

  /**
   * Draw the label, the graph of the newest samples that fit, and the suffix.
   *
   * @param width Cells available; the graph takes what the label and suffix leave.
   * @returns One row, empty when `width` is below 1.
   */
  public render(width: number): readonly string[] {
    if (width < 1) {
      return [];
    }

    const key = `${width}\0${this.label}`;

    if (key === this.cacheKey) {
      return this.cache;
    }

    const suffix = this.formatLatest();
    const labelWidth = visibleWidth(this.label);
    const suffixWidth = visibleWidth(suffix);
    const room = width - (labelWidth > 0 ? labelWidth + this.gap : 0) -
      (suffixWidth > 0 ? suffixWidth + this.gap : 0);
    const line = room < 1 ? this.fallback(width, suffix) : this.compose(
      room,
      suffix,
    );

    this.cacheKey = key;
    this.cache = [line];

    return this.cache;
  }

  /** The label, else the suffix, cut to `width`, when there is no room for a graph. */
  private fallback(width: number, suffix: string): string {
    const text = this.label === "" ? suffix : this.label;

    if (text === "") {
      return "";
    }

    const p = this.label === "" ? this.theme.suffix : this.theme.label;

    return truncateToWidth(paint(text, p), width, this.ellipsis);
  }

  /** The formatted latest sample, or "" without a formatter or samples. */
  private formatLatest(): string {
    if (!this.format || this.samples.length === 0) {
      return "";
    }

    return this.format(this.samples.at(-1) ?? 0, Math.max(...this.samples));
  }

  /** Label, graph of the last `room` samples and suffix, joined by `gap` spaces. */
  private compose(room: number, suffix: string): string {
    const shown = this.samples.slice(-room);
    const max = Math.max(0, ...shown);
    let graph = "";

    for (const sample of shown) {
      graph += this.levels[
        max > 0 ? Math.round((sample / max) * (this.levels.length - 1)) : 0
      ];
    }

    const parts: string[] = [];

    if (this.label !== "") {
      parts.push(paint(this.label, this.theme.label));
    }

    if (graph !== "") {
      parts.push(paint(this.style?.(graph) ?? graph, this.theme.graph));
    }

    if (suffix !== "") {
      parts.push(paint(suffix, this.theme.suffix));
    }

    return parts.filter((part) => part !== "").join(" ".repeat(this.gap));
  }
}
