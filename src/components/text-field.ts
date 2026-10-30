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

/** Whether `key` matches any of `specs` (see {@link matchesKey}). */
function matchesAny(key: Key, specs: readonly string[]): boolean {
  for (const spec of specs) {
    if (matchesKey(key, spec)) {
      return true;
    }
  }

  return false;
}

/** The first `count` graphemes of `text`. */
function takeGraphemes(text: string, count: number): string {
  let result = "";
  let taken = 0;

  for (const { segment } of segmenter.segment(text)) {
    if (taken >= count) {
      break;
    }

    result += segment;
    taken++;
  }

  return result;
}

/** The one-cell mask character for `mask`, or `fallback` when it is not a single one-cell grapheme. */
function maskCharacter(
  mask: boolean | string | undefined,
  fallback: string,
): string {
  if (typeof mask !== "string") {
    return fallback;
  }

  const first = segmenter.segment(mask).containing(0);

  return first?.segment === mask && graphemeWidth(mask) === 1 ? mask : fallback;
}

/**
 * Everything a key press can do in the field; bind keys to them with {@linkcode TextFieldOptions.keys}.
 *
 * @category Text
 */
export type TextFieldAction =
  | "submit"
  | "deleteBack"
  | "deleteForward"
  | "deleteToStart"
  | "deleteToEnd"
  | "deleteBigWordBack"
  | "deleteWordBack"
  | "deleteWordForward"
  | "left"
  | "right"
  | "home"
  | "end"
  | "wordLeft"
  | "wordRight";

/**
 * Key specs (see {@linkcode matchesKey}) per action. `deleteBigWordBack` deletes
 * back to the start of the previous whitespace separated word,
 * `deleteWordBack` only to the start of the previous word. An action is
 * chosen by the first match in the order listed here.
 *
 * @category Text
 */
export const DEFAULT_TEXT_FIELD_KEYS: Readonly<
  Record<TextFieldAction, readonly string[]>
> = {
  submit: ["enter"],
  deleteBack: ["backspace", "ctrl+h"],
  deleteForward: ["delete", "ctrl+d"],
  deleteToStart: ["ctrl+u"],
  deleteToEnd: ["ctrl+k"],
  deleteBigWordBack: ["ctrl+w"],
  deleteWordBack: ["alt+backspace"],
  deleteWordForward: ["alt+d"],
  left: ["left", "ctrl+b"],
  right: ["right", "ctrl+f"],
  home: ["home", "ctrl+a"],
  end: ["end", "ctrl+e"],
  wordLeft: ["ctrl+left", "alt+left", "alt+b"],
  wordRight: ["ctrl+right", "alt+right", "alt+f"],
};

/** Actions in the order their keys are tried. */
// Keys of the defaults are exactly the actions, in the order written above.
const ACTION_ORDER = Object.keys(DEFAULT_TEXT_FIELD_KEYS) as TextFieldAction[];

/**
 * Paints per element; unset elements keep their defaults.
 *
 * @category Text
 */
export interface TextFieldTheme {
  /** The prompt. Default none. */
  readonly prompt?: Paint;
  /** The value. Default none. */
  readonly text?: Paint;
  /** The mask characters of a masked value, merged over `text`. Default none. */
  readonly mask?: Paint;
  /** The placeholder while the value is empty. Default dim. */
  readonly placeholder?: Paint;
  /** The caret cell, unless the hardware cursor is shown; merged over `text`. Default inverse. */
  readonly caret?: Paint;
}

/**
 * Decoration characters, each one cell wide.
 *
 * @category Text
 */
export interface TextFieldGlyphs {
  /** The caret cell where there is no character under it: an empty field or the end of the value. */
  readonly caret: string;
  /** Drawn for every grapheme of a masked value, unless `mask` gives a character. */
  readonly mask: string;
}

const DEFAULT_THEME: Required<TextFieldTheme> = {
  prompt: {},
  text: {},
  mask: {},
  placeholder: { dim: true },
  caret: { inverse: true },
};

const DEFAULT_GLYPHS: TextFieldGlyphs = { caret: " ", mask: "•" };

/** `text` drawn with `p`; nothing for empty text. */
function paintText(text: string, p: Paint): string {
  return text === "" ? "" : paint(text, p);
}

