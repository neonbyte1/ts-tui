import process from "node:process";
import {
  AUTOWRAP_OFF,
  AUTOWRAP_ON,
  CLEAR_ALL,
  CURSOR_HIDE,
  CURSOR_MARKER,
  CURSOR_SHOW,
  ERASE_BELOW,
  ERASE_LINE,
  escapeSequenceLength,
  HYPERLINK_CLOSE,
  IMAGE_RESERVED,
  RESET,
  SYNC_BEGIN,
  SYNC_END,
} from "./ansi.ts";
import { type ImageProtocol, terminalInfo } from "./capabilities.ts";
import {
  type InputEvent,
  InputParser,
  type MouseInput,
  type ParsedInput,
  type TerminalReport,
} from "./keys.ts";
import { type Paint, paint } from "./style.ts";
import type { Terminal } from "./terminal.ts";
import {
  padToWidth,
  sliceColumns,
  truncateToWidth,
  visibleWidth,
} from "./width.ts";

/**
 * A renderable piece of UI: the contract every widget in this package, and
 * every component you write, implements.
 *
 * `render(width)` returns one string per terminal row. Each row may contain
 * escape sequences (colours, hyperlinks) but no other control characters (no
 * `\n`, `\r`, `\t`) and must not be wider than `width` cells; the TUI throws
 * when a row is too wide, so wrap or truncate with {@linkcode wrapText} and
 * {@linkcode truncateToWidth}. Return the same array while nothing changed;
 * containers use that identity to skip work, so cache the rows and build a new
 * array only when the content or `width` changed.
 *
 * `height`, when given, is the exact number of rows the parent shows (e.g. a
 * pane). Components that fill or scroll ({@linkcode Panes},
 * {@linkcode ScrollView}) return exactly that many; others may ignore it, and
 * the parent cuts or pads their rows.
 *
 * To write a component, implement `render`; add `handleInput` for keys (the
 * component must be focused, see {@linkcode TUI.setFocus}), `handleMouse` for
 * the pointer (forward to children with {@linkcode forwardMouse}) and
 * `invalidate` to drop caches after a theme change. After changing state
 * outside of `handleInput`, call {@linkcode TUI.requestRender}. Components
 * that show a caret also implement {@linkcode Focusable}.
 *
 * @category Core
 *
 * @example A custom component that caches its rows
 * ```ts
 * import {
 *   type Component,
 *   type InputEvent,
 *   matchesKey,
 *   truncateToWidth,
 *   TUI,
 *   VirtualTerminal,
 * } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * class Counter implements Component {
 *   private count = 0;
 *   private rows: readonly string[] | undefined;
 *   private rowsWidth = -1;
 *
 *   handleInput(event: InputEvent): void {
 *     if (event.type === "key" && matchesKey(event.key, "up")) {
 *       this.count++;
 *       this.rows = undefined;
 *     }
 *   }
 *
 *   invalidate(): void {
 *     this.rows = undefined;
 *   }
 *
 *   render(width: number): readonly string[] {
 *     if (this.rows === undefined || this.rowsWidth !== width) {
 *       this.rows = [truncateToWidth(`Count: ${this.count}`, width)];
 *       this.rowsWidth = width;
 *     }
 *
 *     return this.rows;
 *   }
 * }
 *
 * const terminal = new VirtualTerminal(20, 3);
 * const tui = new TUI(terminal);
 * const counter = new Counter();
 *
 * tui.addChild(counter);
 * tui.setFocus(counter);
 * tui.start();
 * tui.renderNow();
 *
 * assertEquals(terminal.viewport()[0], "Count: 0");
 *
 * terminal.send("\x1b[A");
 * tui.renderNow();
 *
 * assertEquals(terminal.viewport()[0], "Count: 1");
 *
 * tui.stop();
 * ```
 */
export interface Component {
  /**
   * Draws the component.
   *
   * @param width Available width in cells; no row may be wider.
   * @param height Exact number of rows the parent shows, when it dictates one.
   * @returns One string per row. Return the same array while nothing changed.
   */
  render(width: number, height?: number): readonly string[];
  /** Called with key and paste input while this component has focus. */
  handleInput?(event: InputEvent): void;
  /**
   * Called with mouse input over this component, in its own cells (0,0 is
   * its top-left). Return `true` when handled: a handled press captures the
   * pointer (the drag and release come here even outside the component) and
   * focuses the component if it is `Focusable`; a handled move makes it the
   * hover target, which gets a `leave` event when the pointer moves on.
   * Composites deliver to children with `forwardMouse`.
   */
  handleMouse?(event: MouseInput): boolean | void;
  /** Drop cached render output (e.g. after a theme change). */
  invalidate?(): void;
}

/**
 * Components that show a caret while focused.
 *
 * While `focused`, the component must emit {@linkcode CURSOR_MARKER}
 * immediately before its caret cell. When `hardwareCursor` is true the
 * terminal's own cursor is shown at the marker, so the component must not also
 * draw an inverse-video caret; otherwise it draws one. Both fields are set by
 * the TUI when the component gets focus (see {@linkcode TUI.setFocus}).
 *
 * @category Core
 *
 * @example A prompt that shows its caret only while focused
 * ```ts
 * import {
 *   type Component,
 *   CURSOR_MARKER,
 *   type Focusable,
 *   TUI,
 *   VirtualTerminal,
 * } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * class Prompt implements Component, Focusable {
 *   public focused = false;
 *   public hardwareCursor?: boolean;
 *
 *   render(): readonly string[] {
 *     if (!this.focused) {
 *       return ["> "];
 *     }
 *
 *     const caret = this.hardwareCursor ? "" : "\x1b[7m \x1b[27m";
 *
 *     return ["> " + CURSOR_MARKER + caret];
 *   }
 * }
 *
 * const terminal = new VirtualTerminal(20, 3);
 * const tui = new TUI(terminal, { hardwareCursor: true });
 * const prompt = new Prompt();
 *
 * tui.addChild(prompt);
 * tui.setFocus(prompt);
 * tui.start();
 * tui.renderNow();
 *
 * assertEquals(terminal.cursor, { x: 2, y: 0, visible: true });
 *
 * tui.stop();
 * ```
 */
export interface Focusable {
  /** Whether the component has keyboard focus. Set by the TUI. */
  focused: boolean;
  /** Whether the terminal's own cursor is shown at the caret; then the component draws no caret itself. Set by the TUI. */
  hardwareCursor?: boolean;
}

/**
 * Whether `component` is a {@linkcode Focusable}: it has a `focused` field.
 *
 * @param component The component to test, or `null`.
 * @returns `true` for a focusable component; `false` for others and `null`.
 * @category Core
 *
 * @example Tell focusable components apart
 * ```ts
 * import { type Component, isFocusable } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * const label: Component = { render: () => ["label"] };
 * const field = { focused: false, render: () => ["field"] };
 *
 * assertEquals(isFocusable(label), false);
 * assertEquals(isFocusable(field), true);
 * assertEquals(isFocusable(null), false);
 * ```
 */
export function isFocusable(
  component: Component | null,
): component is Component & Focusable {
  return component !== null && "focused" in component;
}

/** Routing state shared by every translated copy of one mouse event. */
interface MouseRoute {
  /** Innermost component that handled the event. */
  target: Component | undefined;
  /** The event's content cell, and the target's top-left content cell. */
  rootX: number;
  rootY: number;
  originX: number;
  originY: number;
}

const mouseRoutes = new WeakMap<MouseInput, MouseRoute>();

