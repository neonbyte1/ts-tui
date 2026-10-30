import { mergePaint, type Paint, paint } from "./style.ts";

/**
 * One cell for the empty track and one for the thumb.
 *
 * @category Layout
 */
export interface ScrollbarGlyphs {
  /** Cell of the track where the thumb is not. */
  readonly track: string;
  /** Cell of the thumb. */
  readonly thumb: string;
}

/**
 * Scrollbar paints. Unset fields keep their defaults.
 *
 * @category Layout
 */
export interface ScrollbarTheme {
  /** Default grey `#5c6370`. */
  readonly track?: Paint;
  /** Default cyan `#3fb5e8`. */
  readonly thumb?: Paint;
  /** The thumb while hovered or dragged. Default bold on top of `thumb`. */
  readonly thumbActive?: Paint;
}

/**
 * Glyph sets. `vertical` and `horizontal` are thin lines with a heavier thumb; `block` and `ascii` work for either orientation; `blank` draws no track.
 *
 * @category Layout
 */
export const SCROLLBAR_GLYPHS: {
  readonly [Name in "vertical" | "horizontal" | "block" | "ascii" | "blank"]:
    ScrollbarGlyphs;
} = {
  vertical: { track: "│", thumb: "┃" },
  horizontal: { track: "─", thumb: "━" },
  block: { track: "░", thumb: "█" },
  ascii: { track: "|", thumb: "#" },
  blank: { track: " ", thumb: "█" },
};

/**
 * Look of a scrollbar drawn by {@linkcode renderScrollbar}.
 *
 * @category Layout
 */
export interface ScrollbarOptions {
  /** Default `SCROLLBAR_GLYPHS.vertical`. */
  glyphs?: ScrollbarGlyphs;
  /** Paints for the track and thumb, each replacing its default. */
  theme?: ScrollbarTheme;
  /** Draw the thumb with `theme.thumbActive`, e.g. while it is hovered or dragged. */
  active?: boolean;
}

/**
 * A thumb's place on its track, in cells.
 *
 * @category Layout
 */
export interface ScrollbarThumb {
  /** Index of the thumb's first cell on the track. */
  readonly start: number;
  /** Number of cells the thumb covers. */
  readonly size: number;
}

const DEFAULT_THEME: Required<ScrollbarTheme> = {
  track: { fg: "#5c6370" },
  thumb: { fg: "#3fb5e8" },
  thumbActive: { bold: true },
};

/**
 * Where the thumb sits on a track of `length` cells for `total` content cells
 * of which the `length` starting at `offset` are visible. The size is
 * proportional to the visible share but at least one cell, and below the
 * track length whenever there is something to scroll (so the thumb can
 * move). The thumb touches the start only at offset 0 and the end only at the
 * last offset, `total - length`. With nothing to scroll it fills the track.
 *
 * @param length Cells of the track, which is also the number of visible content cells.
 * @param total Content cells, visible or not.
 * @param offset Index of the first visible content cell; clamped to the valid range.
 * @returns The thumb's first cell and size on the track.
 *
 * @example Place the thumb for a scrolled list
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { scrollbarThumb } from "@neonbyte/tui";
 *
 * // 10 rows visible out of 20.
 * assertEquals(scrollbarThumb(10, 20, 0), { start: 0, size: 5 });
 * assertEquals(scrollbarThumb(10, 20, 10), { start: 5, size: 5 });
 * ```
 *
 * @category Layout
 */
export function scrollbarThumb(
  length: number,
  total: number,
  offset: number,
): ScrollbarThumb {
  if (length < 1 || total <= length) {
    return { start: 0, size: Math.max(0, length) };
  }

  const size = thumbSize(length, total);
  const room = length - size;
  const last = total - length;
  const at = Math.min(Math.max(0, offset), last);

  if (room < 1) {
    return { start: 0, size };
  }

  let start = Math.round(at / last * room);

  if (at > 0 && start < 1) {
    start = 1;
  }

  if (at < last && start > room - 1) {
    start = room - 1;
  }

  return { start: Math.min(Math.max(0, start), room), size };
}

/** Thumb length for a scrollable track: proportional, at least 1, less than `length` when it has room to move. */
function thumbSize(length: number, total: number): number {
  const proportional = Math.max(1, Math.round(length * length / total));

  return length > 1 ? Math.min(proportional, length - 1) : 1;
}

/**
 * The scroll offset for a thumb whose first cell is at `thumbStart`: the
 * inverse of {@link scrollbarThumb}, for dragging. Positions outside the track
 * give the first or last offset.
 *
 * @param length Cells of the track.
 * @param total Content cells, visible or not.
 * @param thumbStart Index of the thumb's first cell, e.g. under the pointer.
 * @returns The offset of the first visible content cell, between 0 and `total - length`.
 *
 * @example Turn a drag position into a scroll offset
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { scrollbarOffset } from "@neonbyte/tui";
 *
 * assertEquals(scrollbarOffset(10, 20, 0), 0);
 * assertEquals(scrollbarOffset(10, 20, 5), 10);
 * assertEquals(scrollbarOffset(10, 20, 99), 10);
 * ```
 *
 * @category Layout
 */
export function scrollbarOffset(
  length: number,
  total: number,
  thumbStart: number,
): number {
  if (length < 1 || total <= length) {
    return 0;
  }

  const room = length - thumbSize(length, total);
  const last = total - length;

  if (room < 1) {
    return 0;
  }

  return Math.min(Math.max(0, Math.round(thumbStart / room * last)), last);
}

/**
 * A scrollbar as one painted cell per track position, for a vertical bar
 * (one per row) or a horizontal one (join them). `length` is the visible
 * cells, `total` the content cells and `offset` the first visible one. When
 * everything fits, only the track is drawn.
 *
 * @param length Visible cells, the number of cells returned.
 * @param total Content cells, visible or not.
 * @param offset Index of the first visible content cell.
 * @param options Glyphs, paints and active state; see {@linkcode ScrollbarOptions}.
 * @returns One painted cell per track position.
 *
 * @example Draw a vertical bar
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { renderScrollbar, SCROLLBAR_GLYPHS } from "@neonbyte/tui";
 *
 * const bar = renderScrollbar(4, 8, 0, {
 *   glyphs: SCROLLBAR_GLYPHS.ascii,
 *   theme: { track: {}, thumb: {} },
 * });
 *
 * assertEquals(bar, ["#", "#", "|", "|"]);
 * ```
 *
 * @category Layout
 */
export function renderScrollbar(
  length: number,
  total: number,
  offset: number,
  options: ScrollbarOptions = {},
): string[] {
  const count = Math.max(0, Math.floor(length));
  const glyphs = options.glyphs ?? SCROLLBAR_GLYPHS.vertical;
  const theme = { ...DEFAULT_THEME, ...options.theme };
  const track = paint(glyphs.track, theme.track);
  const thumb = paint(
    glyphs.thumb,
    options.active === true
      ? mergePaint(theme.thumb, theme.thumbActive)
      : theme.thumb,
  );

  if (total <= count) {
    return Array.from({ length: count }, () => track);
  }

  const { start, size } = scrollbarThumb(count, total, offset);

  return Array.from(
    { length: count },
    (_, i) => i >= start && i < start + size ? thumb : track,
  );
}
