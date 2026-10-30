import {
  bindKeys,
  type InputEvent,
  matchesKey,
  type MouseInput,
} from "../keys.ts";
import {
  type Component,
  type Focusable,
  forwardMouse,
  isFocusable,
  type OverlayAnchor,
  type OverlayHandle,
  type OverlaySize,
  type TUI,
} from "../tui.ts";
import { type BorderGlyphs, BORDERS, Box, type BoxTheme } from "./box.ts";

/**
 * Paints per element of the panel's frame: border, title and footer.
 *
 * @category Overlays
 */
export type OverlayTheme = BoxTheme;

/**
 * What a key does to a shown {@link Overlay}: `"close"` hides it.
 *
 * @category Overlays
 */
export type OverlayAction = "close";

/**
 * Default key bindings of an {@link Overlay}.
 *
 * @category Overlays
 */
export const DEFAULT_OVERLAY_KEYS: Readonly<
  Record<OverlayAction, readonly string[]>
> = {
  close: ["escape"],
};

/**
 * Frame, placement and behaviour of an {@link Overlay}.
 *
 * @category Overlays
 */
export interface OverlayPanelOptions {
  /** Text in the top edge of the frame. Ignored without a frame. */
  title?: string;
  /** Text in the bottom edge of the frame, right-aligned. Ignored without a frame. */
  footer?: string;
  /** Frame glyphs. Default `BORDERS.rounded`; `null` draws the content alone. */
  border?: BorderGlyphs | null;
  /** Paints for the frame, title and footer, each replacing its default. Ignored without a frame. */
  theme?: OverlayTheme;
  /** Cells between the frame and the content: `[vertical, horizontal]` or one value for both. Default `[0, 1]`. Ignored without a frame. */
  padding?: number | readonly [number, number];
  /** Mark at the end of a title or footer cut to fit. Default `"…"`. Ignored without a frame. */
  ellipsis?: string;
  /** Default `"center"`. */
  anchor?: OverlayAnchor;
  /** Cells or a percentage of the terminal width, frame included. Default: the terminal width minus margins, at most 80. */
  width?: OverlaySize;
  /** Rows beyond this are cut. Default: the terminal height minus margins. */
  maxHeight?: OverlaySize;
  /** Distance kept from the screen edges. Default 1. */
  margin?: number;
  /** Shift of the panel from its anchor, in columns. */
  offsetX?: number;
  /** Shift of the panel from its anchor, in rows. */
  offsetY?: number;
  /** Give the panel keyboard focus while shown; keys then reach the content. Default true. */
  focus?: boolean;
  /** The close key closes the panel while it has focus. Default true. */
  closeOnEscape?: boolean;
  /** Key specs per action; an entry replaces the default list for that action. See {@link DEFAULT_OVERLAY_KEYS}. */
  keys?: Partial<Record<OverlayAction, readonly string[]>>;
  /** A mouse press outside the panel closes it. Default false. */
  closeOnPressOutside?: boolean;
  /** Called after the panel closes, whatever closed it. */
  onClose?: () => void;
}

/**
 * What the TUI shows: the framed content. Focus given to the panel is passed
 * on to the content, so a focused input inside keeps its caret.
 */
class PanelView implements Component, Focusable {
  private content: Component;
  private readonly box: Box | undefined;
  private active = false;
  private cursor: boolean | undefined;
  private pointerFocus = false;
  private shownWidth = 0;
  private shownRows = 0;

  public constructor(content: Component, box: Box | undefined) {
    this.content = content;
    this.box = box;
  }

  public get focused(): boolean {
    return this.active;
  }

  public set focused(value: boolean) {
    this.active = value;

    if (isFocusable(this.content)) {
      this.content.focused = value;
    }
  }

  public get hardwareCursor(): boolean | undefined {
    return this.cursor;
  }

  public set hardwareCursor(value: boolean | undefined) {
    this.cursor = value;

    if (isFocusable(this.content)) {
      this.content.hardwareCursor = value;
    }
  }

  public setContent(content: Component): void {
    if (isFocusable(this.content)) {
      this.content.focused = false;
    }

    this.content = content;

    if (this.box !== undefined) {
      this.box.child = content;
    }

    this.focused = this.active;
  }

  public setTitle(title: string | undefined): void {
    this.box?.setTitle(title);
  }

  public setTheme(theme: OverlayTheme): void {
    this.box?.setTheme(theme);
  }

  /**
   * Whether `focused` is this panel's content: the panel itself, the content,
   * or something inside it that a click focused after the last press outside.
   */
  public holds(focused: Component | null): boolean {
    return focused === this || focused === this.content ||
      (this.pointerFocus && focused !== null);
  }