/**
 * Delivers `event` (in the parent's cells) to `child`, whose top-left cell is
 * at `x`,`y` in the parent (negative when scrolled). Returns whether the child
 * handled it. Composite components must forward through this rather than
 * calling `child.handleMouse` directly, so the TUI learns which component
 * handled a press: that component then receives the drag and release, and
 * takes keyboard focus if it is {@linkcode Focusable}.
 *
 * @param child The component to deliver to.
 * @param event The mouse event in the parent's cells.
 * @param x Column of the child's left edge in the parent. Default 0.
 * @param y Row of the child's top edge in the parent. Default 0.
 * @returns `true` when the child handled the event; `false` when it did not
 * or has no `handleMouse`.
 * @category Core
 *
 * @example Forward a click to an indented child
 * ```ts
 * import { type Component, forwardMouse, type MouseInput } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * const clicks: number[] = [];
 * const button: Component = {
 *   render: () => ["[ ok ]"],
 *   handleMouse(event: MouseInput) {
 *     clicks.push(event.x);
 *
 *     return true;
 *   },
 * };
 * // A composite that draws its child indented by four cells.
 * const indented: Component = {
 *   render: (width) => button.render(width - 4).map((row) => "    " + row),
 *   handleMouse: (event) => forwardMouse(button, event, 4, 0),
 * };
 * const press: MouseInput = {
 *   type: "mouse",
 *   action: "press",
 *   button: "left",
 *   x: 6,
 *   y: 0,
 *   shift: false,
 *   alt: false,
 *   ctrl: false,
 * };
 *
 * assertEquals(indented.handleMouse?.(press), true);
 * assertEquals(clicks, [2]);
 * ```
 */
export function forwardMouse(
  child: Component,
  event: MouseInput,
  x = 0,
  y = 0,
): boolean {
  if (child.handleMouse === undefined) {
    return false;
  }

  const local = x === 0 && y === 0
    ? event
    : { ...event, x: event.x - x, y: event.y - y };
  const route = mouseRoutes.get(event);

  if (route !== undefined && local !== event) {
    mouseRoutes.set(local, route);
  }

  const handled = child.handleMouse(local) === true;

  if (handled && route !== undefined && route.target === undefined) {
    route.target = child;
    route.originX = route.rootX - local.x;
    route.originY = route.rootY - local.y;
  }

  return handled;
}

/**
 * Stacks children vertically. Its rows are the children's rows in order, and
 * the same array is returned while no child's rows changed. It is the base of
 * {@linkcode TUI}; use it on its own to group components.
 *
 * @category Core
 *
 * @example Group components into one
 * ```ts
 * import { Container, Text } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * const stack = new Container();
 *
 * stack.addChild(new Text("first"));
 * stack.addChild(new Text("second"));
 *
 * assertEquals(stack.render(20), ["first", "second"]);
 * ```
 */
export class Container implements Component {
  /** The children, top to bottom. Prefer `addChild` and `removeChild` to changing it directly. */
  public children: Component[] = [];
  private memoWidth = -1;
  private memoLines: readonly string[] | undefined;
  private memoChildLines: (readonly string[])[] = [];
  /** Children as of the last render, aligned with `memoChildLines` for hit-testing. */
  private memoChildren: Component[] = [];

  /**
   * Adds a component below the existing children.
   *
   * @param component The component to add. It may be any
   * {@linkcode Component}, including your own.
   *
   * @example Add a custom component
   * ```ts
   * import { type Component, Container } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const banner: Component = { render: () => ["== banner =="] };
   * const stack = new Container();
   *
   * stack.addChild(banner);
   *
   * assertEquals(stack.render(20), ["== banner =="]);
   * ```
   */
  public addChild(component: Component): void {
    this.children.push(component);
  }

  /**
   * Removes a child. Does nothing when `component` is not a child.
   *
   * @param component The child to remove.
   *
   * @example Remove a child
   * ```ts
   * import { Container, Text } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const first = new Text("first");
   * const stack = new Container();
   *
   * stack.addChild(first);
   * stack.addChild(new Text("second"));
   * stack.removeChild(first);
   *
   * assertEquals(stack.render(20), ["second"]);
   * ```
   */
  public removeChild(component: Component): void {
    const index = this.children.indexOf(component);

    if (index !== -1) {
      this.children.splice(index, 1);
    }
  }

  /**
   * Removes every child.
   *
   * @example Empty the container
   * ```ts
   * import { Container, Text } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const stack = new Container();
   *
   * stack.addChild(new Text("row"));
   * stack.clear();
   *
   * assertEquals(stack.children.length, 0);
   * assertEquals(stack.render(20), []);
   * ```
   */
  public clear(): void {
    this.children = [];
  }

  /** Drops the cached rows and invalidates every child. */
  public invalidate(): void {
    this.memoLines = undefined;
    this.memoChildLines = [];

    for (const child of this.children) {
      child.invalidate?.();
    }
  }

  /**
   * Renders the children one below the other.
   *
   * @param width Available width in cells, passed to every child.
   * @returns The children's rows in order; the same array while no child's
   * rows changed.
   */
  public render(width: number): readonly string[] {
    const count = this.children.length;
    let unchanged = this.memoLines !== undefined &&
      this.memoWidth === width &&
      this.memoChildLines.length === count;
    const childLines: (readonly string[])[] = new Array(count);

    for (let i = 0; i < count; i++) {
      childLines[i] = this.children[i].render(width);

      if (
        childLines[i] !== this.memoChildLines[i] ||
        this.children[i] !== this.memoChildren[i]
      ) {
        unchanged = false;
      }
    }

    if (unchanged) {
      return this.memoLines!;
    }

    this.memoWidth = width;
    this.memoChildren = [...this.children];
    this.memoChildLines = childLines;
    this.memoLines = childLines.flat();

    return this.memoLines;
  }

  /**
   * Forwards a mouse event to the child drawn at the event's row in the last
   * frame, through {@linkcode forwardMouse}.
   *
   * @param event Mouse event in the container's cells.
   * @returns `true` when a child handled the event.
   */
  public handleMouse(event: MouseInput): boolean {
    let top = 0;

    for (let i = 0; i < this.memoChildren.length; i++) {
      const rows = this.memoChildLines[i]?.length ?? 0;

      if (event.y < top + rows) {
        return event.y >= top &&
          forwardMouse(this.memoChildren[i], event, 0, top);
      }

      top += rows;
    }

    return false;
  }
}

/**
 * Receives every key, paste and mouse event before it reaches the focused
 * component (keys, paste) or the component under the pointer (mouse, in
 * content cells). Return `true` to consume the event; see
 * {@linkcode TUI.addInputListener}.
 *
 * @category Core
 */
export type InputListener = (event: InputEvent | MouseInput) => boolean | void;

/**
 * Cells or a percentage of the terminal dimension, e.g. `40` or `"50%"`.
 *
 * @category Core
 */
export type OverlaySize = number | `${number}%`;

/**
 * Where an overlay sits on the screen, relative to the margins.
 *
 * @category Core
 */
export type OverlayAnchor =
  | "center"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/**
 * How {@linkcode TUI.showOverlay} sizes and places an overlay.
 *
 * @category Core
 */
export interface OverlayOptions {
  /** Width the component renders at. Default: terminal width minus margins, at most 80. */
  width?: OverlaySize;
  /** Rows beyond this are cut. Default: terminal height minus margins. */
  maxHeight?: OverlaySize;
  /** Default `"center"`. */
  anchor?: OverlayAnchor;
  /** Distance kept from the screen edges, in cells. Default 1. */
  margin?: number;
  /** Columns to move right of the anchored position; negative moves left. Default 0. */
  offsetX?: number;
  /** Rows to move down from the anchored position; negative moves up. Default 0. */
  offsetY?: number;
  /** Give the overlay keyboard focus while it is visible. Default true. */
  focus?: boolean;
  /** Block mouse input to everything beneath the overlay while it is visible. Default false. */
  modal?: boolean;
  /** Restyle the screen beneath as plain text in this paint while visible, e.g. `{ fg: "#5c6370" }` to dim it. */
  backdrop?: Paint;
  /** Called for every mouse press outside the overlay while it is visible (e.g. to close a popup). */
  onPressOutside?: () => void;
}

/**
 * Controls a shown overlay; returned by {@linkcode TUI.showOverlay}.
 *
 * @category Core
 */
