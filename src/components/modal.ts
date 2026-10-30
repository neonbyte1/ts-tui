import { bindKeys, type Key, matchesKey, type MouseInput } from "../keys.ts";
import type { Paint } from "../style.ts";
import {
  type Component,
  Container,
  forwardMouse,
  isFocusable,
  type OverlayHandle,
  type OverlayOptions,
  type OverlaySize,
  type TUI,
} from "../tui.ts";
import { type BorderGlyphs, Box, type BoxTheme } from "./box.ts";
import {
  Button,
  type ButtonAction,
  type ButtonGlyphs,
  ButtonRow,
  type ButtonRowOptions,
  type ButtonTheme,
  type ButtonVariant,
} from "./button.ts";
import { Spacer } from "./spacer.ts";
import { Text } from "./text.ts";

/**
 * What closed a {@link Modal}: `"escape"` the close key, `"backdrop"` a press
 * outside the dialog, `"button"` a button press, `"close"` a call to
 * {@linkcode Modal.close}.
 *
 * @category Overlays
 */
export type ModalCloseReason = "escape" | "backdrop" | "button" | "close";

/**
 * What a key does while a {@link Modal} is open: close it, move the focus
 * over the body and the buttons, or select the previous or next button.
 *
 * @category Overlays
 */
export type ModalAction =
  | "close"
  | "focusNext"
  | "focusPrev"
  | "previousButton"
  | "nextButton";

/**
 * Default key bindings of a {@link Modal}.
 *
 * @category Overlays
 */
export const DEFAULT_MODAL_KEYS: Readonly<
  Record<ModalAction, readonly string[]>
> = {
  close: ["escape"],
  focusNext: ["tab"],
  focusPrev: ["shift+tab"],
  previousButton: ["left"],
  nextButton: ["right"],
};

/**
 * Paints per element of a {@link Modal}: its frame, the screen beneath and the buttons.
 *
 * @category Overlays
 */
export interface ModalTheme extends BoxTheme {
  /** Restyle of the screen beneath, as plain text. Default dim grey `{ fg: "#5c6370" }`; `null` leaves it as it is. */
  readonly backdrop?: Paint | null;
  /** Paints for every button, each state replacing the variant's default; a button's own `theme` wins. */
  readonly buttons?: ButtonTheme;
}

/**
 * One button of a {@link Modal}, pressed by click or by Enter while focused.
 *
 * @category Overlays
 */
export interface ModalButton {
  /** Text of the button. */
  label: string;
  /** Default `"default"`. */
  variant?: ButtonVariant;
  /** Called when the button is pressed, before the modal closes. */
  onPress?: () => void;
  /** Close the modal after `onPress`. Default true. */
  close?: boolean;
  /** Paints for this button, replacing the modal's `theme.buttons` and the variant's defaults per state. */
  theme?: ButtonTheme;
  /** Characters of this button, replacing the modal's `buttonGlyphs`. */
  glyphs?: Partial<ButtonGlyphs>;
}

/**
 * Content, buttons, look and behaviour of a {@link Modal}.
 *
 * @category Overlays
 */
export interface ModalOptions {
  /** Text in the top edge of the frame. */
  title?: string;
  /** Text in the bottom edge of the frame, right-aligned. */
  footer?: string;
  /** A component, or a string shown as wrapped text. */
  body?: Component | string;
  /** Buttons along the bottom, right-aligned. */
  buttons?: readonly ModalButton[];
  /** Width in cells or a percentage of the terminal. Default 50. */
  width?: OverlaySize;
  /** The close key (Escape by default) closes the modal. Default true. */
  closeOnEscape?: boolean;
  /** A mouse press outside the dialog closes it. Default false. */
  closeOnBackdrop?: boolean;
  /** Paints for the frame, the backdrop and the buttons, each replacing its default. */
  theme?: ModalTheme;
  /** Frame glyphs. Default `BORDERS.rounded`. */
  border?: BorderGlyphs;
  /** Cells between the frame and the content: `[vertical, horizontal]` or one value for both. Default `[1, 2]`. */
  padding?: number | readonly [number, number];
  /** Mark at the end of a title or footer cut to fit. Default `"…"`. */
  ellipsis?: string;
  /** Empty rows between the body and the buttons. Default 1. */
  bodyGap?: number;
  /** Layout, separator and keys of the button row. Default: right-aligned. */
  buttonRow?: ButtonRowOptions;
  /** Characters of every button, each replacing its default from `BUTTON_GLYPHS.padded`. */
  buttonGlyphs?: Partial<ButtonGlyphs>;
  /** Key specs of every button; an entry replaces the default list for that action. */
  buttonKeys?: Partial<Record<ButtonAction, readonly string[]>>;
  /** Key specs per action; an entry replaces the default list for that action. See {@link DEFAULT_MODAL_KEYS}. */
  keys?: Partial<Record<ModalAction, readonly string[]>>;
  /** Called after the modal closed, with what closed it. */
  onClose?: (reason: ModalCloseReason) => void;
}

