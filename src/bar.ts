import {
  hexToRgb,
  mergePaint,
  mixColors,
  type Paint,
  paintTransition,
} from "./style.ts";
import { visibleWidth } from "./width.ts";

/**
 * Characters a bar is drawn with. Every glyph must be exactly one cell wide.
 *
 * @category Progress & status
 */
export interface BarGlyphs {
  /** A completely filled cell. */
  readonly full: string;
  /** An unfilled cell. */
  readonly empty: string;
  /** Partly filled cells, least filled first; `n` entries split a cell into `n + 1` steps. */
  readonly partials?: readonly string[];
  /** Drawn in the first unfilled cell when it shows no partial fill, like `>` in `===>`. */
  readonly head?: string;
  /** Caps around the cells, like `[` and `]`. */
  readonly left?: string;
  /** Right cap. */
  readonly right?: string;
}

/**
 * Built-in glyph sets for {@linkcode BarGlyphs}: `blocks`, `shade`, `dots`,
 * `thin`, `rail`, `arrow`, `ascii` and `segments`.
 *
 * @category Progress & status
 */
export const BAR_GLYPHS = {
  /** `███████▍    ` in eighths of a cell; give the track a background to show its extent. */
  blocks: {
    full: "█",
    empty: " ",
    partials: ["▏", "▎", "▍", "▌", "▋", "▊", "▉"],
  },
  /** `██████▓░░░░░` */
  shade: { full: "█", empty: "░", partials: ["▒", "▓"] },
  /** `⣿⣿⣿⣿⣶⣀⣀⣀⣀` braille, filling from the bottom. */
  dots: { full: "⣿", empty: "⣀", partials: ["⣤", "⣶"] },
  /** `━━━━━━╸─────` like pip and rich. */
  thin: { full: "━", empty: "─", partials: ["╸"] },
  /** `▶──────────◀` one line; fill and track differ only by their paint. */
  rail: { full: "─", empty: "─", left: "▶", right: "◀" },
  /** `[======>     ]` */
  arrow: { full: "=", empty: " ", head: ">", left: "[", right: "]" },
  /** `[######......]` for terminals or fonts without box-drawing glyphs. */
  ascii: { full: "#", empty: ".", left: "[", right: "]" },
  /** `▰▰▰▰▱▱▱▱` whole cells only; set the bar width to the step count for one cell per step. */
  segments: { full: "▰", empty: "▱" },
} as const satisfies Record<string, BarGlyphs>;

/**
 * What a cell shows: filled, the partly filled edge cell, the head glyph, or unfilled track.
 *
 * @category Progress & status
 */
export type BarCellKind = "fill" | "partial" | "head" | "track";

/**
 * Where a cell sits, passed to a {@linkcode CellPaint}.
 *
 * @category Progress & status
 */
export interface BarCell {
  /** 0 is the leftmost cell. */
  readonly index: number;
  /** Number of cells in the bar. */
  readonly cells: number;
  /** What the cell shows. */
  readonly kind: BarCellKind;
  /** Stacked part a filled cell shows (0 for a single value); -1 on the track. */
  readonly part: number;
  /** Index into `theme.sections` of the section holding the cell's centre, or -1. */
  readonly section: number;
  /** Overall fill, 0 to 1. */
  readonly ratio: number;
}

/**
 * Per-cell paint merged over the theme's, e.g. a gradient.
 *
 * @category Progress & status
 */
export type CellPaint = (cell: BarCell) => Paint | undefined;

/**
 * A zone of the bar with its own paints and glyphs, like a warning zone past 80%.
 *
 * @category Progress & status
 */
export interface BarSection {
  /** The section holds cells whose centre is before this fraction (0 to 1) and not in an earlier section. */
  readonly until: number;
  /** Merged over `theme.fill` for filled cells in the section. */
  readonly fill?: Paint;
  /** Merged over `theme.track` for unfilled cells in the section. */
  readonly track?: Paint;
  /** Glyph overrides for filled and unfilled cells in the section. */
  readonly full?: string;
  /** Glyph for unfilled cells in the section. */
  readonly empty?: string;
}

/**
 * Paints for each element of a bar. Later, more specific paints merge over earlier ones.
 *
 * @category Progress & status
 */
