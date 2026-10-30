import {
  mergePaint,
  mixColors,
  type Paint,
  paintTransition,
} from "../style.ts";
import type { Component } from "../tui.ts";
import { graphemeWidth, truncateToWidth, visibleWidth } from "../width.ts";

const segmenter = new Intl.Segmenter();

/**
 * Colours and attributes of a shimmer band.
 *
 * @category Progress & status
 */
export interface ShimmerTheme {
  /** Colour outside the band. Default `#8a8f98`. */
  base?: `#${string}`;
  /** Colour at the band's centre. Default `#ff9f1a`. */
  peak?: `#${string}`;
  /** Band width in cells, edge to edge; the colour fades out towards both edges. Default 10. */
  band?: number;
  /** Attributes for all of the text, e.g. italic. The colour comes from `base` and `peak`. */
  paint?: Omit<Paint, "fg">;
  /** Attributes added where the band is at least half strength, e.g. bold. */
  peakPaint?: Omit<Paint, "fg">;
}

const DEFAULT_THEME = {
  base: "#8a8f98",
  peak: "#ff9f1a",
  band: 10,
} as const satisfies ShimmerTheme;

/**
 * Draw plain `text` (no escapes) with a highlight band centred on cell
 * `centre`: full `peak` colour at the centre, fading to `base` with a cosine
 * falloff over half the band width on each side. A centre far outside the
 * text draws it all in `base`.
 *
 * @param text The text to colour, without escape sequences.
 * @param centre Cell position of the band's centre; may lie outside the text.
 * @param theme Colours, band width and attributes; see {@linkcode ShimmerTheme}.
 * @returns The text with a 24-bit colour per character.
 * @throws {Error} When `theme.base` or `theme.peak` is not of the form `#rrggbb`, or a paint in `theme` has an invalid colour.
 *
 * @example Light up one spot
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { shimmerText } from "@neonbyte/tui";
 *
 * const peak = "38;2;255;159;26"; // the default peak colour
 * const lit = shimmerText("Rewriting", 4.5);
 * const resting = shimmerText("Rewriting", -100);
 *
 * assertEquals(lit.replace(/\x1b\[[0-9;]*m/g, ""), "Rewriting");
 * assertEquals(lit.includes(peak), true);
 * assertEquals(resting.includes(peak), false);
 * ```
 *
 * @category Progress & status
 */
export function shimmerText(
  text: string,
  centre: number,
  theme: ShimmerTheme = {},
): string {
  const base = theme.base ?? DEFAULT_THEME.base;
  const peak = theme.peak ?? DEFAULT_THEME.peak;
  const half = Math.max(0.5, (theme.band ?? DEFAULT_THEME.band) / 2);

  let out = "";
  let current: Paint = {};
  let x = 0;

  for (const { segment } of segmenter.segment(text)) {
    const width = graphemeWidth(segment);
    const distance = Math.abs(x + width / 2 - centre);

    x += width;

    const strength = distance >= half
      ? 0
      : (1 + Math.cos((Math.PI * distance) / half)) / 2;
    const p = mergePaint(
      theme.paint,
      { fg: strength === 0 ? base : mixColors(base, peak, strength) },
      strength >= 0.5 ? theme.peakPaint : undefined,
    );

    out += paintTransition(current, p) + segment;
    current = p;
  }

  return out + paintTransition(current, {});
}

/**
 * Options of {@linkcode Shimmer}.
 *
 * @category Progress & status
 */
export interface ShimmerOptions {
  /** Colours, band width and attributes, each replacing its default. */
  theme?: ShimmerTheme;
  /** Cells the band travels beyond the text before the next pass: the pause between passes. Default 12. */
  gap?: number;
  /** `right` sweeps left to right. Default `right`. */
  direction?: "right" | "left";
  /** Ends text that is cut to fit the row. Default `…`. */
  ellipsis?: string;
  /** Frame interval; the band moves one cell per frame. Default 50 ms. */
  intervalMs?: number;
}

/**
 * One row of text with a highlight sweeping across it, like an activity
 * label (`Rewriting tests for themes`). Animates between `start()` and
 * `stop()`; stopped, it draws the text in the base colour. A started
 * shimmer keeps the process alive.
 *
 * @example Show an activity label
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Shimmer } from "@neonbyte/tui";
 *
 * const shimmer = new Shimmer({ requestRender() {} }, "Rewriting tests");
 * const plain = shimmer.render(30)[0].replace(/\x1b\[[0-9;]*m/g, "");
 *
 * assertEquals(plain, "Rewriting tests");
 * ```
 *
 * @category Progress & status
 */
export class Shimmer implements Component {
  private readonly host: { requestRender(): void };
  private readonly gap: number;
  private readonly direction: "right" | "left";
  private readonly ellipsis: string;
  private readonly intervalMs: number;
  private theme: ShimmerTheme;
  private text: string;
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private cacheKey = "";
  private cache: readonly string[] = [];

  /**
   * Create a stopped shimmer.
   *
   * @param host Asked to redraw while the band moves; the {@linkcode TUI} works as host.
   * @param text The text to draw, without escape sequences.
   * @param options Colours, band, speed and direction; see {@linkcode ShimmerOptions}.
   */
  public constructor(
    host: { requestRender(): void },
    text: string,
    options: ShimmerOptions = {},
  ) {
    this.host = host;
    this.text = text;
    this.gap = Math.max(0, options.gap ?? 12);
    this.direction = options.direction ?? "right";
    this.ellipsis = options.ellipsis ?? "…";
    this.intervalMs = options.intervalMs ?? 50;
    this.theme = { ...DEFAULT_THEME, ...options.theme };
  }

