import { CURSOR_MARKER } from "../ansi.ts";
import {
  bindKeys,
  type InputEvent,
  type Key,
  matchesKey,
  type MouseInput,
} from "../keys.ts";
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
import { type Paint, paint } from "../style.ts";
import type { Component, Focusable } from "../tui.ts";
import { truncateToWidth, visibleWidth, wrapText } from "../width.ts";

/**
 * One item of a {@linkcode Checklist}.
 *
 * @category Progress & status
 */
export interface ChecklistItem {
  /** Text of the item; wraps when it does not fit. */
  readonly label: string;
  /** Where the item is in its life. */
  readonly state: TaskState;
  /** Dimmed text after the label, e.g. a duration or error. */
  readonly note?: string;
}

/**
 * What a key can do in an interactive checklist.
 *
 * @category Progress & status
 */
export type ChecklistAction = "up" | "down" | "first" | "last" | "toggle";

/**
 * Key bindings of an interactive checklist, as {@linkcode matchesKey} specs.
 *
 * @category Progress & status
 */
export const DEFAULT_CHECKLIST_KEYS: Readonly<
  Record<ChecklistAction, readonly string[]>
> = {
  up: ["up", "k"],
  down: ["down", "j"],
  first: ["home"],
  last: ["end"],
  toggle: ["space", "enter"],
};

/**
 * Paints per element of a checklist.
 *
 * @category Progress & status
 */
export interface ChecklistTheme extends StatusTheme {
  /**
   * Label paint per state, each replacing that state's default: bold while
   * running, struck through and dim when done, red when failed, dim when
   * skipped.
   */
  readonly label?: StatusPaints;
  /** The note after a label. Default grey `#5c6370`. */
  readonly note?: Paint;
  /** The pointer at the selected item. Default cyan `#3fb5e8`. */
  readonly pointer?: Paint;
}

/**
 * Options of {@linkcode Checklist}.
 *
 * @category Progress & status
 */
export interface ChecklistOptions {
  /** The initial items; they appear in their states without settle animations. */
  items?: readonly ChecklistItem[];
  /** Default `STATUS_GLYPHS.checkbox`. */
  glyphs?: StatusGlyphs;
  /** Paints for glyphs (per state: grey, cyan, green, red, grey), labels, notes and the pointer, each replacing its default. */
  theme?: ChecklistTheme;
  /** Keyboard control while focused, replacing the default keys of each action given. Default `DEFAULT_CHECKLIST_KEYS`. */
  keys?: Partial<Record<ChecklistAction, readonly string[]>>;
  /** Respond to keys and the mouse: ↑/↓ select, Space/Enter toggle done. Adds a pointer column. Default false. */
  interactive?: boolean;
  /** Pointer at the selected item while focused, painted with `theme.pointer`. Default `❯`. */
  pointer?: string;
  /** Cells between the glyph and the label. Default 1. */
  gap?: number;
  /** Cells between the pointer and the glyph. Default 1. */
  pointerGap?: number;
  /** Between a label and its note. Default `" "`. */
  noteSeparator?: string;
  /** Frame interval of spinners and settle animations. Default 80 ms. */
  intervalMs?: number;
  /** Millisecond clock the animation follows. Default `performance.now`. */
  clock?: () => number;
}

const ACTIONS: readonly ChecklistAction[] = [
  "up",
  "down",
  "first",
  "last",
  "toggle",
];

const DEFAULT_LABELS: StatusPaints = {
  running: { bold: true },
  done: { dim: true, strikethrough: true },
  failed: { fg: "#e05050" },
  skipped: { dim: true },
};

const DEFAULT_PAINTS: { readonly note: Paint; readonly pointer: Paint } = {
  note: { fg: "#5c6370" },
  pointer: { fg: "#3fb5e8" },
};

interface Entry {
  label: string;
  note: string | undefined;
  mark: TaskMark;
}

