import { type Paint, paint } from "../style.ts";
import type { Component } from "../tui.ts";
import { truncateToWidth } from "../width.ts";

/**
 * Paints per element; unset elements keep the surrounding style.
 *
 * @category Progress & status
 */
export interface LoaderTheme {
  /** The spinner frame. Must not change its width. Default none. */
  readonly spinner?: Paint;
  /** The message. Default none. */
  readonly message?: Paint;
}

/**
 * Options of {@linkcode Loader}.
 *
 * @category Progress & status
 */
export interface LoaderOptions {
  /** Spinner frames, each one cell wide, played in order. Default braille dots. */
  frames?: readonly string[];
  /** Animation frame interval. Default 80 ms. */
  intervalMs?: number;
  /** Between the spinner and the message. Default `" "`. */
  separator?: string;
  /** Paints for the spinner frame and the message. Default none. */
  theme?: LoaderTheme;
}

const DEFAULT_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * One-row spinner with a message. Call `stop()` when done: a running loader
 * keeps the process alive.
 *
 * @example Show a spinner next to a message
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Loader } from "@neonbyte/tui";
 *
 * const loader = new Loader({ requestRender() {} }, "Fetching…");
 *
 * assertEquals(loader.render(20), ["⠋ Fetching…"]);
 * ```
 *
 * @category Progress & status
 */
export class Loader implements Component {
  private readonly host: { requestRender(): void };
  private readonly frames: readonly string[];
  private readonly intervalMs: number;
  private readonly separator: string;
  private theme: LoaderTheme;
  private message: string;
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private cacheKey = "";
  private cache: readonly string[] = [];

  /**
   * Create a loader. It stays still until {@linkcode Loader.start} is called.
   *
   * @param host Asked to redraw whenever the frame or message changes; the {@linkcode TUI} works as host.
   * @param message Text beside the spinner. Default `Working…`.
   * @param options Frames, speed and paints; see {@linkcode LoaderOptions}.
   */
  public constructor(
    host: { requestRender(): void },
    message = "Working…",
    options: LoaderOptions = {},
  ) {
    this.host = host;
    this.message = message;
    this.frames = options.frames ?? DEFAULT_FRAMES;
    this.intervalMs = options.intervalMs ?? 80;
    this.separator = options.separator ?? " ";
    this.theme = options.theme ?? {};
  }

  /** Whether the animation is started. */
  public get running(): boolean {
    return this.timer !== undefined;
  }

  /**
   * Start advancing the spinner every `intervalMs` and request a render for
   * each frame. Does nothing when already running.
   *
   * @example Advance the frames
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { FakeTime } from "@std/testing/time";
   * import { Loader } from "@neonbyte/tui";
   *
   * using time = new FakeTime();
   * let renders = 0;
   * const loader = new Loader({ requestRender: () => renders++ }, "Working…", {
   *   intervalMs: 100,
   * });
   *
   * loader.start();
   * time.tick(250);
   * loader.stop();
   *
   * assertEquals(renders, 2);
   * assertEquals(loader.render(20), ["⠹ Working…"]);
   * ```
   */
  public start(): void {
    if (this.timer !== undefined) {
      return;
    }

    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % this.frames.length;

      this.host.requestRender();
    }, this.intervalMs);
  }

  /**
   * Stop the animation so the process can exit. Safe to call when not running.
   *
   * @example Stop the spinner
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Loader } from "@neonbyte/tui";
   *
   * const loader = new Loader({ requestRender() {} });
   *
   * loader.start();
   * loader.stop();
   *
   * assertEquals(loader.running, false);
   * ```
   */
  public stop(): void {
    clearInterval(this.timer);

    this.timer = undefined;
  }

  /**
   * Change the message and request a render.
   *
   * @param message The new text beside the spinner.
   *
   * @example Report progress while loading
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Loader } from "@neonbyte/tui";
   *
   * const loader = new Loader({ requestRender() {} }, "Connecting…");
   *
   * loader.setMessage("Downloading…");
   *
   * assertEquals(loader.render(30), ["⠋ Downloading…"]);
   * ```
   */
  public setMessage(message: string): void {
    this.message = message;

    this.host.requestRender();
  }

  /**
   * Replace some paints; others keep their values. Requests a render.
   *
   * @param theme Paints to change; see {@linkcode LoaderTheme}.
   *
   * @example Paint the message
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Loader } from "@neonbyte/tui";
   *
   * const loader = new Loader({ requestRender() {} }, "Saving…");
   *
   * loader.setTheme({ message: { bold: true } });
   *
   * assertEquals(loader.render(20)[0].includes("\x1b[1m"), true);
   * ```
   */
  public setTheme(theme: LoaderTheme): void {
    this.theme = { ...this.theme, ...theme };
    this.cacheKey = "";

    this.host.requestRender();
  }

  /**
   * Draw the spinner frame and the message in one row.
   *
   * @param width Cells available; the row is cut to fit.
   * @returns One row.
   */
  public render(width: number): readonly string[] {
    const key = `${width}\0${this.frame}\0${this.message}`;

    if (key === this.cacheKey) {
      return this.cache;
    }

    const spinner = paint(this.frames[this.frame], this.theme.spinner);
    const message = paint(this.message, this.theme.message);

    this.cacheKey = key;
    this.cache = [truncateToWidth(spinner + this.separator + message, width)];

    return this.cache;
  }
}
