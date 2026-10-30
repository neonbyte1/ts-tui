import type { InputEvent, MouseInput } from "../keys.ts";
import { type Paint, paint } from "../style.ts";
import { type Component, forwardMouse } from "../tui.ts";
import { padToWidth, truncateToWidth, visibleWidth } from "../width.ts";

/**
 * Frame glyphs: corners, horizontal and vertical edges, each one cell wide.
 *
 * @category Layout
 */
export interface BorderGlyphs {
  /** Top-left corner. */
  readonly topLeft: string;
  /** Top-right corner. */
  readonly topRight: string;
  /** Bottom-left corner. */
  readonly bottomLeft: string;
  /** Bottom-right corner. */
  readonly bottomRight: string;
  /** Repeated along the top and bottom edges. */
  readonly horizontal: string;
  /** Repeated along the left and right edges. */
  readonly vertical: string;
}

/**
 * Ready-made frame styles for {@linkcode BoxOptions.border}: `rounded` (the
 * default), `single`, `double`, `heavy` and `ascii` for terminals without box
 * drawing characters.
 *
 * @category Layout
 */
export const BORDERS: {
  readonly [Name in "rounded" | "single" | "double" | "heavy" | "ascii"]:
    BorderGlyphs;
} = {
  rounded: {
    topLeft: "╭",
    topRight: "╮",
    bottomLeft: "╰",
    bottomRight: "╯",
    horizontal: "─",
    vertical: "│",
  },
  single: {
    topLeft: "┌",
    topRight: "┐",
    bottomLeft: "└",
    bottomRight: "┘",
    horizontal: "─",
    vertical: "│",
  },
  double: {
    topLeft: "╔",
    topRight: "╗",
    bottomLeft: "╚",
    bottomRight: "╝",
    horizontal: "═",
    vertical: "║",
  },
  heavy: {
    topLeft: "┏",
    topRight: "┓",
    bottomLeft: "┗",
    bottomRight: "┛",
    horizontal: "━",
    vertical: "┃",
  },
  ascii: {
    topLeft: "+",
    topRight: "+",
    bottomLeft: "+",
    bottomRight: "+",
    horizontal: "-",
    vertical: "|",
  },
};

/**
 * Paints per element of a box frame.
 *
 * @category Layout
 */
export interface BoxTheme {
  /** Corners and edges. Default grey `#5c6370`. */
  readonly border?: Paint;
  /** Title text, with a space either side. Default bold. */
  readonly title?: Paint;
  /** Footer text, with a space either side. Default bold. */
  readonly footer?: Paint;
}

const DEFAULT_THEME: Required<BoxTheme> = {
  border: { fg: "#5c6370" },
  title: { bold: true },
  footer: { bold: true },
};

/**
 * Look of a {@linkcode Box}. Every option is optional.
 *
 * @category Layout
 */
export interface BoxOptions {
  /** Default `BORDERS.rounded`. */
  border?: BorderGlyphs;
  /** Text in the top edge, e.g. `╭─ Title ─╮`; cut to fit. */
  title?: string;
  /** Text in the bottom edge, right-aligned. */
  footer?: string;
  /** Paints for the frame, title and footer, each replacing its default. */
  theme?: BoxTheme;
  /** Cells between the border and the content: `[vertical, horizontal]` or one value for both. Default `[0, 1]`. */
  padding?: number | readonly [number, number];
  /** Mark at the end of a title or footer cut to fit. Default `"…"`. */
  ellipsis?: string;
}

/**
 * A border around one child, with an optional title and footer. The child
 * renders at the inner width; given a `height`, the box fills exactly that
 * many rows and passes the inner height on. Mouse events are forwarded to the
 * child in its own cells.
 *
 * @example Frame some text with a title
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Box, Text } from "@neonbyte/tui";
 *
 * const box = new Box(new Text("hi"), {
 *   title: "Greeting",
 *   theme: { border: {}, title: {} },
 * });
 *
 * assertEquals(box.render(14), [
 *   "╭─ Greeting ─╮",
 *   "│ hi         │",
 *   "╰────────────╯",
 * ]);
 * ```
 *
 * @category Layout
 */
export class Box implements Component {
  /** The component inside the frame. Assign a new one to swap the content; call {@linkcode Box.invalidate} afterwards. */
  public child: Component;
  private options: BoxOptions;
  private theme: Required<BoxTheme>;
  private cacheKey = "";
  private cacheChild: readonly string[] | undefined;
  private cache: readonly string[] = [];

  /**
   * Create a box around `child`.
   *
   * @param child The component to frame.
   * @param options Border, title, padding and paints; see {@linkcode BoxOptions}.
   */
  public constructor(child: Component, options: BoxOptions = {}) {
    this.child = child;
    this.options = options;
    this.theme = { ...DEFAULT_THEME, ...options.theme };
  }

  /**
   * Replace some options; others keep their values. A `theme` here replaces the paints it sets.
   *
   * @param options The options to change; see {@linkcode BoxOptions}.
   *
   * @example Add a footer
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Box, Text } from "@neonbyte/tui";
   *
   * const box = new Box(new Text("hi"), { theme: { border: {}, footer: {} } });
   * box.setOptions({ footer: "ok" });
   *
   * assertEquals(box.render(10)[2], "╰─── ok ─╯");
   * ```
   */
  public setOptions(options: BoxOptions): void {
    this.options = { ...this.options, ...options };
    this.theme = { ...this.theme, ...options.theme };
    this.cacheKey = "";
  }