export interface BarTheme {
  /** Filled cells. */
  readonly fill?: Paint;
  /** Unfilled cells. */
  readonly track?: Paint;
  /** The partly filled edge cell. Default: the track's paint with the fill colour (fill fg, else fill bg) as foreground. */
  readonly partial?: Paint;
  /** The head glyph; merged over the fill. */
  readonly head?: Paint;
  /** The caps. */
  readonly left?: Paint;
  /** Paint of the right cap. */
  readonly right?: Paint;
  /** Labels and markers merge over the paint of the cell they cover, so they keep its background. */
  readonly edgeLabel?: Paint;
  /** Paint of the text at the right end of the bar. */
  readonly endLabel?: Paint;
  /** Default for every marker; a marker's own paint merges over it. */
  readonly marker?: Paint;
  /** The shimmer cell. Default bright white, bold. */
  readonly highlight?: Paint;
  /** Zones along the bar, in order. */
  readonly sections?: readonly BarSection[];
  /** Per stacked part, merged over the fill (and section fill). */
  readonly parts?: readonly Paint[];
}

/**
 * A fixed indicator drawn over the bar, like a limit or a target.
 *
 * @category Progress & status
 */
export interface BarMarker {
  /** Position, 0 (left edge) to 1 (right edge). */
  readonly at: number;
  /** One cell wide. Default `│`. */
  readonly glyph?: string;
  /** Merged over the theme's marker paint. */
  readonly paint?: Paint;
}

/**
 * Options of {@linkcode renderBar}.
 *
 * @category Progress & status
 */
export interface BarRenderOptions {
  /** Default `BAR_GLYPHS.blocks`. */
  glyphs?: BarGlyphs;
  /** Paints for the fill, track, caps, labels and sections. Default: none, so the bar is unpainted. */
  theme?: BarTheme;
  /** Merged over the theme's paint for each cell. */
  cellPaint?: CellPaint;
  /** Index of a filled cell drawn with `theme.highlight` (the shimmer). */
  highlight?: number;
  /** Drawn over the cells they fall on, after the fill. */
  markers?: readonly BarMarker[];
  /** Text over the track just past the fill edge, so it moves with the fill. May contain styles. */
  edgeLabel?: string;
  /** Text over the right end of the cells, inside the right cap. May contain styles. */
  endLabel?: string;
  /** Fill these cells instead of filling from the left; `parts` is then ignored (indeterminate bars). */
  segment?: { readonly start: number; readonly length: number };
}

const DEFAULT_HIGHLIGHT: Paint = { fg: "brightWhite", bold: true };
/** Switches off every attribute a Paint can set, after text with its own escapes. */
const PAINT_OFF = "\x1b[39;49;22;23;24;27;29m";
/** Absorbs float error so that e.g. 0.3 of 10 cells is exactly 3 cells. */
const EPSILON = 1e-9;

/**
 * Number of fully filled cells for `ratio` (0 to 1) of `cells`, rounded down.
 *
 * @param ratio Filled fraction; clamped to 0 to 1.
 * @param cells Number of cells in the bar.
 * @returns Whole cells filled, from 0 to `cells`.
 *
 * @example Count the filled cells
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { filledCells } from "@neonbyte/tui";
 *
 * assertEquals(filledCells(0.3, 10), 3);
 * assertEquals(filledCells(0.39, 10), 3);
 * assertEquals(filledCells(2, 10), 10);
 * ```
 *
 * @category Progress & status
 */
export function filledCells(ratio: number, cells: number): number {
  return Math.floor(Math.min(1, Math.max(0, ratio)) * cells + EPSILON);
}

/**
 * Cells taken by the caps of `glyphs`.
 *
 * @param glyphs The glyph set whose `left` and `right` caps are measured.
 * @returns The combined width of both caps; 0 when there are none.
 *
 * @example Reserve room for the caps
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { BAR_GLYPHS, capsWidth } from "@neonbyte/tui";
 *
 * assertEquals(capsWidth(BAR_GLYPHS.ascii), 2);
 * assertEquals(capsWidth(BAR_GLYPHS.blocks), 0);
 * ```
 *
 * @category Progress & status
 */
export function capsWidth(glyphs: BarGlyphs): number {
  return visibleWidth(glyphs.left ?? "") + visibleWidth(glyphs.right ?? "");
}

