import { type Color, mixColors, type Paint, paint } from "./style.ts";
import { visibleWidth } from "./width.ts";

/**
 * Where a task is in its life: waiting, in progress, or finished one of three ways.
 *
 * @category Progress & status
 */
export type TaskState = "pending" | "running" | "done" | "failed" | "skipped";

/**
 * Glyphs a task status is drawn with. Entries may be several cells wide (e.g.
 * `[✔]`); narrower ones are padded to the widest so text never shifts.
 *
 * @category Progress & status
 */
export interface StatusGlyphs {
  /** Mark of a task that has not started. */
  readonly pending: string;
  /** Spinner frames while running, one per interval. */
  readonly running: readonly string[];
  /** Frames played once when a task finishes, between its previous glyph and its final mark. */
  readonly settle: readonly string[];
  /** Mark of a task that finished successfully. */
  readonly done: string;
  /** Mark of a task that finished with an error. */
  readonly failed: string;
  /** Mark of a task that was not run. */
  readonly skipped: string;
}

const BRAILLE = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BRAILLE_FILL = ["⣀", "⣤", "⣶", "⣿"];

/**
 * Built-in {@linkcode StatusGlyphs} sets: `dots`, `circle`, `checkbox`,
 * `brackets` and `ascii`.
 *
 * @category Progress & status
 */
export const STATUS_GLYPHS: {
  readonly [Name in "dots" | "circle" | "checkbox" | "brackets" | "ascii"]:
    StatusGlyphs;
} = {
  /** `○` pending, braille spinner, fills up `⣀⣤⣶⣿`, then `✔` / `✘` / `–`. */
  dots: {
    pending: "○",
    running: BRAILLE,
    settle: BRAILLE_FILL,
    done: "✔",
    failed: "✘",
    skipped: "–",
  },
  /** Arc spinner that fills into a disc `◔◑◕●` before the mark. */
  circle: {
    pending: "○",
    running: ["◜", "◠", "◝", "◞", "◡", "◟"],
    settle: ["◔", "◑", "◕", "●"],
    done: "✔",
    failed: "✘",
    skipped: "–",
  },
  /** Checkboxes for to-do lists: `☐` → rotating quadrant → `▣` → `☑` / `☒` / `⊟`. */
  checkbox: {
    pending: "☐",
    running: ["◰", "◳", "◲", "◱"],
    settle: ["◧", "▣"],
    done: "☑",
    failed: "☒",
    skipped: "⊟",
  },
  /** Markdown-style `[ ]` / `[✔]` with the braille spinner inside. */
  brackets: {
    pending: "[ ]",
    running: BRAILLE.map((g) => `[${g}]`),
    settle: BRAILLE_FILL.map((g) => `[${g}]`),
    done: "[✔]",
    failed: "[✘]",
    skipped: "[-]",
  },
  /** ASCII only, for terminals without Unicode fonts. */
  ascii: {
    pending: "[ ]",
    running: ["[|]", "[/]", "[-]", "[\\]"],
    settle: ["[.]", "[o]"],
    done: "[x]",
    failed: "[!]",
    skipped: "[-]",
  },
};

/**
 * A paint per task state; states left out use the component's default for them.
 *
 * @category Progress & status
 */
export type StatusPaints = { readonly [S in TaskState]?: Paint };

/**
 * Paints per element of a task indicator.
 *
 * @category Progress & status
 */
export interface StatusTheme {
  /**
   * Glyph paint per state, each replacing that state's default: grey,
   * cyan, green, red, grey. A finishing task fades its glyph from the old
   * state's colour to the new one.
   */
  readonly glyph?: StatusPaints;
  /** Text paint per state, for the label next to the glyph. */
  readonly label?: StatusPaints;
}

const DEFAULT_GLYPH_PAINTS: { readonly [S in TaskState]: Paint } = {
  pending: { fg: "#5c6370" },
  running: { fg: "#3fb5e8" },
  done: { fg: "#50c050" },
  failed: { fg: "#e05050" },
  skipped: { fg: "#8a8f98" },
};

/** A task's state and when it was entered: enough to draw its glyph at any moment. */
export interface TaskMark {
  readonly state: TaskState;
  /** The state before, whose colour a settle animation fades from. */
  readonly from: TaskState;
  /** Clock time the state was entered; `-Infinity` skips the settle animation. */
  readonly since: number;
}

const HEX = /^#[0-9a-f]{6}$/i;

function isHex(color: Color | undefined): color is `#${string}` {
  return typeof color === "string" && HEX.test(color);
}

function isFinal(state: TaskState): boolean {
  return state === "done" || state === "failed" || state === "skipped";
}

