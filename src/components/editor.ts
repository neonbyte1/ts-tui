import { CURSOR_MARKER } from "../ansi.ts";
import {
  bindKeys,
  type InputEvent,
  type Key,
  matchesKey,
  type MouseInput,
} from "../keys.ts";
import { mergePaint, type Paint, paint } from "../style.ts";
import type { Component, Focusable } from "../tui.ts";
import { graphemeWidth, truncateToWidth, visibleWidth } from "../width.ts";
import { bigWordStart, wordEnd, wordStart } from "../words.ts";

const segmenter = new Intl.Segmenter();

const MAX_UNDO = 200;
const WHEEL_ROWS = 3;

/**
 * Everything a key press can do in the editor; bind keys to them with {@linkcode EditorOptions.keys}.
 *
 * @category Text
 */
export type EditorAction =
  | "submit"
  | "newline"
  | "deleteBack"
  | "deleteForward"
  | "deleteBigWordBack"
  | "deleteWordBack"
  | "deleteWordForward"
  | "deleteToStart"
  | "deleteToEnd"
  | "undo"
  | "left"
  | "right"
  | "up"
  | "down"
  | "home"
  | "end"
  | "wordLeft"
  | "wordRight";

/**
 * Key specs (see {@linkcode matchesKey}) per action. `up` and `down` move by
 * visual row and, past the first or last row, browse the history.
 * `deleteBigWordBack` deletes back to the start of the previous whitespace
 * separated word, `deleteWordBack` only to the start of the previous word.
 * An action is chosen by the first match in the order listed here.
 *
 * @category Text
 */
export const DEFAULT_EDITOR_KEYS: Readonly<
  Record<EditorAction, readonly string[]>
> = {
  submit: ["enter"],
  newline: ["shift+enter", "alt+enter", "ctrl+j"],
  deleteBack: ["backspace"],
  deleteForward: ["delete", "ctrl+d"],
  deleteBigWordBack: ["ctrl+w"],
  deleteWordBack: ["alt+backspace"],
  deleteWordForward: ["alt+d"],
  deleteToStart: ["ctrl+u"],
  deleteToEnd: ["ctrl+k"],
  undo: ["ctrl+z", "ctrl+-", "ctrl+_"],
  left: ["left"],
  right: ["right"],
  up: ["up"],
  down: ["down"],
  home: ["home", "ctrl+a"],
  end: ["end", "ctrl+e"],
  wordLeft: ["ctrl+left", "alt+left", "alt+b"],
  wordRight: ["ctrl+right", "alt+right", "alt+f"],
};

/** Actions in the order their keys are tried. */
// Keys of the defaults are exactly the actions, in the order written above.
const ACTION_ORDER = Object.keys(DEFAULT_EDITOR_KEYS) as EditorAction[];

/**
 * Paints per element; unset elements keep their defaults.
 *
 * @category Text
 */
export interface EditorTheme {
  /** The text rows. Default none. */
  readonly text?: Paint;
  /** The placeholder while the text is empty. Default dim. */
  readonly placeholder?: Paint;
  /** The caret cell, unless the hardware cursor is shown; merged over `text`. Default inverse. */
  readonly caret?: Paint;
  /** The rule above and below the text. Default none. */
  readonly border?: Paint;
  /** The "N more" label in a rule. Default dim. */
  readonly label?: Paint;
}

/**
 * Decoration characters; `rule` and `caret` must be one cell wide.
 *
 * @category Text
 */
export interface EditorGlyphs {
  /** The rule above and below the text. */
  readonly rule: string;
  /** Arrow of the default label when rows are scrolled off above. */
  readonly above: string;
  /** Arrow of the default label when rows are scrolled off below. */
  readonly below: string;
  /** The caret cell where there is no character under it: an empty editor or the end of a line. */
  readonly caret: string;
}

/**
 * Built-in glyph sets for {@linkcode EditorOptions.glyphs}: `unicode` (the
 * default) and `ascii` for terminals without box drawing characters.
 *
 * @category Text
 */
