import type { Component } from "../tui.ts";

/**
 * Blank rows, for vertical gaps between components.
 *
 * @example Leave two empty rows between content
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Spacer } from "@neonbyte/tui";
 *
 * const gap = new Spacer(2);
 *
 * assertEquals(gap.render(), ["", ""]);
 * ```
 *
 * @category Layout
 */
export class Spacer implements Component {
  private lines: readonly string[];

  /**
   * Create a spacer.
   *
   * @param rows Number of blank rows. Default 1.
   */
  public constructor(rows = 1) {
    this.lines = Array.from({ length: rows }, () => "");
  }

  /**
   * Change the number of blank rows.
   *
   * @param rows The new number of blank rows.
   *
   * @example Grow a gap
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Spacer } from "@neonbyte/tui";
   *
   * const gap = new Spacer();
   * gap.setRows(3);
   *
   * assertEquals(gap.render().length, 3);
   * ```
   */
  public setRows(rows: number): void {
    if (rows !== this.lines.length) {
      this.lines = Array.from({ length: rows }, () => "");
    }
  }

  /**
   * Render the blank rows.
   *
   * @returns One empty string per row; the width does not matter.
   */
  public render(): readonly string[] {
    return this.lines;
  }
}