/**
 * A to-do list: one status glyph per item, spinning while it runs and
 * settling into a check mark, cross or skip mark when it ends. Long labels
 * wrap under themselves.
 *
 * With `interactive`, a focused list is a set of checkboxes: ↑/↓ (or k/j)
 * select, Home/End jump, Space or Enter toggles between done and pending and
 * calls `onToggle` (rebind with `keys`). With mouse enabled, clicking an item
 * selects it, and clicking its glyph or label toggles it; the wheel moves the
 * selection.
 *
 * @example Show the steps of a build
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Checklist } from "@neonbyte/tui";
 *
 * const list = new Checklist({ requestRender() {} }, {
 *   items: [
 *     { label: "Compile", state: "pending", note: "1.2s" },
 *     { label: "Test", state: "pending" },
 *   ],
 * });
 * const rows = list.render(30).map((row) => row.replace(/\x1b\[[0-9;]*m/g, ""));
 *
 * assertEquals(rows, ["☐ Compile 1.2s", "☐ Test"]);
 * ```
 *
 * @category Progress & status
 */
export class Checklist implements Component, Focusable {
  /** Whether the list has focus; set by the TUI. A focused interactive list shows its pointer. */
  public focused = false;
  /** Whether the terminal's own cursor is shown at the selected item; set by the TUI. */
  public hardwareCursor?: boolean;
  /** Called after the user toggles an item. */
  public onToggle?: (index: number, item: ChecklistItem) => void;
  private readonly host: { requestRender(): void };
  private readonly style: StatusStyle;
  private readonly keys: Readonly<Record<ChecklistAction, readonly string[]>>;
  private readonly interactive: boolean;
  private readonly pointer: string;
  private readonly gap: number;
  private readonly pointerGap: number;
  private readonly noteSeparator: string;
  private readonly clock: () => number;
  private readonly ticker: Ticker;
  private labels: StatusPaints;
  private notePaint: Paint | undefined;
  private pointerPaint: Paint | undefined;
  private entries: Entry[] = [];
  private cursor = 0;
  private cacheKey = "";
  private cache: readonly string[] = [];
  /** The rows of each item in the last frame, for hit-testing. */
  private blocks: readonly (readonly string[])[] = [];

  /**
   * Create a checklist.
   *
   * @param host Asked to redraw while items animate; the {@linkcode TUI} works as host.
   * @param options Items, glyphs, paints, keys and timing; see {@linkcode ChecklistOptions}.
   * @throws {Error} When `options.glyphs.running` is empty.
   */
  public constructor(
    host: { requestRender(): void },
    options: ChecklistOptions = {},
  ) {
    const intervalMs = options.intervalMs ?? 80;
    const theme = { ...DEFAULT_PAINTS, ...options.theme };

    this.host = host;
    this.style = new StatusStyle(
      options.glyphs ?? STATUS_GLYPHS.checkbox,
      theme.glyph ?? {},
      intervalMs,
    );
    this.keys = bindKeys(DEFAULT_CHECKLIST_KEYS, options.keys);
    this.labels = { ...DEFAULT_LABELS, ...theme.label };
    this.notePaint = theme.note;
    this.pointerPaint = theme.pointer;
    this.interactive = options.interactive ?? false;
    this.pointer = options.pointer ?? "❯";
    this.gap = Math.max(0, Math.floor(options.gap ?? 1));
    this.pointerGap = Math.max(0, Math.floor(options.pointerGap ?? 1));
    this.noteSeparator = options.noteSeparator ?? " ";
    this.clock = options.clock ?? (() => performance.now());
    this.ticker = new Ticker(host, intervalMs, () => this.animating);

    this.setItems(options.items ?? []);
  }

  /** The items with their current states. */
  public get items(): readonly ChecklistItem[] {
    return this.entries.map((entry) => this.itemAt(entry));
  }

  /** Index of the selected item. */
  public get selected(): number {
    return this.cursor;
  }

  /** Whether any glyph is still moving: an item running, or settling into its final mark. */
  public get animating(): boolean {
    const now = this.clock();

    return this.entries.some((entry) => this.style.animating(entry.mark, now));
  }

  /**
   * Replace every item; they appear in their states without settle
   * animations. The selection is kept as far as the new list reaches.
   *
   * @param items The new items.
   *
   * @example Load a list
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Checklist } from "@neonbyte/tui";
   *
   * const list = new Checklist({ requestRender() {} });
   *
   * list.setItems([
   *   { label: "Compile", state: "done" },
   *   { label: "Test", state: "pending" },
   * ]);
   *
   * const rows = list.render(20).map((row) => row.replace(/\x1b\[[0-9;]*m/g, ""));
   *
   * assertEquals(rows, ["☑ Compile", "☐ Test"]);
   * ```
   */
  public setItems(items: readonly ChecklistItem[]): void {
    this.entries = items.map((item) => ({
      label: item.label,
      note: item.note,
      mark: this.style.mark(undefined, item.state, this.clock()),
    }));
    this.cursor = Math.min(this.cursor, Math.max(0, this.entries.length - 1));

    this.changed();
  }

