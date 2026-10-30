import { type Paint, paint } from "../style.ts";
import type { Component } from "../tui.ts";
import { truncateToWidth } from "../width.ts";

/**
 * Units a duration is split into, largest first.
 *
 * @category Progress & status
 */
export type DurationUnit = "d" | "h" | "m" | "s";

/**
 * Frames a changing digit is drawn with. Each frame is a 10-character string
 * indexed by digit (`"⁰¹²³⁴⁵⁶⁷⁸⁹"`). The old digit plays `leave`, then the new
 * digit plays `enter`, then the new digit shows plainly. Every character must
 * be one cell wide.
 *
 * @category Progress & status
 */
export interface RollGlyphs {
  /** Frames the old digit plays while it leaves, one 10-character string per frame. */
  readonly leave: readonly string[];
  /** Frames the new digit plays while it arrives, one 10-character string per frame. */
  readonly enter: readonly string[];
}

const DIGITS = "0123456789";
const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

/**
 * Built-in digit transitions for {@linkcode RollGlyphs}: `up`, `down`,
 * `fade` and `none`.
 *
 * @category Progress & status
 */
export const ROLL_GLYPHS: {
  readonly [Name in "up" | "down" | "fade" | "none"]: RollGlyphs;
} = {
  /** The old digit leaves upward (superscript), the new one arrives from below (subscript). */
  up: { leave: [SUPERSCRIPT], enter: [SUBSCRIPT] },
  /** The old digit leaves downward, the new one arrives from above. */
  down: { leave: [SUBSCRIPT], enter: [SUPERSCRIPT] },
  /** No movement: both digits flash in the rolling paints, for fonts without super/subscript digits. */
  fade: { leave: [DIGITS], enter: [DIGITS] },
  /** Digits change at once. */
  none: { leave: [], enter: [] },
};

/**
 * Paints per element; unset elements keep the surrounding style.
 *
 * @category Progress & status
 */
export interface DurationTheme {
  /** Digits at rest. */
  readonly digits?: Paint;
  /** Unit labels (`m`, `s`). */
  readonly units?: Paint;
  /** The old digit while it leaves. Default grey `#8a8f98`. */
  readonly leaving?: Paint;
  /** The new digit while it arrives. Default grey `#8a8f98`. */
  readonly entering?: Paint;
}

/**
 * Options of {@linkcode Duration}.
 *
 * @category Progress & status
 */
export interface DurationOptions {
  /** Count down from this many milliseconds instead of up from zero; stops at zero and calls `onDone`. */
  countdown?: number;
  /** Called once when a countdown reaches zero. */
  onDone?: () => void;
  /** Units to split into, largest first; the last is the resolution. Default `["h", "m", "s"]`. */
  units?: readonly DurationUnit[];
  /** Labels after each part. Default `d h m s`. */
  labels?: Partial<Record<DurationUnit, string>>;
  /** Between parts. Default `" "`. */
  separator?: string;
  /** Parts shown even when their leading units are zero: 1 gives `5s`, 2 gives `0m 05s`. Default 1. */
  minParts?: number;
  /** Pad the leading part to two digits too (`09m 02s`). Default false. */
  padLeading?: boolean;
  /** Default `ROLL_GLYPHS.up`. */
  roll?: RollGlyphs;
  /** Duration of one roll frame. Default 70 ms. */
  frameMs?: number;
  /** Paints per element; unset elements keep the surrounding style. */
  theme?: DurationTheme;
  /** Ends a display that is cut to fit the row. Default `…`. */
  ellipsis?: string;
  /** Millisecond clock time follows. Default `performance.now`. */
  clock?: () => number;
}

interface Part {
  readonly unit: DurationUnit;
  readonly digits: string;
}

interface Transition {
  readonly from: readonly Part[] | undefined;
  readonly to: readonly Part[];
  readonly since: number;
}

const UNIT_MS: Record<DurationUnit, number> = {
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
  s: 1000,
};
const DEFAULT_LABELS: Record<DurationUnit, string> = {
  d: "d",
  h: "h",
  m: "m",
  s: "s",
};
const ROLLING: Paint = { fg: "#8a8f98" };

/** Split `ms` into parts, dropping zero leading parts beyond `minParts`. */
function splitDuration(
  ms: number,
  units: readonly DurationUnit[],
  minParts: number,
  padLeading: boolean,
): Part[] {
  let rest = Math.max(0, ms);
  const values = units.map((unit) => {
    const value = Math.floor(rest / UNIT_MS[unit]);

    rest -= value * UNIT_MS[unit];

    return value;
  });
  let first = 0;

  while (first < units.length - Math.max(1, minParts) && values[first] === 0) {
    first++;
  }

  return units.slice(first).map((unit, i) => {
    const digits = String(values[first + i]);
    const pad = i > 0 || padLeading;

    return { unit, digits: pad ? digits.padStart(2, "0") : digits };
  });
}