/**
 * Draw a bar of `cells` cells plus its caps. `parts` is the filled fraction
 * (0 to 1), or several fractions drawn one after another as a stacked bar.
 * Fill rounds down, so the bar is only full when the parts add up to 1.
 * Markers, then the end label, then the edge label are drawn over the cells.
 *
 * @param parts Filled fraction (0 to 1), or one fraction per stacked part.
 * @param cells Number of cells between the caps.
 * @param options Glyphs, paints, labels and markers; see {@linkcode BarRenderOptions}.
 * @returns The bar as one string, with ANSI styles where paints are set.
 * @throws {Error} When a paint in `options` (including those `options.cellPaint` returns) has an invalid colour; see {@linkcode Color}.
 *
 * @example Draw a half-filled bar
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { BAR_GLYPHS, renderBar } from "@neonbyte/tui";
 *
 * const bar = renderBar(0.5, 10, { glyphs: BAR_GLYPHS.ascii, theme: {} });
 *
 * assertEquals(bar, "[#####.....]");
 * ```
 *
 * @example Stack several parts
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { BAR_GLYPHS, renderBar } from "@neonbyte/tui";
 *
 * const bar = renderBar([0.5, 0.25], 8, { glyphs: BAR_GLYPHS.ascii, theme: {} });
 *
 * assertEquals(bar, "[######..]");
 * ```
 *
 * @category Progress & status
 */
export function renderBar(
  parts: number | readonly number[],
  cells: number,
  options: BarRenderOptions = {},
): string {
  const layout = barLayout(parts, cells, options);
  const { glyphs, theme } = layout;
  const { out, edge } = buildCells(layout, cells, options);

  applyMarkers(out, cells, options.markers ?? [], theme);
  placeLabels(out, edge, cells, options, theme);

  // Emit only the attribute changes between neighbouring cells.
  const text = new PaintedText();

  text.append(glyphs.left ?? "", theme.left ?? {});

  for (const cell of out) {
    text.append(cell.text, cell.paint);
  }

  text.append(glyphs.right ?? "", theme.right ?? {});

  return text.finish();
}

/** One drawn cell. A multi-cell label fills its first entry and blanks the rest. */
interface DrawnCell {
  text: string;
  paint: Paint;
}

/** What `renderBar` works out once per bar before looking at single cells. */
interface BarLayout {
  readonly glyphs: BarGlyphs;
  readonly theme: BarTheme;
  readonly sections: readonly BarSection[];
  readonly segment: BarRenderOptions["segment"];
  /** Cumulative end of each part. */
  readonly ends: readonly number[];
  /** The last part that has any fill. */
  readonly lastPart: number;
  readonly ratio: number;
  readonly partials: readonly string[];
  /** Fully filled cells. */
  readonly full: number;
  /** Fill beyond `full`, in partial-glyph steps. */
  readonly remainder: number;
}

function barLayout(
  parts: number | readonly number[],
  cells: number,
  options: BarRenderOptions,
): BarLayout {
  const glyphs: BarGlyphs = options.glyphs ?? BAR_GLYPHS.blocks;
  const theme = options.theme ?? {};
  const values = typeof parts === "number" ? [parts] : parts;
  const segment = options.segment;

  const ends: number[] = [];
  let sum = 0;
  let lastPart = 0;

  for (let i = 0; i < values.length; i++) {
    const value = Number.isFinite(values[i]) && values[i] > 0 ? values[i] : 0;

    if (value > 0) {
      lastPart = i;
    }

    sum += value;

    ends.push(Math.min(1, sum));
  }

  const ratio = segment ? 0 : Math.min(1, sum);

  const partials = glyphs.partials ?? [];
  const steps = partials.length + 1;
  const units = Math.floor(ratio * cells * steps + EPSILON);

  return {
    glyphs,
    theme,
    sections: theme.sections ?? [],
    segment,
    ends,
    lastPart,
    ratio,
    partials,
    full: Math.floor(units / steps),
    remainder: units % steps,
  };
}

/** One entry per cell, and the first cell past the fill (including a partial or head cell). */
function buildCells(
  layout: BarLayout,
  cells: number,
  options: BarRenderOptions,
): { out: DrawnCell[]; edge: number } {
  const { theme, sections } = layout;
  let edge = layout.full;
  const out: DrawnCell[] = [];

  for (let index = 0; index < cells; index++) {
    const centre = (index + 0.5) / cells;
    const section = sections.findIndex((s) => centre < s.until);
    const kind = cellKind(layout, index);

    if (kind === "partial" || kind === "head") {
      edge = layout.full + 1;
    }

    const part = cellPart(layout, kind, centre);
    const cell = cellContent(layout, kind, sections[section], part);
    let paint = mergePaint(
      cell.paint,
      options.cellPaint?.({
        index,
        cells,
        kind,
        part,
        section,
        ratio: layout.ratio,
      }),
    );

    if (index === options.highlight && kind !== "track") {
      paint = mergePaint(paint, theme.highlight ?? DEFAULT_HIGHLIGHT);
    }

    out.push({ text: cell.text, paint });
  }

  return { out, edge };
}