  /** Forget that a click inside moved the focus. */
  public releasePointerFocus(): void {
    this.pointerFocus = false;
  }

  public invalidate(): void {
    (this.box ?? this.content).invalidate?.();
  }

  public handleInput(event: InputEvent): void {
    this.content.handleInput?.(event);
  }

  /** Events on the frame itself do not reach the content. */
  public handleMouse(event: MouseInput): boolean {
    if (!this.insideContent(event)) {
      return false;
    }

    const handled = forwardMouse(this.box ?? this.content, event);

    if (handled && event.action === "press") {
      this.pointerFocus = true;
    }

    return handled;
  }

  public render(width: number, height?: number): readonly string[] {
    const rows = (this.box ?? this.content).render(width, height);

    this.shownWidth = width;
    this.shownRows = rows.length;

    return rows;
  }

  /** Whether the pointer lies inside the content area rather than on the frame. */
  private insideContent(event: MouseInput): boolean {
    if (this.box === undefined) {
      return true;
    }

    const [top, left] = this.box.inset;

    return event.x >= left && event.x < this.shownWidth - left &&
      event.y >= top && event.y < this.shownRows - top;
  }
}

/**
 * A floating panel over the screen: the friendly wrapper over
 * `tui.showOverlay`. It is not modal, so the content beneath keeps its mouse
 * input. While shown it takes keyboard focus (unless `focus` is false); Escape
 * closes it before the content sees the key, every other key goes to the
 * content, and hiding restores the focus held before. `keys` rebinds the
 * close key.
 *
 * @example Show and hide a framed panel
 * ```ts
 * import { assert, assertEquals } from "@std/assert";
 * import { Overlay, Text, TUI, VirtualTerminal } from "@neonbyte/tui";
 *
 * const terminal = new VirtualTerminal(30, 8);
 * const tui = new TUI(terminal);
 * const overlay = new Overlay(tui, new Text("Hello"), { title: "Greeting" });
 *
 * tui.start();
 * overlay.show();
 * tui.renderNow();
 * assert(terminal.viewport().some((row) => row.includes("Hello")));
 *
 * terminal.send("\x1b[27u"); // Escape closes it
 * assertEquals(overlay.visible, false);
 * tui.stop();
 * ```
 *
 * @category Overlays
 */
export class Overlay {
  private readonly tui: TUI;
  private readonly options: OverlayPanelOptions;
  private readonly keys: Readonly<Record<OverlayAction, readonly string[]>>;
  private readonly panel: PanelView;
  private handle: OverlayHandle | undefined;
  private stopListening: (() => void) | undefined;

  /**
   * Create a hidden panel; call {@linkcode Overlay.show} to show it.
   *
   * @param tui The TUI the panel is shown on.
   * @param content What the panel shows.
   * @param options Frame, placement and behaviour; see {@linkcode OverlayPanelOptions}.
   */
  public constructor(
    tui: TUI,
    content: Component,
    options: OverlayPanelOptions = {},
  ) {
    this.tui = tui;
    this.options = options;
    this.keys = bindKeys(DEFAULT_OVERLAY_KEYS, options.keys);

    const border = options.border === undefined
      ? BORDERS.rounded
      : options.border;

    this.panel = new PanelView(
      content,
      border === null ? undefined : new Box(content, {
        border,
        title: options.title,
        footer: options.footer,
        theme: options.theme,
        padding: options.padding,
        ellipsis: options.ellipsis,
      }),
    );
  }

  /** Whether the panel is shown. */
  public get visible(): boolean {
    return this.handle !== undefined;
  }

  /**
   * Show the panel; does nothing while it is already shown.
   *
   * @example Show a panel at the top left
   * ```ts
   * import { assert } from "@std/assert";
   * import { Overlay, Text, TUI, VirtualTerminal } from "@neonbyte/tui";
   *
   * const terminal = new VirtualTerminal(30, 8);
   * const tui = new TUI(terminal);
   * const overlay = new Overlay(tui, new Text("Hello"), { anchor: "top-left" });
   *
   * tui.start();
   * overlay.show();
   * tui.renderNow();
   * assert(overlay.visible);
   * assert(terminal.viewport()[2].includes("Hello"));
   *
   * overlay.hide();
   * tui.stop();
   * ```
   */
  public show(): void {
    if (this.handle !== undefined) {
      return;
    }

    const options = this.options;

    this.panel.releasePointerFocus();

    if (options.closeOnEscape !== false && options.focus !== false) {
      this.stopListening = this.tui.addInputListener((event) =>
        this.onInput(event)
      );
    }

    this.handle = this.tui.showOverlay(this.panel, {
      width: options.width,
      maxHeight: options.maxHeight,
      anchor: options.anchor,
      margin: options.margin,
      offsetX: options.offsetX,
      offsetY: options.offsetY,
      focus: options.focus,
      onPressOutside: () => this.onPressOutside(),
    });
  }