function partsKey(parts: readonly Part[] | undefined): string {
  return parts === undefined
    ? ""
    : parts.map((part) => part.digits + part.unit).join(" ");
}

/**
 * An elapsed-time or countdown display like `9m 02s` whose digits roll when
 * they change: by default the old digit slides up out of the cell and the new
 * one comes up from below, like a mechanical counter.
 *
 * It counts up from zero after `start()` (or down from `countdown`), or shows
 * whatever `setValue()` sets. While running it repaints at each change and,
 * while a digit rolls, every `frameMs`; paused and settled, it keeps no timer.
 *
 * @example Show an elapsed time
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { FakeTime } from "@std/testing/time";
 * import { Duration } from "@neonbyte/tui";
 *
 * using time = new FakeTime();
 * const timer = new Duration({ requestRender() {} }, {
 *   clock: () => time.now,
 * });
 *
 * timer.start();
 * time.tick(65_300); // the digits have settled
 *
 * assertEquals(timer.render(20), ["1m 05s"]);
 * timer.pause();
 * ```
 *
 * @category Progress & status
 */
export class Duration implements Component {
  private readonly host: { requestRender(): void };
  private readonly clock: () => number;
  private readonly countdown: number | undefined;
  private readonly onDone: (() => void) | undefined;
  private readonly units: readonly DurationUnit[];
  private readonly labels: Record<DurationUnit, string>;
  private readonly separator: string;
  private readonly minParts: number;
  private readonly padLeading: boolean;
  private readonly ellipsis: string;
  private readonly frameMs: number;
  private roll: RollGlyphs;
  private theme: DurationTheme;
  /** Elapsed milliseconds banked before the current run. */
  private banked = 0;
  /** Clock time the current run started; undefined while paused. */
  private startedAt: number | undefined;
  private transition: Transition;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private cacheKey = "";
  private cache: readonly string[] = [];

  /**
   * Create a paused display at zero (or at the full countdown).
   *
   * @param host Asked to redraw when the shown value changes; the {@linkcode TUI} works as host.
   * @param options Countdown, units, labels, roll and paints; see {@linkcode DurationOptions}.
   * @throws {Error} When `units` is empty.
   */
  public constructor(
    host: { requestRender(): void },
    options: DurationOptions = {},
  ) {
    const units = options.units ?? ["h", "m", "s"];

    if (units.length === 0) {
      throw new Error("Duration needs at least one unit");
    }

    this.host = host;
    this.clock = options.clock ?? (() => performance.now());
    this.countdown = options.countdown;
    this.onDone = options.onDone;
    this.units = [...units].sort((a, b) => UNIT_MS[b] - UNIT_MS[a]);
    this.labels = { ...DEFAULT_LABELS, ...options.labels };
    this.separator = options.separator ?? " ";
    this.minParts = options.minParts ?? 1;
    this.padLeading = options.padLeading ?? false;
    this.frameMs = Math.max(1, options.frameMs ?? 70);
    this.roll = options.roll ?? ROLL_GLYPHS.up;
    this.theme = { ...options.theme };
    this.ellipsis = options.ellipsis ?? "…";
    this.transition = {
      from: undefined,
      to: this.partsAt(this.clock()),
      since: -Infinity,
    };
  }

  /** Whether time is running. */
  public get running(): boolean {
    return this.startedAt !== undefined;
  }

  /** Milliseconds shown: elapsed time, or the time left for a countdown. */
  public get value(): number {
    const elapsed = this.elapsedAt(this.clock());

    return this.countdown === undefined
      ? elapsed
      : Math.max(0, this.countdown - elapsed);
  }

  /**
   * Start or resume. A finished countdown stays at zero. While running, the
   * display repaints each time the shown value changes and `host` is asked
   * to redraw.
   *
   * @example Count down to zero
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { FakeTime } from "@std/testing/time";
   * import { Duration } from "@neonbyte/tui";
   *
   * using time = new FakeTime();
   * let done = false;
   * const timer = new Duration({ requestRender() {} }, {
   *   countdown: 3000,
   *   onDone: () => done = true,
   *   clock: () => time.now,
   * });
   *
   * timer.start();
   * time.tick(3300);
   *
   * assertEquals(done, true);
   * assertEquals(timer.running, false);
   * assertEquals(timer.render(20), ["0s"]);
   * ```
   */
  public start(): void {
    const finished = this.countdown !== undefined && this.value === 0;

    if (this.startedAt !== undefined || finished) {
      return;
    }

    this.startedAt = this.clock();

    this.tick();
  }