/**
 * Look and behaviour of a {@linkcode TextField}. Every option is optional.
 *
 * @category Text
 */
export interface TextFieldOptions {
  /** Shown before the text, e.g. `"> "`. May contain styling. */
  prompt?: string;
  /** Shown (dimmed) while the value is empty. */
  placeholder?: string;
  /**
   * Password mode: every grapheme is drawn as `glyphs.mask` (`•`), or as the
   * given one-cell character. Default false.
   */
  mask?: boolean | string;
  /** Longest value in graphemes; typing, paste and `setValue` are cut to fit. Default unlimited. */
  maxLength?: number;
  /** Paints per element; see {@linkcode TextFieldTheme}. */
  theme?: TextFieldTheme;
  /** Decoration characters, each replacing its default; see {@linkcode TextFieldGlyphs}. */
  glyphs?: Partial<TextFieldGlyphs>;
  /** Key specs per action; an entry replaces the default list for that action. */
  keys?: Partial<Record<TextFieldAction, readonly string[]>>;
}

/** One grapheme of the value as drawn. */
interface Segment {
  /** What is drawn: the grapheme, or the mask character. */
  text: string;
  /** UTF-16 offset in the value. */
  start: number;
  width: number;
}

/** Where everything sits in a frame of a given width. */
interface Layout {
  prompt: string;
  promptWidth: number;
  segments: readonly Segment[];
  /** Segment under the caret; `segments.length` when it is after the last one. */
  cursorIndex: number;
  /** First visible segment. */
  first: number;
  /** One past the last visible segment. */
  last: number;
  /** Cells taken by the visible segments. */
  filled: number;
  available: number;
}

/**
 * Single-line text field with horizontal scrolling and emacs-style editing
 * (see {@linkcode DEFAULT_TEXT_FIELD_KEYS}). While focused it marks its caret
 * for the terminal cursor and, unless the hardware cursor is shown, draws a
 * caret cell (inverse video by default); pasted newlines become spaces.
 *
 * A masked field (`mask`, `setMasked`) draws one cell per grapheme whatever
 * it is, so wide characters do not leak through the width of the field. Word
 * motion and word deletion also treat the masked value as a single word
 * (ctrl+left/right jump to the ends, ctrl+w and alt+backspace delete back to
 * the start, alt+d forward to the end) so word boundaries are not revealed.
 *
 * With mouse enabled, a left press places the caret at the clicked cell
 * (clicking past the end goes to the end, either half of a wide character
 * puts the caret before it) and dragging moves it, scrolling the view when
 * the pointer leaves the field. There is no selection.
 *
 * @example Type a value and submit it
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { parseKey, TextField } from "@neonbyte/tui";
 *
 * const submitted: string[] = [];
 * const field = new TextField({ prompt: "> " });
 * field.onSubmit = (value) => submitted.push(value);
 *
 * for (const char of "hi") {
 *   field.handleInput({ type: "key", key: parseKey(char) });
 * }
 * field.handleInput({ type: "key", key: parseKey("\r") });
 *
 * assertEquals(submitted, ["hi"]);
 * assertEquals(field.render(20)[0].trimEnd(), "> hi");
 * ```
 *
 * @category Text
 */
export class TextField implements Component, Focusable {
  /** Whether the field has keyboard focus; set by the TUI. Only a focused field shows a caret. */
  public focused = false;
  /** Whether the terminal's own cursor is shown at the caret instead of a drawn one; set by the TUI. */
  public hardwareCursor?: boolean;
  /** Called with the value when a key bound to `submit` (Enter by default) is pressed. */
  public onSubmit?: (value: string) => void;
  /** Called with the new value after every edit made by the user. Not called by `setValue`. */
  public onChange?: (value: string) => void;

  private prompt: string;
  private placeholder: string;
  private readonly maskChar: string;
  private readonly maxLength: number;
  private isMasked: boolean;
  private readonly glyphs: TextFieldGlyphs;
  private readonly keys: Readonly<Record<TextFieldAction, readonly string[]>>;
  private theme: Required<TextFieldTheme>;
  private content = "";
  /** UTF-16 offset of the cursor, always on a grapheme boundary. */
  private cursor = 0;
  /** Index of the first visible grapheme; follows the cursor lazily. */
  private scroll = 0;
  private lastWidth = 0;
  private cacheKey = "";
  private cache: readonly string[] = [];

