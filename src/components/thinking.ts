import { type Paint, paint } from "../style.ts";
import type { Component } from "../tui.ts";
import { truncateToWidth, visibleWidth } from "../width.ts";
import { shimmerCentre, shimmerText, type ShimmerTheme } from "./shimmer.ts";

/**
 * Paints per element of a thinking line.
 *
 * @category Progress & status
 */
export interface ThinkingTheme {
  /** The animated glyph. Default cyan `#3fb5e8`. */
  readonly glyph?: Paint;
  /** The message: shimmer colours, band, and attributes, replacing the default as a whole. Default grey italic with a light band. Without `shimmer` the message is drawn in its `base` colour. */
  readonly text?: ShimmerTheme;
  /** The detail after the message. Default grey `#5c6370`. */
  readonly detail?: Paint;
}

/**
 * Options of {@linkcode Thinking}.
 *
 * @category Progress & status
 */
export interface ThinkingOptions {
  /** Glyphs the indicator steps through, forward then back. Default `· ✢ ✳ ✶ ✻ ✽`. */
  frames?: readonly string[];
  /** Animation frames per glyph step. Default 3 (150 ms at the default interval). */
  glyphEvery?: number;
  /** Paints for the glyph, the message and the detail, each replacing its default. */
  theme?: ThinkingTheme;
  /** Sweep a band across the text. Default true; false draws it in `theme.text.base`. */
  shimmer?: boolean;
  /** Cycle through these texts, one every `rotateMs`, instead of the constructor's text. */
  messages?: readonly string[];
  /** Default 3000 ms. */
  rotateMs?: number;
  /** Text after the message, from the seconds since `start()`, e.g. `(12s · esc to interrupt)`. Dropped when it would make the message not fit. */
  detail?: (elapsed: number) => string;
  /** Cells between the glyph and the message, and between the message and the detail. Default 1. */
  gap?: number;
  /** Ends a message that is cut to fit the row. Default `…`. */
  ellipsis?: string;
  /** Animation frame interval. Default 50 ms. */
  intervalMs?: number;
  /** Millisecond clock for elapsed time and message rotation. Default `performance.now`. */
  clock?: () => number;
}

const DEFAULT_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽"];
const DEFAULT_TEXT: ShimmerTheme & { readonly band: number } = {
  base: "#8a8f98",
  peak: "#e6e9ef",
  band: 8,
  paint: { italic: true },
};
const DEFAULT_THEME: Required<ThinkingTheme> = {
  glyph: { fg: "#3fb5e8" },
  text: DEFAULT_TEXT,
  detail: { fg: "#5c6370" },
};

/** The paints in use; any may be unset by the caller. */
interface Look {
  glyph: Paint | undefined;
  text: ShimmerTheme | undefined;
  detail: Paint | undefined;
}

/**
 * A "thinking" line: an animated glyph and a shimmering message, with an
 * optional detail such as elapsed time, like `✻ Thinking… (4s)`. Animates
 * between `start()` and `stop()`; a started indicator keeps the process alive.
 *
 * @example Show a thinking line with elapsed time
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { FakeTime } from "@std/testing/time";
 * import { Thinking } from "@neonbyte/tui";
 *
 * using time = new FakeTime();
 * const thinking = new Thinking({ requestRender() {} }, "Thinking…", {
 *   clock: () => time.now,
 *   detail: (seconds) => `(${Math.floor(seconds)}s)`,
 * });
 *
 * thinking.start();
 * time.tick(2000);
 * const row = thinking.render(40)[0].replace(/\x1b\[[0-9;]*m/g, "");
 * thinking.stop();
 *
 * assertEquals(row.endsWith("Thinking… (2s)"), true);
 * ```
 *
 * @category Progress & status
 */
export class Thinking implements Component {
  private readonly host: { requestRender(): void };
  private readonly sequence: readonly string[];
  private readonly glyphWidth: number;
  private readonly glyphEvery: number;
  private readonly shimmer: boolean;
  private readonly messages: readonly string[];
  private readonly rotateMs: number;
  private readonly detail: ((elapsed: number) => string) | undefined;
  private readonly gap: number;
  private readonly ellipsis: string;
  private readonly intervalMs: number;
  private readonly clock: () => number;
  private theme: Look;
  private text: string;
  private frame = 0;
  private startedAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private cacheKey = "";
  private cache: readonly string[] = [];

  /**
   * Create a stopped indicator.
   *
   * @param host Asked to redraw while animating; the {@linkcode TUI} works as host.
   * @param text The message. Default `Thinking…`.
   * @param options Glyphs, paints, detail and timing; see {@linkcode ThinkingOptions}.
   */
  public constructor(
    host: { requestRender(): void },
    text = "Thinking…",
    options: ThinkingOptions = {},
  ) {
    this.host = host;
    this.text = text;

    const frames = options.frames?.length ? options.frames : DEFAULT_FRAMES;

    // Forward then back without repeating the ends: · ✢ ✳ ✶ ✻ ✽ ✻ ✶ ✳ ✢.
    this.sequence = [...frames, ...frames.slice(1, -1).reverse()];
    this.glyphWidth = Math.max(...frames.map((f) => visibleWidth(f)));
    this.glyphEvery = Math.max(1, Math.floor(options.glyphEvery ?? 3));
    this.theme = { ...DEFAULT_THEME, ...options.theme };
    this.shimmer = options.shimmer ?? true;
    this.messages = options.messages ?? [];
    this.rotateMs = Math.max(1, options.rotateMs ?? 3000);
    this.detail = options.detail;
    this.gap = Math.max(0, Math.floor(options.gap ?? 1));
    this.ellipsis = options.ellipsis ?? "…";
    this.intervalMs = options.intervalMs ?? 50;
    this.clock = options.clock ?? (() => performance.now());
  }

