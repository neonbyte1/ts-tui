import {
  STATUS_GLYPHS,
  type StatusGlyphs,
  type StatusPaints,
  StatusStyle,
  type StatusTheme,
  type TaskMark,
  type TaskState,
  Ticker,
} from "../status.ts";
import { paint } from "../style.ts";
import type { Component } from "../tui.ts";
import { truncateToWidth } from "../width.ts";

/**
 * Options of {@linkcode Spinner}.
 *
 * @category Progress & status
 */
export interface SpinnerOptions {
  /** Default `STATUS_GLYPHS.dots`. */
  glyphs?: StatusGlyphs;
  /** Paints for the glyph and the text per state, each replacing that state's default: glyphs grey, cyan, green, red, grey; text none. */
  theme?: StatusTheme;
  /** Cells between the glyph and the text. Default 1. */
  gap?: number;
  /** Ends a line that is too long. Default `…`. */
  ellipsis?: string;
  /** Frame interval of the spinner and the settle animation. Default 80 ms. */
  intervalMs?: number;
  /** Millisecond clock the animation follows. Default `performance.now`. */
  clock?: () => number;
}

/**
 * One-row task indicator: a spinner while running that settles into a check
 * mark, cross or skip mark when the task ends, like `✔ Installed 42 packages`.
 *
 * The animation runs while the spinner is running and for the short settle
 * that follows `succeed()`, `fail()` or `skip()`, then stops by itself. A
 * running spinner keeps the process alive until it is finished or `reset()`.
 *
 * @example Track one task from start to finish
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Spinner } from "@neonbyte/tui";
 *
 * let now = 0;
 * const spinner = new Spinner({ requestRender() {} }, "Installing", {
 *   clock: () => now,
 * });
 *
 * spinner.start();
 * spinner.succeed("Installed");
 * now = 1000; // the settle animation is over
 *
 * const row = spinner.render(30)[0].replace(/\x1b\[[0-9;]*m/g, "");
 *
 * assertEquals(row, "✔ Installed");
 * spinner.reset(); // a real clock lets the timer stop by itself
 * ```
 *
 * @category Progress & status
 */
export class Spinner implements Component {
  private readonly host: { requestRender(): void };
  private readonly style: StatusStyle;
  private readonly gap: number;
  private readonly ellipsis: string;
  private readonly clock: () => number;
  private readonly ticker: Ticker;
  private labels: StatusPaints;
  private current: TaskMark;
  private text: string;
  private cacheKey = "";
  private cache: readonly string[] = [];

  /**
   * Create a pending spinner.
   *
   * @param host Asked to redraw while animating; the {@linkcode TUI} works as host.
   * @param text Text beside the glyph. Default none.
   * @param options Glyphs, paints and timing; see {@linkcode SpinnerOptions}.
   * @throws {Error} When `options.glyphs.running` is empty.
   */
  public constructor(
    host: { requestRender(): void },
    text = "",
    options: SpinnerOptions = {},
  ) {
    const intervalMs = options.intervalMs ?? 80;

    this.host = host;
    this.text = text;
    this.style = new StatusStyle(
      options.glyphs ?? STATUS_GLYPHS.dots,
      options.theme?.glyph ?? {},
      intervalMs,
    );
    this.labels = { ...options.theme?.label };
    this.gap = Math.max(0, Math.floor(options.gap ?? 1));
    this.ellipsis = options.ellipsis ?? "…";
    this.clock = options.clock ?? (() => performance.now());
    this.current = this.style.mark(undefined, "pending", 0);
    this.ticker = new Ticker(
      host,
      intervalMs,
      () => this.style.animating(this.current, this.clock()),
    );
  }

  /** The current state: `pending` until started. */
  public get state(): TaskState {
    return this.current.state;
  }

  /** Whether the glyph is still moving: running, or settling into its final mark. */
  public get animating(): boolean {
    return this.style.animating(this.current, this.clock());
  }

  /**
   * Start spinning, optionally with new text. The spinner animates, asking
   * `host` to redraw every `intervalMs`, until it is finished with
   * {@linkcode Spinner.succeed}, {@linkcode Spinner.fail} or
   * {@linkcode Spinner.skip} and has settled, or {@linkcode Spinner.reset}.
   *
   * @param text New text beside the glyph. Default: keep the current text.
   *
   * @example Spin while a task runs
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Spinner } from "@neonbyte/tui";
   *
   * let now = 0;
   * const spinner = new Spinner({ requestRender() {} }, "Installing", {
   *   clock: () => now,
   * });
   *
   * spinner.start();
   * now = 80; // one frame later
   *
   * const row = spinner.render(30)[0].replace(/\x1b\[[0-9;]*m/g, "");
   *
   * assertEquals(row, "⠙ Installing");
   * spinner.reset(); // stops the timer
   * ```
   */
  public start(text?: string): void {
    this.setState("running", text);
  }

  /**
   * Settle into the done mark.
   *
   * @param text New text beside the glyph. Default: keep the current text.
   *
   * @example Report success
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Spinner } from "@neonbyte/tui";
   *
   * let now = 0;
   * const spinner = new Spinner({ requestRender() {} }, "Installing", {
   *   clock: () => now,
   * });
   *
   * spinner.start();
   * spinner.succeed("Installed 42 packages");
   * now = 1000; // the settle animation is over
   *
   * const row = spinner.render(30)[0].replace(/\x1b\[[0-9;]*m/g, "");
   *
   * assertEquals(row, "✔ Installed 42 packages");
   * spinner.reset(); // stops the timer
   * ```
   */
  public succeed(text?: string): void {
    this.setState("done", text);
  }