  /**
   * Append an item.
   *
   * @param label Text of the item.
   * @param state Where the item starts, without a settle animation. Default `pending`.
   * @param note Dimmed text after the label. Default none.
   * @returns The index of the new item.
   *
   * @example Grow the list as work is discovered
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Checklist } from "@neonbyte/tui";
   *
   * const list = new Checklist({ requestRender() {} });
   *
   * assertEquals(list.add("Compile"), 0);
   * assertEquals(list.add("Test", "pending", "slow"), 1);
   * assertEquals(list.items.length, 2);
   * ```
   */
  public add(
    label: string,
    state: TaskState = "pending",
    note?: string,
  ): number {
    this.entries.push({
      label,
      note,
      mark: this.style.mark(undefined, state, this.clock()),
    });

    this.changed();

    return this.entries.length - 1;
  }

  /**
   * Remove an item. The selection stays on the list.
   *
   * @param index Index of the item.
   * @throws {RangeError} When there is no item at `index`.
   *
   * @example Drop a step
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Checklist } from "@neonbyte/tui";
   *
   * const list = new Checklist({ requestRender() {} }, {
   *   items: [
   *     { label: "Compile", state: "done" },
   *     { label: "Test", state: "pending" },
   *   ],
   * });
   *
   * list.remove(0);
   *
   * assertEquals(list.items.map((item) => item.label), ["Test"]);
   * ```
   */
  public remove(index: number): void {
    this.entryAt(index);
    this.entries.splice(index, 1);

    this.cursor = Math.min(this.cursor, Math.max(0, this.entries.length - 1));

    this.changed();
  }

  /**
   * Change an item's state (animated when it finishes), label or note.
   * `note: undefined` clears the note.
   *
   * @param index Index of the item.
   * @param patch The fields to change; others keep their values.
   * @throws {RangeError} When there is no item at `index`.
   *
   * @example Attach a duration to a finished step
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Checklist } from "@neonbyte/tui";
   *
   * const list = new Checklist({ requestRender() {} }, {
   *   items: [{ label: "Compile", state: "done" }],
   * });
   *
   * list.update(0, { note: "1.2s" });
   *
   * assertEquals(list.items[0], {
   *   label: "Compile",
   *   state: "done",
   *   note: "1.2s",
   * });
   * ```
   */
  public update(index: number, patch: Partial<ChecklistItem>): void {
    const entry = this.entryAt(index);

    if (patch.label !== undefined) {
      entry.label = patch.label;
    }

    if ("note" in patch) {
      entry.note = patch.note;
    }

    if (patch.state !== undefined) {
      entry.mark = this.style.mark(entry.mark, patch.state, this.clock());
    }

    this.changed();
  }

  /**
   * Change an item's state; finishing it plays the settle animation.
   *
   * @param index Index of the item.
   * @param state The state to enter.
   * @throws {RangeError} When there is no item at `index`.
   *
   * @example Finish a step
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Checklist } from "@neonbyte/tui";
   *
   * let now = 0;
   * const list = new Checklist({ requestRender() {} }, {
   *   items: [{ label: "Compile", state: "running" }],
   *   clock: () => now,
   * });
   *
   * list.setState(0, "done");
   * now = 1000; // the settle animation is over
   *
   * const row = list.render(20)[0].replace(/\x1b\[[0-9;]*m/g, "");
   *
   * assertEquals(row, "☑ Compile");
   * list.setItems([]); // stops the animation's timer
   * ```
   */
  public setState(index: number, state: TaskState): void {
    this.update(index, { state });
  }

