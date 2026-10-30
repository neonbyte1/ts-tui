import { unicodeWidth } from "./unicode-width.ts";
import { escapeSequenceLength, StyleState } from "./ansi.ts";

const segmenter = new Intl.Segmenter();
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
/** Drawn as a two-cell emoji: emoji presentation by default, or forced by VS16 (U+FE0F). */
const EMOJI = /\p{Emoji_Presentation}|\uFE0F/u;

/**
 * One grapheme cluster of visible text, or one escape sequence (zero width).
 *
 * @category Text utilities
 */
export type Token =
  | { readonly kind: "text"; readonly value: string; readonly width: number }
  | { readonly kind: "escape"; readonly value: string };

/**
 * Terminal cell width of one grapheme cluster. Emoji (ZWJ families, flags,
 * `❤️` with VS16) occupy two cells; text-style symbols such as `✳` or `❤`
 * without VS16 take their normal width.
 *
 * @param grapheme One grapheme cluster, e.g. one element of `Intl.Segmenter`
 * output.
 * @returns The number of terminal cells it occupies: 0, 1 or 2.
 * @category Text utilities
 *
 * @example Measure narrow, wide and emoji characters
 * ```ts
 * import { graphemeWidth } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * assertEquals(graphemeWidth("a"), 1);
 * assertEquals(graphemeWidth("世"), 2);
 * assertEquals(graphemeWidth("👍"), 2);
 * ```
 */
export function graphemeWidth(grapheme: string): number {
  if (grapheme.length === 1) {
    const code = grapheme.charCodeAt(0);

    if (code >= 0x20 && code < 0x7f) {
      return 1;
    }
  }

  if (EMOJI.test(grapheme)) {
    return 2;
  }

  return unicodeWidth(grapheme);
}

/**
 * Splits a string into escape sequences and grapheme clusters.
 *
 * @param s Text that may contain ANSI escape sequences.
 * @returns The tokens in order; joining their `value`s gives back `s`.
 * @category Text utilities
 *
 * @example Separate styling from text
 * ```ts
 * import { tokenize } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * assertEquals(tokenize("a\x1b[1m世"), [
 *   { kind: "text", value: "a", width: 1 },
 *   { kind: "escape", value: "\x1b[1m" },
 *   { kind: "text", value: "世", width: 2 },
 * ]);
 * ```
 */
export function tokenize(s: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < s.length) {
    const esc = s.indexOf("\x1b", i);
    const textEnd = esc === -1 ? s.length : esc;

    if (textEnd > i) {
      for (const { segment } of segmenter.segment(s.slice(i, textEnd))) {
        tokens.push({
          kind: "text",
          value: segment,
          width: graphemeWidth(segment),
        });
      }

      i = textEnd;

      continue;
    }

    const length = escapeSequenceLength(s, i);
    const end = length === -1 ? s.length : i + length;

    tokens.push({ kind: "escape", value: s.slice(i, end) });

    i = end;
  }

  return tokens;
}

/**
 * Number of terminal cells `s` occupies, ignoring escape sequences.
 *
 * @param s Text that may contain ANSI escape sequences.
 * @returns The width in cells.
 * @category Text utilities
 *
 * @example Measure styled text
 * ```ts
 * import { visibleWidth } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * assertEquals(visibleWidth("\x1b[31mhi\x1b[39m"), 2);
 * assertEquals(visibleWidth("世界"), 4);
 * ```
 */
export function visibleWidth(s: string): number {
  if (PRINTABLE_ASCII.test(s)) {
    return s.length;
  }

  let width = 0;

  for (const token of tokenize(s)) {
    if (token.kind === "text") {
      width += token.width;
    }
  }

  return width;
}

/**
 * Cuts `s` to at most `width` cells, ending with `ellipsis` when anything was
 * removed. Escape sequences before the cut are kept and closed afterwards.
 * When `width` is narrower than the ellipsis, the ellipsis is dropped.
 *
 * @param s Text that may contain ANSI escape sequences.
 * @param width Maximum width in cells.
 * @param ellipsis Marker appended when `s` was cut. Default `"…"`.
 * @returns `s` itself when it fits, otherwise the shortened text.
 * @category Text utilities
 *
 * @example Shorten a title to fit a column
 * ```ts
 * import { truncateToWidth, visibleWidth } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * assertEquals(truncateToWidth("hello world", 8), "hello w…");
 * assertEquals(truncateToWidth("hello world", 8, "..."), "hello...");
 * assertEquals(visibleWidth(truncateToWidth("世界世界", 5)), 5);
 * ```
 */
