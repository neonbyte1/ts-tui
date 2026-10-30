import type { MouseInput } from "../keys.ts";
import { type Paint, paint } from "../style.ts";
import { type Component, forwardMouse } from "../tui.ts";
import { sliceColumns } from "../width.ts";

/**
 * Cells (`30`) or a share of the space left after the dividers (`"25%"`).
 *
 * @category Layout
 */
export type PaneSize = number | `${number}%`;

/**
 * One pane of a {@linkcode Panes}: its component and size limits.
 *
 * @category Layout
 */
export interface PaneSpec {
  /** What the pane shows, rendered at the pane's exact width (and height). */
  readonly component: Component;
  /** Fixed cells or a percentage. Omitted: a flexible pane that shares what the others leave equally. */
  readonly size?: PaneSize;
  /** Smallest size in cells. Default 1. */
  readonly min?: number;
  /** Largest size in cells. Default unbounded. */
  readonly max?: number;
}

/**
 * Divider paints. Unset fields keep their defaults.
 *
 * @category Layout
 */
export interface PanesTheme {
  /** Default grey `#5c6370`. */
  readonly divider?: Paint;
  /** The divider under the pointer. Default cyan `#3fb5e8`. */
  readonly dividerHover?: Paint;
  /** The divider while it is being dragged. Default cyan `#3fb5e8`. */
  readonly dividerDragging?: Paint;
}

/**
 * The cell drawn between panes in each layout direction; each must be one cell wide.
 *
 * @category Layout
 */
export interface PanesGlyphs {
  /** Between side-by-side panes (`direction: "horizontal"`), repeated down the divider column. */
  readonly horizontal: string;
  /** Between stacked panes (`direction: "vertical"`), repeated along the divider row. */
  readonly vertical: string;
}

/**
 * Built-in divider sets: `line` (the default), `heavy`, `double`, `ascii`, and `blank` for no visible divider.
 *
 * @category Layout
 */
export const PANES_GLYPHS: {
  readonly [Name in "line" | "heavy" | "double" | "ascii" | "blank"]:
    PanesGlyphs;
} = {
  line: { horizontal: "│", vertical: "─" },
  heavy: { horizontal: "┃", vertical: "━" },
  double: { horizontal: "║", vertical: "═" },
  ascii: { horizontal: "|", vertical: "-" },
  blank: { horizontal: " ", vertical: " " },
};

/**
 * Direction, panes, look and behaviour of a {@linkcode Panes}.
 *
 * @category Layout
 */
export interface PanesOptions {
  /** `"horizontal"` puts panes side by side, `"vertical"` stacks them. */
  direction: "horizontal" | "vertical";
  /** The panes, in order from left to right or top to bottom. */
  panes: readonly PaneSpec[];
  /**
   * Rows for the whole layout when the parent passes no height. A vertical
   * layout needs this or a render height; a horizontal one defaults to its
   * tallest pane.
   */
  height?: number | (() => number);
  /** The divider cell for each direction. Default `PANES_GLYPHS.line`. */
  glyphs?: Partial<PanesGlyphs>;
  /** Paints for the divider in its normal, hovered and dragged states. */
  theme?: PanesTheme;
  /** Let the pointer drag dividers. Default true. */
  resizable?: boolean;
  /** Called with the sizes in cells whenever dragging or `resizeBy` changes them. */
  onResize?: (sizes: readonly number[]) => void;
}

interface PaneState {
  component: Component;
  size: PaneSize | undefined;
  min: number;
  max: number;
  cut: CutRows | undefined;
}

/** A pane's rows cut to its cell, kept while the child returns the same array. */
interface CutRows {
  readonly source: readonly string[];
  readonly width: number;
  readonly height: number | undefined;
  readonly rows: readonly string[];
}

/** What the layout needs of one pane: a target size in cells (`undefined` for flexible) and its bounds. */
interface Bounds {
  readonly target: number | undefined;
  readonly min: number;
  readonly max: number;
}

const DEFAULT_THEME: Required<PanesTheme> = {
  divider: { fg: "#5c6370" },
  dividerHover: { fg: "#3fb5e8" },
  dividerDragging: { fg: "#3fb5e8" },
};
const PERCENT = /^(\d+(?:\.\d+)?)%$/;

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** A size as cells, `p% of available` as a float; `undefined` stays flexible. */
function targetCells(
  size: PaneSize | undefined,
  available: number,
): number | undefined {
  if (typeof size === "string") {
    return available * Number(PERCENT.exec(size)?.[1]) / 100;
  }

  return size;
}