export const EDITOR_GLYPHS: {
  readonly [Name in "unicode" | "ascii"]: EditorGlyphs;
} = {
  unicode: { rule: "─", above: "↑", below: "↓", caret: " " },
  ascii: { rule: "-", above: "^", below: "v", caret: " " },
};

/**
 * Fixed texts of the rules.
 *
 * @category Text
 */
export interface EditorLabels {
  /** Label in the top rule while `count` rows are scrolled off above. Default ` ↑ N more `. */
  readonly above: (count: number) => string;
  /** Label in the bottom rule while `count` rows are hidden below. Default ` ↓ N more `. */
  readonly below: (count: number) => string;
}

/**
 * Look and behaviour of an {@linkcode Editor}. Every option is optional.
 *
 * @category Text
 */
export interface EditorOptions {
  /** Shown (dimmed) while the text is empty. */
  placeholder?: string;
  /** Maximum number of visible text rows before the editor scrolls. Default 10. */
  maxHeight?: number;
  /** Draw a horizontal rule above and below the text. Default true. */
  border?: boolean;
  /** Paints per element; see {@linkcode EditorTheme}. */
  theme?: EditorTheme;
  /** Decoration characters, each replacing its default from {@linkcode EDITOR_GLYPHS}`.unicode`; see {@linkcode EditorGlyphs}. */
  glyphs?: Partial<EditorGlyphs>;
  /** Fixed texts of the rules, each replacing its default; see {@linkcode EditorLabels}. */
  labels?: Partial<EditorLabels>;
  /** Cells of rule before a label. Default 1. */
  labelInset?: number;
  /** Key specs per action; an entry replaces the default list for that action. */
  keys?: Partial<Record<EditorAction, readonly string[]>>;
}

const DEFAULT_THEME: Required<EditorTheme> = {
  text: {},
  placeholder: { dim: true },
  caret: { inverse: true },
  border: {},
  label: { dim: true },
};

/** `text` drawn with `p`; nothing for empty text. */
function paintText(text: string, p: Paint): string {
  return text === "" ? "" : paint(text, p);
}

/** One visual (wrapped) row: the text slice `[start, end)` of a logical line. */
interface Row {
  readonly start: number;
  readonly end: number;
  readonly width: number;
  /** Last visual row of its logical line. */
  last: boolean;
}

interface Snapshot {
  readonly text: string;
  readonly cursor: number;
}

/** Strip control characters other than newlines; normalize line endings and expand tabs. */
function sanitize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    // deno-lint-ignore no-control-regex
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, "");
}

/** `placeholder` with each run of control characters replaced by a space. */
function singleLinePlaceholder(placeholder: string): string {
  // deno-lint-ignore no-control-regex
  return placeholder.replace(/[\x00-\x1f\x7f-\x9f]+/g, " ");
}

/** Whether `key` matches any of `specs` (see {@link matchesKey}). */
function matchesAny(key: Key, specs: readonly string[]): boolean {
  for (const spec of specs) {
    if (matchesKey(key, spec)) {
      return true;
    }
  }

  return false;
}

/** A run of consecutive whitespace or non-whitespace graphemes within a logical line. */
interface Chunk {
  readonly space: boolean;
  readonly graphemes: { start: number; width: number }[];
  width: number;
}

/** Start offset and filled width of the visual row being built. */
interface RowState {
  start: number;
  width: number;
}

/** Close the current row at `end` and start a new one there. */
function flushRow(rows: Row[], state: RowState, end: number): void {
  rows.push({ start: state.start, end, width: state.width, last: false });

  state.start = end;
  state.width = 0;
}

/** Add `chunk` to the row being built: words wrap whole, whitespace and over-wide words wrap per grapheme. */
function placeChunk(
  rows: Row[],
  state: RowState,
  chunk: Chunk,
  width: number,
): void {
  if (chunk.space || chunk.width > width) {
    for (const g of chunk.graphemes) {
      if (state.width > 0 && state.width + g.width > width) {
        flushRow(rows, state, g.start);
      }

      state.width += g.width;
    }

    return;
  }

  if (state.width + chunk.width > width) {
    flushRow(rows, state, chunk.graphemes[0].start);
  }

  state.width += chunk.width;
}