export interface OverlayHandle {
  /** Remove the overlay permanently and restore the focus it took. */
  hide(): void;
  /** Temporarily hide or re-show the overlay. */
  setHidden(hidden: boolean): void;
  /** Whether the overlay is temporarily hidden. */
  readonly hidden: boolean;
}

/**
 * Options of {@linkcode TUI}.
 *
 * @category Core
 */
export interface TUIOptions {
  /**
   * Inline image protocol. `"auto"` (default) asks the terminal whether it
   * supports kitty graphics and whether it is iTerm2; `"off"` disables images.
   */
  images?: "auto" | "off" | ImageProtocol;
  /** Enable the kitty keyboard protocol when the terminal supports it. Default true. */
  kittyKeyboard?: boolean;
  /** Show the terminal's own cursor at the focused caret instead of a drawn one. Default false. */
  hardwareCursor?: boolean;
  /** Mouse reporting; see `TUI.setMouse`. Default `"off"`. */
  mouse?: MouseMode;
}

/**
 * How much mouse input the terminal reports: none, presses and wheel, plus
 * drags, plus all motion. See {@linkcode TUI.setMouse}.
 *
 * @category Core
 */
export type MouseMode = "off" | "click" | "drag" | "move";

interface Rect {
  row: number;
  col: number;
  width: number;
  height: number;
}

interface Overlay {
  component: Component;
  options: OverlayOptions;
  hidden: boolean;
  /** Focus to restore when the overlay goes away. */
  previousFocus: Component | null;
  /** Where the last frame drew it, in content cells; unset while not drawn. */
  rect?: Rect;
}

/** A component that handled a mouse event, with its top-left cell in content cells. */
interface MouseTarget {
  component: Component;
  originX: number;
  originY: number;
  /** Overlay it was reached through; `null` for the content. */
  overlay: Overlay | null;
}

interface PendingImage {
  row: number;
  lastRow: number;
  sequence: string;
}

const MIN_FRAME_INTERVAL_MS = 16;
/** How long an incomplete escape sequence waits for more bytes before it is delivered (lone Escape). */
const ESCAPE_TIMEOUT_MS = 50;
const SAVE_CURSOR = "\x1b7";
const RESTORE_CURSOR = "\x1b8";
const KITTY_KEYBOARD_PUSH = "\x1b[>1u"; // flag 1: disambiguate escape codes
const KITTY_KEYBOARD_POP = "\x1b[<u";
const KITTY_GRAPHICS_PROBE_ID = 31;
/**
 * Startup queries. Device attributes (`CSI c`) goes last: every terminal
 * answers it, so its reply marks the end of the replies to the others.
 */