  /** Whether the sweep is started. */
  public get running(): boolean {
    return this.timer !== undefined;
  }

  /**
   * Start sweeping the band: every `intervalMs` it moves one cell and
   * `host` is asked to redraw. Does nothing when already running.
   *
   * @example Sweep the band across the text
   * ```ts
   * import { assertEquals, assertNotEquals } from "@std/assert";
   * import { FakeTime } from "@std/testing/time";
   * import { Shimmer } from "@neonbyte/tui";
   *
   * using time = new FakeTime();
   * const shimmer = new Shimmer({ requestRender() {} }, "Rewriting tests");
   * const resting = shimmer.render(30)[0];
   *
   * shimmer.start();
   * time.tick(500);
   * const sweeping = shimmer.render(30)[0];
   * shimmer.stop();
   *
   * assertEquals(shimmer.running, false);
   * assertNotEquals(sweeping, resting);
   * ```
   */
  public start(): void {
    if (this.timer !== undefined) {
      return;
    }

    this.timer = setInterval(() => {
      this.frame++;

      this.host.requestRender();
    }, this.intervalMs);
  }

  /**
   * Stop the sweep so the process can exit, and request a render of the
   * resting text in the base colour. Safe to call when not running.
   *
   * @example Stop the sweep
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Shimmer } from "@neonbyte/tui";
   *
   * const shimmer = new Shimmer({ requestRender() {} }, "Working");
   *
   * shimmer.start();
   * shimmer.stop();
   *
   * assertEquals(shimmer.running, false);
   * ```
   */
  public stop(): void {
    clearInterval(this.timer);

    this.timer = undefined;

    this.host.requestRender();
  }

  /**
   * Change the text and request a render. Plain text only; escapes would be
   * broken up by the per-character colours.
   *
   * @param text The new text, without escape sequences.
   *
   * @example Change the activity
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Shimmer } from "@neonbyte/tui";
   *
   * const shimmer = new Shimmer({ requestRender() {} }, "Reading", {
   *   theme: { base: "#ffffff" },
   * });
   *
   * shimmer.setText("Writing");
   *
   * assertEquals(shimmer.render(10), ["\x1b[38;2;255;255;255mWriting\x1b[39m"]);
   * ```
   */
  public setText(text: string): void {
    this.text = text;

    this.host.requestRender();
  }

  /**
   * Replace some colours and attributes; others keep their values. Requests a render.
   *
   * @param theme Colours and attributes to change; see {@linkcode ShimmerTheme}.
   *
   * @example Use a different base colour
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Shimmer } from "@neonbyte/tui";
   *
   * const shimmer = new Shimmer({ requestRender() {} }, "Idle");
   *
   * shimmer.setTheme({ base: "#ff0000" });
   *
   * assertEquals(shimmer.render(10), ["\x1b[38;2;255;0;0mIdle\x1b[39m"]);
   * ```
   */
  public setTheme(theme: ShimmerTheme): void {
    this.theme = { ...this.theme, ...theme };
    this.cacheKey = "";

    this.host.requestRender();
  }

  /** Drop the cached row so the next render draws it again. */
  public invalidate(): void {
    this.cacheKey = "";
  }

  /**
   * Draw the text in one row, with the band while running and in the base
   * colour while stopped.
   *
   * @param width Cells available; longer text is cut with the ellipsis.
   * @returns One row, empty when `width` is below 1.
   */
  public render(width: number): readonly string[] {
    if (width < 1) {
      return [];
    }

    const key = `${width}\0${this.text}\0${this.running ? this.frame : -1}`;

    if (key === this.cacheKey) {
      return this.cache;
    }

    const line = truncateToWidth(this.text, width, this.ellipsis);
    const centre = this.running
      ? shimmerCentre(this.frame, visibleWidth(line), {
        band: this.theme.band,
        gap: this.gap,
        direction: this.direction,
      })
      : -Infinity;

    this.cacheKey = key;
    this.cache = [shimmerText(line, centre, this.theme)];

    return this.cache;
  }
}

/**
 * Band centre for animation `frame` over text `length` cells wide. One pass
 * moves one cell per frame: the band enters fully off one end, leaves fully
 * off the other, then travels `gap` more cells as a pause.
 *
 * @param frame Animation frame, counted from 0; the pass repeats every `length + band + gap` frames.
 * @param length Width of the text in cells.
 * @param options `band` width (default 10), `gap` pause in cells (default 12) and `direction` of the sweep (default `right`).
 * @returns The centre as a cell position, usable as the `centre` of {@linkcode shimmerText}; off the text while the band is entering, leaving or paused.
 *
 * @example Follow the band across ten cells
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { shimmerCentre } from "@neonbyte/tui";
 *
 * assertEquals(shimmerCentre(0, 10), -5); // entering from the left
 * assertEquals(shimmerCentre(5, 10), 0);
 * assertEquals(shimmerCentre(0, 10, { direction: "left" }), 15);
 * ```
 *
 * @category Progress & status
 */
export function shimmerCentre(
  frame: number,
  length: number,
  options: { band?: number; gap?: number; direction?: "right" | "left" } = {},
): number {
  const band = options.band ?? DEFAULT_THEME.band;
  const travelled = frame % (length + band + (options.gap ?? 12));

  return options.direction === "left"
    ? length + band / 2 - travelled
    : travelled - band / 2;
}