/**
 * Multi-line prompt editor: word-wrapped text, visual-row navigation, input
 * history, undo, and a scrolling viewport of at most `maxHeight` text rows.
 * By default Enter submits; shift+enter, alt+enter, ctrl+j, or a trailing
 * backslash before Enter insert a newline (see {@linkcode DEFAULT_EDITOR_KEYS}).
 *
 * With mouse enabled, a left press places the cursor at the clicked cell and
 * dragging moves it (scrolling the view at the window's edges). The wheel
 * scrolls the view by rows, as the view otherwise only follows the cursor; the
 * cursor stays put unless it would leave the window, then it moves by the
 * scrolled rows to the nearest visible row.
 *
 * @example Type two lines and submit
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Editor, parseKey } from "@neonbyte/tui";
 *
 * const submitted: string[] = [];
 * const editor = new Editor();
 * editor.onSubmit = (text) => submitted.push(text);
 *
 * const press = (sequence: string) =>
 *   editor.handleInput({ type: "key", key: parseKey(sequence) });
 *
 * press("h");
 * press("i");
 * press("\x1b\r"); // alt+enter inserts a newline
 * press("!");
 * press("\r");
 *
 * assertEquals(submitted, ["hi\n!"]);
 * ```
 *
 * @category Text
 */
export class Editor implements Component, Focusable {
  /** Whether the editor has keyboard focus; set by the TUI. Only a focused editor shows a caret. */
  public focused = false;
  /** Whether the terminal's own cursor is shown at the caret instead of a drawn one; set by the TUI. */
  public hardwareCursor?: boolean;
  /** Called with the text when a key bound to `submit` (Enter by default) is pressed and submitting is not disabled. */
  public onSubmit?: (text: string) => void;
  /** Called with the new text after every edit made by the user. Not called by `setText`. */
  public onChange?: (text: string) => void;
  /** While true, Enter does nothing. */
  public disableSubmit = false;

  private placeholder: string;
  private readonly maxHeight: number;
  private readonly border: boolean;
  private readonly glyphs: EditorGlyphs;
  private readonly labels: EditorLabels;
  private readonly labelInset: number;
  private readonly keys: Readonly<Record<EditorAction, readonly string[]>>;
  private theme: Required<EditorTheme>;

  private content = "";
  /** UTF-16 offset of the cursor, always on a grapheme boundary. */
  private cursor = 0;
  /** Column (cells) kept across consecutive up/down moves. */
  private preferredColumn: number | undefined;
  /** Number of visual rows scrolled off the top. */
  private scroll = 0;
  private lastWidth = 80;

  private readonly history: string[] = [];
  /** Index into history while browsing, -1 otherwise. */
  private historyIndex = -1;
  private draft = "";

  private readonly undoStack: Snapshot[] = [];
  /** Kind of the previous edit; consecutive "type" edits share one undo step. */
  private lastEdit: "type" | "other" | "" = "";

  private cacheKey = "";
  private cache: readonly string[] = [];

  /**
   * Create an empty editor.
   *
   * @param options Placeholder, height, border, paints, glyphs and key bindings; see {@linkcode EditorOptions}.
   */
  public constructor(options: EditorOptions = {}) {
    this.placeholder = singleLinePlaceholder(options.placeholder ?? "");
    this.maxHeight = Math.max(1, Math.floor(options.maxHeight ?? 10));
    this.border = options.border ?? true;
    this.theme = { ...DEFAULT_THEME, ...options.theme };

    const glyphs = { ...EDITOR_GLYPHS.unicode, ...options.glyphs };

    this.glyphs = glyphs;
    this.labels = {
      above: (count) => ` ${glyphs.above} ${count} more `,
      below: (count) => ` ${glyphs.below} ${count} more `,
      ...options.labels,
    };
    this.labelInset = Math.max(0, Math.floor(options.labelInset ?? 1));
    this.keys = bindKeys(DEFAULT_EDITOR_KEYS, options.keys);
  }

