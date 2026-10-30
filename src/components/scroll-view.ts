import {
  bindKeys,
  type InputEvent,
  type Key,
  matchesKey,
  type MouseInput,
} from "../keys.ts";
import {
  renderScrollbar,
  SCROLLBAR_GLYPHS,
  type ScrollbarGlyphs,
  scrollbarOffset,
  type ScrollbarTheme,
  scrollbarThumb,
} from "../scrollbar.ts";
import {
  type Component,
  type Focusable,
  forwardMouse,
  isFocusable,
} from "../tui.ts";
import { sliceColumns } from "../width.ts";

/**
 * Size, scrollbar, scrolling and keys of a {@linkcode ScrollView}.
 *
 * @category Layout
 */
export interface ScrollViewOptions {
  /** Rows shown when the parent passes no height. Default: every row of the child (nothing scrolls). */
  height?: number;
  /**
   * `"auto"` (default) draws the bar only while the content overflows, but
   * keeps its column free either way so wrapping never changes when content
   * grows past the viewport. `"always"` draws the track even when everything
   * fits; `"never"` gives the child the full width.
   */
  scrollbar?: "auto" | "always" | "never";
  /** Stay at the bottom while the view is at the bottom, so appended rows scroll into view (logs, chat). Default false. */
  follow?: boolean;
  /** Rows per wheel notch. Default 3. */
  wheelStep?: number;
  /** Default `SCROLLBAR_GLYPHS.vertical`. */
  glyphs?: ScrollbarGlyphs;
  /** Paints for the track and thumb, each replacing its default. */
  theme?: ScrollbarTheme;
  /** Rows a page step keeps from the previous page. Default 1. */
  pageOverlap?: number;
  /** Keys per action; an entry replaces that action's `DEFAULT_SCROLL_VIEW_KEYS` list. */
  keys?: Partial<Record<ScrollViewAction, readonly string[]>>;
}

/**
 * What a key can do while the view has focus: scroll a row or a page, or jump to the top or bottom.
 *
 * @category Layout
 */
export type ScrollViewAction =
  | "up"
  | "down"
  | "pageUp"
  | "pageDown"
  | "top"
  | "bottom";

/**
 * Key specs (see {@linkcode matchesKey}) bound to each {@linkcode ScrollViewAction} by default.
 *
 * @category Layout
 */
export const DEFAULT_SCROLL_VIEW_KEYS: Readonly<
  Record<ScrollViewAction, readonly string[]>
> = {
  up: ["up"],
  down: ["down"],
  pageUp: ["pageup"],
  pageDown: ["pagedown"],
  top: ["home", "ctrl+home"],
  bottom: ["end", "ctrl+end"],
};

const SCROLL_ACTIONS: readonly ScrollViewAction[] = [
  "up",
  "down",
  "pageUp",
  "pageDown",
  "top",
  "bottom",
];

/**
 * A window onto a child taller than the space it is given. The child renders
 * at the full width less one column for the scrollbar and the view shows
 * `height` of its rows (the render height, else `options.height`, else all).
 *
 * While focused: ↑/↓ scroll a row, PgUp/PgDn a page, Home/End (also with
 * ctrl) jump to the ends (`keys` changes these); every other key goes to the
 * child. The wheel scrolls (a child that handles the wheel itself, such as
 * an inner ScrollView, gets it first), clicking the bar's track pages towards
 * the pointer and dragging its thumb scrolls proportionally. Other mouse
 * input inside the view reaches the child in its own cells, scrolled with it.
 *
 * Changing the offset from code does not repaint by itself: request a render
 * as for any other state change (input handling does so already).
 *
 * @example Scroll a tall child
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { ScrollView, Text } from "@neonbyte/tui";
 *
 * const rows = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
 * const view = new ScrollView(new Text(rows), {
 *   height: 3,
 *   theme: { track: {}, thumb: {} },
 * });
 *
 * assertEquals(view.render(10), ["line 0   ┃", "line 1   │", "line 2   │"]);
 *
 * view.scrollBy(2);
 * assertEquals(view.render(10), ["line 2   │", "line 3   ┃", "line 4   │"]);
 * ```
 *
 * @category Layout
 */