/**
 * Equal shares of `pool` among panes, with panes that cannot take their
 * share held at their bound and the rest re-shared (the CSS flex rule).
 */
function waterFill(pool: number, bounds: readonly Bounds[]): number[] {
  const sizes: number[] = bounds.map(() => 0);
  let free = bounds.map((_, i) => i);
  let room = pool;

  while (free.length > 0) {
    const share = room / free.length;
    const low = free.filter((i) => share < bounds[i].min);
    const high = free.filter((i) => share > bounds[i].max);

    if (low.length === 0 && high.length === 0) {
      for (const i of free) {
        sizes[i] = share;
      }

      break;
    }

    const deficit = sum(low.map((i) => bounds[i].min - share));
    const excess = sum(high.map((i) => share - bounds[i].max));
    const held = deficit >= excess ? low : high;

    for (const i of held) {
      sizes[i] = deficit >= excess ? bounds[i].min : bounds[i].max;
      room -= sizes[i];
    }

    free = free.filter((i) => !held.includes(i));
  }

  return sizes;
}

/** Sizes before rounding: targets clamped to their bounds, flexible panes sharing the rest. */
function floatSizes(available: number, panes: readonly Bounds[]): number[] {
  const sizes = panes.map((pane) =>
    pane.target === undefined
      ? 0
      : Math.min(Math.max(pane.target, pane.min), pane.max)
  );
  const flexible = panes.flatMap((pane, i) =>
    pane.target === undefined ? [i] : []
  );
  const shares = waterFill(
    available - sum(sizes),
    flexible.map((i) => panes[i]),
  );

  flexible.forEach((pane, k) => {
    sizes[pane] = shares[k];
  });

  return sizes;
}