/** What cell `index` shows: the segment, or the fill with its partial or head cell. */
function cellKind(layout: BarLayout, index: number): BarCellKind {
  const { segment, full, remainder } = layout;

  if (segment) {
    const inside = index >= segment.start &&
      index < segment.start + segment.length;

    return inside ? "fill" : "track";
  }

  if (index < full) {
    return "fill";
  }

  if (index !== full) {
    return "track";
  }

  if (remainder > 0) {
    return "partial";
  }

  return layout.glyphs.head !== undefined && layout.ratio > 0
    ? "head"
    : "track";
}

/** The stacked part of the cell centred at `centre`, or -1 on the track. */
function cellPart(
  layout: BarLayout,
  kind: BarCellKind,
  centre: number,
): number {
  if (kind === "track") {
    return -1;
  }

  if (layout.segment) {
    return 0;
  }

  if (kind !== "fill") {
    return layout.lastPart;
  }

  // The part covering this cell's centre.
  const covering = layout.ends.findIndex((end) => end + EPSILON >= centre);

  return covering === -1
    ? layout.lastPart
    : Math.min(covering, layout.lastPart);
}

/** Glyph and paint (before `cellPaint` and the shimmer) of a cell of `kind`. */
function cellContent(
  layout: BarLayout,
  kind: BarCellKind,
  zone: BarSection | undefined,
  part: number,
): DrawnCell {
  const { glyphs, theme } = layout;
  const fill = mergePaint(
    theme.fill,
    zone?.fill,
    part >= 0 ? theme.parts?.[part] : undefined,
  );
  const track = mergePaint(theme.track, zone?.track);

  switch (kind) {
    case "fill":
      return { text: zone?.full ?? glyphs.full, paint: fill };
    case "partial":
      return {
        text: layout.partials[layout.remainder - 1],
        paint: mergePaint(track, { fg: fill.fg ?? fill.bg }, theme.partial),
      };
    case "head":
      return {
        text: glyphs.head ?? glyphs.full,
        paint: mergePaint(fill, theme.head),
      };
    case "track":
      return { text: zone?.empty ?? glyphs.empty, paint: track };
  }
}

/** Draw the markers over the cells they fall on. */
function applyMarkers(
  out: DrawnCell[],
  cells: number,
  markers: readonly BarMarker[],
  theme: BarTheme,
): void {
  for (const marker of markers) {
    if (!(marker.at >= 0 && marker.at <= 1) || cells === 0) {
      continue;
    }

    const index = Math.min(cells - 1, filledCells(marker.at, cells));

    out[index] = {
      text: marker.glyph ?? "│",
      paint: mergePaint(out[index].paint, theme.marker, marker.paint),
    };
  }
}

/** Draw `text` (`width` cells wide) from cell `start`, blanking the cells it covers. */
function placeText(
  out: DrawnCell[],
  start: number,
  text: string,
  width: number,
  p?: Paint,
): void {
  out[start] = { text, paint: mergePaint(out[start].paint, p) };

  for (let i = start + 1; i < start + width; i++) {
    out[i] = { text: "", paint: {} };
  }
}

/** Draw the end label at the right end, then the edge label past the fill. */
function placeLabels(
  out: DrawnCell[],
  edge: number,
  cells: number,
  options: BarRenderOptions,
  theme: BarTheme,
): void {
  let limit = cells; // cells left of the end label

  if (options.endLabel) {
    const width = visibleWidth(options.endLabel);

    if (width <= cells) {
      limit = cells - width;

      placeText(out, limit, options.endLabel, width, theme.endLabel);
    }
  }

  if (options.edgeLabel) {
    const width = visibleWidth(options.edgeLabel);
    // Past the fill when it fits, else pushed left over the fill.
    const start = Math.min(edge, limit - width);

    if (start >= 0) {
      placeText(out, start, options.edgeLabel, width, theme.edgeLabel);
    }
  }
}

/** Builds the bar's string, writing only the attribute changes between texts. */
class PaintedText {
  private result = "";
  private current: Paint = {};