export class ScrollView implements Component, Focusable {
  /** The content shown in the window. */
  public child: Component;
  /** Called with the new offset after scrollTo/scrollBy, keys and mouse change it (not when a render clamps or follows). */
  public onScroll?: (offset: number) => void;
  private readonly options: ScrollViewOptions;
  private readonly keys: Readonly<Record<ScrollViewAction, readonly string[]>>;
  private readonly pageOverlap: number;
  private theme: ScrollbarTheme;
  private isFocused = false;
  private cursor: boolean | undefined;
  private offset = 0;
  private maxOffset = 0;
  private measured = false;
  private viewHeight: number;
  private innerWidth = 0;
  private barColumn = false;
  private total = 0;
  private hover = false;
  private grab: number | undefined;
  private cacheKey = "";
  private cacheRows: readonly string[] | undefined;
  private cache: readonly string[] = [];

  /**
   * Create a view onto `child`.
   *
   * @param child The content, rendered at the view's width less the scrollbar column.
   * @param options Height, scrollbar and keys; see {@linkcode ScrollViewOptions}.
   */
  public constructor(child: Component, options: ScrollViewOptions = {}) {
    this.child = child;
    this.options = options;
    this.theme = { ...options.theme };
    this.keys = bindKeys(DEFAULT_SCROLL_VIEW_KEYS, options.keys);
    this.pageOverlap = Math.max(0, Math.floor(options.pageOverlap ?? 1));
    this.viewHeight = options.height ?? 0;
  }

  /** Whether the view has the keyboard focus. */
  public get focused(): boolean {
    return this.isFocused;
  }

  /** Focusing the view focuses a focusable child too, so its caret shows. */
  public set focused(value: boolean) {
    this.isFocused = value;

    if (isFocusable(this.child)) {
      this.child.focused = value;
    }
  }

  /** Whether the terminal's own cursor is shown at the child's caret. */
  public get hardwareCursor(): boolean | undefined {
    return this.cursor;
  }

  public set hardwareCursor(value: boolean | undefined) {
    this.cursor = value;

    if (isFocusable(this.child)) {
      this.child.hardwareCursor = value;
    }
  }

  /** First visible row of the child. */
  public get scrollTop(): number {
    return this.offset;
  }

  /** Largest offset as of the last render: child rows less view rows, never negative. */
  public get maxScroll(): number {
    return this.maxOffset;
  }

  /**
   * Scroll so child row `row` is the first visible one, kept within the content.
   *
   * @param row Index of the child row to show first.
   *
   * @example Jump to a row
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { ScrollView, Text } from "@neonbyte/tui";
   *
   * const rows = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
   * const view = new ScrollView(new Text(rows), { height: 3 });
   *
   * view.render(10);
   * view.scrollTo(4);
   * assertEquals(view.scrollTop, 4);
   *
   * view.scrollTo(99); // kept within the content
   * assertEquals(view.scrollTop, view.maxScroll);
   * ```
   */
  public scrollTo(row: number): void {
    const bound = this.measured ? this.maxOffset : Number.MAX_SAFE_INTEGER;
    const target = Math.min(Math.max(0, Math.floor(row) || 0), bound);

    if (target === this.offset) {
      return;
    }

    this.offset = target;

    this.onScroll?.(target);
  }

  /**
   * Scroll by a number of rows, kept within the content.
   *
   * @param rows Rows to move; negative scrolls up.
   *
   * @example Scroll down and back up
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { ScrollView, Text } from "@neonbyte/tui";
   *
   * const rows = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
   * const view = new ScrollView(new Text(rows), { height: 3 });
   *
   * view.render(10);
   * view.scrollBy(3);
   * view.scrollBy(-1);
   * assertEquals(view.scrollTop, 2);
   * ```
   */
  public scrollBy(rows: number): void {
    this.scrollTo(this.offset + rows);
  }

  /**
   * Scroll to the end. Before the first render this is applied once the content is measured.
   *
   * @example Show the last rows
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { ScrollView, Text } from "@neonbyte/tui";
   *
   * const rows = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
   * const view = new ScrollView(new Text(rows), { height: 3 });
   *
   * view.scrollToBottom();
   * view.render(10);
   * assertEquals(view.scrollTop, 7);
   * ```
   */
  public scrollToBottom(): void {
    this.scrollTo(Number.MAX_SAFE_INTEGER);
  }