  /**
   * Select an item. The index is clamped to the list.
   *
   * @param index Index of the item to select.
   *
   * @example Select the last item
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Checklist } from "@neonbyte/tui";
   *
   * const list = new Checklist({ requestRender() {} }, {
   *   items: [
   *     { label: "Compile", state: "pending" },
   *     { label: "Test", state: "pending" },
   *   ],
   * });
   *
   * list.select(10);
   *
   * assertEquals(list.selected, 1);
   * ```
   */
  public select(index: number): void {
    this.cursor = Math.min(
      Math.max(0, index),
      Math.max(0, this.entries.length - 1),
    );

    this.changed();
  }

  /**
   * Handle a key while focused: select, jump or toggle, as bound by `keys`.
   * Ignores paste events, and everything when the list is not interactive or
   * empty.
   *
   * @param event The input event to act on.
   *
   * @example Move the selection and toggle an item
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Checklist, parseKey } from "@neonbyte/tui";
   *
   * const list = new Checklist({ requestRender() {} }, {
   *   interactive: true,
   *   items: [
   *     { label: "Compile", state: "pending" },
   *     { label: "Test", state: "pending" },
   *   ],
   * });
   *
   * list.focused = true;
   * list.handleInput({ type: "key", key: parseKey("j") });
   * list.handleInput({ type: "key", key: parseKey(" ") });
   *
   * assertEquals(list.selected, 1);
   * assertEquals(list.items[1].state, "done");
   * list.setItems([]); // stops the settle animation's timer
   * ```
   */
  public handleInput(event: InputEvent): void {
    if (
      !this.interactive || event.type !== "key" || this.entries.length === 0
    ) {
      return;
    }

    switch (this.actionFor(event.key)) {
      case "up":
        this.select(this.cursor - 1);

        break;
      case "down":
        this.select(this.cursor + 1);

        break;
      case "first":
        this.select(0);

        break;
      case "last":
        this.select(this.entries.length - 1);

        break;
      case "toggle":
        this.toggle(this.cursor);

        break;
    }
  }

  /**
   * Replace some paints; others keep their values. Glyph and label paints
   * merge per state. Requests a render.
   *
   * @param theme Paints to change; see {@linkcode ChecklistTheme}.
   *
   * @example Colour the notes
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Checklist } from "@neonbyte/tui";
   *
   * const list = new Checklist({ requestRender() {} }, {
   *   items: [{ label: "Compile", state: "done", note: "1.2s" }],
   * });
   *
   * list.setTheme({ note: { fg: "red" } });
   *
   * assertEquals(list.render(30)[0].endsWith("\x1b[31m1.2s\x1b[39m"), true);
   * ```
   */
  public setTheme(theme: ChecklistTheme): void {
    this.style.setPaints(theme.glyph ?? {});

    this.labels = { ...this.labels, ...theme.label };

    if ("note" in theme) {
      this.notePaint = theme.note;
    }

    if ("pointer" in theme) {
      this.pointerPaint = theme.pointer;
    }

    this.cacheKey = "";

    this.host.requestRender();
  }

  /**
   * Interactive lists only. A left press on an item row (wrapped continuation
   * rows included) selects the item, and also toggles it when the press lands
   * on its glyph or its label text; the pointer column and the blank space
   * after the text only select. The wheel moves the selection by one item.
   *
   * @param event The mouse event, with coordinates relative to the list.
   * @returns Whether the event was handled: a wheel step, or a press on an item.
   */
  public handleMouse(event: MouseInput): boolean {
    if (!this.interactive || this.entries.length === 0) {
      return false;
    }

    if (event.action === "wheel") {
      if (event.direction !== "up" && event.direction !== "down") {
        return false;
      }

      this.select(this.cursor + (event.direction === "up" ? -1 : 1));

      return true;
    }

    return event.action === "press" && event.button === "left" &&
      this.click(event.x, event.y);
  }

  /** Select the item drawn at row `y` of the last frame, toggling it when `x` is on its glyph or label; false below the last item. */
  private click(x: number, y: number): boolean {
    let top = 0;

    for (let i = 0; y >= 0 && i < this.blocks.length; i++) {
      const lines = this.blocks[i];

      if (y < top + lines.length) {
        this.select(i);

        if (this.hitsTarget(lines[y - top], y === top, x)) {
          this.toggle(i);
        }

        return true;
      }

      top += lines.length;
    }

    return false;
  }

