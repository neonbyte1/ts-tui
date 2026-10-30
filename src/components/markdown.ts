import { Lexer, type Token, type Tokens } from "marked";
import { HYPERLINK_CLOSE, StyleState } from "../ansi.ts";
import { mergePaint, type Paint, paint } from "../style.ts";
import type { Component } from "../tui.ts";
import {
  type Token as TextToken,
  tokenize,
  truncateToWidth,
  visibleWidth,
  wrapText,
} from "../width.ts";

/**
 * Paints per element; unset elements keep their defaults.
 *
 * @category Text
 */
export interface MarkdownTheme {
  /** Headings of every level, marker included. Default bold. */
  readonly heading?: Paint;
  /** Level 1 headings, merged over `heading`. Default underline. */
  readonly heading1?: Paint;
  /** Default bold. */
  readonly bold?: Paint;
  /** Default italic. */
  readonly italic?: Paint;
  /** Default strikethrough. */
  readonly strikethrough?: Paint;
  /** Inline code. Default cyan. */
  readonly code?: Paint;
  /** Code block lines that are not styled by `highlightCode`. Default none. */
  readonly codeBlock?: Paint;
  /** Frame of a code block. Default dim. */
  readonly codeBlockBorder?: Paint;
  /** Blockquote content. Default italic. */
  readonly quote?: Paint;
  /** The bar before blockquote rows. Default dim. */
  readonly quoteBorder?: Paint;
  /** Link text. Default underlined blue. */
  readonly link?: Paint;
  /** The ` (url)` shown after link and image text. Default dim. */
  readonly linkUrl?: Paint;
  /** Bullets and numbers of list items. Default yellow. */
  readonly listBullet?: Paint;
  /** The `[x]` / `[ ]` of task list items. Default none. */
  readonly checkbox?: Paint;
  /** Horizontal rules. Default dim. */
  readonly hr?: Paint;
  /** Table frame and column separators. Default dim. */
  readonly tableBorder?: Paint;
  /** Text of the table's header cells. Default bold. */
  readonly tableHeader?: Paint;
}

/**
 * Table frame glyphs, each one cell wide.
 *
 * @category Text
 */
export interface MarkdownTableGlyphs {
  /** Top-left corner. */
  readonly topLeft: string;
  /** Where a column separator meets the top edge. */
  readonly topMid: string;
  /** Top-right corner. */
  readonly topRight: string;
  /** Left end of the rule under the header. */
  readonly midLeft: string;
  /** Where a column separator crosses the rule under the header. */
  readonly cross: string;
  /** Right end of the rule under the header. */
  readonly midRight: string;
  /** Bottom-left corner. */
  readonly bottomLeft: string;
  /** Where a column separator meets the bottom edge. */
  readonly bottomMid: string;
  /** Bottom-right corner. */
  readonly bottomRight: string;
  /** Repeated along the table's horizontal edges and the rule under the header. */
  readonly horizontal: string;
  /** Repeated along the table's left and right edges and between columns. */
  readonly vertical: string;
}

/**
 * Decoration characters.
 *
 * @category Text
 */
export interface MarkdownGlyphs {
  /** Repeated per heading level before the heading text. */
  readonly headingMarker: string;
  /** Item marker of unordered lists. */
  readonly bullet: string;
  /** Marker of a checked task list item. */
  readonly checked: string;
  /** Marker of an unchecked task list item. */
  readonly unchecked: string;
  /** Before each blockquote row, gap included. */
  readonly quoteBar: string;
  /** Start of a code block's frame; the language follows after a space. */
  readonly codeTop: string;
  /** Before each code block row, gap included. */
  readonly codeGutter: string;
  /** End of a code block's frame. */
  readonly codeBottom: string;
  /** One cell of a horizontal rule. */
  readonly rule: string;
  /** Table frame glyphs; see {@linkcode MarkdownTableGlyphs}. */
  readonly table: MarkdownTableGlyphs;
}

/**
 * Built-in glyph sets for {@linkcode MarkdownOptions.glyphs}: `unicode` (the
 * default) and `ascii` for terminals without box drawing characters.
 *
 * @category Text
 */
