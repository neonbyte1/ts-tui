/**
 * Inline image protocols the package can emit.
 *
 * @category Terminal
 */
export type ImageProtocol = "kitty" | "iterm2";

/**
 * What the running terminal supports. The TUI fills this in from terminal
 * replies after `start()` and re-renders every component when it changes, so
 * components read it at render time instead of caching it.
 *
 * @category Terminal
 */
export interface TerminalInfo {
  /** Protocol used to draw inline images, or `null` when images are unsupported or switched off. */
  imageProtocol: ImageProtocol | null;
  /** Pixel width of one cell; defaults until the terminal reports it. */
  cellWidthPx: number;
  /** Pixel height of one cell; defaults until the terminal reports it. */
  cellHeightPx: number;
  /** Kitty keyboard protocol (disambiguated keys such as shift+enter) is active. */
  kittyKeyboard: boolean;
}

/**
 * The capabilities of the running terminal; a single shared object the TUI
 * updates. Defaults to no image support and a 9×18 pixel cell until the
 * terminal replies.
 *
 * @category Terminal
 *
 * @example Size an image in cells in a custom component
 * ```ts
 * import { terminalInfo } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * const widthPx = 90;
 * const columns = Math.ceil(widthPx / terminalInfo.cellWidthPx);
 *
 * assertEquals(columns * terminalInfo.cellWidthPx >= widthPx, true);
 * ```
 */
export const terminalInfo: TerminalInfo = {
  imageProtocol: null,
  cellWidthPx: 9,
  cellHeightPx: 18,
  kittyKeyboard: false,
};