  /**
   * Scroll the least that brings child row `row` into view.
   *
   * @param row Index of the child row to reveal.
   *
   * @example Reveal a row below the window
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { ScrollView, Text } from "@neonbyte/tui";
   *
   * const rows = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
   * const view = new ScrollView(new Text(rows), { height: 3 });
   *
   * view.render(10);
   * view.ensureVisible(5); // rows 3..5 are shown
   * assertEquals(view.scrollTop, 3);
   * view.ensureVisible(4); // already visible
   * assertEquals(view.scrollTop, 3);
   * ```
   */
  public ensureVisible(row: number): void {
    const target = Math.max(0, Math.floor(row) || 0);

    if (target < this.offset || this.viewHeight < 1) {
      this.scrollTo(target);
    } else if (target >= this.offset + this.viewHeight) {
      this.scrollTo(target - this.viewHeight + 1);
    }
  }

  /**
   * Replace some scrollbar paints; others keep their values. Request a render afterwards.
   *
   * @param theme The paints to change; see {@linkcode ScrollbarTheme}.
   *
   * @example Plain scrollbar
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { ScrollView, Text } from "@neonbyte/tui";
   *
   * const view = new ScrollView(new Text("a\nb\nc\nd"), { height: 2 });
   *
   * view.setTheme({ track: {}, thumb: {} });
   * assertEquals(view.render(4), ["a  ┃", "b  │"]);
   * ```
   */
  public setTheme(theme: ScrollbarTheme): void {
    this.theme = { ...this.theme, ...theme };
    this.cacheKey = "";
  }

  public invalidate(): void {
    this.cacheKey = "";

    this.child.invalidate?.();
  }

  /**
   * Scroll on a scroll key, else pass the event on to the child.
   *
   * @param event The key or paste event.
   */
  public handleInput(event: InputEvent): void {
    if (event.type === "key" && this.scrollKey(event.key)) {
      return;
    }

    this.child.handleInput?.(event);
  }

  /**
   * Scroll with the wheel or the scrollbar, else pass the event on to the child.
   *
   * @param event The mouse report, relative to the view.
   * @returns Whether the view or its child handled the event.
   */
  public handleMouse(event: MouseInput): boolean {
    if (this.grab !== undefined) {
      return this.dragThumb(event);
    }

    if (event.action === "leave") {
      this.hover = false;

      return false;
    }

    const inside = event.x >= 0 && event.y >= 0 && event.y < this.viewHeight &&
      event.x < this.innerWidth + (this.barColumn ? 1 : 0);

    if (!inside) {
      this.hover = false;

      return false;
    }

    if (this.barColumn && event.x === this.innerWidth) {
      return this.barMouse(event);
    }

    this.hover = false;

    return forwardMouse(this.child, event, 0, -this.offset) ||
      (event.action === "wheel" && this.wheel(event));
  }

  /**
   * Draw the visible rows of the child and the scrollbar column.
   *
   * @param width Available width in cells, scrollbar included.
   * @param height Rows to show; defaults to the `height` option, then every row of the child.
   * @returns One row per visible line.
   */
  public render(width: number, height?: number): readonly string[] {
    if (width < 1) {
      return [];
    }

    this.barColumn = this.options.scrollbar !== "never" && width >= 2;
    this.innerWidth = width - (this.barColumn ? 1 : 0);

    const rows = this.child.render(this.innerWidth);

    this.measure(rows.length, height ?? this.options.height ?? rows.length);

    const key = `${width}\0${this.viewHeight}\0${this.offset}\0${this.active}`;

    if (key === this.cacheKey && rows === this.cacheRows) {
      return this.cache;
    }

    this.cacheKey = key;
    this.cacheRows = rows;
    this.cache = this.compose(rows);

    return this.cache;
  }

  /** Whether the thumb is hovered or dragged. */
  private get active(): boolean {
    return this.hover || this.grab !== undefined;
  }

  /** Rows for a page step: the view less the rows of overlap. */
  private get page(): number {
    return Math.max(1, this.viewHeight - this.pageOverlap);
  }