export const MARKDOWN_GLYPHS: {
  readonly [Name in "unicode" | "ascii"]: MarkdownGlyphs;
} = {
  unicode: {
    headingMarker: "#",
    bullet: "•",
    checked: "[x]",
    unchecked: "[ ]",
    quoteBar: "│ ",
    codeTop: "┌─",
    codeGutter: "│ ",
    codeBottom: "└─",
    rule: "─",
    table: {
      topLeft: "┌",
      topMid: "┬",
      topRight: "┐",
      midLeft: "├",
      cross: "┼",
      midRight: "┤",
      bottomLeft: "└",
      bottomMid: "┴",
      bottomRight: "┘",
      horizontal: "─",
      vertical: "│",
    },
  },
  ascii: {
    headingMarker: "#",
    bullet: "*",
    checked: "[x]",
    unchecked: "[ ]",
    quoteBar: "| ",
    codeTop: "+-",
    codeGutter: "| ",
    codeBottom: "+-",
    rule: "-",
    table: {
      topLeft: "+",
      topMid: "+",
      topRight: "+",
      midLeft: "+",
      cross: "+",
      midRight: "+",
      bottomLeft: "+",
      bottomMid: "+",
      bottomRight: "+",
      horizontal: "-",
      vertical: "|",
    },
  },
};

/**
 * Fixed texts.
 *
 * @category Text
 */
export interface MarkdownLabels {
  /** Shown after link text whose target differs from it; styled with `theme.linkUrl`. Default ` (HREF)`. */
  readonly linkUrl: (href: string) => string;
  /** Shown after an image's alt text; styled with `theme.linkUrl`. Default ` (HREF)`, or just the href without alt text. */
  readonly imageUrl: (href: string, alt: string) => string;
}

/**
 * Look of a {@linkcode Markdown} component. Every option is optional.
 *
 * @category Text
 */
export interface MarkdownOptions {
  /** Columns of blank margin on each side. Default 0. */
  paddingX?: number;
  /** Spaces inside each side of a table cell; dropped on very narrow widths. Default 1. */
  tablePadding?: number;
  /** Spaces between a list marker and the item. Default 1. */
  listGap?: number;
  /** Blank rows between blocks and between the items of a loose list. Default 1. */
  blockGap?: number;
  /** Paints per element; see {@linkcode MarkdownTheme}. */
  theme?: MarkdownTheme;
  /** Decoration characters, each replacing its default from {@linkcode MARKDOWN_GLYPHS}`.unicode`; see {@linkcode MarkdownGlyphs}. */
  glyphs?: Partial<MarkdownGlyphs>;
  /** Fixed texts, each replacing its default; see {@linkcode MarkdownLabels}. */
  labels?: Partial<MarkdownLabels>;
  /**
   * Styles a code block: returns one styled line per source line. Must not
   * change the visible width of any line.
   */
  highlightCode?: (code: string, lang: string | undefined) => string[];
}

const DEFAULT_THEME: Required<MarkdownTheme> = {
  heading: { bold: true },
  heading1: { underline: true },
  bold: { bold: true },
  italic: { italic: true },
  strikethrough: { strikethrough: true },
  code: { fg: "cyan" },
  codeBlock: {},
  codeBlockBorder: { dim: true },
  quote: { italic: true },
  quoteBorder: { dim: true },
  link: { underline: true, fg: "blue" },
  linkUrl: { dim: true },
  listBullet: { fg: "yellow" },
  checkbox: {},
  hr: { dim: true },
  tableBorder: { dim: true },
  tableHeader: { bold: true },
};

const DEFAULT_LABELS: MarkdownLabels = {
  linkUrl: (href) => ` (${href})`,
  imageUrl: (href, alt) => alt === "" ? href : ` (${href})`,
};

interface Context {
  readonly theme: Required<MarkdownTheme>;
  readonly glyphs: MarkdownGlyphs;
  readonly labels: MarkdownLabels;
  readonly tablePadding: number;
  readonly listGap: number;
  /** Rows between blocks. */
  readonly blank: readonly string[];
  readonly highlightCode: MarkdownOptions["highlightCode"];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  copy: "©",
  reg: "®",
  hellip: "…",
  mdash: "—",
  ndash: "–",
};