/** Draws task glyphs for one glyph set, glyph paints, and frame interval. */
export class StatusStyle {
  public readonly width: number;
  private readonly glyphs: StatusGlyphs;
  private paints: { [S in TaskState]: Paint | undefined };
  private readonly intervalMs: number;

  public constructor(
    glyphs: StatusGlyphs,
    paints: StatusPaints,
    intervalMs: number,
  ) {
    if (glyphs.running.length === 0) {
      throw new Error("StatusGlyphs.running needs at least one frame");
    }

    this.glyphs = glyphs;
    this.paints = { ...DEFAULT_GLYPH_PAINTS, ...paints };
    this.intervalMs = Math.max(1, intervalMs);
    this.width = Math.max(
      ...[
        glyphs.pending,
        glyphs.done,
        glyphs.failed,
        glyphs.skipped,
        ...glyphs.running,
        ...glyphs.settle,
      ].map((g) => visibleWidth(g)),
    );
  }

  /** Replace some glyph paints; others keep their values. */
  public setPaints(paints: StatusPaints): void {
    this.paints = { ...this.paints, ...paints };
  }

  /**
   * `state` entered at `now`; returns `previous` unchanged when the state is
   * the same. Without a `previous` mark, a finished state shows its final mark
   * at once instead of settling.
   */
  public mark(
    previous: TaskMark | undefined,
    state: TaskState,
    now: number,
  ): TaskMark {
    if (previous === undefined) {
      return { state, from: state, since: isFinal(state) ? -Infinity : now };
    }

    if (previous.state === state) {
      return previous;
    }

    return { state, from: previous.state, since: now };
  }

  /** Whether the glyph of `mark` still changes over time. */
  public animating(mark: TaskMark, now: number): boolean {
    if (mark.state === "running") {
      return true;
    }

    return isFinal(mark.state) &&
      this.frameAt(mark, now) < this.glyphs.settle.length;
  }

  /** The painted glyph of `mark` at `now`, padded to `width` cells. */
  public cell(mark: TaskMark, now: number): string {
    const [glyph, p] = this.glyph(mark, now);

    return paint(glyph, p) + " ".repeat(this.width - visibleWidth(glyph));
  }

  private glyph(mark: TaskMark, now: number): [string, Paint | undefined] {
    const target = this.paintOf(mark.state);

    if (mark.state === "pending") {
      return [this.glyphs.pending, target];
    }

    const frame = this.frameAt(mark, now);

    if (mark.state === "running") {
      const running = this.glyphs.running;

      return [running[frame % running.length], target];
    }

    const settle = this.glyphs.settle;

    if (frame >= settle.length) {
      return [this.glyphs[mark.state], target];
    }

    return [settle[frame], this.fade(mark.from, target, frame)];
  }

  /** Settle frame `frame` (0-based) coloured part way from the old state's colour to `target`. */
  private fade(
    from: TaskState,
    target: Paint | undefined,
    frame: number,
  ): Paint | undefined {
    const start = this.paintOf(from)?.fg;
    const end = target?.fg;

    if (!isHex(start) || !isHex(end)) {
      return target;
    }

    const t = (frame + 1) / (this.glyphs.settle.length + 1);

    return { ...target, fg: mixColors(start, end, t) };
  }

  private paintOf(state: TaskState): Paint | undefined {
    return this.paints[state];
  }

  private frameAt(mark: TaskMark, now: number): number {
    return Math.max(0, Math.floor((now - mark.since) / this.intervalMs));
  }
}

/**
 * Repaints a component every interval while `active()` holds, and stops by
 * itself once it no longer does, so finished tasks do not keep the process
 * alive.
 */
export class Ticker {
  private readonly host: { requestRender(): void };
  private readonly intervalMs: number;
  private readonly active: () => boolean;
  private timer: ReturnType<typeof setInterval> | undefined;

  public constructor(
    host: { requestRender(): void },
    intervalMs: number,
    active: () => boolean,
  ) {
    this.host = host;
    this.intervalMs = Math.max(1, intervalMs);
    this.active = active;
  }

  public get running(): boolean {
    return this.timer !== undefined;
  }

  /** Repaint now, and keep repainting if anything animates. */
  public wake(): void {
    this.host.requestRender();

    if (this.timer !== undefined || !this.active()) {
      return;
    }

    this.timer = setInterval(() => {
      this.host.requestRender();

      if (!this.active()) {
        this.stop();
      }
    }, this.intervalMs);
  }

  public stop(): void {
    clearInterval(this.timer);

    this.timer = undefined;
  }
}