const DEFAULT_BACKDROP: Paint = { fg: "#5c6370" };

const FRAME_KEYS = ["border", "title", "footer"] as const;

/** Actions in the order their keys are tried. */
const ACTIONS: readonly ModalAction[] = [
  "close",
  "focusNext",
  "focusPrev",
  "previousButton",
  "nextButton",
];

/**
 * A blocking dialog shown over the TUI: a frame with an optional title, a
 * body and a row of buttons. While open it blocks the mouse beneath it and
 * owns the keyboard: Escape closes it, Tab and Shift+Tab move the focus over
 * the body (when it is focusable, e.g. a text field) and the buttons, ←/→ move
 * between buttons, and every other key goes to the focused component. `keys`
 * rebinds all of these.
 *
 * It starts with the body focused if the body is focusable, else the first
 * `"primary"` button, else the first button. Closing restores the focus held
 * before `open()`. Clicking a button presses it, which needs mouse mode
 * `"click"` or more.
 *
 * @example Ask for a decision
 * ```ts
 * import { assert, assertEquals } from "@std/assert";
 * import { Modal, TUI, VirtualTerminal } from "@neonbyte/tui";
 *
 * const terminal = new VirtualTerminal(30, 8);
 * const tui = new TUI(terminal);
 * let reason = "";
 * const modal = new Modal(tui, {
 *   title: "Save",
 *   body: "Save changes?",
 *   buttons: [{ label: "Yes", variant: "primary" }, { label: "No" }],
 *   onClose: (why) => reason = why,
 * });
 *
 * tui.start();
 * modal.open();
 * tui.renderNow();
 * assert(terminal.viewport().some((row) => row.includes("Save changes?")));
 *
 * terminal.send("\r"); // Enter presses the focused primary button
 * assertEquals(reason, "button");
 * tui.stop();
 * ```
 *
 * @category Overlays
 */
export class Modal implements Component {
  private readonly tui: TUI;
  private readonly options: ModalOptions;
  private readonly keys: Readonly<Record<ModalAction, readonly string[]>>;
  private readonly body: Component | undefined;
  private readonly row: ButtonRow;
  private readonly box: Box;
  private theme: ModalTheme;
  private overlayOptions: OverlayOptions | undefined;
  private handle: OverlayHandle | undefined;
  private unsubscribe: (() => void) | undefined;

  /**
   * Create a closed dialog; call {@linkcode Modal.open} to show it.
   *
   * @param tui The TUI the dialog is shown on.
   * @param options Content, buttons, look and behaviour; see {@linkcode ModalOptions}.
   */
  public constructor(tui: TUI, options: ModalOptions = {}) {
    this.tui = tui;
    this.options = options;
    this.theme = { ...options.theme };
    this.keys = bindKeys(DEFAULT_MODAL_KEYS, options.keys);
    this.body = typeof options.body === "string"
      ? new Text(options.body)
      : options.body;
    this.row = new ButtonRow(
      (options.buttons ?? []).map((spec) => this.makeButton(spec)),
      { align: "right", ...options.buttonRow },
    );

    const content = new Container();
    const gap = Math.max(0, Math.floor(options.bodyGap ?? 1));

    if (this.body !== undefined) {
      content.addChild(this.body);
    }

    if (this.body !== undefined && this.row.buttons.length > 0 && gap > 0) {
      content.addChild(new Spacer(gap));
    }

    if (this.row.buttons.length > 0) {
      content.addChild(this.row);
    }

    this.box = new Box(content, {
      title: options.title,
      footer: options.footer,
      border: options.border,
      padding: options.padding ?? [1, 2],
      ellipsis: options.ellipsis,
      theme: this.frameTheme(),
    });
  }

  /** Whether the dialog is shown. */
  public get isOpen(): boolean {
    return this.handle !== undefined;
  }