const PROBE_KITTY_KEYBOARD = "\x1b[?u";
const PROBE_KITTY_GRAPHICS =
  `\x1b_Gi=${KITTY_GRAPHICS_PROBE_ID},s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\`;
const PROBE_CELL_SIZE = "\x1b[16t";
const PROBE_VERSION = "\x1b[>0q";
const PROBE_DEVICE_ATTRIBUTES = "\x1b[c";
const PROBE_CURSOR_POSITION = "\x1b[6n";
/** Reply to `CSI 6n` without its ESC: `[row;colR`. */
const CURSOR_POSITION_REPLY = /^\[(\d+);(\d+)R$/;
/** Reporting modes per setting, always with SGR encoding (1006). */
const MOUSE_ON: Record<MouseMode, string> = {
  off: "",
  click: "\x1b[?1000h\x1b[?1006h",
  drag: "\x1b[?1002h\x1b[?1006h",
  move: "\x1b[?1003h\x1b[?1006h",
};
const MOUSE_OFF = "\x1b[?1003l\x1b[?1002l\x1b[?1000l\x1b[?1006l";

function isImageRow(line: string): boolean {
  return line.startsWith("\x1b_G") || line.startsWith("\x1b]1337;File=");
}

/** Image id (`i=`) of a kitty graphics row. */
function kittyImageId(line: string): number | undefined {
  if (!line.startsWith("\x1b_G")) {
    return undefined;
  }

  const control = line.slice(3, line.indexOf(";"));
  const param = control.split(",").find((p) => p.startsWith("i="));

  return param === undefined ? undefined : Number(param.slice(2));
}

function resolveSize(size: OverlaySize, total: number): number {
  return typeof size === "number"
    ? Math.floor(size)
    : Math.floor(total * Number.parseFloat(size) / 100);
}

function verticalMove(rows: number): string {
  if (rows < 0) {
    return `\x1b[${-rows}A`;
  }

  if (rows > 0) {
    return `\x1b[${rows}B`;
  }

  return "";
}

/** Rows `first..last` of a diff repaint; `full` when a clear-and-repaint is needed instead. */
interface DirtyRange {
  first: number;
  last: number;
  full: boolean;
}

/**
 * Bytes that erase everything below the new last row after rows were removed.
 * The cursor is on `lastWritten`, or on row `first` when nothing was written.
 */
function eraseRemovedRows(
  lineCount: number,
  first: number,
  lastWritten: number,
): string {
  if (lastWritten >= first) {
    // Cursor is on the last written row; rows exist below it, so this newline never scrolls.
    return `\r\n${ERASE_BELOW}\x1b[1A`;
  }

  // Nothing written: cursor is on row `first` === lineCount, the first removed row.
  return lineCount > 0 ? ERASE_BELOW + "\x1b[1A" : ERASE_BELOW;
}

/** Margin, render width and row limit of an overlay in a `width` x `height` terminal. */
function overlayBounds(
  options: OverlayOptions,
  width: number,
  height: number,
): { margin: number; width: number; maxHeight: number } {
  const margin = Math.max(0, options.margin ?? 1);
  const availableWidth = Math.max(1, width - margin * 2);
  const availableHeight = Math.max(1, height - margin * 2);
  const wanted = options.width === undefined
    ? 80
    : resolveSize(options.width, width);
  const wantedHeight = options.maxHeight === undefined
    ? availableHeight
    : resolveSize(options.maxHeight, height);

  return {
    margin,
    width: Math.min(availableWidth, Math.max(1, wanted)),
    maxHeight: Math.min(availableHeight, Math.max(1, wantedHeight)),
  };
}

/** Unclamped top row of an overlay for its anchor. */
function anchoredRow(
  anchor: OverlayAnchor,
  margin: number,
  height: number,
  count: number,
): number {
  if (anchor.startsWith("top")) {
    return margin;
  }

  if (anchor.startsWith("bottom")) {
    return height - count - margin;
  }

  return Math.floor((height - count) / 2);
}

/** Unclamped left column of an overlay for its anchor. */
function anchoredCol(
  anchor: OverlayAnchor,
  margin: number,
  width: number,
  overlayWidth: number,
): number {
  if (anchor.endsWith("left")) {
    return margin;
  }

  if (anchor.endsWith("right")) {
    return width - overlayWidth - margin;
  }

  return Math.floor((width - overlayWidth) / 2);
}

/** Blank every image that has a row among `result[start..start+count)`, whole. */
function clearCoveredImages(
  result: string[],
  start: number,
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const target = start + i;

    if (result[target] === IMAGE_RESERVED || isImageRow(result[target])) {
      blankImageAt(result, target);
    }
  }
}

/** Blank all rows of the image that row `target` belongs to. */
function blankImageAt(result: string[], target: number): void {
  let first = target;

  while (first > 0 && result[first] === IMAGE_RESERVED) {
    first--;
  }

  let last = target;

  while (result[last + 1] === IMAGE_RESERVED) {
    last++;
  }

  for (let r = first; r <= last; r++) {
    result[r] = "";
  }
}

/** `base` with `text` drawn over columns `col..col+overlayWidth`. */
function overlayRow(
  base: string,
  text: string,
  col: number,
  overlayWidth: number,
  width: number,
): string {
  const cell = padToWidth(
    truncateToWidth(text, overlayWidth, ""),
    overlayWidth,
  );

  return sliceColumns(base, 0, col) + RESET + cell + RESET +
    (cell.includes("\x1b]8;") ? HYPERLINK_CLOSE : "") +
    sliceColumns(base, col + overlayWidth, width);
}

/** `line` without escape sequences. */
function plainText(line: string): string {
  let out = "";
  let i = 0;

  while (i < line.length) {
    if (line.charCodeAt(i) === 0x1b) {
      const length = escapeSequenceLength(line, i);

      i += length === -1 ? line.length : length;
    } else {
      out += line[i];
      i++;
    }
  }

  return out;
}

/** Restyle rows `start..start+count` as plain text in `p`, e.g. to dim the screen behind a modal. */
function applyBackdrop(
  result: string[],
  start: number,
  count: number,
  p: Paint,
): void {
  clearCoveredImages(result, start, count);

  for (let i = start; i < start + count; i++) {
    result[i] = paint(plainText(result[i]), p);
  }
}

function contains(rect: Rect, event: MouseInput): boolean {
  return event.x >= rect.col && event.x < rect.col + rect.width &&
    event.y >= rect.row && event.y < rect.row + rect.height;
}

/** `event` (in content cells) relative to `target`'s origin. */
function localMouse(event: MouseInput, target: MouseTarget): MouseInput {
  return {
    ...event,
    x: event.x - target.originX,
    y: event.y - target.originY,
  };
}

/**
 * Root container that owns the terminal: renders children inline below the
 * shell prompt, routes input, and repaints only the rows that changed.
 *
 * Rendering model: content rows are written top to bottom; rows that no longer
 * fit scroll into the terminal's native scrollback. A change to a row that is
 * still on screen rewrites just the changed range. A change to a row that has
 * already scrolled off, or any resize, clears the screen and scrollback and
 * repaints everything. Visible overlays are drawn over the bottom screenful,
 * which is padded to the full terminal height while any overlay is shown.
 *
 * Add children with {@linkcode Container.addChild}, call {@linkcode TUI.start},
 * and call {@linkcode TUI.requestRender} whenever a component's rows change.
 * Key and paste input goes to the focused component (see
 * {@linkcode TUI.setFocus}) after the listeners from
 * {@linkcode TUI.addInputListener}. Components only get mouse input after
 * enabling it with {@linkcode TUI.setMouse}. A row wider than the terminal
 * makes the next paint throw: wrap or truncate in `render`.
 *
 * @category Core
 *
 * @example Render components headlessly and read the screen
 * ```ts
 * import { Text, TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * const terminal = new VirtualTerminal(20, 4);
 * const tui = new TUI(terminal);
 *
 * tui.addChild(new Text("Hello"));
 * tui.addChild(new Text("world"));
 * tui.start();
 * tui.renderNow();
 *
 * assertEquals(terminal.viewport(), ["Hello", "world", "", ""]);
 *
 * tui.stop();
 * ```
 *
 * @example Run in the real terminal and quit on ctrl+c
 * ```ts ignore
 * import process from "node:process";
 * import { matchesKey, ProcessTerminal, Text, TUI } from "@neonbyte/tui";
 *
 * const tui = new TUI(new ProcessTerminal());
 *
 * tui.addChild(new Text("Press ctrl+c to quit"));
 * tui.addInputListener((event) => {
 *   if (event.type === "key" && matchesKey(event.key, "ctrl+c")) {
 *     tui.stop();
 *     process.exit(0);
 *   }
 * });
 * tui.start();
 * ```
 */
export class TUI extends Container {
  /** The terminal this TUI renders into and reads input from. */
  public readonly terminal: Terminal;
  private readonly parser: InputParser;
  private readonly options: TUIOptions;
  private listeners: InputListener[] = [];
  private resizeListeners: (() => void)[] = [];
  private focusedComponent: Component | null = null;
  private overlays: Overlay[] = [];
  private hardwareCursor: boolean;
  private started = false;

  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private renderPending = false;
  private forceFull = false;
  private lastRenderAt = 0;
  private escapeTimer: ReturnType<typeof setTimeout> | undefined;

  // Startup probe results, applied when the device-attributes reply arrives.
  private probing = false;
  private probeKittyGraphics = false;
  private probeITerm2 = false;
  private probeCellSize: { width: number; height: number } | undefined;

  // Paint state.
  private hasPainted = false;
  private previousLines: readonly string[] = [];
  private previousWidth = 0;
  private previousHeight = 0;
  /** Content row the terminal cursor sits on after the last paint. */
  private cursorRow = 0;
  private cursorVisible = false;
  /** Most rows ever on screen since the last full paint; rows below `extent - height` are visible. */
  private extent = 0;
  /** Kitty image ids currently placed on screen. */
  private kittyPlaced = new Set<number>();

  // Mouse state.
  private mouseMode: MouseMode;
  /** Component that handled the last press; it receives drags and the release. */
  private captured: MouseTarget | undefined;
  /** Component that handled the last move; it gets `leave` when the pointer moves on. */
  private hovered: MouseTarget | undefined;
  /** Overlay the focused component belongs to; hiding it restores the focus it replaced. */
  private focusOverlay: Overlay | null = null;
  /** Screen row of content row 0 at the last full paint, before any scrolling. */
  private originRow = 0;
  /** Whether the cursor position reply sets `originRow`: only until the first clear-and-repaint. */
  private originFromCursor = true;
  private awaitingPosition = false;

  /** Exit/crash handler: restores the terminal without rendering, since rendering may be what failed. */
  private readonly restoreOnExit = (): void => this.teardown();

  /**
   * Creates a TUI. Nothing is drawn and the terminal is not touched until
   * {@linkcode TUI.start}.
   *
   * @param terminal Where to render: {@linkcode ProcessTerminal} for the real
   * terminal, {@linkcode VirtualTerminal} in tests.
   * @param options Image protocol, keyboard, cursor and mouse behaviour; see
   * {@linkcode TUIOptions}.
   */
  public constructor(terminal: Terminal, options: TUIOptions = {}) {
    super();

    this.terminal = terminal;
    this.options = options;
    this.hardwareCursor = options.hardwareCursor ?? false;
    this.mouseMode = options.mouse ?? "off";
    this.parser = new InputParser((event) => this.onParsed(event));
  }

  /**
   * Starts the terminal, hides the cursor, enables the options' mouse and
   * keyboard modes, asks the terminal what it supports, and schedules the
   * first frame. Does nothing when already started. Restarting after
   * {@linkcode TUI.stop} repaints everything.
   *
   * @throws {Error} When the terminal cannot start; this propagates what `Terminal.start` throws, e.g. {@linkcode ProcessTerminal} when stdin is not a terminal.
   *
   * @example Start with mouse reporting
   * ```ts
   * import { Text, TUI, VirtualTerminal } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal(20, 3);
   * const tui = new TUI(terminal, { mouse: "click" });
   *
   * tui.addChild(new Text("ready"));
   * tui.start();
   * tui.renderNow();
   *
   * assertEquals(terminal.mouseModes, [1000, 1006]);
   * assertEquals(terminal.viewport()[0], "ready");
   *
   * tui.stop();
   * ```
   */
  public start(): void {
    if (this.started) {
      return;
    }

    this.started = true;

    this.terminal.start(
      (data) => this.onInput(data),
      () => {
        this.requestRender(true);

        for (const listener of this.resizeListeners) {
          listener();
        }
      },
    );

    const images = this.options.images ?? "auto";

    terminalInfo.imageProtocol = images === "auto" || images === "off"
      ? null
      : images;
    this.probing = true;
    this.awaitingPosition = true;
    this.originFromCursor = !this.hasPainted;
    this.probeKittyGraphics = false;
    this.probeITerm2 = false;
    this.probeCellSize = undefined;
    this.cursorVisible = false;

    this.terminal.write(
      CURSOR_HIDE + MOUSE_ON[this.mouseMode] +
        (this.options.kittyKeyboard === false ? "" : PROBE_KITTY_KEYBOARD) +
        (images === "auto" ? PROBE_KITTY_GRAPHICS + PROBE_VERSION : "") +
        PROBE_CELL_SIZE + PROBE_CURSOR_POSITION + PROBE_DEVICE_ATTRIBUTES,
    );
    process.on("exit", this.restoreOnExit);
    process.on("uncaughtExceptionMonitor", this.restoreOnExit);
    // After stop() the cursor sits below the content and other output may follow, so a restart repaints everything.
    this.requestRender(this.hasPainted);
  }

  /**
   * Paints any pending frame, leaves the cursor below the content, and
   * restores the terminal (cursor, mouse and keyboard modes). Does nothing
   * when not started. Call it before exiting, and before handing the terminal
   * to another program.
   *
   * @throws {Error} When the pending frame has a row wider than the terminal.
   *
   * @example Leave the cursor below the content
   * ```ts
   * import { Text, TUI, VirtualTerminal } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal(20, 3);
   * const tui = new TUI(terminal, { mouse: "click" });
   *
   * tui.addChild(new Text("done"));
   * tui.start();
   * tui.stop();
   *
   * assertEquals(terminal.viewport()[0], "done");
   * assertEquals(terminal.cursor, { x: 0, y: 1, visible: true });
   * assertEquals(terminal.mouseModes, []);
   * ```
   */
  public stop(): void {
    if (!this.started) {
      return;
    }

    if (this.renderPending) {
      this.renderNow();
    }

    this.teardown();
  }

  /** Restores the terminal without painting: stops timers and listeners and resets cursor, mouse and keyboard modes. */
  private teardown(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.probing = false;

    clearTimeout(this.renderTimer);
    clearTimeout(this.escapeTimer);
    process.off("exit", this.restoreOnExit);
    process.off("uncaughtExceptionMonitor", this.restoreOnExit);

    const lastRow = Math.max(0, this.previousLines.length - 1);
    let out = verticalMove(lastRow - this.cursorRow);

    out += this.previousLines.length > 0 ? "\r\n" : "\r";

    if (terminalInfo.kittyKeyboard) {
      out += KITTY_KEYBOARD_POP;
    }

    terminalInfo.kittyKeyboard = false;

    if (this.mouseMode !== "off") {
      out += MOUSE_OFF;
    }

    this.captured = undefined;
    this.hovered = undefined;

    this.terminal.write(out + CURSOR_SHOW + AUTOWRAP_ON);

    this.cursorRow = lastRow;

    this.terminal.stop();
  }

  /**
   * Moves keyboard focus to `component`, or removes focus with `null`. The
   * previous component's `focused` flag is cleared and the new one's is set
   * (see {@linkcode Focusable}). Shown overlays take focus themselves, see
   * {@linkcode OverlayOptions.focus}.
   *
   * @param component The component to focus, or `null` for none.
   *
   * @example Focus a component and read it back
   * ```ts
   * import {
   *   type Component,
   *   type Focusable,
   *   TUI,
   *   VirtualTerminal,
   * } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const tui = new TUI(new VirtualTerminal());
   * const field: Component & Focusable = {
   *   focused: false,
   *   render: () => ["field"],
   * };
   *
   * tui.addChild(field);
   * tui.setFocus(field);
   *
   * assertEquals(tui.focused, field);
   * assertEquals(field.focused, true);
   *
   * tui.setFocus(null);
   *
   * assertEquals(field.focused, false);
   * ```
   */
  public setFocus(component: Component | null): void {
    this.focusIn(component, this.topFocusOverlay());
  }

  /** Focus `component`, remembering the overlay it belongs to so hiding that overlay restores the previous focus. */
  private focusIn(component: Component | null, overlay: Overlay | null): void {
    if (isFocusable(this.focusedComponent)) {
      this.focusedComponent.focused = false;
    }

    this.focusedComponent = component;
    this.focusOverlay = component === null ? null : overlay;

    if (isFocusable(component)) {
      component.focused = true;
      component.hardwareCursor = this.hardwareCursor;
    }

    this.requestRender();
  }

  /** Topmost shown overlay that takes focus, if any. */
  private topFocusOverlay(): Overlay | null {
    for (let i = this.overlays.length - 1; i >= 0; i--) {
      const overlay = this.overlays[i];

      if (!overlay.hidden && overlay.options.focus !== false) {
        return overlay;
      }
    }

    return null;
  }

  /** The component that receives key and paste input, or `null` when none has focus. */
  public get focused(): Component | null {
    return this.focusedComponent;
  }

  /**
   * Shows the terminal's own cursor at the focused caret instead of a drawn
   * one (helps IME placement and accessibility tools). Applies to the focused
   * component now and to every component focused later; see
   * {@linkcode Focusable.hardwareCursor}.
   *
   * @param enabled Whether to use the terminal's cursor. Default `false`.
   *
   * @example Put the terminal cursor on the caret
   * ```ts
   * import {
   *   type Component,
   *   CURSOR_MARKER,
   *   type Focusable,
   *   TUI,
   *   VirtualTerminal,
   * } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal(20, 3);
   * const tui = new TUI(terminal);
   * const field: Component & Focusable = {
   *   focused: false,
   *   render: () => ["> " + (field.focused ? CURSOR_MARKER : "")],
   * };
   *
   * tui.addChild(field);
   * tui.setFocus(field);
   * tui.setHardwareCursor(true);
   * tui.start();
   * tui.renderNow();
   *
   * assertEquals(field.hardwareCursor, true);
   * assertEquals(terminal.cursor, { x: 2, y: 0, visible: true });
   *
   * tui.stop();
   * ```
   */
  public setHardwareCursor(enabled: boolean): void {
    this.hardwareCursor = enabled;

    if (isFocusable(this.focusedComponent)) {
      this.focusedComponent.hardwareCursor = enabled;
    }

    this.requestRender();
  }

  /**
   * Adds a listener that sees every key, paste and mouse event before the
   * focused component (or the component under the pointer). Listeners run in
   * registration order; one that returns `true` consumes the event.
   *
   * @param listener Called with each event; return `true` to consume it.
   * @returns A function that removes the listener.
   *
   * @example Handle a global shortcut
   * ```ts
   * import { type InputEvent, matchesKey, TUI, VirtualTerminal } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal();
   * const tui = new TUI(terminal);
   * const received: string[] = [];
   * const field = {
   *   render: () => ["field"],
   *   handleInput(event: InputEvent) {
   *     received.push(event.type === "key" ? event.key.name : event.type);
   *   },
   * };
   * let quit = false;
   *
   * tui.addChild(field);
   * tui.setFocus(field);
   *
   * const remove = tui.addInputListener((event) => {
   *   if (event.type === "key" && matchesKey(event.key, "ctrl+c")) {
   *     quit = true;
   *
   *     return true;
   *   }
   * });
   *
   * tui.start();
   * terminal.send("a\x03");
   *
   * assertEquals(quit, true);
   * assertEquals(received, ["a"]);
   *
   * remove();
   * terminal.send("\x03");
   *
   * assertEquals(received, ["a", "c"]);
   *
   * tui.stop();
   * ```
   */
  public addInputListener(listener: InputListener): () => void {
    this.listeners.push(listener);

    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /**
   * Calls `listener` after the terminal was resized, while the TUI is
   * started. Read the new size from {@linkcode TUI.terminal}. A redraw is
   * already scheduled.
   *
   * @param listener Called on every resize.
   * @returns A function that removes the listener.
   *
   * @example Follow the terminal width
   * ```ts
   * import { TUI, VirtualTerminal } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal(40, 5);
   * const tui = new TUI(terminal);
   * const widths: number[] = [];
   * const remove = tui.addResizeListener(() => {
   *   widths.push(tui.terminal.columns);
   * });
   *
   * tui.start();
   * terminal.resize(30, 5);
   * remove();
   * terminal.resize(20, 5);
   * tui.stop();
   *
   * assertEquals(widths, [30]);
   * ```
   */
  public addResizeListener(listener: () => void): () => void {
    this.resizeListeners.push(listener);

    return () => {
      this.resizeListeners = this.resizeListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Changes mouse reporting: `"click"` reports presses, releases and the wheel;
   * `"drag"` adds motion while a button is held (needed to drag dividers and
   * scrollbar thumbs); `"move"` adds all motion (hover effects). While on, the
   * terminal no longer scrolls its scrollback with the wheel or selects text
   * on drag (most terminals still select with Shift held). Default `"off"`.
   *
   * @param mode How much mouse input to report.
   *
   * @example Turn on drag reporting
   * ```ts
   * import { TUI, VirtualTerminal } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal();
   * const tui = new TUI(terminal);
   *
   * tui.start();
   * tui.setMouse("drag");
   *
   * assertEquals(tui.mouse, "drag");
   * assertEquals(terminal.mouseModes, [1002, 1006]);
   *
   * tui.stop();
   * ```
   */
  public setMouse(mode: MouseMode): void {
    if (mode === this.mouseMode) {
      return;
    }

    this.mouseMode = mode;
    this.captured = undefined;
    this.hovered = undefined;

    if (this.started) {
      this.terminal.write(MOUSE_OFF + MOUSE_ON[mode]);
    }
  }

  /** The current mouse reporting mode; see {@linkcode TUI.setMouse}. */
  public get mouse(): MouseMode {
    return this.mouseMode;
  }

  /**
   * Draws `component` over the screen. Overlays shown later stack on top. The
   * overlay takes keyboard focus unless {@linkcode OverlayOptions.focus} is
   * `false`, and hiding it gives the focus back.
   *
   * @param component What to draw; it renders at the overlay's width.
   * @param options Size, position, focus and backdrop; see
   * {@linkcode OverlayOptions}.
   * @returns A handle to hide or temporarily hide the overlay.
   *
   * @example Show and hide a popup
   * ```ts
   * import { Text, TUI, VirtualTerminal } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal(20, 5);
   * const tui = new TUI(terminal);
   *
   * tui.addChild(new Text("base line"));
   * tui.start();
   *
   * const popup = tui.showOverlay(new Text("POPUP"), {
   *   anchor: "top-left",
   *   margin: 0,
   *   width: 5,
   * });
   *
   * tui.renderNow();
   *
   * assertEquals(terminal.viewport()[0], "POPUPline");
   *
   * popup.hide();
   * tui.renderNow();
   *
   * assertEquals(terminal.viewport()[0], "base line");
   *
   * tui.stop();
   * ```
   */
  public showOverlay(
    component: Component,
    options: OverlayOptions = {},
  ): OverlayHandle {
    const overlay: Overlay = {
      component,
      options,
      hidden: false,
      previousFocus: this.focusedComponent,
    };

    this.overlays.push(overlay);

    if (options.focus !== false) {
      this.setFocus(component);
    }

    this.requestRender();

    return {
      hide: () => {
        const index = this.overlays.indexOf(overlay);

        if (index === -1) {
          return;
        }

        this.overlays.splice(index, 1);
        this.releaseFocus(overlay);
        this.requestRender();
      },
      setHidden: (hidden: boolean) => {
        if (overlay.hidden === hidden || !this.overlays.includes(overlay)) {
          return;
        }

        overlay.hidden = hidden;

        if (hidden) {
          this.releaseFocus(overlay);
        } else if (options.focus !== false) {
          overlay.previousFocus = this.focusedComponent;

          this.setFocus(component);
        }

        this.requestRender();
      },
      get hidden() {
        return overlay.hidden;
      },
    };
  }

  /** Hands focus back to what had it before `overlay` and drops mouse state that points into it. */
  private releaseFocus(overlay: Overlay): void {
    if (
      this.focusedComponent === overlay.component ||
      this.focusOverlay === overlay
    ) {
      this.setFocus(overlay.previousFocus);
    }

    if (this.captured?.overlay === overlay) {
      this.captured = undefined;
    }

    if (this.hovered?.overlay === overlay) {
      this.hovered = undefined;
    }
  }

  /** Drops cached render output of all children and shown overlays. */
  public override invalidate(): void {
    super.invalidate();

    for (const overlay of this.overlays) {
      overlay.component.invalidate?.();
    }
  }

  /**
   * Schedules a frame. Requests are coalesced and limited to about 60 frames
   * per second; nothing is drawn before {@linkcode TUI.start}. Call it after
   * changing a component, or use {@linkcode TUI.renderNow} to paint at once.
   * The frame is painted later from a timer, so the error
   * {@linkcode TUI.renderNow} throws for a row wider than the terminal is
   * thrown from that timer, not from this call.
   *
   * @param full Clear the screen and scrollback and repaint every row, instead
   * of only the rows that changed. Default `false`.
   *
   * @example Repaint after a component changed
   * ```ts
   * import { Text, TUI, VirtualTerminal } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal(20, 3);
   * const tui = new TUI(terminal);
   * const status = new Text("working");
   *
   * tui.addChild(status);
   * tui.start();
   * tui.renderNow();
   *
   * status.setText("done");
   * tui.requestRender();
   * tui.renderNow();
   *
   * assertEquals(terminal.viewport()[0], "done");
   *
   * tui.stop();
   * ```
   */
  public requestRender(full = false): void {
    if (full) {
      this.forceFull = true;
    }

    if (this.renderPending || !this.started) {
      return;
    }

    this.renderPending = true;

    const delay = Math.max(
      0,
      MIN_FRAME_INTERVAL_MS - (performance.now() - this.lastRenderAt),
    );

    this.renderTimer = setTimeout(() => this.renderNow(), delay);
  }

  /**
   * Paints synchronously, cancelling any scheduled frame. Does nothing before
   * {@linkcode TUI.start}. Mostly for tests; applications call
   * {@linkcode TUI.requestRender}.
   *
   * @throws {Error} When a rendered row is wider than the terminal.
   *
   * @example Paint without waiting for the frame timer
   * ```ts
   * import { type Component, TUI, VirtualTerminal } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal(20, 3);
   * const tui = new TUI(terminal);
   * let rows: readonly string[] = ["one"];
   * const view: Component = { render: () => rows };
   *
   * tui.addChild(view);
   * tui.start();
   * tui.renderNow();
   *
   * assertEquals(terminal.viewport()[0], "one");
   *
   * rows = ["two"];
   * tui.renderNow();
   *
   * assertEquals(terminal.viewport()[0], "two");
   *
   * tui.stop();
   * ```
   */
  public renderNow(): void {
    clearTimeout(this.renderTimer);

    this.renderPending = false;

    if (!this.started) {
      return;
    }

    this.lastRenderAt = performance.now();

    this.paint();
  }

  /** Feeds raw terminal input to the parser and schedules delivery of a held lone Escape. */
  private onInput(data: string): void {
    clearTimeout(this.escapeTimer);
    this.parser.feed(data);

    if (this.parser.pending) {
      this.escapeTimer = setTimeout(
        () => this.parser.flush(),
        ESCAPE_TIMEOUT_MS,
      );
    }
  }

  /** Routes a parsed event: terminal replies to the probe, mouse to the pointer routing, keys and paste to listeners and the focused component. */
  private onParsed(event: ParsedInput): void {
    if (event.type === "report") {
      this.onReport(event);
    } else if (event.type === "mouse") {
      this.dispatchMouse(event);
    } else if (!this.takeCursorPosition(event)) {
      this.dispatch(event);
    }
  }

  /** Consume the reply to the startup cursor position query; it decodes like a modified F3 key. */
  private takeCursorPosition(event: InputEvent): boolean {
    if (!this.awaitingPosition || event.type !== "key") {
      return false;
    }

    const sequence = event.key.sequence;
    const reply = sequence.startsWith("\x1b")
      ? CURSOR_POSITION_REPLY.exec(sequence.slice(1))
      : null;

    if (reply === null) {
      return false;
    }

    this.awaitingPosition = false;

    if (this.originFromCursor) {
      this.originRow = Number(reply[1]) - 1;
    }

    return true;
  }

  /** Delivers a key or paste event to the listeners, then the focused component. */
  private dispatch(event: InputEvent): void {
    if (this.runListeners(event)) {
      return;
    }

    this.focusedComponent?.handleInput?.(event);
    this.requestRender();
  }

  /** Runs the listeners in order; true when one consumed the event. */
  private runListeners(event: InputEvent | MouseInput): boolean {
    for (const listener of [...this.listeners]) {
      if (listener(event) === true) {
        this.requestRender();

        return true;
      }
    }

    return false;
  }

  /** Delivers a mouse event (given in screen cells) to the listeners, then to the captured or hit component. */
  private dispatchMouse(screen: MouseInput): void {
    const event: MouseInput = { ...screen, y: this.contentRow(screen.y) };

    if (this.runListeners(event)) {
      return;
    }

    const captured = this.captured;

    if (
      captured !== undefined &&
      (event.action === "drag" || event.action === "release")
    ) {
      if (event.action === "release") {
        this.captured = undefined;
      }

      captured.component.handleMouse?.(localMouse(event, captured));
    } else {
      this.deliverMouse(event);
    }

    this.requestRender();
  }

  /** Hit-test `event`, then capture, focus and hover whatever handled it. */
  private deliverMouse(event: MouseInput): void {
    const route: MouseRoute = {
      target: undefined,
      rootX: event.x,
      rootY: event.y,
      originX: 0,
      originY: 0,
    };

    mouseRoutes.set(event, route);

    const overlay = this.routeMouse(event);
    const target: MouseTarget | undefined = route.target === undefined
      ? undefined
      : {
        component: route.target,
        originX: route.originX,
        originY: route.originY,
        overlay,
      };

    if (event.action === "press" && target !== undefined) {
      this.captured = target;

      if (
        isFocusable(target.component) &&
        target.component !== this.focusedComponent
      ) {
        this.focusIn(target.component, overlay);
      }
    }

    if (event.action === "move" || event.action === "drag") {
      this.hover(target, event);
    }
  }

  /**
   * Deliver to the topmost visible overlay under the pointer, else to the
   * content. A modal overlay blocks everything beneath it. Returns the overlay
   * the event went to or was blocked by, or `null` for the content.
   */
  private routeMouse(event: MouseInput): Overlay | null {
    for (const overlay of [...this.overlays].reverse()) {
      const rect = overlay.rect;

      if (overlay.hidden || rect === undefined) {
        continue;
      }

      if (contains(rect, event)) {
        forwardMouse(overlay.component, event, rect.col, rect.row);

        return overlay;
      }

      if (event.action === "press") {
        overlay.options.onPressOutside?.();
      }

      if (overlay.options.modal === true) {
        return overlay;
      }
    }

    super.handleMouse(event);

    return null;
  }

  /** Make `target` the hover target, sending `leave` to the previous one. */
  private hover(target: MouseTarget | undefined, event: MouseInput): void {
    const previous = this.hovered;

    this.hovered = target;

    if (previous === undefined || previous.component === target?.component) {
      return;
    }

    previous.component.handleMouse?.(
      localMouse({ ...event, action: "leave", button: "none" }, previous),
    );
  }

  /** Content row shown on screen row `y`: content starts at `originRow` and scrolls up once it reaches the bottom. */
  private contentRow(y: number): number {
    const scrolled = Math.max(
      0,
      this.originRow + this.extent - this.previousHeight,
    );

    return y - this.originRow + scrolled;
  }

  /** Applies a startup probe reply from the terminal. */
  private onReport(report: TerminalReport): void {
    const s = report.sequence;

    if (s.startsWith("\x1b[?") && s.endsWith("u")) {
      // Kitty keyboard flags reply: the protocol is supported.
      if (
        this.options.kittyKeyboard !== false && !terminalInfo.kittyKeyboard
      ) {
        this.terminal.write(KITTY_KEYBOARD_PUSH);

        terminalInfo.kittyKeyboard = true;
      }
    } else if (s.startsWith(`\x1b_Gi=${KITTY_GRAPHICS_PROBE_ID};`)) {
      this.probeKittyGraphics = s.includes(";OK");
    } else if (s.startsWith("\x1bP>|")) {
      this.probeITerm2 = s.includes("iTerm2");
    } else if (s.startsWith("\x1b[6;") && s.endsWith("t")) {
      const [height, width] = s.slice(4, -1).split(";").map(Number);

      if (height > 0 && width > 0) {
        this.probeCellSize = { width, height };
      }
    } else if (s.startsWith("\x1b[?") && s.endsWith("c") && this.probing) {
      this.finishProbe();
    }
  }

  /** Applies the probe results once the device-attributes reply arrives, and re-renders. */
  private finishProbe(): void {
    this.probing = false;
    this.awaitingPosition = false;

    let changed = false;

    if ((this.options.images ?? "auto") === "auto") {
      const protocol = this.detectedImageProtocol();

      changed = protocol !== terminalInfo.imageProtocol;
      terminalInfo.imageProtocol = protocol;
    }

    const cell = this.probeCellSize;

    if (
      cell &&
      (cell.width !== terminalInfo.cellWidthPx ||
        cell.height !== terminalInfo.cellHeightPx)
    ) {
      terminalInfo.cellWidthPx = cell.width;
      terminalInfo.cellHeightPx = cell.height;
      changed = true;
    }

    if (changed) {
      this.invalidate();
      this.requestRender();
    }
  }

  /** Image protocol implied by the probe replies, if any. */
  private detectedImageProtocol(): ImageProtocol | null {
    if (this.probeKittyGraphics) {
      return "kitty";
    }

    if (this.probeITerm2) {
      return "iterm2";
    }

    return null;
  }

  /** Throws when `line` is wider than `width`. */
  private assertFits(line: string, index: number, width: number): void {
    const lineWidth = visibleWidth(line);

    if (lineWidth > width) {
      throw new Error(
        `Rendered row ${index} is ${lineWidth} cells wide but the terminal is ${width}: ${
          JSON.stringify(line)
        }`,
      );
    }
  }

  /** Bytes that rewrite one content row (the cursor is at its start). */
  private row(line: string): string {
    if (line === IMAGE_RESERVED || isImageRow(line)) {
      return ERASE_LINE;
    }

    if (!line.includes("\x1b")) {
      return ERASE_LINE + line;
    }

    const text = line.includes(CURSOR_MARKER)
      ? line.replaceAll(CURSOR_MARKER, "")
      : line;

    // Close styles and hyperlinks so they cannot bleed into the next row.
    return ERASE_LINE + text + RESET + HYPERLINK_CLOSE;
  }

  /**
   * Write rows `from..to`, starting with the cursor at the start of row
   * `from`, and draw every image whose rows all exist once its last row is
   * written. Images are drawn over their blank rows with the cursor saved and
   * restored, so protocols that move the cursor cannot disturb row tracking.
   * Returns images whose remaining rows lie below `to`.
   */
  private writeRows(
    lines: readonly string[],
    from: number,
    to: number,
    height: number,
  ): { out: string; pending: PendingImage[] } {
    let out = "";
    const pending: PendingImage[] = [];

    for (let i = from; i <= to; i++) {
      if (i > from) {
        out += "\r\n";
      }

      const line = lines[i];

      out += this.row(line);

      if (isImageRow(line)) {
        let lastRow = i;

        while (lines[lastRow + 1] === IMAGE_RESERVED) {
          lastRow++;
        }

        pending.push({ row: i, lastRow, sequence: line });
      }

      for (let p = pending.length - 1; p >= 0; p--) {
        if (pending[p].lastRow !== i) {
          continue;
        }

        out += this.drawImage(pending[p], i, height);

        pending.splice(p, 1);
      }
    }

    return { out, pending };
  }

  /** Draw an image whose rows exist, with the cursor on content row `cursorRow`. */
  private drawImage(
    image: PendingImage,
    cursorRow: number,
    height: number,
  ): string {
    const up = cursorRow - image.row;

    if (up > height - 1) {
      return "";
    } // first row already scrolled off screen

    return SAVE_CURSOR + verticalMove(-up) + "\r" + image.sequence +
      RESTORE_CURSOR;
  }

  /** Renders the components, composites overlays, and writes the changed rows to the terminal. */
  private paint(): void {
    const width = this.terminal.columns;
    const height = this.terminal.rows;
    let lines = this.render(width);

    if (this.overlays.some((o) => !o.hidden)) {
      lines = this.compositeOverlays(lines, width, height);
    }

    const previous = this.previousLines;
    const resized = width !== this.previousWidth ||
      height !== this.previousHeight;
    let full = !this.hasPainted || this.forceFull || resized;

    let first = 0;
    let last = 0;

    if (!full) {
      const range = this.dirtyRange(previous, lines, height);

      if (range === undefined) {
        return;
      }

      ({ first, last, full } = range);
    }

    const lastWritten = full
      ? lines.length - 1
      : Math.min(last, lines.length - 1);

    this.assertRowsFit(lines, full ? 0 : first, lastWritten, width);

    let out = SYNC_BEGIN + AUTOWRAP_OFF +
      (this.cursorVisible ? CURSOR_HIDE : "");

    out += this.deleteRemovedKittyImages(lines);

    const rows = full
      ? this.paintFull(lines, height)
      : this.paintDiff(lines, previous, first, last, lastWritten, height);

    out += rows.out;

    // The cursor is now on the last content row; images below the written range are complete.
    const lastRow = Math.max(0, lines.length - 1);

    for (const image of rows.pending) {
      out += this.drawImage(image, lastRow, height);
    }

    out += this.placeCursor(lines, lastRow, height);

    this.terminal.write(out);

    this.previousLines = lines;
    this.previousWidth = width;
    this.previousHeight = height;
    this.extent = Math.max(this.extent, lines.length);
  }

  /**
   * First and last row that differ from the previous frame, or `undefined`
   * when nothing changed. `full` is set when the change reaches rows that
   * already scrolled into native scrollback and so cannot be rewritten.
   */
  private dirtyRange(
    previous: readonly string[],
    lines: readonly string[],
    height: number,
  ): DirtyRange | undefined {
    const maxLength = Math.max(previous.length, lines.length);
    let first = 0;

    while (first < maxLength && previous[first] === lines[first]) {
      first++;
    }

    if (first === maxLength) {
      return undefined;
    }

    let last = maxLength - 1;

    while (last > first && previous[last] === lines[last]) {
      last--;
    }

    // Rewriting part of an image erases it, so restart at the image's first row.
    while (first > 0 && lines[first] === IMAGE_RESERVED) {
      first--;
    }

    // A change in a row that already scrolled into native scrollback cannot be rewritten.
    return { first, last, full: first < this.extent - height };
  }

  /** Throws when a row in `from..to` is wider than `width`. */
  private assertRowsFit(
    lines: readonly string[],
    from: number,
    to: number,
    width: number,
  ): void {
    for (let i = from; i <= to; i++) {
      this.assertFits(lines[i], i, width);
    }
  }

  /** Clear the screen and scrollback and write every row. */
  private paintFull(
    lines: readonly string[],
    height: number,
  ): { out: string; pending: PendingImage[] } {
    // The first paint starts at the cursor so the shell output above stays intact.
    const start = this.hasPainted ? CLEAR_ALL : "\r";
    const rows = this.writeRows(lines, 0, lines.length - 1, height);

    if (this.hasPainted) {
      this.originRow = 0;
      this.originFromCursor = false;
    }

    this.extent = 0;
    this.forceFull = false;
    this.hasPainted = true;

    return { out: start + rows.out, pending: rows.pending };
  }

  /** Rewrite rows `first..lastWritten` in place and erase or skip past the rest. */
  private paintDiff(
    lines: readonly string[],
    previous: readonly string[],
    first: number,
    last: number,
    lastWritten: number,
    height: number,
  ): { out: string; pending: PendingImage[] } {
    // Move to `first`, which is at most one past the previous last row.
    let out = "";

    if (first === previous.length && previous.length > 0) {
      out += verticalMove(previous.length - 1 - this.cursorRow) + "\r\n";
    } else {
      out += verticalMove(first - this.cursorRow) + "\r";
    }

    const rows = this.writeRows(lines, first, lastWritten, height);

    out += rows.out;

    if (last >= lines.length) {
      out += eraseRemovedRows(lines.length, first, lastWritten);
    } else if (lastWritten < lines.length - 1) {
      out += verticalMove(lines.length - 1 - lastWritten);
    }

    return { out, pending: rows.pending };
  }

  /** Move the cursor to the caret (or the line start), update cursor state, and end the frame. */
  private placeCursor(
    lines: readonly string[],
    lastRow: number,
    height: number,
  ): string {
    let out: string;
    const caret = this.findCaret(lines, height);

    if (caret) {
      out = verticalMove(caret.row - lastRow) + `\x1b[${caret.col + 1}G`;
      this.cursorRow = caret.row;
    } else {
      out = "\r";
      this.cursorRow = lastRow;
    }

    this.cursorVisible = caret !== undefined && this.hardwareCursor;

    return out + AUTOWRAP_ON + (this.cursorVisible ? CURSOR_SHOW : "") +
      SYNC_END;
  }

  /** Position of the caret marker within the visible rows, if a focused component drew one. */
  private findCaret(
    lines: readonly string[],
    height: number,
  ): { row: number; col: number } | undefined {
    for (
      let row = lines.length - 1;
      row >= Math.max(0, lines.length - height);
      row--
    ) {
      const index = lines[row].indexOf(CURSOR_MARKER);

      if (index !== -1) {
        return { row, col: visibleWidth(lines[row].slice(0, index)) };
      }
    }

    return undefined;
  }

  /** Delete kitty placements whose image row is no longer part of the content. */
  private deleteRemovedKittyImages(lines: readonly string[]): string {
    const present = new Set<number>();

    for (const line of lines) {
      const id = kittyImageId(line);

      if (id !== undefined) {
        present.add(id);
      }
    }

    let out = "";

    for (const id of this.kittyPlaced) {
      if (!present.has(id)) {
        out += `\x1b_Ga=d,d=I,i=${id},q=2\x1b\\`;
      }
    }

    this.kittyPlaced = present;

    return out;
  }

  /**
   * Draw visible overlays over the bottom screenful of `lines`. Images under
   * an overlay are removed for as long as it covers them, since terminals
   * would draw them on top of it.
   */
  private compositeOverlays(
    lines: readonly string[],
    width: number,
    height: number,
  ): string[] {
    const result = [...lines];

    while (result.length < height) {
      result.push("");
    }

    const top = result.length - height;

    for (const overlay of this.overlays) {
      overlay.rect = undefined;

      if (overlay.hidden) {
        continue;
      }

      const { options } = overlay;
      const bounds = overlayBounds(options, width, height);
      const overlayWidth = bounds.width;
      const rows = overlay.component.render(overlayWidth).slice(
        0,
        bounds.maxHeight,
      );

      if (rows.length === 0) {
        continue;
      }

      const anchor = options.anchor ?? "center";
      const row = Math.max(
        0,
        Math.min(
          height - rows.length,
          anchoredRow(anchor, bounds.margin, height, rows.length) +
            (options.offsetY ?? 0),
        ),
      );
      const col = Math.max(
        0,
        Math.min(
          width - overlayWidth,
          anchoredCol(anchor, bounds.margin, width, overlayWidth) +
            (options.offsetX ?? 0),
        ),
      );

      if (options.backdrop !== undefined) {
        applyBackdrop(result, top, height, options.backdrop);
      }

      clearCoveredImages(result, top + row, rows.length);

      for (let i = 0; i < rows.length; i++) {
        const target = top + row + i;

        result[target] = overlayRow(
          result[target],
          rows[i],
          col,
          overlayWidth,
          width,
        );
      }

      overlay.rect = {
        row: top + row,
        col,
        width: overlayWidth,
        height: rows.length,
      };
    }

    return result;
  }
}