  /**
   * Close the panel and restore the previous focus; does nothing while it is hidden.
   * `onClose` is called.
   *
   * @example Hide a panel
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Overlay, Text, TUI, VirtualTerminal } from "@neonbyte/tui";
   *
   * const tui = new TUI(new VirtualTerminal(30, 8));
   * let closed = 0;
   * const overlay = new Overlay(tui, new Text("Hello"), {
   *   onClose: () => closed++,
   * });
   *
   * tui.start();
   * overlay.show();
   * overlay.hide();
   * assertEquals(overlay.visible, false);
   * assertEquals(closed, 1);
   * tui.stop();
   * ```
   */
  public hide(): void {
    const handle = this.handle;

    if (handle === undefined) {
      return;
    }

    this.handle = undefined;

    this.stopListening?.();

    this.stopListening = undefined;

    handle.hide();
    this.options.onClose?.();
  }

  /**
   * Show the panel when hidden, hide it when shown.
   *
   * @example Toggle from a key handler
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Overlay, Text, TUI, VirtualTerminal } from "@neonbyte/tui";
   *
   * const tui = new TUI(new VirtualTerminal(30, 8));
   * const overlay = new Overlay(tui, new Text("Help"));
   *
   * tui.start();
   * overlay.toggle();
   * assertEquals(overlay.visible, true);
   * overlay.toggle();
   * assertEquals(overlay.visible, false);
   * tui.stop();
   * ```
   */
  public toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Replace the content, keeping the frame and the focus.
   *
   * @param content The new content.
   *
   * @example Swap what the panel shows
   * ```ts
   * import { assert } from "@std/assert";
   * import { Overlay, Text, TUI, VirtualTerminal } from "@neonbyte/tui";
   *
   * const terminal = new VirtualTerminal(30, 8);
   * const tui = new TUI(terminal);
   * const overlay = new Overlay(tui, new Text("Loading…"));
   *
   * tui.start();
   * overlay.show();
   * overlay.setContent(new Text("Ready"));
   * tui.renderNow();
   * assert(terminal.viewport().some((row) => row.includes("Ready")));
   *
   * overlay.hide();
   * tui.stop();
   * ```
   */
  public setContent(content: Component): void {
    this.panel.setContent(content);
    this.tui.requestRender();
  }

  /**
   * Replace some frame paints; others keep their values. Does nothing without a frame.
   *
   * @param theme The paints to change; see {@linkcode OverlayTheme}.
   *
   * @example Colour the border
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Overlay, Text, TUI, VirtualTerminal } from "@neonbyte/tui";
   *
   * const tui = new TUI(new VirtualTerminal(30, 8));
   * const overlay = new Overlay(tui, new Text("Hello"));
   *
   * tui.start();
   * overlay.setTheme({ border: { fg: "#e05050" } });
   * overlay.show();
   * assertEquals(overlay.visible, true);
   * overlay.hide();
   * tui.stop();
   * ```
   */
  public setTheme(theme: OverlayTheme): void {
    this.panel.setTheme(theme);
    this.tui.requestRender();
  }

  /**
   * Change the frame's title; `undefined` removes it.
   *
   * @param title The new title text, or `undefined` for none.
   *
   * @example Retitle a shown panel
   * ```ts
   * import { assert } from "@std/assert";
   * import { Overlay, Text, TUI, VirtualTerminal } from "@neonbyte/tui";
   *
   * const terminal = new VirtualTerminal(30, 8);
   * const tui = new TUI(terminal);
   * const overlay = new Overlay(tui, new Text("Hello"), { title: "Old" });
   *
   * tui.start();
   * overlay.show();
   * overlay.setTitle("New");
   * tui.renderNow();
   * assert(terminal.viewport().some((row) => row.includes("New")));
   *
   * overlay.hide();
   * tui.stop();
   * ```
   */
  public setTitle(title: string | undefined): void {
    this.panel.setTitle(title);
    this.tui.requestRender();
  }

  /** Hide the panel when the close key arrives while the panel holds the focus. */
  private onInput(event: InputEvent | MouseInput): boolean {
    if (
      event.type !== "key" ||
      !this.keys.close.some((spec) => matchesKey(event.key, spec)) ||
      !this.panel.holds(this.tui.focused)
    ) {
      return false;
    }

    this.hide();

    return true;
  }

  /** Release pointer focus, and hide the panel if `closeOnPressOutside` is set. */
  private onPressOutside(): void {
    this.panel.releasePointerFocus();

    if (this.options.closeOnPressOutside === true) {
      this.hide();
    }
  }
}