  /** The current text; lines are separated by `\n`. */
  public get text(): string {
    return this.content;
  }

  /**
   * Replace the text and put the cursor at the end. Clears undo and history browsing.
   *
   * @param text The new text; `\r\n` becomes `\n`, tabs become spaces and other control characters are dropped.
   *
   * @example Prefill the editor
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Editor } from "@neonbyte/tui";
   *
   * const editor = new Editor();
   * editor.setText("one\r\ntwo");
   *
   * assertEquals(editor.text, "one\ntwo");
   * ```
   */
  public setText(text: string): void {
    this.content = sanitize(text);
    this.cursor = this.content.length;
    this.preferredColumn = undefined;
    this.historyIndex = -1;
    this.draft = "";
    this.undoStack.length = 0;
    this.lastEdit = "";
  }

  /**
   * Record a submitted text for up-arrow recall. Empty strings and consecutive duplicates are ignored.
   *
   * @param text The text to remember.
   *
   * @example Recall the previous prompt with the up arrow
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Editor, parseKey } from "@neonbyte/tui";
   *
   * const editor = new Editor();
   * editor.addToHistory("first");
   * editor.addToHistory("second");
   *
   * editor.handleInput({ type: "key", key: parseKey("\x1b[A") });
   *
   * assertEquals(editor.text, "second");
   * ```
   */
  public addToHistory(text: string): void {
    if (text === "" || this.history.at(-1) === text) {
      return;
    }

    this.history.push(text);
  }

  /**
   * Apply a key press (editing, cursor motion, history, undo or submit) or insert pasted text.
   *
   * @param event The key press or paste.
   */
  public handleInput(event: InputEvent): void {
    if (event.type === "paste") {
      this.lastEdit = "";

      this.replace("other", this.cursor, this.cursor, sanitize(event.text));

      return;
    }

    const key = event.key;
    const typing = key.text !== undefined && !key.ctrl && !key.alt;

    if (!typing) {
      this.lastEdit = "";
    }

    const action = ACTION_ORDER.find((a) => matchesAny(key, this.keys[a]));

    if (action !== undefined) {
      this.perform(action);

      return;
    }

    if (typing) {
      const c = this.cursor;

      this.replace("type", c, c, sanitize(key.text!));
    }
  }

  /**
   * Left press and drag place the cursor at the pointed row and column
   * (either half of a wide character puts it before the character); the
   * wheel scrolls the view three rows at a time.
   *
   * @param event The mouse report relative to the editor.
   * @returns Whether the event was handled: a left press or drag, or a wheel scroll.
   */
  public handleMouse(event: MouseInput): boolean {
    if (event.action === "wheel") {
      return this.wheel(event.direction);
    }

    if (
      event.button !== "left" ||
      (event.action !== "press" && event.action !== "drag")
    ) {
      return false;
    }

    this.point(event);

    return true;
  }

  /** Enter submits, or inserts a newline after a trailing backslash. */
  private submit(): void {
    const c = this.cursor;

    if (this.disableSubmit) {
      return;
    }

    if (this.content[c - 1] === "\\") {
      this.replace("other", c - 1, c, "\n");
    } else {
      this.onSubmit?.(this.content);
    }
  }

