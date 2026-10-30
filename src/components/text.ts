import type { Component } from "../tui.ts";
import { padToWidth, wrapText } from "../width.ts";

/**
 * Style applied to each full-width row; must not change the visible width.
 *
 * @category Text
 */
export type LineStyle = (line: string) => string;

/**
 * Word-wrapped multi-line text with optional padding and a per-row style (e.g.
 * a background).
 *
 * @example Wrap a sentence to the available width
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Text } from "@neonbyte/tui";
 *
 * const text = new Text("hello brave new world");
 *
 * assertEquals(text.render(11), ["hello brave", "new world"]);
 * ```
 *
 * @category Text
 */
export class Text implements Component {
  private content: string;
  private paddingX: number;
  private paddingY: number;
  private style: LineStyle | undefined;
  private cacheWidth = -1;
  private cache: readonly string[] = [];

  /**
   * Create a text block.
   *
   * @param text The content; `\n` starts a new row. Default `""`.
   * @param paddingX Blank cells left and right of the text. Default 0.
   * @param paddingY Blank rows above and below the text. Default 0.
   * @param style Applied to every row including the padding rows, e.g. to paint a background; see {@linkcode LineStyle}.
   */
  public constructor(text = "", paddingX = 0, paddingY = 0, style?: LineStyle) {
    this.content = text;
    this.paddingX = paddingX;
    this.paddingY = paddingY;
    this.style = style;
  }

  /** The current content. */
  public get text(): string {
    return this.content;
  }

  /**
   * Replace the content. Does nothing when it is unchanged.
   *
   * @param text The new content.
   *
   * @example Update the text
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Text } from "@neonbyte/tui";
   *
   * const text = new Text("old");
   * text.setText("new");
   *
   * assertEquals(text.render(10), ["new"]);
   * ```
   */
  public setText(text: string): void {
    if (text === this.content) {
      return;
    }

    this.content = text;

    this.invalidate();
  }

  /**
   * Replace the per-row style.
   *
   * @param style The new style, or `undefined` to render rows unstyled.
   *
   * @example Paint every row
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Text } from "@neonbyte/tui";
   *
   * const text = new Text("hi", 1);
   * text.setStyle((line) => `[${line}]`);
   *
   * assertEquals(text.render(6), ["[ hi   ]"]);
   * ```
   */
  public setStyle(style: LineStyle | undefined): void {
    this.style = style;

    this.invalidate();
  }

  /** Drop the cached rows so the next render recomputes them. */
  public invalidate(): void {
    this.cacheWidth = -1;
  }

  /**
   * Wrap the content to `width` and apply padding and style.
   *
   * @param width Available width in cells.
   * @returns The rows, each padded to `width` when a style is set.
   */
  public render(width: number): readonly string[] {
    if (this.cacheWidth === width) {
      return this.cache;
    }

    const paddingX = Math.min(this.paddingX, Math.floor((width - 1) / 2));
    const inner = Math.max(1, width - paddingX * 2);
    const style = this.style;
    const margin = " ".repeat(paddingX);
    const blank = style ? style(" ".repeat(width)) : "";
    const lines: string[] = [];

    for (let i = 0; i < this.paddingY; i++) {
      lines.push(blank);
    }

    if (this.content !== "") {
      for (const line of wrapText(this.content, inner)) {
        lines.push(
          style ? style(padToWidth(margin + line, width)) : margin + line,
        );
      }
    }

    for (let i = 0; i < this.paddingY; i++) {
      lines.push(blank);
    }

    this.cacheWidth = width;
    this.cache = lines;

    return lines;
  }
}