export function truncateToWidth(
  s: string,
  width: number,
  ellipsis = "…",
): string {
  if (visibleWidth(s) <= width) {
    return s;
  }

  let suffix = ellipsis;
  let budget = width - visibleWidth(ellipsis);

  if (budget < 0) {
    suffix = "";
    budget = width;
  }

  const style = new StyleState();
  let out = "";
  let used = 0;

  for (const token of tokenize(s)) {
    if (token.kind === "escape") {
      out += token.value;

      style.apply(token.value);

      continue;
    }

    if (used + token.width > budget) {
      break;
    }

    out += token.value;
    used += token.width;
  }

  return out + style.close() + suffix;
}

/**
 * Appends spaces so `s` occupies exactly `width` cells. Text that is already
 * that wide or wider is returned unchanged.
 *
 * @param s Text that may contain ANSI escape sequences.
 * @param width Target width in cells.
 * @returns `s` padded on the right.
 * @category Text utilities
 *
 * @example Pad a label to a column
 * ```ts
 * import { padToWidth } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * assertEquals(padToWidth("ab", 5), "ab   ");
 * assertEquals(padToWidth("世", 3), "世 ");
 * assertEquals(padToWidth("abcdef", 3), "abcdef");
 * ```
 */
export function padToWidth(s: string, width: number): string {
  const missing = width - visibleWidth(s);

  return missing > 0 ? s + " ".repeat(missing) : s;
}

/**
 * Cells `[start, end)` of `s` as a self-contained string exactly `end - start`
 * cells wide: styles and hyperlinks active at `start` are reopened and closed
 * at the end, wide characters cut by either edge become spaces, and short input
 * is space-padded. Escape sequences inside the range are kept.
 *
 * @param s Text that may contain ANSI escape sequences.
 * @param start First cell to keep, counting from 0.
 * @param end Cell after the last one to keep.
 * @returns The selected cells, `end - start` columns wide.
 * @category Text utilities
 *
 * @example Take a column range
 * ```ts
 * import { sliceColumns, visibleWidth } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * assertEquals(sliceColumns("hello world", 6, 11), "world");
 * assertEquals(sliceColumns("世界", 1, 3), "  ");
 * assertEquals(visibleWidth(sliceColumns("\x1b[31mhello\x1b[39m", 1, 3)), 2);
 * ```
 */
export function sliceColumns(s: string, start: number, end: number): string {
  const style = new StyleState();
  let out = "";
  let opened = false;
  let col = 0;
  let filled = 0;

  for (const token of tokenize(s)) {
    if (col >= end) {
      break;
    }

    const piece = sliceToken(token, col, start, end);

    if (piece !== null) {
      if (!opened) {
        out += style.open();
        opened = true;
      }

      out += piece;
    }

    if (token.kind === "escape") {
      style.apply(token.value);

      continue;
    }

    const next = col + token.width;

    if (piece !== null) {
      filled += Math.min(next, end) - Math.max(col, start);
    }

    col = next;
  }

  if (opened) {
    out += style.close();
  }

  return out + " ".repeat(Math.max(0, end - start - filled));
}

/**
 * Text `sliceColumns` emits for `token` at column `col`, or null when it is
 * skipped: escapes before `start`, and text that ends at or before `start`.
 * A wide character cut by an edge becomes spaces for its in-range cells.
 */
function sliceToken(
  token: Token,
  col: number,
  start: number,
  end: number,
): string | null {
  if (token.kind === "escape") {
    return col >= start ? token.value : null;
  }

  const next = col + token.width;

  if (next <= start) {
    return null;
  }

  if (col < start || next > end) {
    return " ".repeat(Math.min(next, end) - Math.max(col, start));
  }

  return token.value;
}

function isSpace(token: Token): boolean {
  return token.kind === "text" && token.value === " ";
}