  /**
   * Replace some paints; others keep their values.
   *
   * @param theme The paints to change; see {@linkcode BoxTheme}.
   *
   * @example Paint the border red
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Box, Text } from "@neonbyte/tui";
   *
   * const box = new Box(new Text("hi"));
   * box.setTheme({ border: { fg: "#ff0000" } });
   *
   * assertEquals(box.render(6)[0].startsWith("\x1b["), true);
   * ```
   */
  public setTheme(theme: BoxTheme): void {
    this.setOptions({ theme });
  }

  /**
   * Set or clear the title in the top edge.
   *
   * @param title The new title, or `undefined` to remove it.
   *
   * @example Retitle a box
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Box, Text } from "@neonbyte/tui";
   *
   * const box = new Box(new Text("hi"), { theme: { border: {}, title: {} } });
   * box.setTitle("Hi");
   *
   * assertEquals(box.render(10)[0], "╭─ Hi ───╮");
   * ```
   */
  public setTitle(title: string | undefined): void {
    this.setOptions({ title });
  }

  /** Cells taken by border and padding: `[top/bottom, left/right]` on each side. */
  public get inset(): [number, number] {
    const [py, px] = this.padding();

    return [1 + py, 1 + px];
  }

  /** Drop the cached frame and invalidate the child. */
  public invalidate(): void {
    this.cacheKey = "";

    this.child.invalidate?.();
  }

  /**
   * Forward key and paste input to the child, so focusing a box drives its content.
   *
   * @param event The key press or paste.
   */
  public handleInput(event: InputEvent): void {
    this.child.handleInput?.(event);
  }

  /**
   * Forward a mouse event to the child, translated into its own cells.
   *
   * @param event The mouse report relative to the box.
   * @returns Whether the child handled the event.
   */
  public handleMouse(event: MouseInput): boolean {
    const [top, left] = this.inset;

    return forwardMouse(this.child, event, left, top);
  }

  /**
   * Render the frame around the child.
   *
   * @param width Total width in cells, border included.
   * @param height Total height in rows; when given, the box fills exactly that many rows and the child gets the inner height.
   * @returns The framed rows; empty when `width` is below 2.
   */
  public render(width: number, height?: number): readonly string[] {
    const [top, left] = this.inset;
    const innerWidth = Math.max(0, width - left * 2);
    const innerHeight = height === undefined
      ? undefined
      : Math.max(0, height - top * 2);
    const rows = innerWidth > 0
      ? this.child.render(innerWidth, innerHeight)
      : [];
    const key = `${width}\0${height}`;

    if (key === this.cacheKey && rows === this.cacheChild) {
      return this.cache;
    }

    this.cacheKey = key;
    this.cacheChild = rows;
    this.cache = width < 2
      ? []
      : this.frame(rows, width, innerWidth, innerHeight);

    return this.cache;
  }

  /** The framed rows: top edge with title, padded child rows, bottom edge with footer. */
  private frame(
    rows: readonly string[],
    width: number,
    innerWidth: number,
    innerHeight: number | undefined,
  ): string[] {
    const border = this.options.border ?? BORDERS.rounded;
    const edge = this.theme.border;
    const [py, px] = this.padding();
    const side = paint(border.vertical, edge);
    const gap = " ".repeat(Math.max(0, px));
    const blank = " ".repeat(innerWidth);
    const body = innerHeight === undefined
      ? [...rows]
      : Array.from({ length: innerHeight }, (_, i) => rows[i] ?? "");
    const padded = [
      ...Array.from({ length: py }, () => blank),
      ...body.map((row) =>
        padToWidth(truncateToWidth(row, innerWidth, ""), innerWidth)
      ),
      ...Array.from({ length: py }, () => blank),
    ];

    return [
      this.edge(
        [border.topLeft, border.topRight],
        this.options.title,
        this.theme.title,
        width,
        "left",
      ),
      ...padded.map((row) => `${side}${gap}${row}${gap}${side}`),
      this.edge(
        [border.bottomLeft, border.bottomRight],
        this.options.footer,
        this.theme.footer,
        width,
        "right",
      ),
    ];
  }

  /** A top or bottom edge with `label` set into it in `labelPaint`. */
  private edge(
    corners: readonly [string, string],
    label: string | undefined,
    labelPaint: Paint,
    width: number,
    align: "left" | "right",
  ): string {
    const border = this.options.border ?? BORDERS.rounded;
    const edge = this.theme.border;
    const line = (cells: number) =>
      border.horizontal.repeat(Math.max(0, cells));
    const room = width - 4;
    const [leftCorner, rightCorner] = corners;

    if (label === undefined || label === "" || room < 3) {
      return paint(leftCorner + line(width - 2) + rightCorner, edge);
    }

    const text = truncateToWidth(
      label,
      room - 2,
      this.options.ellipsis ?? "…",
    );
    const rest = width - 4 - visibleWidth(text);
    const titled = paint(` ${text} `, labelPaint);
    const before = align === "left" ? 1 : rest - 1;
    const after = align === "left" ? rest - 1 : 1;

    return paint(leftCorner + line(before), edge) + titled +
      paint(line(after) + rightCorner, edge);
  }

  /** Vertical and horizontal padding in cells as `[vertical, horizontal]`. */
  private padding(): [number, number] {
    const padding = this.options.padding ?? [0, 1];

    return typeof padding === "number"
      ? [padding, padding]
      : [padding[0], padding[1]];
  }
}