  /**
   * Show the dialog and take the keyboard; does nothing while open.
   *
   * @example Open and close a dialog
   * ```ts
   * import { assert, assertEquals } from "@std/assert";
   * import { Modal, TUI, VirtualTerminal } from "@neonbyte/tui";
   *
   * const terminal = new VirtualTerminal(30, 8);
   * const tui = new TUI(terminal);
   * const modal = new Modal(tui, { title: "Hi", body: "Hello" });
   *
   * tui.start();
   * modal.open();
   * tui.renderNow();
   * assert(modal.isOpen);
   * assert(terminal.viewport().some((row) => row.includes("Hello")));
   *
   * modal.close();
   * tui.renderNow();
   * assertEquals(terminal.viewport().join(""), "");
   * tui.stop();
   * ```
   */
  public open(): void {
    if (this.isOpen) {
      return;
    }

    this.unsubscribe = this.tui.addInputListener((event) =>
      event.type === "key" ? this.handleKey(event.key) : false
    );
    // The TUI reads these options on every render, so `setTheme` can change the backdrop in place.
    this.overlayOptions = {
      width: this.options.width ?? 50,
      modal: true,
      focus: true,
      backdrop: this.backdrop(),
      onPressOutside: this.options.closeOnBackdrop === true
        ? () => this.dismiss("backdrop")
        : undefined,
    };
    this.handle = this.tui.showOverlay(this, this.overlayOptions);

    this.tui.setFocus(this.initialFocus() ?? this);
  }

  /**
   * Hide the dialog and restore the focus it replaced; does nothing while closed.
   * `onClose` gets the reason `"close"`.
   *
   * @example Close from code
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Modal, type ModalCloseReason, TUI, VirtualTerminal } from "@neonbyte/tui";
   *
   * const tui = new TUI(new VirtualTerminal(30, 8));
   * let reason: ModalCloseReason | undefined;
   * const modal = new Modal(tui, { body: "Working…", onClose: (r) => reason = r });
   *
   * tui.start();
   * modal.open();
   * modal.close();
   * assertEquals(reason, "close");
   * assertEquals(modal.isOpen, false);
   * tui.stop();
   * ```
   */
  public close(): void {
    this.dismiss("close");
  }

  /**
   * Replace some paints, on the frame, the backdrop and the buttons; others keep their values.
   *
   * @param theme The paints to change; see {@linkcode ModalTheme}.
   *
   * @example Remove the backdrop dimming
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Modal, TUI, VirtualTerminal } from "@neonbyte/tui";
   *
   * const terminal = new VirtualTerminal(30, 8);
   * const tui = new TUI(terminal);
   * const modal = new Modal(tui, { body: "Hello" });
   *
   * tui.start();
   * modal.setTheme({ backdrop: null });
   * modal.open();
   * tui.renderNow();
   * assertEquals(modal.isOpen, true);
   * modal.close();
   * tui.stop();
   * ```
   */
  public setTheme(theme: ModalTheme): void {
    this.theme = {
      ...this.theme,
      ...theme,
      buttons: { ...this.theme.buttons, ...theme.buttons },
    };

    this.box.setTheme(this.frameTheme());

    const specs = this.options.buttons ?? [];

    this.row.buttons.forEach((button, i) => {
      button.setTheme({ ...this.theme.buttons, ...specs[i]?.theme });
    });

    if (this.overlayOptions !== undefined) {
      this.overlayOptions.backdrop = this.backdrop();
    }

    this.tui.requestRender();
  }

  /**
   * Change the frame's title; `undefined` removes it.
   *
   * @param title The new title text, or `undefined` for none.
   *
   * @example Retitle an open dialog
   * ```ts
   * import { assert } from "@std/assert";
   * import { Modal, TUI, VirtualTerminal } from "@neonbyte/tui";
   *
   * const terminal = new VirtualTerminal(30, 8);
   * const tui = new TUI(terminal);
   * const modal = new Modal(tui, { title: "Old", body: "Hello" });
   *
   * tui.start();
   * modal.open();
   * modal.setTitle("New");
   * tui.renderNow();
   * assert(terminal.viewport().some((row) => row.includes("New")));
   *
   * modal.close();
   * tui.stop();
   * ```
   */
  public setTitle(title: string | undefined): void {
    this.box.setTitle(title);
    this.tui.requestRender();
  }

  public invalidate(): void {
    this.box.invalidate();
  }