  /** Whether the animation is started. */
  public get running(): boolean {
    return this.timer !== undefined;
  }

  /** Seconds since `start()`; 0 while stopped. */
  public get elapsed(): number {
    return this.running ? (this.clock() - this.startedAt) / 1000 : 0;
  }

  /**
   * Start animating and counting the elapsed time: every `intervalMs` the
   * frame advances and `host` is asked to redraw. Does nothing when already
   * running.
   *
   * @example Show the elapsed time
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { FakeTime } from "@std/testing/time";
   * import { Thinking } from "@neonbyte/tui";
   *
   * using time = new FakeTime();
   * const thinking = new Thinking({ requestRender() {} }, "Thinking…", {
   *   clock: () => time.now,
   *   detail: (seconds) => `(${Math.floor(seconds)}s)`,
   * });
   *
   * thinking.start();
   * time.tick(4000);
   * const row = thinking.render(40)[0].replace(/\x1b\[[0-9;]*m/g, "");
   * thinking.stop();
   *
   * assertEquals(row, "✻ Thinking… (4s)");
   * ```
   */
  public start(): void {
    if (this.timer !== undefined) {
      return;
    }

    this.startedAt = this.clock();
    this.frame = 0;
    this.timer = setInterval(() => {
      this.frame++;

      this.host.requestRender();
    }, this.intervalMs);

    this.host.requestRender();
  }

  /**
   * Stop the animation so the process can exit, and request a render. The
   * glyph returns to the first frame and the elapsed time to 0. Safe to call
   * when not running.
   *
   * @example Stop when the answer arrives
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { FakeTime } from "@std/testing/time";
   * import { Thinking } from "@neonbyte/tui";
   *
   * using time = new FakeTime();
   * const thinking = new Thinking({ requestRender() {} }, "Thinking…", {
   *   clock: () => time.now,
   * });
   *
   * thinking.start();
   * time.tick(1000);
   * thinking.stop();
   *
   * assertEquals(thinking.running, false);
   * assertEquals(thinking.elapsed, 0);
   * ```
   */
  public stop(): void {
    clearInterval(this.timer);

    this.timer = undefined;

    this.host.requestRender();
  }

  /**
   * Change the message and request a render. Plain text only; escapes would
   * be broken up by the shimmer's per-character colours. Ignored while
   * `messages` is set.
   *
   * @param text The new message, without escape sequences.
   *
   * @example Report what is being worked on
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Thinking } from "@neonbyte/tui";
   *
   * const thinking = new Thinking({ requestRender() {} });
   *
   * thinking.setText("Reading files…");
   *
   * const row = thinking.render(30)[0].replace(/\x1b\[[0-9;]*m/g, "");
   *
   * assertEquals(row, "· Reading files…");
   * ```
   */
  public setText(text: string): void {
    this.text = text;

    this.host.requestRender();
  }

  /**
   * Replace some paints; others keep their values. A `text` here replaces the
   * whole message style. Requests a render.
   *
   * @param theme Paints to change; see {@linkcode ThinkingTheme}.
   *
   * @example Colour the glyph
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Thinking } from "@neonbyte/tui";
   *
   * const thinking = new Thinking({ requestRender() {} });
   *
   * thinking.setTheme({ glyph: { fg: "#ff0000" } });
   *
   * assertEquals(thinking.render(20)[0].startsWith("\x1b[38;2;255;0;0m·"), true);
   * ```
   */
  public setTheme(theme: ThinkingTheme): void {
    this.theme = { ...this.theme, ...theme };
    this.cacheKey = "";

    this.host.requestRender();
  }

  /** Drop the cached row so the next render draws it again. */
  public invalidate(): void {
    this.cacheKey = "";
  }

  /**
   * Draw the glyph, the message and, if it fits, the detail in one row.
   *
   * @param width Cells available; the message is cut to fit.
   * @returns One row, empty when `width` is below 1.
   */
  public render(width: number): readonly string[] {
    if (width < 1) {
      return [];
    }

    const elapsed = this.elapsed;
    const text = this.messages.length > 0
      ? this.messages[
        Math.floor((elapsed * 1000) / this.rotateMs) % this.messages.length
      ]
      : this.text;
    const detail = this.detail?.(elapsed) ?? "";
    const key = [
      width,
      text,
      detail,
      this.running ? this.frame : -1,
    ].join("\0");

    if (key === this.cacheKey) {
      return this.cache;
    }

    const glyph = this.sequence[
      this.running
        ? Math.floor(this.frame / this.glyphEvery) % this.sequence.length
        : 0
    ];
    const gap = " ".repeat(this.gap);
    // Pad narrower glyphs so the text never shifts between frames.
    const head = paint(glyph, this.theme.glyph) +
      " ".repeat(this.glyphWidth - visibleWidth(glyph)) + gap;
    let room = width - this.glyphWidth - this.gap;
    const detailWidth = visibleWidth(detail);
    const showDetail = detail !== "" &&
      room - detailWidth - this.gap >= visibleWidth(text);

    if (showDetail) {
      room -= detailWidth + this.gap;
    }

    let line: string;

    if (room < 1) {
      line = truncateToWidth(paint(glyph, this.theme.glyph), width, "");
    } else {
      const shown = truncateToWidth(text, room, this.ellipsis);
      const centre = this.running && this.shimmer
        ? shimmerCentre(this.frame, visibleWidth(shown), {
          band: this.theme.text?.band ?? DEFAULT_TEXT.band,
        })
        : -Infinity;

      line = head + shimmerText(shown, centre, this.theme.text) +
        (showDetail ? gap + paint(detail, this.theme.detail) : "");
    }

    this.cacheKey = key;
    this.cache = [line];

    return this.cache;
  }
}