  /**
   * Settle into the failed mark.
   *
   * @param text New text beside the glyph. Default: keep the current text.
   *
   * @example Report a failure
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Spinner } from "@neonbyte/tui";
   *
   * let now = 0;
   * const spinner = new Spinner({ requestRender() {} }, "Deploy", {
   *   clock: () => now,
   * });
   *
   * spinner.start();
   * spinner.fail("Deploy failed");
   * now = 1000; // the settle animation is over
   *
   * const row = spinner.render(30)[0].replace(/\x1b\[[0-9;]*m/g, "");
   *
   * assertEquals(row, "✘ Deploy failed");
   * spinner.reset(); // stops the timer
   * ```
   */
  public fail(text?: string): void {
    this.setState("failed", text);
  }

  /**
   * Settle into the skipped mark.
   *
   * @param text New text beside the glyph. Default: keep the current text.
   *
   * @example Mark a task as skipped
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Spinner } from "@neonbyte/tui";
   *
   * let now = 0;
   * const spinner = new Spinner({ requestRender() {} }, "Lint", {
   *   clock: () => now,
   * });
   *
   * spinner.skip("Lint (not needed)");
   * now = 1000; // the settle animation is over
   *
   * const row = spinner.render(30)[0].replace(/\x1b\[[0-9;]*m/g, "");
   *
   * assertEquals(row, "– Lint (not needed)");
   * spinner.reset(); // stops the timer
   * ```
   */
  public skip(text?: string): void {
    this.setState("skipped", text);
  }

  /**
   * Back to pending, without animation. Also stops the timer of a running
   * spinner.
   *
   * @param text New text beside the glyph. Default: keep the current text.
   *
   * @example Stop a spinner without a result
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Spinner } from "@neonbyte/tui";
   *
   * const spinner = new Spinner({ requestRender() {} }, "Build", {
   *   clock: () => 0,
   * });
   *
   * spinner.start();
   * spinner.reset("Build (cancelled)");
   *
   * assertEquals(spinner.state, "pending");
   * assertEquals(spinner.animating, false);
   * ```
   */
  public reset(text?: string): void {
    this.setState("pending", text);
  }

  /**
   * Enter `state`, optionally with new text. Entering a finished state plays
   * the settle animation; entering the current state changes nothing but the
   * text. {@linkcode Spinner.start}, {@linkcode Spinner.succeed},
   * {@linkcode Spinner.fail}, {@linkcode Spinner.skip} and
   * {@linkcode Spinner.reset} are shorthands for the common states.
   *
   * @param state The state to enter.
   * @param text New text beside the glyph. Default: keep the current text.
   *
   * @example Enter a state by name
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Spinner } from "@neonbyte/tui";
   *
   * const spinner = new Spinner({ requestRender() {} }, "Build", {
   *   clock: () => 0,
   * });
   *
   * spinner.setState("running");
   * assertEquals(spinner.state, "running");
   *
   * spinner.setState("pending"); // stops the animation
   * assertEquals(spinner.state, "pending");
   * ```
   */
  public setState(state: TaskState, text?: string): void {
    if (text !== undefined) {
      this.text = text;
    }

    this.current = this.style.mark(this.current, state, this.clock());

    if (!this.style.animating(this.current, this.clock())) {
      this.ticker.stop();
    }

    this.ticker.wake();
  }

  /**
   * Change the text, keeping the state.
   *
   * @param text The new text beside the glyph.
   *
   * @example Report progress while running
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Spinner } from "@neonbyte/tui";
   *
   * const spinner = new Spinner({ requestRender() {} }, "Downloading", {
   *   clock: () => 0,
   * });
   *
   * spinner.setText("Unpacking");
   *
   * const row = spinner.render(30)[0].replace(/\x1b\[[0-9;]*m/g, "");
   *
   * assertEquals(row, "○ Unpacking");
   * ```
   */
  public setText(text: string): void {
    this.setState(this.current.state, text);
  }

  /**
   * Replace some paints; others keep their values. Glyph and text paints
   * merge per state. Requests a render.
   *
   * @param theme Paints per state for the glyph and the text; see {@linkcode StatusTheme}.
   *
   * @example Colour the text of a pending task
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Spinner } from "@neonbyte/tui";
   *
   * const spinner = new Spinner({ requestRender() {} }, "Deploy", {
   *   clock: () => 0,
   * });
   *
   * spinner.setTheme({ label: { pending: { fg: "red" } } });
   *
   * assertEquals(spinner.render(20)[0].endsWith("\x1b[31mDeploy\x1b[39m"), true);
   * ```
   */
  public setTheme(theme: StatusTheme): void {
    this.style.setPaints(theme.glyph ?? {});

    this.labels = { ...this.labels, ...theme.label };
    this.cacheKey = "";

    this.host.requestRender();
  }

  /** Drop the cached row so the next render draws it again. */
  public invalidate(): void {
    this.cacheKey = "";
  }

  /**
   * Draw the glyph for the current state and the text in one row.
   *
   * @param width Cells available; the row is cut to fit.
   * @returns One row, empty when `width` is below 1.
   */
  public render(width: number): readonly string[] {
    if (width < 1) {
      return [];
    }

    const cell = this.style.cell(this.current, this.clock());
    const key = `${width}\0${cell}\0${this.current.state}\0${this.text}`;

    if (key === this.cacheKey) {
      return this.cache;
    }

    const label = paint(this.text, this.labels[this.current.state]);
    const line = this.text === ""
      ? cell
      : `${cell}${" ".repeat(this.gap)}${label}`;

    this.cacheKey = key;
    this.cache = [truncateToWidth(line, width, this.ellipsis)];

    return this.cache;
  }
}