  /** Carry out one bound action. */
  private perform(action: EditorAction): void {
    const c = this.cursor;

    switch (action) {
      case "submit":
        this.submit();

        break;
      case "newline":
        this.replace("other", c, c, "\n");

        break;
      case "deleteBack":
        this.replace("other", this.previousBoundary(c), c, "");

        break;
      case "deleteForward":
        this.replace("other", c, this.nextBoundary(c), "");

        break;
      case "deleteBigWordBack":
        this.replace("other", this.bigWordLeft(c), c, "");

        break;
      case "deleteWordBack":
        this.replace("other", this.wordLeft(c), c, "");

        break;
      case "deleteWordForward":
        this.replace("other", c, this.wordRight(c), "");

        break;
      case "deleteToStart":
        this.replace("other", this.lineStart(c), c, "");

        break;
      case "deleteToEnd": {
        const end = this.lineEnd(c);

        this.replace("other", c, c === end ? this.nextBoundary(c) : end, "");

        break;
      }
      case "undo":
        this.undo();

        break;
      case "left":
        this.moveTo(this.previousBoundary(c));

        break;
      case "right":
        this.moveTo(this.nextBoundary(c));

        break;
      case "up":
        this.moveVertical(-1);

        break;
      case "down":
        this.moveVertical(1);

        break;
      case "home":
        this.moveTo(this.lineStart(c));

        break;
      case "end":
        this.moveTo(this.lineEnd(c));

        break;
      case "wordLeft":
        this.moveTo(this.wordLeft(c));

        break;
      case "wordRight":
        this.moveTo(this.wordRight(c));

        break;
    }
  }

  /**
   * Render the editor: an optional rule, the visible text rows, an optional rule.
   *
   * @param width Available width in cells.
   * @returns The rows; the placeholder is shown while the text is empty.
   */
  public render(width: number): readonly string[] {
    if (width < 1) {
      return [];
    }

    this.lastWidth = width;

    const hardware = this.hardwareCursor ?? false;
    const cacheKey =
      `${width}\0${this.focused}\0${hardware}\0${this.cursor}\0${this.scroll}\0${this.content}`;

    if (cacheKey === this.cacheKey) {
      return this.cache;
    }

    const rows = this.layout(width);
    const cursorRow = this.cursorRow(rows);
    const scroll = this.clampScroll(rows.length, cursorRow);

    this.scroll = scroll;

    const visible = rows.slice(scroll, scroll + this.maxHeight);
    const lines: string[] = [];

    if (this.border) {
      lines.push(this.borderRow(width, "above", scroll));
    }

    if (this.content === "") {
      lines.push(this.placeholderRow(width, hardware));
    } else {
      for (let i = 0; i < visible.length; i++) {
        const caret = this.focused && scroll + i === cursorRow;

        lines.push(this.textRow(visible[i], caret, width, hardware));
      }
    }

    if (this.border) {
      const below = rows.length - scroll - visible.length;

      lines.push(this.borderRow(width, "below", below));
    }

    // Same key as above, but the scroll may have just changed.
    this.cacheKey =
      `${width}\0${this.focused}\0${hardware}\0${this.cursor}\0${scroll}\0${this.content}`;
    this.cache = lines;

    return lines;
  }

  /** The scroll offset that keeps `cursorRow` inside the `maxHeight` window. */
  private clampScroll(rowCount: number, cursorRow: number): number {
    const maxScroll = Math.max(0, rowCount - this.maxHeight);
    let scroll = this.scroll;

    if (cursorRow < scroll) {
      scroll = cursorRow;
    }

    if (cursorRow >= scroll + this.maxHeight) {
      scroll = cursorRow - this.maxHeight + 1;
    }

    return Math.min(scroll, maxScroll);
  }

  /** One text row, with the caret drawn when `caret`, truncated to `width`. */
  private textRow(
    row: Row,
    caret: boolean,
    width: number,
    hardware: boolean,
  ): string {
    const line = caret
      ? this.withCaret(row, hardware)
      : paintText(this.content.slice(row.start, row.end), this.theme.text);

    return visibleWidth(line) > width ? truncateToWidth(line, width, "") : line;
  }

  /** Drop the cached rows so the next render recomputes them. */
  public invalidate(): void {
    this.cacheKey = "";
  }

  /**
   * Replace some paints; others keep their values. Takes effect on the next render.
   *
   * @param theme The paints to change; see {@linkcode EditorTheme}.
   *
   * @example Drop the dimmed placeholder
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Editor } from "@neonbyte/tui";
   *
   * const editor = new Editor({ placeholder: "Message", border: false });
   * editor.setTheme({ placeholder: {} });
   *
   * assertEquals(editor.render(20), ["Message"]);
   * ```
   */
  public setTheme(theme: EditorTheme): void {
    this.theme = { ...this.theme, ...theme };
    this.cacheKey = "";
  }