  /**
   * Create an empty text field.
   *
   * @param options Prompt, placeholder, masking, limits, paints and key bindings; see {@linkcode TextFieldOptions}.
   */
  public constructor(options: TextFieldOptions = {}) {
    this.prompt = options.prompt ?? "";
    this.placeholder = options.placeholder ?? "";
    this.glyphs = { ...DEFAULT_GLYPHS, ...options.glyphs };
    this.keys = bindKeys(DEFAULT_TEXT_FIELD_KEYS, options.keys);
    this.theme = { ...DEFAULT_THEME, ...options.theme };
    this.maskChar = maskCharacter(options.mask, this.glyphs.mask);
    this.isMasked = options.mask !== undefined && options.mask !== false;
    this.maxLength = options.maxLength === undefined
      ? Infinity
      : Math.max(0, Math.floor(options.maxLength));
  }

  /** The current value. */
  public get value(): string {
    return this.content;
  }

  /** Whether the value is drawn as mask characters. */
  public get masked(): boolean {
    return this.isMasked;
  }

  /**
   * Show or hide the value, e.g. for a show-password toggle. The caret keeps its position.
   *
   * @param masked Whether to draw the value as mask characters.
   *
   * @example Toggle password visibility
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { TextField } from "@neonbyte/tui";
   *
   * const field = new TextField();
   * field.setValue("secret");
   * field.setMasked(true);
   *
   * assertEquals(field.render(20)[0].trimEnd(), "••••••");
   * ```
   */
  public setMasked(masked: boolean): void {
    this.isMasked = masked;
  }

  /**
   * Replace the text shown before the value. Takes effect on the next render.
   *
   * @param prompt The new prompt, e.g. `"> "`; may contain styling.
   *
   * @example Change the prompt
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { TextField } from "@neonbyte/tui";
   *
   * const field = new TextField({ prompt: "> " });
   * field.setValue("hi");
   * field.setPrompt("$ ");
   *
   * assertEquals(field.render(20)[0].trimEnd(), "$ hi");
   * ```
   */
  public setPrompt(prompt: string): void {
    this.prompt = prompt;
    this.cacheKey = "";
  }

  /**
   * Replace the text shown (dimmed) while the value is empty. Takes effect on the next render.
   *
   * @param placeholder The new placeholder.
   *
   * @example Change the placeholder
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { TextField } from "@neonbyte/tui";
   *
   * const field = new TextField({ placeholder: "Name" });
   * field.setTheme({ placeholder: {} });
   * field.setPlaceholder("Email");
   *
   * assertEquals(field.render(10), [" Email"]);
   * ```
   */
  public setPlaceholder(placeholder: string): void {
    this.placeholder = placeholder;
    this.cacheKey = "";
  }

  /**
   * Replace the value (cut to `maxLength`) and put the cursor at the end. Does not call `onChange`.
   *
   * @param value The new value.
   *
   * @example Prefill a field
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { TextField } from "@neonbyte/tui";
   *
   * const field = new TextField({ maxLength: 5 });
   * field.setValue("hello world");
   *
   * assertEquals(field.value, "hello");
   * ```
   */
  public setValue(value: string): void {
    this.content = takeGraphemes(value, this.maxLength);
    this.cursor = this.content.length;
  }

  /**
   * Apply a key press (editing, caret motion or submit) or insert pasted text.
   *
   * @param event The key press or paste.
   */
  public handleInput(event: InputEvent): void {
    if (event.type === "paste") {
      this.insert(event.text.replace(/\r\n?|\n/g, " ").replace(/\t/g, "    "));

      return;
    }

    const key = event.key;

    const action = ACTION_ORDER.find((a) => matchesAny(key, this.keys[a]));

    if (action !== undefined) {
      this.perform(action);

      return;
    }

    if (key.text !== undefined) {
      this.insert(key.text);
    }
  }

  /**
   * Left press and drag place the caret at the pointed cell.
   *
   * @param event The mouse report relative to the field.
   * @returns Whether the caret was moved; `true` for a left press or drag after the first render.
   */
  public handleMouse(event: MouseInput): boolean {
    if (
      event.button !== "left" ||
      (event.action !== "press" && event.action !== "drag") ||
      this.lastWidth < 1
    ) {
      return false;
    }

    const layout = this.layout(this.lastWidth);

    this.cursor = this.offsetAt(layout, event.x, event.action === "drag");

    return true;
  }