  /**
   * Stop the clock, keeping the time shown.
   *
   * @example Pause a stopwatch
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { FakeTime } from "@std/testing/time";
   * import { Duration } from "@neonbyte/tui";
   *
   * using time = new FakeTime();
   * const timer = new Duration({ requestRender() {} }, {
   *   clock: () => time.now,
   * });
   *
   * timer.start();
   * time.tick(2000);
   * timer.pause();
   * time.tick(5000);
   *
   * assertEquals(timer.value, 2000);
   * assertEquals(timer.running, false);
   * ```
   */
  public pause(): void {
    const now = this.clock();

    this.banked = this.elapsedAt(now);
    this.startedAt = undefined;

    this.tick();
  }

  /**
   * Back to zero (or the full countdown) without rolling, paused.
   *
   * @example Start over
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { FakeTime } from "@std/testing/time";
   * import { Duration } from "@neonbyte/tui";
   *
   * using time = new FakeTime();
   * const timer = new Duration({ requestRender() {} }, {
   *   clock: () => time.now,
   * });
   *
   * timer.start();
   * time.tick(5000);
   * timer.reset();
   *
   * assertEquals(timer.value, 0);
   * assertEquals(timer.running, false);
   * ```
   */
  public reset(): void {
    this.banked = 0;
    this.startedAt = undefined;
    this.transition = {
      from: undefined,
      to: this.partsAt(this.clock()),
      since: -Infinity,
    };

    this.tick();
  }

  /**
   * Show `ms` (elapsed, or time left for a countdown), rolling the digits
   * that change. Keeps running if it was.
   *
   * @param ms Milliseconds to show.
   *
   * @example Show a time you measured elsewhere
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { FakeTime } from "@std/testing/time";
   * import { Duration } from "@neonbyte/tui";
   *
   * using time = new FakeTime();
   * const timer = new Duration({ requestRender() {} }, {
   *   clock: () => time.now,
   * });
   *
   * timer.setValue(3_725_000);
   * time.tick(300); // let the digits settle
   *
   * assertEquals(timer.render(20), ["1h 02m 05s"]);
   * ```
   */
  public setValue(ms: number): void {
    const now = this.clock();
    const elapsed = this.countdown === undefined ? ms : this.countdown - ms;

    this.banked = Math.max(0, elapsed);
    this.startedAt = this.startedAt === undefined ? undefined : now;

    this.tick();
  }

  /**
   * Change the digit transition. Requests a render.
   *
   * @param roll The frames a changing digit plays, e.g. {@linkcode ROLL_GLYPHS}`.fade`.
   *
   * @example Switch the rolling off
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Duration, ROLL_GLYPHS } from "@neonbyte/tui";
   *
   * const timer = new Duration({ requestRender() {} });
   *
   * timer.setRoll(ROLL_GLYPHS.none);
   * timer.setValue(5000);
   *
   * assertEquals(timer.render(20), ["5s"]);
   * ```
   */
  public setRoll(roll: RollGlyphs): void {
    this.roll = roll;
    this.cacheKey = "";

    this.host.requestRender();
  }

  /**
   * Replace some paints; others keep their values. Requests a render.
   *
   * @param theme Paints to change; see {@linkcode DurationTheme}.
   *
   * @example Emphasise the digits
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Duration } from "@neonbyte/tui";
   *
   * const timer = new Duration({ requestRender() {} });
   *
   * timer.setTheme({ digits: { bold: true } });
   *
   * assertEquals(timer.render(20), ["\x1b[1m0\x1b[22ms"]);
   * ```
   */
  public setTheme(theme: DurationTheme): void {
    this.theme = { ...this.theme, ...theme };
    this.cacheKey = "";

    this.host.requestRender();
  }

  /** Drop the cached row so the next render draws it again. */
  public invalidate(): void {
    this.cacheKey = "";
  }