  /**
   * Replace the text shown while the editor is empty.
   *
   * @param placeholder The new placeholder; control characters become spaces.
   *
   * @example Hint at what to type next
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Editor } from "@neonbyte/tui";
   *
   * const editor = new Editor({ placeholder: "Ask anything", border: false });
   * editor.setTheme({ placeholder: {} });
   * editor.setPlaceholder("Waiting for the reply…");
   *
   * assertEquals(editor.render(30), ["Waiting for the reply…"]);
   * ```
   */
  public setPlaceholder(placeholder: string): void {
    this.placeholder = singleLinePlaceholder(placeholder);
    this.cacheKey = "";
  }

  /** The row with the caret cell drawn at the cursor. */
  private withCaret(row: Row, hardware: boolean): string {
    const { text, caret } = this.theme;
    const before = this.content.slice(row.start, this.cursor);
    const after = this.content.slice(this.cursor, row.end);
    const first = segmenter.segment(after).containing(0)?.segment ?? "";
    const cell = first === "" ? this.glyphs.caret : first;

    return paintText(before, text) + CURSOR_MARKER +
      paint(cell, hardware ? text : mergePaint(text, caret)) +
      paintText(after.slice(first.length), text);
  }

  /** The row shown while the text is empty: the placeholder, with the caret when focused. */
  private placeholderRow(width: number, hardware: boolean): string {
    const { text, caret, placeholder } = this.theme;

    if (!this.focused) {
      return paintText(
        truncateToWidth(this.placeholder, width, ""),
        placeholder,
      );
    }

    const rest = truncateToWidth(this.placeholder, width - 1, "");

    return CURSOR_MARKER +
      paint(this.glyphs.caret, hardware ? text : mergePaint(text, caret)) +
      paintText(rest, placeholder);
  }

  /** Border row, with a "N more" label when `count` is positive. */
  private borderRow(
    width: number,
    side: "above" | "below",
    count: number,
  ): string {
    const { border, label: labelPaint } = this.theme;
    const rule = this.glyphs.rule;

    if (count === 0) {
      return paint(rule.repeat(width), border);
    }

    const inset = Math.min(this.labelInset, width);
    const label = truncateToWidth(this.labels[side](count), width - inset, "");
    const rest = width - inset - visibleWidth(label);

    return paintText(rule.repeat(inset), border) +
      paintText(label, labelPaint) +
      (rest > 0 ? paint(rule.repeat(rest), border) : "");
  }

  /** Split the text into visual rows for `width`. A full last row gets an empty row for a cursor at its end. */
  private layout(width: number): Row[] {
    const text = this.content;
    const rows: Row[] = [];
    let lineStart = 0;

    for (;;) {
      let lineEnd = text.indexOf("\n", lineStart);

      if (lineEnd === -1) {
        lineEnd = text.length;
      }

      this.wrapLine(rows, lineStart, lineEnd, width);

      if (lineEnd === text.length) {
        break;
      }

      lineStart = lineEnd + 1;
    }

    return rows;
  }

  /** Wrap one logical line into visual rows, appending them to `rows`. */
  private wrapLine(
    rows: Row[],
    lineStart: number,
    lineEnd: number,
    width: number,
  ): void {
    const state: RowState = { start: lineStart, width: 0 };

    for (const chunk of this.chunkLine(lineStart, lineEnd)) {
      placeChunk(rows, state, chunk, width);
    }

    rows.push({
      start: state.start,
      end: lineEnd,
      width: state.width,
      last: true,
    });

    if (this.cursor === lineEnd && state.width >= width) {
      rows.at(-1)!.last = false;

      rows.push({ start: lineEnd, end: lineEnd, width: 0, last: true });
    }
  }