  /** Carry out one bound action. */
  private perform(action: TextFieldAction): void {
    const c = this.cursor;

    switch (action) {
      case "submit":
        this.onSubmit?.(this.content);

        break;
      case "deleteBack":
        this.delete(this.previousBoundary(c), c);

        break;
      case "deleteForward":
        this.delete(c, this.nextBoundary(c));

        break;
      case "deleteToStart":
        this.delete(0, c);

        break;
      case "deleteToEnd":
        this.delete(c, this.content.length);

        break;
      case "deleteBigWordBack":
        this.delete(this.bigWordLeft(c), c);

        break;
      case "deleteWordBack":
        this.delete(this.wordLeft(c), c);

        break;
      case "deleteWordForward":
        this.delete(c, this.wordRight(c));

        break;
      case "left":
        this.cursor = this.previousBoundary(c);

        break;
      case "right":
        this.cursor = this.nextBoundary(c);

        break;
      case "home":
        this.cursor = 0;

        break;
      case "end":
        this.cursor = this.content.length;

        break;
      case "wordLeft":
        this.cursor = this.wordLeft(c);

        break;
      case "wordRight":
        this.cursor = this.wordRight(c);

        break;
    }
  }

  /**
   * Render the field as one row, scrolling horizontally to keep the caret visible.
   *
   * @param width Available width in cells.
   * @returns One row: the prompt, then the value (or the placeholder when empty).
   */
  public render(width: number): readonly string[] {
    const key =
      `${width}\0${this.focused}\0${this.hardwareCursor}\0${this.isMasked}\0${this.cursor}\0${this.content}`;

    this.lastWidth = width;

    if (key === this.cacheKey) {
      return this.cache;
    }

    this.cacheKey = key;
    this.cache = [this.renderLine(width)];

    return this.cache;
  }

  /**
   * Replace some paints; others keep their values. Takes effect on the next render.
   *
   * @param theme The paints to change; see {@linkcode TextFieldTheme}.
   *
   * @example Drop the dimmed placeholder
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { TextField } from "@neonbyte/tui";
   *
   * const field = new TextField({ placeholder: "Name" });
   * field.setTheme({ placeholder: {} });
   *
   * assertEquals(field.render(10), [" Name"]);
   * ```
   */
  public setTheme(theme: TextFieldTheme): void {
    this.theme = { ...this.theme, ...theme };
    this.cacheKey = "";
  }

  /** Draw the prompt, value and caret for a frame of `width` cells. */
  private renderLine(width: number): string {
    const layout = this.layout(width);
    const { prompt, text, mask, placeholder, caret } = this.theme;
    const valuePaint = this.isMasked ? mergePaint(text, mask) : text;
    const caretPaint = this.hardwareCursor
      ? valuePaint
      : mergePaint(valuePaint, caret);
    const cell = (s: string): string =>
      this.focused
        ? CURSOR_MARKER + paint(s, caretPaint)
        : paint(s, valuePaint);
    const head = paintText(layout.prompt, prompt);

    if (this.content === "") {
      const rest = truncateToWidth(
        this.placeholder,
        layout.available - 1,
        "",
      );

      return head + cell(this.glyphs.caret) + paintText(rest, placeholder);
    }

    let before = "";
    let at: string | undefined;
    let after = "";

    for (let i = layout.first; i < layout.last; i++) {
      const segment = layout.segments[i].text;

      if (i === layout.cursorIndex) {
        at = segment;
      } else if (at === undefined) {
        before += segment;
      } else {
        after += segment;
      }
    }

    if (
      layout.cursorIndex === layout.segments.length &&
      layout.filled < layout.available
    ) {
      at = this.glyphs.caret;
    }

    if (!this.focused) {
      return head + paintText(before + (at ?? "") + after, valuePaint);
    }

    return head + paintText(before, valuePaint) +
      (at === undefined ? "" : cell(at)) + paintText(after, valuePaint);
  }