  /**
   * Pass a mouse event on to the dialog's content.
   *
   * @param event The mouse report, relative to the dialog.
   * @returns Whether the content handled the event.
   */
  public handleMouse(event: MouseInput): boolean {
    return forwardMouse(this.box, event);
  }

  /**
   * Draw the dialog's frame, body and buttons.
   *
   * @param width Available width in cells.
   * @returns The rendered rows.
   */
  public render(width: number): readonly string[] {
    return this.box.render(width);
  }

  /** The frame's own paints: the theme without the backdrop and the buttons, and without unset keys. */
  private frameTheme(): BoxTheme {
    const frame: { border?: Paint; title?: Paint; footer?: Paint } = {};

    for (const key of FRAME_KEYS) {
      const value = this.theme[key];

      if (value !== undefined) {
        frame[key] = value;
      }
    }

    return frame;
  }

  /** The backdrop paint the overlay gets; `undefined` leaves the screen as it is. */
  private backdrop(): Paint | undefined {
    const { backdrop } = this.theme;

    return backdrop === null ? undefined : backdrop ?? DEFAULT_BACKDROP;
  }

  /** The button for `spec`: a press runs its `onPress`, then closes the dialog unless `close` is false. */
  private makeButton(spec: ModalButton): Button {
    return new Button(spec.label, {
      variant: spec.variant,
      theme: { ...this.theme.buttons, ...spec.theme },
      glyphs: { ...this.options.buttonGlyphs, ...spec.glyphs },
      keys: this.options.buttonKeys,
      onPress: () => {
        spec.onPress?.();

        if (spec.close !== false) {
          this.dismiss("button");
        }
      },
    });
  }

  /** Hide the dialog and report `reason` to `onClose`; does nothing while closed. */
  private dismiss(reason: ModalCloseReason): void {
    const handle = this.handle;

    if (handle === undefined) {
      return;
    }

    this.handle = undefined;
    this.overlayOptions = undefined;

    this.unsubscribe?.();

    this.unsubscribe = undefined;

    handle.hide();

    this.options.onClose?.(reason);
  }

  /** The component focused on open: the body when focusable, else the primary or first button. */
  private initialFocus(): Component | undefined {
    if (this.body !== undefined && isFocusable(this.body)) {
      return this.body;
    }

    const buttons = this.row.buttons;

    return buttons.find((button) => button.variant === "primary") ??
      buttons[0];
  }

  /** Keys the dialog claims; everything else reaches the focused component. */
  private handleKey(key: Key): boolean {
    if (!this.isOpen) {
      return false;
    }

    const action = ACTIONS.find((name) =>
      this.keys[name].some((spec) => matchesKey(key, spec))
    );

    switch (action) {
      case "close":
        if (this.options.closeOnEscape === false) {
          return false;
        }

        this.dismiss("escape");

        return true;
      case "focusNext":
        this.cycle(this.focusOrder(), 1);

        return true;
      case "focusPrev":
        this.cycle(this.focusOrder(), -1);

        return true;
      case "previousButton":
      case "nextButton":
        if (!this.onButton()) {
          return false;
        }

        this.cycle(this.shownButtons(), action === "nextButton" ? 1 : -1);

        return true;
      default:
        return false;
    }
  }

  /** Whether a button holds the focus. */
  private onButton(): boolean {
    return this.row.buttons.some((button) => button === this.tui.focused);
  }

  /** Enabled buttons that fit at the current width. */
  private shownButtons(): Button[] {
    return this.row.buttons
      .slice(0, this.row.visibleCount)
      .filter((button) => !button.disabled);
  }

  /** Components the focus keys cycle over: the focusable body, then the shown buttons. */
  private focusOrder(): Component[] {
    const body = this.body !== undefined && isFocusable(this.body)
      ? [this.body]
      : [];

    return [...body, ...this.shownButtons()];
  }

  /** Focus the component after (or before) the focused one in `order`, wrapping around. */
  private cycle(order: readonly Component[], step: 1 | -1): void {
    if (order.length === 0) {
      return;
    }

    // Nothing in `order` focused: start before the first entry going forward, past the last going back.
    const from = Math.max(
      order.findIndex((c) => c === this.tui.focused),
      step > 0 ? -1 : 0,
    );
    const next = (from + step + order.length) % order.length;
    const target = order[next];
    const index = this.row.buttons.findIndex((button) => button === target);

    this.tui.setFocus(target);

    if (index !== -1) {
      this.row.select(index);
    }
  }
}