function trimTrailingSpaces(tokens: Token[]): Token[] {
  let end = tokens.length;

  while (end > 0) {
    const token = tokens[end - 1];

    if (isSpace(token)) {
      tokens.splice(end - 1, 1);
    } else if (token.kind === "text") {
      break;
    }

    end--;
  }

  return tokens;
}

/**
 * Word-wraps `text` into lines of at most `width` cells.
 *
 * Breaks at spaces when possible and hard-breaks longer words. Newlines start
 * a new line, tabs become four spaces, and carriage returns are dropped.
 * Styles and hyperlinks are closed at each line end and reopened on the next
 * line, so every returned line renders correctly on its own.
 *
 * @param text Text that may contain newlines and ANSI escape sequences.
 * @param width Maximum line width in cells; values below 1 count as 1.
 * @returns The wrapped lines, at least one.
 * @category Text utilities
 *
 * @example Wrap a paragraph
 * ```ts
 * import { wrapText } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * assertEquals(wrapText("the quick brown fox", 9), ["the quick", "brown fox"]);
 * assertEquals(wrapText("abcdefghij", 4), ["abcd", "efgh", "ij"]);
 * ```
 */
export function wrapText(text: string, width: number): string[] {
  const wrapper = new Wrapper(Math.max(1, Math.floor(width)));
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ")
    .replace(/\r/g, "");

  for (const paragraph of normalized.split("\n")) {
    wrapper.paragraph(paragraph);
  }

  return wrapper.lines;
}

/** Sum of the cell widths of the text tokens in `tokens`. */
function tokensWidth(tokens: Token[]): number {
  let total = 0;

  for (const token of tokens) {
    if (token.kind === "text") {
      total += token.width;
    }
  }

  return total;
}

/** Line-building state for `wrapText`; style state carries across lines and paragraphs. */
class Wrapper {
  public readonly lines: string[] = [];
  private readonly maxWidth: number;
  private style = new StyleState();
  private line: Token[] = [];
  private lineWidth = 0;
  private breakAt = -1; // index in `line` where the next line would start
  private continuation = false; // `line` continues a wrapped line of this paragraph

  public constructor(maxWidth: number) {
    this.maxWidth = maxWidth;
  }

  /** Wrap one newline-free paragraph and emit its final line. */
  public paragraph(text: string): void {
    this.resetLine();

    this.continuation = false;

    for (const token of tokenize(text)) {
      this.add(token);
    }

    this.emit(trimTrailingSpaces(this.line));
  }

  /** Append one token to the current line, wrapping first when it does not fit. */
  private add(token: Token): void {
    if (token.kind === "escape") {
      this.line.push(token);

      return;
    }

    // Wrapped continuation lines drop leading spaces; a paragraph's own indentation is kept.
    if (this.continuation && this.lineWidth === 0 && isSpace(token)) {
      return;
    }

    if (this.lineWidth + token.width > this.maxWidth) {
      this.continuation = true;

      if (isSpace(token)) {
        this.emit(trimTrailingSpaces(this.line));
        this.resetLine();

        return;
      }

      this.breakLine();

      if (token.width > this.maxWidth) {
        return;
      } // wider than the whole line: cannot be shown
    }

    this.line.push(token);

    this.lineWidth += token.width;

    if (isSpace(token)) {
      this.breakAt = this.line.length;
    }
  }

  /** Emit the current line at its last space (or hard-break it) and keep the remainder. */
  private breakLine(): void {
    if (this.breakAt > 0) {
      const rest = this.line.slice(this.breakAt);

      this.emit(trimTrailingSpaces(this.line.slice(0, this.breakAt)));

      this.line = rest;
      this.lineWidth = tokensWidth(rest);
      this.breakAt = -1;
    } else {
      this.emit(this.line);
      this.resetLine();
    }
  }

  private resetLine(): void {
    this.line = [];
    this.lineWidth = 0;
    this.breakAt = -1;
  }

  /** Push `tokens` as a finished line, wrapped in the style open/close sequences. */
  private emit(tokens: Token[]): void {
    let body = "";
    const end = this.style.clone();

    for (const token of tokens) {
      body += token.value;

      if (token.kind === "escape") {
        end.apply(token.value);
      }
    }

    this.lines.push(this.style.open() + body + end.close());

    this.style = end;
  }
}