/** Round to whole cells keeping the total, giving the extra cells to the largest fractions (earlier panes on ties). */
function roundSizes(floats: readonly number[]): number[] {
  const floors = floats.map((size) => Math.floor(size + 1e-9));
  const extra = Math.round(sum(floats)) - sum(floors);
  const order = floats
    .map((size, i) => ({ i, fraction: size - floors[i] }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i);

  for (const { i } of order.slice(0, Math.max(0, extra))) {
    floors[i] += 1;
  }

  return floors;
}

/** Move the sizes' total to `available` by growing or shrinking from the last pane backwards, within `limit`'s bounds. */
function absorb(
  sizes: number[],
  available: number,
  limit: (i: number) => readonly [number, number],
): void {
  let diff = available - sum(sizes);

  for (let i = sizes.length - 1; i >= 0 && diff !== 0; i--) {
    const [low, high] = limit(i);
    const next = Math.min(Math.max(sizes[i] + diff, low), high);

    diff -= next - sizes[i];
    sizes[i] = next;
  }
}

/**
 * Whole-cell sizes for `panes` that add up to `available`: fixed and
 * percentage panes at their targets, flexible ones sharing the rest, every
 * pane within its bounds. When the bounds make that impossible the last panes
 * give way first, below their minimum if they must.
 */
function resolveSizes(available: number, panes: readonly Bounds[]): number[] {
  const total = Math.max(0, available);
  const sizes = roundSizes(floatSizes(total, panes));

  absorb(sizes, total, (i) => [panes[i].min, panes[i].max]);
  absorb(sizes, total, () => [0, Number.POSITIVE_INFINITY]);

  return sizes;
}

const EMPTY: readonly string[] = [];

function checkSize(size: PaneSize | undefined): void {
  if (typeof size === "string" && !PERCENT.test(size)) {
    throw new RangeError(`Invalid pane size "${size}"`);
  }
}

/** A hit on the layout: a pane or the divider after a pane. */
type Hit = { readonly pane: number } | { readonly divider: number };

/**
 * A resizable split layout. Horizontal panes sit side by side with a one-cell
 * divider between; vertical ones stack with a divider row. Every pane gets
 * its exact cells: children render at the pane's width (and height) and their
 * rows are cut or padded to it, with styles closed at the edge, so colours
 * never reach the next pane. Panes nest: an inner Panes is just a child.
 *
 * Sizes follow the terminal: fixed panes keep their cells, percentages scale,
 * flexible panes share the rest, and the whole always adds up to the space
 * available. Dragging a divider moves it between its two neighbours within
 * their min/max and turns both into fixed sizes; `resizeBy` does the same for
 * keyboard shortcuts. Mouse input goes to the pane under the pointer in its
 * own cells.
 *
 * @example Two panes side by side
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Panes, Text } from "@neonbyte/tui";
 *
 * const panes = new Panes({
 *   direction: "horizontal",
 *   theme: { divider: {} }, // unpainted divider, for plain rows
 *   panes: [
 *     { component: new Text("left") },
 *     { component: new Text("right"), size: 6 },
 *   ],
 * });
 *
 * assertEquals(panes.render(11), ["left│right "]);
 * assertEquals(panes.sizes, [4, 6]);
 * ```
 *
 * @category Layout
 */
export class Panes implements Component {
  private readonly options: PanesOptions;
  private readonly glyphs: PanesGlyphs;
  private theme: Required<PanesTheme>;
  private readonly panes: PaneState[];
  private resolved: number[] = [];
  private starts: number[] = [];
  private available = -1;
  private cross = 0;
  private hover = -1;
  private dragging = -1;
  private lastCuts: readonly CutRows[] = [];
  private cacheKey = "";
  private cache: readonly string[] = [];

  /**
   * Create a split layout.
   *
   * @param options Direction, panes, look and behaviour; see {@linkcode PanesOptions}.
   * @throws {RangeError} When a pane's `size` is a string that is not a non-negative percentage such as `"25%"`.
   */
  public constructor(options: PanesOptions) {
    this.options = options;
    this.theme = { ...DEFAULT_THEME, ...options.theme };
    this.glyphs = { ...PANES_GLYPHS.line, ...options.glyphs };
    this.panes = options.panes.map((pane) => {
      checkSize(pane.size);

      const min = Math.max(0, pane.min ?? 1);

      return {
        component: pane.component,
        size: pane.size,
        min,
        max: Math.max(min, pane.max ?? Number.POSITIVE_INFINITY),
        cut: undefined,
      };
    });
  }

  /** Current sizes in cells, one per pane, as of the last layout (empty before the first render). */
  public get sizes(): readonly number[] {
    return [...this.resolved];
  }

  /**
   * Replace every pane's size with cells or percentages, one per pane.
   *
   * @param sizes The new sizes, one per pane.
   * @throws {RangeError} When `sizes` does not have one entry per pane, or an entry is a string that is not a non-negative percentage such as `"25%"`.
   *
   * @example Make the left pane narrower
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Panes, Text } from "@neonbyte/tui";
   *
   * const panes = new Panes({
   *   direction: "horizontal",
   *   panes: [{ component: new Text("a") }, { component: new Text("b") }],
   * });
   *
   * panes.render(11);
   * assertEquals(panes.sizes, [5, 5]);
   *
   * panes.setSizes([3, "70%"]);
   * assertEquals(panes.sizes, [3, 7]);
   * ```
   */
  public setSizes(sizes: readonly PaneSize[]): void {
    if (sizes.length !== this.panes.length) {
      throw new RangeError(
        `Expected ${this.panes.length} sizes, got ${sizes.length}`,
      );
    }

    sizes.forEach(checkSize);
    sizes.forEach((size, i) => {
      this.panes[i].size = size;
    });

    this.relayout();
  }

  /**
   * Replace the component of the pane at `index`.
   *
   * @param index Index of the pane.
   * @param component The new content.
   * @throws {RangeError} When there is no pane at `index`.
   *
   * @example Swap a pane's content
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Panes, Text } from "@neonbyte/tui";
   *
   * const panes = new Panes({
   *   direction: "horizontal",
   *   theme: { divider: {} },
   *   panes: [{ component: new Text("left") }, { component: new Text("old") }],
   * });
   *
   * panes.setPane(1, new Text("new"));
   * assertEquals(panes.render(11), ["left │new  "]);
   * ```
   */
  public setPane(index: number, component: Component): void {
    const pane = this.paneAt(index);

    pane.component = component;
    pane.cut = undefined;

    this.cacheKey = "";
  }

  /**
   * Replace some divider paints; others keep their values. Request a render afterwards.
   *
   * @param theme The paints to change; see {@linkcode PanesTheme}.
   *
   * @example Recolour the divider
   * ```ts
   * import { assert } from "@std/assert";
   * import { Panes, Text } from "@neonbyte/tui";
   *
   * const panes = new Panes({
   *   direction: "horizontal",
   *   panes: [{ component: new Text("a") }, { component: new Text("b") }],
   * });
   *
   * panes.setTheme({ divider: { fg: "#ff0000" } });
   * assert(panes.render(5)[0].includes("\x1b[38;2;255;0;0m"));
   * ```
   */
  public setTheme(theme: PanesTheme): void {
    this.theme = { ...this.theme, ...theme };
    this.cacheKey = "";
  }

  /**
   * Move the divider after pane `divider` by `cells` (negative: towards the
   * start) within its neighbours' bounds; both become fixed sizes. Nothing
   * moves before the first render.
   *
   * @param divider Index of the pane before the divider.
   * @param cells Cells to move the divider; negative moves it towards the start.
   * @returns Whether anything moved.
   * @throws {RangeError} When there is no pane after the divider.
   *
   * @example Resize from the keyboard
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Panes, Text } from "@neonbyte/tui";
   *
   * const panes = new Panes({
   *   direction: "horizontal",
   *   panes: [{ component: new Text("a") }, { component: new Text("b") }],
   *   onResize: (sizes) => assertEquals(sizes, [7, 3]),
   * });
   *
   * panes.render(11);
   * assertEquals(panes.resizeBy(0, 2), true);
   * assertEquals(panes.sizes, [7, 3]);
   * ```
   */
  public resizeBy(divider: number, cells: number): boolean {
    this.paneAt(divider + 1);

    if (divider < 0 || divider >= this.resolved.length) {
      return false;
    }

    return this.resizeTo(divider, this.resolved[divider] + cells);
  }

  public invalidate(): void {
    this.cacheKey = "";

    for (const pane of this.panes) {
      pane.cut = undefined;

      pane.component.invalidate?.();
    }
  }

  /**
   * Start, drag and end divider drags, or pass the event on to the pane under the pointer.
   *
   * @param event The mouse report, relative to the layout.
   * @returns Whether the layout or a pane handled the event.
   */
  public handleMouse(event: MouseInput): boolean {
    if (this.dragging >= 0) {
      return this.dragMouse(event);
    }

    const hit = event.action === "leave" ? undefined : this.hitTest(event);

    this.hover = hit !== undefined && "divider" in hit ? hit.divider : -1;

    if (hit === undefined) {
      return false;
    }

    if ("divider" in hit) {
      return this.dividerMouse(event, hit.divider);
    }

    const start = this.starts[hit.pane];
    const component = this.panes[hit.pane].component;

    return this.vertical
      ? forwardMouse(component, event, 0, start)
      : forwardMouse(component, event, start, 0);
  }

  /**
   * Draw the panes with their dividers.
   *
   * @param width Available width in cells.
   * @param height Rows for the layout. Default: the `height` option, then the tallest pane for a horizontal layout.
   * @returns The rendered rows.
   * @throws {Error} When the layout is vertical and neither the `height` option nor `height` is given.
   */
  public render(width: number, height?: number): readonly string[] {
    const rows = height ?? this.givenHeight();

    if (this.vertical && rows === undefined) {
      throw new Error(
        "Panes: a vertical layout needs a height option or a render height",
      );
    }

    const axis = this.vertical ? (rows ?? 0) : width;
    const sizes = this.layout(axis - this.gaps);
    const cuts = this.panes.map((pane, i) =>
      this.vertical
        ? this.cut(pane, width, sizes[i])
        : this.cut(pane, sizes[i], rows)
    );
    const tall = rows ?? Math.max(0, ...cuts.map((cut) => cut.rows.length));
    const key = [width, rows, this.hover, this.dragging].join("\0");

    this.cross = this.vertical ? width : tall;

    if (
      key === this.cacheKey && cuts.every((cut, i) => cut === this.lastCuts[i])
    ) {
      return this.cache;
    }

    this.cacheKey = key;
    this.lastCuts = cuts;
    this.cache = this.vertical
      ? this.stack(cuts, sizes, width, rows ?? 0)
      : this.sideBySide(cuts, sizes, width, tall);

    return this.cache;
  }

  /** Whether the panes are stacked. */
  private get vertical(): boolean {
    return this.options.direction === "vertical";
  }

  /** Divider cells between the panes. */
  private get gaps(): number {
    return Math.max(0, this.panes.length - 1);
  }

  /** The `height` option as rows, if set. */
  private givenHeight(): number | undefined {
    const height = this.options.height;

    return typeof height === "function" ? height() : height;
  }

  /** The pane at `index`; throws a `RangeError` when there is none. */
  private paneAt(index: number): PaneState {
    if (!Number.isInteger(index) || index < 0 || index >= this.panes.length) {
      throw new RangeError(`No pane at index ${index}`);
    }

    return this.panes[index];
  }

  /** Resolve sizes for `available` cells along the split axis. */
  private layout(available: number): readonly number[] {
    this.available = Math.max(0, available);

    this.relayout();

    return this.resolved;
  }

  /** Recompute sizes and pane start cells from the panes' size specs and the last known space. */
  private relayout(): void {
    if (this.available < 0) {
      return;
    }

    this.resolved = resolveSizes(
      this.available,
      this.panes.map((pane) => ({
        target: targetCells(pane.size, this.available),
        min: pane.min,
        max: pane.max,
      })),
    );

    let at = 0;

    this.starts = this.resolved.map((size) => {
      const start = at;

      at += size + 1;

      return start;
    });
  }

  /** The pane's rows cut or padded to `width` cells (and `height` rows when known). */
  private cut(
    pane: PaneState,
    width: number,
    height: number | undefined,
  ): CutRows {
    const empty = width < 1 || height === 0;
    const source = empty ? EMPTY : pane.component.render(width, height);
    const old = pane.cut;

    if (
      old !== undefined && old.source === source && old.width === width &&
      old.height === height
    ) {
      return old;
    }

    const lines = height === undefined ? source : source.slice(0, height);
    const cut = {
      source,
      width,
      height,
      rows: empty ? EMPTY : lines.map((row) => sliceColumns(row, 0, width)),
    };

    pane.cut = cut;

    return cut;
  }

  /** The painted divider cell after pane `index`, by its hover and drag state. */
  private dividerCell(index: number): string {
    const { divider, dividerHover, dividerDragging } = this.theme;
    const glyph = this.vertical ? this.glyphs.vertical : this.glyphs.horizontal;

    if (this.dragging === index) {
      return paint(glyph, dividerDragging);
    }

    return paint(glyph, this.hover === index ? dividerHover : divider);
  }

  /** The rows of side-by-side panes with their divider cells. */
  private sideBySide(
    cuts: readonly CutRows[],
    sizes: readonly number[],
    width: number,
    rows: number,
  ): string[] {
    const dividers = cuts.map((_, i) =>
      i < cuts.length - 1 ? this.dividerCell(i) : ""
    );
    const blanks = sizes.map((size) => " ".repeat(size));

    return Array.from({ length: rows }, (_, r) => {
      const row = cuts.map((cut, i) => (cut.rows[r] ?? blanks[i]) + dividers[i])
        .join("");

      return width < this.gaps ? sliceColumns(row, 0, width) : row;
    });
  }

  /** The rows of stacked panes with their divider rows, cut to `rows`. */
  private stack(
    cuts: readonly CutRows[],
    sizes: readonly number[],
    width: number,
    rows: number,
  ): string[] {
    const blank = " ".repeat(width);
    const lines = cuts.flatMap((cut, i) => {
      const body = Array.from(
        { length: sizes[i] },
        (_, r) => cut.rows[r] ?? blank,
      );

      return i < cuts.length - 1
        ? [...body, this.dividerCell(i).repeat(width)]
        : body;
    });

    return lines.slice(0, rows);
  }

  /** The pane or divider at `event`, in this layout's cells. */
  private hitTest(event: MouseInput): Hit | undefined {
    const along = this.vertical ? event.y : event.x;
    const across = this.vertical ? event.x : event.y;

    if (along < 0 || across < 0 || across >= this.cross) {
      return undefined;
    }

    for (let i = 0; i < this.resolved.length; i++) {
      const end = this.starts[i] + this.resolved[i];

      if (along < end) {
        return { pane: i };
      }

      if (along === end && i < this.resolved.length - 1) {
        return this.options.resizable === false ? undefined : { divider: i };
      }
    }

    return undefined;
  }

  /** Start a drag on a left press on the divider; hovering counts as handled. */
  private dividerMouse(event: MouseInput, divider: number): boolean {
    if (event.action === "press" && event.button === "left") {
      this.dragging = divider;

      return true;
    }

    return event.action === "move";
  }

  /** Resize while dragging; a release ends the drag. */
  private dragMouse(event: MouseInput): boolean {
    if (event.action === "drag") {
      const along = this.vertical ? event.y : event.x;

      this.resizeTo(this.dragging, along - this.starts[this.dragging]);
    } else if (event.action === "release") {
      const hit = this.hitTest(event);
      const over = hit !== undefined && "divider" in hit &&
        hit.divider === this.dragging;

      this.hover = over ? this.dragging : -1;
      this.dragging = -1;
    }

    return true;
  }

  /** Give pane `index` `size` cells at the expense of (or to) the next pane, within both panes' bounds. */
  private resizeTo(index: number, size: number): boolean {
    const left = this.paneAt(index);
    const right = this.paneAt(index + 1);
    const current = this.resolved[index];
    const total = current + this.resolved[index + 1];
    const low = Math.max(left.min, total - right.max);
    const high = Math.min(left.max, total - right.min);
    const next = Math.min(Math.max(size, low), high);

    if (low > high || next === current) {
      return false;
    }

    left.size = next;
    right.size = total - next;

    this.relayout();
    this.options.onResize?.(this.sizes);

    return true;
  }
}