  public append(text: string, p: Paint): void {
    if (text === "") {
      return;
    }

    this.result += paintTransition(this.current, p) + text;
    this.current = p;

    if (text.includes("\x1b")) {
      // The text's own escapes leave the attributes unknown.
      this.result += PAINT_OFF;
      this.current = {};
    }
  }

  /** The text so far, with every attribute switched off at the end. */
  public finish(): string {
    return this.result + paintTransition(this.current, {});
  }
}

/** Paint for a partial cell: its glyph carries the fill colour; the background stays the track's. */
function partialSafe(cell: BarCell, p: Paint): Paint {
  return cell.kind === "partial" ? { fg: p.fg ?? p.bg } : p;
}

/**
 * Colour filled cells along `stops` (`#rrggbb`, at least one) with 24-bit
 * colour: by each cell's position across the bar, or all cells by the
 * overall progress (e.g. red to green as the bar fills). `layer: "bg"` colours
 * the background, for fills drawn with spaces.
 *
 * @param stops Colours as `#rrggbb`, blended between neighbours; at least one.
 * @param options `by` picks position (default) or overall progress as the blend position; `layer` picks `"fg"` (default) or `"bg"`.
 * @returns A {@linkcode CellPaint} for {@linkcode BarRenderOptions.cellPaint}; track cells stay unpainted.
 * @throws {Error} When `stops` is empty, or a stop is not of the form `#rrggbb`.
 *
 * @example Colour a bar from red to green
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { gradient } from "@neonbyte/tui";
 *
 * const paintFor = gradient(["#ff0000", "#00ff00"]);
 * const cell = { cells: 5, kind: "fill", part: 0, section: -1, ratio: 1 } as const;
 *
 * assertEquals(paintFor({ ...cell, index: 0 }), { fg: "#ff0000" });
 * assertEquals(paintFor({ ...cell, index: 4 }), { fg: "#00ff00" });
 * ```
 *
 * @category Progress & status
 */
export function gradient(
  stops: readonly `#${string}`[],
  options: { by?: "position" | "progress"; layer?: "fg" | "bg" } = {},
): CellPaint {
  if (stops.length === 0) {
    throw new Error("gradient() needs at least one stop");
  }

  for (const stop of stops) {
    hexToRgb(stop);
  } // fail at creation, not mid-render

  return (cell) => {
    if (cell.kind === "track") {
      return undefined;
    }

    let t = 0;

    if (options.by === "progress") {
      t = cell.ratio;
    } else if (cell.cells > 1) {
      t = cell.index / (cell.cells - 1);
    }

    const scaled = t * (stops.length - 1);
    const from = Math.min(stops.length - 1, Math.floor(scaled));
    const to = Math.min(stops.length - 1, from + 1);
    const color = mixColors(stops[from], stops[to], scaled - from);

    return partialSafe(
      cell,
      options.layer === "bg" ? { bg: color } : { fg: color },
    );
  };
}

/**
 * Paint filled cells by overall progress: the first `[limit, paint]` whose
 * limit is above the ratio applies, else the last. For a budget meter:
 * `thresholds([[0.7, { fg: "green" }], [0.9, { fg: "yellow" }], [1, { fg: "red" }]])`.
 *
 * @param stops `[limit, paint]` pairs in ascending order of `limit` (0 to 1); at least one.
 * @returns A {@linkcode CellPaint} for {@linkcode BarRenderOptions.cellPaint} that paints filled cells only.
 * @throws {Error} When `stops` is empty.
 *
 * @example Turn a budget meter red near the limit
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { thresholds } from "@neonbyte/tui";
 *
 * const paintFor = thresholds([
 *   [0.7, { fg: "green" }],
 *   [0.9, { fg: "yellow" }],
 *   [1, { fg: "red" }],
 * ]);
 * const cell = { index: 0, cells: 10, kind: "fill", part: 0, section: -1 } as const;
 *
 * assertEquals(paintFor({ ...cell, ratio: 0.5 }), { fg: "green" });
 * assertEquals(paintFor({ ...cell, ratio: 0.95 }), { fg: "red" });
 * ```
 *
 * @category Progress & status
 */
export function thresholds(
  stops: readonly (readonly [number, Paint])[],
): CellPaint {
  if (stops.length === 0) {
    throw new Error("thresholds() needs at least one stop");
  }

  return (cell) => {
    if (cell.kind === "track") {
      return undefined;
    }

    const [, p] = stops.find(([limit]) => cell.ratio < limit) ?? stops.at(-1)!;

    return partialSafe(cell, p);
  };
}