  /** Measure the value for `width`, settling the scroll offset on the cursor. */
  private layout(width: number): Layout {
    const prompt = truncateToWidth(this.prompt, Math.max(0, width - 1), "");
    const promptWidth = visibleWidth(prompt);
    const available = width - promptWidth;
    const segments = this.segments();
    const found = segments.findIndex((s) => s.start === this.cursor);
    const cursorIndex = found === -1 ? segments.length : found;

    this.scroll = this.scrollFor(segments, cursorIndex, available);

    let filled = 0;
    let last = this.scroll;

    while (
      last < segments.length && filled + segments[last].width <= available
    ) {
      filled += segments[last++].width;
    }

    return {
      prompt,
      promptWidth,
      segments,
      cursorIndex,
      first: this.scroll,
      last,
      filled,
      available,
    };
  }

  /** The graphemes of the value as drawn, masked when needed. */
  private segments(): Segment[] {
    return [...segmenter.segment(this.content)].map((s) =>
      this.isMasked
        ? { text: this.maskChar, start: s.index, width: 1 }
        : { text: s.segment, start: s.index, width: graphemeWidth(s.segment) }
    );
  }

  /**
   * The first visible segment: the current one, moved just far enough to keep
   * the caret cell in view, and back toward the start while the text and a
   * trailing caret cell would still fit with room to spare.
   */
  private scrollFor(
    segments: readonly Segment[],
    cursorIndex: number,
    available: number,
  ): number {
    let start = Math.min(this.scroll, cursorIndex);
    const caretWidth = cursorIndex < segments.length
      ? segments[cursorIndex].width
      : 1;
    let used = caretWidth;
    let total = 1;

    for (let i = start; i < cursorIndex; i++) {
      used += segments[i].width;
    }

    for (let i = start; i < segments.length; i++) {
      total += segments[i].width;
    }

    while (used > available && start < cursorIndex) {
      used -= segments[start].width;
      total -= segments[start].width;
      start++;
    }

    while (start > 0 && total + segments[start - 1].width <= available) {
      start--;
      total += segments[start].width;
    }

    return start;
  }

  /**
   * UTF-16 offset of the grapheme drawn at cell `x`. While `dragging`, a
   * pointer outside the field's text steps one grapheme past the visible edge
   * so the view scrolls.
   */
  private offsetAt(layout: Layout, x: number, dragging: boolean): number {
    const { segments, first, last } = layout;
    const column = x - layout.promptWidth;

    if (dragging && column < 0) {
      return first > 0 ? segments[first - 1].start : 0;
    }

    if (dragging && column >= layout.filled && last < segments.length) {
      return segments[last].start;
    }

    let filled = 0;

    for (let i = first; i < last; i++) {
      filled += segments[i].width;

      if (column < filled) {
        return segments[i].start;
      }
    }

    if (last >= segments.length) {
      return this.content.length;
    }

    return segments[Math.max(first, last - 1)].start;
  }

  /** Cut `text` to the room `maxLength` leaves. */
  private fit(text: string): string {
    if (this.maxLength === Infinity) {
      return text;
    }

    return takeGraphemes(
      text,
      Math.max(0, this.maxLength - [...segmenter.segment(this.content)].length),
    );
  }

  /** Insert `raw` at the cursor, cut to `maxLength`, and call `onChange`. */
  private insert(raw: string): void {
    const text = this.fit(raw);

    if (text === "") {
      return;
    }

    this.content = this.content.slice(0, this.cursor) + text +
      this.content.slice(this.cursor);
    this.cursor += text.length;

    this.onChange?.(this.content);
  }

  /** Remove the value between `from` and `to` and call `onChange`. */
  private delete(from: number, to: number): void {
    if (from >= to) {
      return;
    }

    this.content = this.content.slice(0, from) + this.content.slice(to);
    this.cursor = from;

    this.onChange?.(this.content);
  }

  /** Offset of the previous word start before `offset`; the start of the value when masked. */
  private wordLeft(offset: number): number {
    return this.isMasked ? 0 : wordStart(this.content, offset);
  }

  /** Offset of the next word end after `offset`; the end of the value when masked. */
  private wordRight(offset: number): number {
    return this.isMasked ? this.content.length : wordEnd(this.content, offset);
  }

  /** Offset of the previous whitespace-separated word start before `offset`; the start of the value when masked. */
  private bigWordLeft(offset: number): number {
    return this.isMasked ? 0 : bigWordStart(this.content, offset);
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
}