function decodeEntities(text: string): string {
  if (!text.includes("&")) {
    return text;
  }

  return text.replace(
    /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));/g,
    (match, decimal?: string, hex?: string, name?: string) => {
      if (name !== undefined) {
        return NAMED_ENTITIES[name] ?? match;
      }

      const code = decimal !== undefined
        ? Number.parseInt(decimal, 10)
        : Number.parseInt(hex!, 16);
      const control = code < 0x20 || (code >= 0x7f && code < 0xa0);

      return control || code > 0x10ffff ? match : String.fromCodePoint(code);
    },
  );
}

/** Normalize newlines and drop control characters other than newline and tab, which rows must not contain. */
function sanitize(text: string): string {
  return text.replace(/\r\n?/g, "\n")
    // deno-lint-ignore no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

/** Cut one line into rows of exactly `width` cells without reflowing words; styles are closed and reopened per row. */
function hardWrap(line: string, width: number): string[] {
  const rows: string[] = [];
  let style = new StyleState();
  let tokens: TextToken[] = [];
  let used = 0;
  const flush = (): void => {
    const end = style.clone();
    let body = "";

    for (const token of tokens) {
      body += token.value;

      if (token.kind === "escape") {
        end.apply(token.value);
      }
    }

    rows.push(style.open() + body + end.close());

    style = end;
    tokens = [];
    used = 0;
  };

  for (const token of tokenize(line.replace(/\t/g, "    "))) {
    if (token.kind === "text") {
      if (token.width > width) {
        continue;
      } // wider than the whole row: cannot be shown

      if (used + token.width > width) {
        flush();
      }

      used += token.width;
    }

    tokens.push(token);
  }

  flush();

  return rows;
}

function renderInline(tokens: Token[] | undefined, ctx: Context): string {
  const { theme } = ctx;
  let out = "";

  for (const token of tokens ?? []) {
    switch (token.type) {
      case "text":
        out += token.tokens
          ? renderInline(token.tokens, ctx)
          : decodeEntities(token.text).replace(/\n/g, " ");

        break;
      case "escape":
        out += token.text;

        break;
      case "strong":
        out += paint(renderInline(token.tokens, ctx), theme.bold);

        break;
      case "em":
        out += paint(renderInline(token.tokens, ctx), theme.italic);

        break;
      case "del":
        out += paint(renderInline(token.tokens, ctx), theme.strikethrough);

        break;
      case "codespan":
        out += paint(token.text.replace(/\n/g, " "), theme.code);

        break;
      case "checkbox": // rendered by the list item prefix
        break;
      case "br":
        out += "\n";

        break;
      case "link": {
        const link = token as Tokens.Link;
        const label = renderInline(link.tokens, ctx);

        out += `\x1b]8;;${link.href}\x07${
          paint(label || link.href, theme.link)
        }${HYPERLINK_CLOSE}`;

        const sameAsUrl = label === "" || link.text === link.href ||
          `mailto:${link.text}` === link.href;

        if (!sameAsUrl) {
          out += paint(ctx.labels.linkUrl(link.href), theme.linkUrl);
        }

        break;
      }
      case "image": {
        const image = token as Tokens.Image;

        out += decodeEntities(image.text);
        out += paint(
          ctx.labels.imageUrl(image.href, image.text),
          theme.linkUrl,
        );

        break;
      }
      case "html":
        out += token.text.replace(/\n/g, " ");

        break;
      default: {
        const other = token as Tokens.Generic;

        out += other.tokens
          ? renderInline(other.tokens, ctx)
          : decodeEntities(other.raw).replace(/\n/g, " ");
      }
    }
  }

  return out;
}

/** Strip trailing `\n` characters only, in linear time. */
function trimTrailingNewlines(text: string): string {
  let end = text.length;

  while (end > 0 && text.charCodeAt(end - 1) === 10) {
    end--;
  }

  return end === text.length ? text : text.slice(0, end);
}

/** Highlighted or plain code block lines; empty for empty source. */
function codeLines(
  source: string,
  lang: string | undefined,
  ctx: Context,
): string[] {
  if (source === "") {
    return [];
  }

  if (ctx.highlightCode) {
    return ctx.highlightCode(source, lang);
  }

  return source.split("\n").map((line) => paint(line, ctx.theme.codeBlock));
}

/** Checkbox prefix for task list items; empty for ordinary items. */
function taskCheckbox(item: Tokens.ListItem, ctx: Context): string {
  if (!item.task) {
    return "";
  }

  const glyph = item.checked ? ctx.glyphs.checked : ctx.glyphs.unchecked;

  return paint(glyph, ctx.theme.checkbox) + " ".repeat(ctx.listGap);
}

/** Left padding for a cell given its column alignment and spare space. */
function alignOffset(align: string | null | undefined, space: number): number {
  if (align === "right") {
    return space;
  }

  if (align === "center") {
    return Math.floor(space / 2);
  }

  return 0;
}

function renderCode(
  code: Tokens.Code,
  width: number,
  ctx: Context,
): string[] {
  const { theme, glyphs } = ctx;
  const lang = code.lang?.split(/\s+/)[0] || undefined;
  const source = trimTrailingNewlines(code.text);
  const lines = codeLines(source, lang, ctx);
  const gutter = paint(glyphs.codeGutter, theme.codeBlockBorder);
  const top = lang ? `${glyphs.codeTop} ${lang}` : glyphs.codeTop;
  const rows = [paint(top, theme.codeBlockBorder)];
  const inner = Math.max(1, width - visibleWidth(glyphs.codeGutter));

  for (const line of lines) {
    for (const row of hardWrap(line, inner)) {
      rows.push(gutter + row);
    }
  }

  rows.push(paint(glyphs.codeBottom, theme.codeBlockBorder));

  return rows;
}

function renderList(list: Tokens.List, width: number, ctx: Context): string[] {
  const start = typeof list.start === "number" ? list.start : 1;
  const labels = list.items.map((_, i) =>
    list.ordered ? `${start + i}.` : ctx.glyphs.bullet
  );
  const labelWidth = Math.max(...labels.map((l) => visibleWidth(l)));
  const gap = " ".repeat(ctx.listGap);
  const rows: string[] = [];

  list.items.forEach((item, i) => {
    const label = " ".repeat(labelWidth - visibleWidth(labels[i])) + labels[i];
    const checkbox = taskCheckbox(item, ctx);
    const prefix = paint(label, ctx.theme.listBullet) + gap + checkbox;
    const indent = labelWidth + gap.length + visibleWidth(checkbox);
    const body = renderBlocks(
      item.tokens.filter((t) => t.type !== "checkbox"),
      Math.max(1, width - indent),
      ctx,
      item.loose,
    );

    if (list.loose && i > 0) {
      rows.push(...ctx.blank);
    }

    const pad = " ".repeat(indent);

    if (body.length === 0) {
      rows.push(prefix.trimEnd());
    }

    body.forEach((row, j) => {
      if (j === 0) {
        rows.push(prefix + row);
      } else {
        rows.push(row === "" ? "" : pad + row);
      }
    });
  });

  return rows;
}

function renderTable(
  table: Tokens.Table,
  width: number,
  ctx: Context,
): string[] {
  const { theme } = ctx;
  const columns = table.header.length;

  if (columns === 0) {
    return [];
  }

  const cellText = (cell: Tokens.TableCell, header: boolean): string => {
    const text = renderInline(cell.tokens, ctx);

    return header ? paint(text, theme.tableHeader) : text;
  };
  const grid = [
    table.header.map((cell) => cellText(cell, true)),
    ...table.rows.map((row) =>
      table.header.map((_, c) => row[c] ? cellText(row[c], false) : "")
    ),
  ];
  const widths = table.header.map((_, c) =>
    Math.max(
      1,
      ...grid.map((row) => Math.max(...row[c].split("\n").map(visibleWidth))),
    )
  );

  // Cell padding is dropped before columns are squeezed to a single cell.
  let pad = ctx.tablePadding;

  if (width - ((2 * pad + 1) * columns + 1) < columns) {
    pad = 0;
  }

  const available = Math.max(columns, width - ((pad + pad + 1) * columns + 1));
  let excess = widths.reduce((a, b) => a + b, 0) - available;

  while (excess > 0) {
    let widest = 0;

    for (let c = 1; c < columns; c++) {
      if (widths[c] > widths[widest]) {
        widest = c;
      }
    }

    widths[widest]--;
    excess--;
  }

  const g = ctx.glyphs.table;
  const border = (s: string): string => paint(s, theme.tableBorder);
  const bar = border(g.vertical);
  const rule = (left: string, mid: string, right: string): string =>
    border(
      left + widths.map((w) => g.horizontal.repeat(w + 2 * pad)).join(mid) +
        right,
    );
  const gap = " ".repeat(pad);
  const rows = [rule(g.topLeft, g.topMid, g.topRight)];

  grid.forEach((row, r) => {
    const cells = row.map((text, c) => wrapText(text, widths[c]));
    const height = Math.max(...cells.map((lines) => lines.length));

    for (let line = 0; line < height; line++) {
      const parts = cells.map((lines, c) => {
        const text = lines[line] ?? "";
        const space = widths[c] - visibleWidth(text);
        const left = alignOffset(table.align[c], space);

        return gap + " ".repeat(left) + text + " ".repeat(space - left) + gap;
      });

      rows.push(bar + parts.join(bar) + bar);
    }

    if (r === 0) {
      rows.push(rule(g.midLeft, g.cross, g.midRight));
    }
  });
  rows.push(rule(g.bottomLeft, g.bottomMid, g.bottomRight));

  return rows;
}

function renderBlock(token: Token, width: number, ctx: Context): string[] {
  const { theme } = ctx;

  switch (token.type) {
    case "space":
    case "def":
      return [];
    case "heading": {
      const heading = token as Tokens.Heading;
      const marker = ctx.glyphs.headingMarker.repeat(heading.depth);
      const text = `${marker} ${renderInline(heading.tokens, ctx)}`;
      const style = heading.depth === 1
        ? mergePaint(theme.heading, theme.heading1)
        : theme.heading;

      return wrapText(paint(text, style), width);
    }
    case "paragraph":
    case "text":
      return wrapText(
        token.tokens
          ? renderInline(token.tokens, ctx)
          : decodeEntities(token.text),
        width,
      );
    case "code":
      return renderCode(token as Tokens.Code, width, ctx);
    case "blockquote": {
      const inner = renderBlocks(
        (token as Tokens.Blockquote).tokens,
        Math.max(1, width - visibleWidth(ctx.glyphs.quoteBar)),
        ctx,
        true,
      );
      const prefix = paint(ctx.glyphs.quoteBar, theme.quoteBorder);

      return inner.map((row) =>
        prefix + (row === "" ? "" : paint(row, theme.quote))
      );
    }
    case "list":
      return renderList(token as Tokens.List, width, ctx);
    case "hr":
      return [paint(ctx.glyphs.rule.repeat(width), theme.hr)];
    case "table":
      return renderTable(token as Tokens.Table, width, ctx);
    case "html":
      return wrapText(trimTrailingNewlines(token.text), width);
    default: {
      const other = token as Tokens.Generic;

      return wrapText(
        other.tokens
          ? renderInline(other.tokens, ctx)
          : trimTrailingNewlines(decodeEntities(other.raw)),
        width,
      );
    }
  }
}

/** Render blocks in order, separated by one blank row when `separate`. */
function renderBlocks(
  tokens: Token[],
  width: number,
  ctx: Context,
  separate: boolean,
): string[] {
  const rows: string[] = [];

  for (const token of tokens) {
    const block = renderBlock(token, width, ctx);

    if (block.length === 0) {
      continue;
    }

    if (separate && rows.length > 0) {
      rows.push(...ctx.blank);
    }

    for (const row of block) {
      rows.push(row);
    }
  }

  return rows;
}

/**
 * Markdown rendered to styled terminal rows: headings, paragraphs, code
 * blocks, blockquotes, nested lists, tables, rules and inline styling.
 * Tolerates partial input, so it can render a message while it streams.
 *
 * @example Render a heading and a list
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Markdown } from "@neonbyte/tui";
 *
 * const markdown = new Markdown("# Title\n\nSome **bold** text\n\n- one\n- two");
 * const plain = markdown.render(30).map((row) =>
 *   row.replace(/\x1b\[[0-9;]*m/g, "")
 * );
 *
 * assertEquals(plain, ["# Title", "", "Some bold text", "", "• one", "• two"]);
 * ```
 *
 * @category Text
 */
export class Markdown implements Component {
  private readonly paddingX: number;
  private ctx: Context;
  private content: string;
  private cacheWidth = -1;
  private cache: readonly string[] = [];

  /**
   * Create a markdown view.
   *
   * @param text The markdown source. Default `""`.
   * @param options Spacing, paints, glyphs and code highlighting; see {@linkcode MarkdownOptions}.
   */
  public constructor(text = "", options: MarkdownOptions = {}) {
    this.content = text;
    this.paddingX = options.paddingX ?? 0;
    this.ctx = {
      theme: { ...DEFAULT_THEME, ...options.theme },
      glyphs: { ...MARKDOWN_GLYPHS.unicode, ...options.glyphs },
      labels: { ...DEFAULT_LABELS, ...options.labels },
      tablePadding: Math.max(0, Math.floor(options.tablePadding ?? 1)),
      listGap: Math.max(0, Math.floor(options.listGap ?? 1)),
      blank: Array.from(
        { length: Math.max(0, Math.floor(options.blockGap ?? 1)) },
        () => "",
      ),
      highlightCode: options.highlightCode,
    };
  }

  /** The markdown source. */
  public get text(): string {
    return this.content;
  }

  /**
   * Replace the markdown source. Does nothing when it is unchanged, so it is cheap to call on every streamed chunk.
   *
   * @param text The new markdown source.
   *
   * @example Append streamed text
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Markdown } from "@neonbyte/tui";
   *
   * const markdown = new Markdown("Hello **wor");
   * markdown.setText(markdown.text + "ld**");
   *
   * const plain = markdown.render(20).map((row) =>
   *   row.replace(/\x1b\[[0-9;]*m/g, "")
   * );
   *
   * assertEquals(plain, ["Hello world"]);
   * ```
   */
  public setText(text: string): void {
    if (text === this.content) {
      return;
    }

    this.content = text;

    this.invalidate();
  }

  /** Drop the cached rows so the next render recomputes them. */
  public invalidate(): void {
    this.cacheWidth = -1;
  }

  /**
   * Replace some paints; others keep their values.
   *
   * @param theme The paints to change; see {@linkcode MarkdownTheme}.
   *
   * @example Drop the bold of headings
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Markdown } from "@neonbyte/tui";
   *
   * const markdown = new Markdown("# Title");
   * markdown.setTheme({ heading: {}, heading1: {} });
   *
   * assertEquals(markdown.render(20), ["# Title"]);
   * ```
   */
  public setTheme(theme: MarkdownTheme): void {
    this.ctx = { ...this.ctx, theme: { ...this.ctx.theme, ...theme } };

    this.invalidate();
  }

  /**
   * Lay the markdown out for `width` columns.
   *
   * @param width Available width in cells.
   * @returns The styled rows; empty source gives no rows.
   */
  public render(width: number): readonly string[] {
    const columns = Math.max(1, Math.floor(width));

    if (columns === this.cacheWidth) {
      return this.cache;
    }

    const paddingX = Math.max(
      0,
      Math.min(this.paddingX, Math.floor((columns - 1) / 2)),
    );
    const margin = " ".repeat(paddingX);
    const blocks = renderBlocks(
      Lexer.lex(sanitize(this.content)),
      columns - paddingX * 2,
      this.ctx,
      true,
    );

    // Prefixes and tables can exceed very narrow widths; cut rather than overflow.
    this.cache = blocks.map((row) =>
      truncateToWidth(row === "" ? row : margin + row, columns)
    );
    this.cacheWidth = columns;

    return this.cache;
  }
}