  /** Group the graphemes of `[lineStart, lineEnd)` into alternating whitespace / non-whitespace chunks. */
  private chunkLine(lineStart: number, lineEnd: number): Chunk[] {
    const chunks: Chunk[] = [];

    for (
      const { index, segment } of segmenter.segment(
        this.content.slice(lineStart, lineEnd),
      )
    ) {
      const space = /^\s+$/.test(segment);
      const grapheme = {
        start: lineStart + index,
        width: graphemeWidth(segment),
      };
      const previous = chunks.at(-1);

      if (previous !== undefined && previous.space === space) {
        previous.graphemes.push(grapheme);

        previous.width += grapheme.width;
      } else {
        chunks.push({ space, graphemes: [grapheme], width: grapheme.width });
      }
    }

    return chunks;
  }

  /** Index of the visual row that holds the cursor. */
  private cursorRow(rows: readonly Row[]): number {
    const c = this.cursor;
    const index = rows.findIndex((r) =>
      c >= r.start && (c < r.end || (r.last && c === r.end))
    );

    return index === -1 ? rows.length - 1 : index;
  }

  /** Move the cursor one visual row up or down; past the first or last row, browse the history. */
  private moveVertical(direction: -1 | 1): void {
    const rows = this.layout(this.lastWidth);
    const current = this.cursorRow(rows);
    const target = current + direction;

    if (target < 0 || target >= rows.length) {
      this.browseHistory(direction);

      return;
    }

    this.moveToRow(rows, current, target);
  }

  /** Put the cursor on row `target` at the column kept across moves (the current one at first). */
  private moveToRow(
    rows: readonly Row[],
    current: number,
    target: number,
  ): void {
    const column = this.preferredColumn ??
      visibleWidth(this.content.slice(rows[current].start, this.cursor));

    this.cursor = this.offsetInRow(rows[target], column);
    this.preferredColumn = column;
  }

  /** Offset of the grapheme drawn `column` cells into `row`; past its end, after the last cell of a final row and on the last cell of a wrapped one. */
  private offsetInRow(row: Row, column: number): number {
    // The row end of a wrapped row is the next row's start.
    let offset = row.last ? row.end : row.start;
    let used = 0;

    for (
      const { index, segment } of segmenter.segment(
        this.content.slice(row.start, row.end),
      )
    ) {
      const w = graphemeWidth(segment);

      if (used + w > column) {
        offset = row.start + index;

        break;
      }

      used += w;

      if (!row.last) {
        offset = row.start + index;
      }
    }

    return offset;
  }

  /** Wheel scrolls the view by rows, moving the cursor only as far as needed to keep it inside. */
  private wheel(direction: MouseInput["direction"]): boolean {
    if (direction !== "up" && direction !== "down") {
      return false;
    }

    const rows = this.layout(this.lastWidth);
    const cursorRow = this.cursorRow(rows);
    const step = Math.min(WHEEL_ROWS, this.maxHeight);
    const moved = this.clampScroll(rows.length, cursorRow) +
      (direction === "up" ? -step : step);
    const scroll = Math.max(
      0,
      Math.min(moved, Math.max(0, rows.length - this.maxHeight)),
    );
    const target = Math.min(
      Math.max(cursorRow, scroll),
      scroll + this.maxHeight - 1,
    );

    this.scroll = scroll;
    this.lastEdit = "";

    if (target !== cursorRow) {
      this.moveToRow(rows, cursorRow, target);
    }

    return true;
  }

  /**
   * Put the cursor under the pointer. A press on a border row only focuses;
   * a drag outside the text steps one row past the visible window so the view
   * follows.
   */
  private point(event: MouseInput): void {
    const rows = this.layout(this.lastWidth);
    const scroll = this.clampScroll(rows.length, this.cursorRow(rows));
    const visible = Math.min(this.maxHeight, rows.length - scroll);
    const line = event.y - (this.border ? 1 : 0);

    if (event.action === "press" && (line < 0 || line >= visible)) {
      return;
    }

    const index = Math.min(
      Math.max(scroll + line, Math.max(0, scroll - 1)),
      Math.min(rows.length - 1, scroll + visible),
    );

    this.lastEdit = "";

    this.moveTo(this.offsetInRow(rows[index], event.x));
  }