  /**
   * Draw the time and its unit labels in one row, with digits that changed
   * recently still rolling.
   *
   * @param width Cells available; the display is cut to fit.
   * @returns One row, empty when `width` is below 1.
   */
  public render(width: number): readonly string[] {
    if (width < 1) {
      return [];
    }

    const frame = Math.floor(
      (this.clock() - this.transition.since) / this.frameMs,
    );
    const rolling = frame < this.rollFrames();
    const key = `${width}\0${rolling ? frame : -1}\0${
      partsKey(this.transition.from)
    }\0${partsKey(this.transition.to)}`;

    if (key === this.cacheKey) {
      return this.cache;
    }

    const parts = this.transition.to.map((part) =>
      this.renderPart(part, rolling ? frame : -1)
    );

    this.cacheKey = key;
    this.cache = [
      truncateToWidth(parts.join(this.separator), width, this.ellipsis),
    ];

    return this.cache;
  }

  /** One part (digits and unit label) at roll frame `frame`; -1 draws it at rest. */
  private renderPart(part: Part, frame: number): string {
    const label = paint(this.labels[part.unit], this.theme.units);
    const old = frame === -1
      ? undefined
      : this.transition.from?.find((p) => p.unit === part.unit)?.digits ?? "";

    if (old === undefined || old === part.digits) {
      return paint(part.digits, this.theme.digits) + label;
    }

    const length = Math.max(old.length, part.digits.length);
    const from = old.padStart(length);
    const to = part.digits.padStart(length);
    let out = "";

    for (let i = 0; i < length; i++) {
      out += from[i] === to[i]
        ? paint(to[i], this.theme.digits)
        : this.rollingDigit(from[i], to[i], frame);
    }

    return out + label;
  }

  /** One digit position `frame` frames into its change from `from` to `to` (either may be a space: absent). */
  private rollingDigit(from: string, to: string, frame: number): string {
    const leave = this.roll.leave;

    if (frame < leave.length) {
      return from === " " ? " " : paint(
        leave[frame][Number(from)],
        this.theme.leaving ?? ROLLING,
      );
    }

    const enter = frame - leave.length;

    if (enter < this.roll.enter.length) {
      return to === " " ? " " : paint(
        this.roll.enter[enter][Number(to)],
        this.theme.entering ?? ROLLING,
      );
    }

    return paint(to, this.theme.digits);
  }

  /** Number of frames a digit change rolls for. */
  private rollFrames(): number {
    return this.roll.leave.length + this.roll.enter.length;
  }

  /** Milliseconds elapsed at `now`, including the banked time. */
  private elapsedAt(now: number): number {
    return this.startedAt === undefined
      ? this.banked
      : this.banked + now - this.startedAt;
  }

  /** What is shown at `now`: a countdown rounds up, so it shows the full time first and zero only at the end. */
  private partsAt(now: number): Part[] {
    const resolution = UNIT_MS[this.units[this.units.length - 1]];
    const elapsed = this.elapsedAt(now);
    const shown = this.countdown === undefined
      ? elapsed
      : Math.ceil(Math.max(0, this.countdown - elapsed) / resolution) *
        resolution;

    return splitDuration(shown, this.units, this.minParts, this.padLeading);
  }

  /** Bring the shown parts up to date, finish a countdown, and schedule the next repaint. */
  private tick(): void {
    const now = this.clock();

    this.finishCountdown(now);

    const parts = this.partsAt(now);

    if (partsKey(parts) !== partsKey(this.transition.to)) {
      this.transition = { from: this.transition.to, to: parts, since: now };
    }

    this.host.requestRender();
    this.schedule(now);
  }

  /** End a countdown that reached zero: bank the full time, pause, and call `onDone`. */
  private finishCountdown(now: number): void {
    if (
      this.countdown === undefined || this.startedAt === undefined ||
      this.elapsedAt(now) < this.countdown
    ) {
      return;
    }

    this.banked = this.countdown;
    this.startedAt = undefined;

    this.onDone?.();
  }

  /** Arm one timer for the next repaint: the next roll frame or the next change of the value. */
  private schedule(now: number): void {
    clearTimeout(this.timer);

    this.timer = undefined;

    const age = now - this.transition.since;
    const rollLeft = this.rollFrames() * this.frameMs - age;
    let delay = rollLeft > 0 ? this.frameMs - (age % this.frameMs) : Infinity;

    if (this.startedAt !== undefined) {
      delay = Math.min(delay, this.untilNextChange(now));
    }

    if (Number.isFinite(delay)) {
      this.timer = setTimeout(() => this.tick(), Math.max(1, Math.ceil(delay)));
    }
  }

  /** Milliseconds until the shown value next changes while running. */
  private untilNextChange(now: number): number {
    const resolution = UNIT_MS[this.units[this.units.length - 1]];
    const elapsed = this.elapsedAt(now);

    if (this.countdown === undefined) {
      return resolution - (elapsed % resolution);
    }

    const left = this.countdown - elapsed;

    return left % resolution || resolution;
  }
}