  /** Whether column `x` of `line` is the glyph (first row only) or inside the label text. */
  private hitsTarget(line: string, first: boolean, x: number): boolean {
    const glyphStart = this.pointerWidth;
    const labelStart = glyphStart + this.style.width + this.gap;
    const onGlyph = first && x >= glyphStart &&
      x < glyphStart + this.style.width;
    const onLabel = x >= labelStart && x < visibleWidth(line);

    return onGlyph || onLabel;
  }

  /** Width of the pointer column including its gap; 0 when not interactive. */
  private get pointerWidth(): number {
    return this.interactive ? visibleWidth(this.pointer) + this.pointerGap : 0;
  }

  /** Drop the cached rows so the next render draws them again. */
  public invalidate(): void {
    this.cacheKey = "";
  }

  /**
   * Draw one or more rows per item: the pointer column when interactive, the
   * status glyph, the label and the note. Long labels wrap under themselves.
   *
   * @param width Cells available.
   * @returns The rows of all items, empty when `width` is below 1.
   */
  public render(width: number): readonly string[] {
    if (width < 1) {
      return [];
    }

    const now = this.clock();
    const cells = this.entries.map((entry) => this.style.cell(entry.mark, now));
    const key = [
      width,
      this.focused,
      this.hardwareCursor,
      this.cursor,
      ...this.entries.flatMap((entry, i) => [
        cells[i],
        entry.mark.state,
        entry.label,
        entry.note ?? "",
      ]),
    ].join("\0");

    if (key === this.cacheKey) {
      return this.cache;
    }

    this.cacheKey = key;
    this.blocks = this.entries.map((entry, i) =>
      this.renderEntry(entry, cells[i], i, width)
    );
    this.cache = this.blocks.flat();

    return this.cache;
  }

  /** The rows of one item: pointer column, glyph and the wrapped label with its note. */
  private renderEntry(
    entry: Entry,
    cell: string,
    index: number,
    width: number,
  ): string[] {
    const current = this.focused && index === this.cursor;
    const prefix = this.pointerColumn(current) +
      (current ? CURSOR_MARKER : "") +
      cell + " ".repeat(this.gap);
    const indent = this.pointerWidth + this.style.width + this.gap;
    const room = width - indent;

    if (room < 1) {
      return [truncateToWidth(prefix, width, "")];
    }

    const label = paint(entry.label, this.labels[entry.mark.state]);
    const text = entry.note === undefined || entry.note === ""
      ? label
      : `${label}${this.noteSeparator}${paint(entry.note, this.notePaint)}`;

    return wrapText(text, room).map((line, i) =>
      (i === 0 ? prefix : " ".repeat(indent)) + line
    );
  }

  /** The pointer column of a row: the pointer on the selected row of a focused list, blanks elsewhere; empty when not interactive. */
  private pointerColumn(current: boolean): string {
    if (!this.interactive) {
      return "";
    }

    return current
      ? paint(this.pointer, this.pointerPaint) + " ".repeat(this.pointerGap)
      : " ".repeat(this.pointerWidth);
  }

  /** The first action with a binding that matches `key`. */
  private actionFor(key: Key): ChecklistAction | undefined {
    return ACTIONS.find((action) =>
      this.keys[action].some((spec) => matchesKey(key, spec))
    );
  }

  /** Flip item `index` between done and pending, then call `onToggle`. */
  private toggle(index: number): void {
    const state = this.entryAt(index).mark.state === "done"
      ? "pending"
      : "done";

    this.setState(index, state);
    this.onToggle?.(index, this.items[index]);
  }

  /** Repaint after a change, and keep the ticker running only while something animates. */
  private changed(): void {
    if (!this.animating) {
      this.ticker.stop();
    }

    this.ticker.wake();
  }

  /** The public view of `entry`: its label, current state and note. */
  private itemAt(entry: Entry): ChecklistItem {
    return entry.note === undefined
      ? { label: entry.label, state: entry.mark.state }
      : { label: entry.label, state: entry.mark.state, note: entry.note };
  }

  /** The entry at `index`; throws a `RangeError` when there is none. */
  private entryAt(index: number): Entry {
    if (!Number.isInteger(index) || index < 0 || index >= this.entries.length) {
      throw new RangeError(`No checklist item at index ${index}`);
    }

    return this.entries[index];
  }
}