  /** Up on the first row / down on the last row: step through history, or jump to the text boundary. */
  private browseHistory(direction: -1 | 1): void {
    let index: number;

    if (direction < 0) {
      index = this.historyIndex === -1
        ? this.history.length - 1
        : this.historyIndex - 1;

      if (index < 0) {
        this.moveTo(0);

        return;
      }
    } else {
      if (this.historyIndex === -1) {
        this.moveTo(this.content.length);

        return;
      }

      index = this.historyIndex + 1 >= this.history.length
        ? -1
        : this.historyIndex + 1;
    }

    if (this.historyIndex === -1) {
      this.draft = this.content;
    }

    this.pushUndo();

    this.content = index === -1 ? this.draft : this.history[index];
    this.cursor = this.content.length;
    this.historyIndex = index;
    this.preferredColumn = undefined;

    this.onChange?.(this.content);
  }

  /** Put the cursor at `offset` and forget the column kept across vertical moves. */
  private moveTo(offset: number): void {
    this.cursor = offset;
    this.preferredColumn = undefined;
  }

  /** Save the current text and cursor as an undo step. */
  private pushUndo(): void {
    this.undoStack.push({ text: this.content, cursor: this.cursor });

    if (this.undoStack.length > MAX_UNDO) {
      this.undoStack.shift();
    }
  }

  /** Restore the most recent undo step, if any. */
  private undo(): void {
    const snapshot = this.undoStack.pop();

    if (snapshot === undefined) {
      return;
    }

    this.content = snapshot.text;
    this.cursor = snapshot.cursor;
    this.preferredColumn = undefined;
    this.historyIndex = -1;
    this.draft = "";

    this.onChange?.(this.content);
  }

  /** Replace `[from, to)` with `insert` and put the cursor after it. */
  private replace(
    kind: "type" | "other",
    from: number,
    to: number,
    insert: string,
  ): void {
    if (from >= to && insert === "") {
      return;
    }

    if (kind !== "type" || this.lastEdit !== "type") {
      this.pushUndo();
    }

    this.lastEdit = kind;
    this.content = this.content.slice(0, from) + insert +
      this.content.slice(to);
    this.cursor = from + insert.length;
    this.preferredColumn = undefined;
    this.historyIndex = -1;
    this.draft = "";

    this.onChange?.(this.content);
  }

  /** Offset of the start of the logical line holding `offset`. */
  private lineStart(offset: number): number {
    return offset === 0 ? 0 : this.content.lastIndexOf("\n", offset - 1) + 1;
  }

  /** Offset of the end of the logical line holding `offset`. */
  private lineEnd(offset: number): number {
    const end = this.content.indexOf("\n", offset);

    return end === -1 ? this.content.length : end;
  }

  /** Offset of the grapheme boundary before `offset`. */
  private previousBoundary(offset: number): number {
    let boundary = 0;

    for (const { index } of segmenter.segment(this.content)) {
      if (index >= offset) {
        break;
      }

      boundary = index;
    }

    return boundary;
  }

  /** Offset of the grapheme boundary after `offset`. */
  private nextBoundary(offset: number): number {
    for (const { index, segment } of segmenter.segment(this.content)) {
      if (index >= offset) {
        return index + segment.length;
      }
    }

    return this.content.length;
  }

  /** Start of the previous word on this line; at column 0, the end of the previous line. */
  private wordLeft(offset: number): number {
    const start = this.lineStart(offset);

    if (offset === start) {
      return this.previousBoundary(offset);
    }

    return wordStart(this.content, offset, start);
  }

  /** End of the next word on this line; at end of line, the start of the next line. */
  private wordRight(offset: number): number {
    const end = this.lineEnd(offset);

    if (offset === end) {
      return this.nextBoundary(offset);
    }

    return wordEnd(this.content, offset, end);
  }

  /** Start of the previous WORD on this line; at column 0, the end of the previous line. */
  private bigWordLeft(offset: number): number {
    const start = this.lineStart(offset);

    if (offset === start) {
      return this.previousBoundary(offset);
    }

    return bigWordStart(this.content, offset, start);
  }
}