  /** Whether the content is taller than the view. */
  private get overflows(): boolean {
    return this.total > this.viewHeight;
  }

  /** Record the content and view size, clamping the offset or following the end. */
  private measure(total: number, view: number): void {
    const atBottom = this.offset >= this.maxOffset;

    this.total = total;
    this.viewHeight = Math.max(0, Math.floor(view));
    this.maxOffset = Math.max(0, total - this.viewHeight);
    this.measured = true;
    this.offset = this.options.follow === true && atBottom
      ? this.maxOffset
      : Math.min(this.offset, this.maxOffset);
  }

  /** The visible slice of `rows`, each followed by its scrollbar cell. */
  private compose(rows: readonly string[]): string[] {
    const bar = this.barCells();
    const blank = " ".repeat(this.innerWidth);

    return Array.from({ length: this.viewHeight }, (_, i) => {
      const at = this.offset + i;
      const cell = at < rows.length
        ? sliceColumns(rows[at], 0, this.innerWidth)
        : blank;

      return cell + bar[i];
    });
  }

  /** One cell per view row for the scrollbar column; empty strings when the child owns the full width. */
  private barCells(): string[] {
    if (!this.barColumn) {
      return Array.from({ length: this.viewHeight }, () => "");
    }

    const shown = this.options.scrollbar === "always" || this.overflows;

    if (!shown) {
      return Array.from({ length: this.viewHeight }, () => " ");
    }

    return renderScrollbar(this.viewHeight, this.total, this.offset, {
      glyphs: this.options.glyphs ?? SCROLLBAR_GLYPHS.vertical,
      theme: this.theme,
      active: this.active,
    });
  }

  /** Run the action bound to `key`; false when the key is not a scroll key. */
  private scrollKey(key: Key): boolean {
    const action = SCROLL_ACTIONS.find((name) =>
      this.keys[name].some((spec) => matchesKey(key, spec))
    );

    if (action === undefined) {
      return false;
    }

    switch (action) {
      case "up":
        this.scrollBy(-1);

        break;
      case "down":
        this.scrollBy(1);

        break;
      case "pageUp":
        this.scrollBy(-this.page);

        break;
      case "pageDown":
        this.scrollBy(this.page);

        break;
      case "top":
        this.scrollTo(0);

        break;
      case "bottom":
        this.scrollToBottom();

        break;
    }

    return true;
  }

  /** Scroll by the wheel; false when there was no room, so an enclosing view can take it. */
  private wheel(event: MouseInput): boolean {
    const step = this.options.wheelStep ?? 3;
    const before = this.offset;

    if (event.direction === "up") {
      this.scrollBy(-step);
    } else if (event.direction === "down") {
      this.scrollBy(step);
    }

    return this.offset !== before;
  }

  /** Handle the wheel, hover and presses on the scrollbar column. */
  private barMouse(event: MouseInput): boolean {
    if (event.action === "wheel") {
      return this.wheel(event);
    }

    if (!this.overflows) {
      return false;
    }

    if (event.action === "press" && event.button === "left") {
      this.pressBar(event.y);

      return true;
    }

    if (event.action === "move") {
      const thumb = scrollbarThumb(this.viewHeight, this.total, this.offset);

      this.hover = event.y >= thumb.start &&
        event.y < thumb.start + thumb.size;

      return true;
    }

    return false;
  }

  /** A press on the thumb starts a drag; one on the track pages towards it. */
  private pressBar(y: number): void {
    const thumb = scrollbarThumb(this.viewHeight, this.total, this.offset);

    if (y >= thumb.start && y < thumb.start + thumb.size) {
      this.grab = y - thumb.start;
    } else {
      this.scrollBy(y < thumb.start ? -this.page : this.page);
    }
  }

  /** Follow the pointer while the thumb is dragged, until it is released. */
  private dragThumb(event: MouseInput): boolean {
    if (event.action === "release") {
      this.grab = undefined;
    } else if (event.action === "drag" && this.grab !== undefined) {
      this.scrollTo(
        scrollbarOffset(this.viewHeight, this.total, event.y - this.grab),
      );
    }

    return true;
  }
}
