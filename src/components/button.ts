import {
  bindKeys,
  type InputEvent,
  type Key,
  matchesKey,
  type MouseInput,
} from "../keys.ts";
import { mergePaint, mixColors, type Paint, paint } from "../style.ts";
import { type Component, type Focusable, forwardMouse } from "../tui.ts";
import { truncateToWidth, visibleWidth } from "../width.ts";

/**
 * Colour family of a button: a neutral grey, the accent blue, or a destructive red.
 *
 * @category Controls
 */
export type ButtonVariant = "default" | "primary" | "danger";

/**
 * Paint per button state. States are layered over `normal` in the order
 * focused, hover, pressed, disabled, so each one only needs the attributes
 * that differ. A value replaces that state's default for the variant.
 *
 * @category Controls
 */
export interface ButtonTheme {
  /** Resting button. Default: a filled background in the variant's colour. */
  normal?: Paint;
  /** Pointer over the button (needs mouse mode `"move"`). Default: a lighter background. */
  hover?: Paint;
  /** Keyboard focus. Default: bold, underlined, slightly lighter. */
  focused?: Paint;
  /** Between a press on the button and the release. Default: a darker background. */
  pressed?: Paint;
  /** Disabled button. Default: muted text on a dark background. */
  disabled?: Paint;
}

/**
 * Characters a button draws around and inside its label: `left` and `right`
 * frame the label (they may span several cells, e.g. `"[ "`), `fill` pads the
 * label out to the button's width and must be one cell wide, `ellipsis` marks
 * a label cut to fit.
 *
 * @category Controls
 */
export interface ButtonGlyphs {
  /** Drawn before the label. */
  readonly left: string;
  /** Drawn after the label. */
  readonly right: string;
  /** Pads the label out to the button's width; one cell wide. */
  readonly fill: string;
  /** Mark at the end of a label cut to fit. */
  readonly ellipsis: string;
}

/**
 * Built-in button faces for {@linkcode ButtonOptions.glyphs}: `padded` (the
 * default), `brackets` and `angles`.
 *
 * @category Controls
 */
export const BUTTON_GLYPHS: {
  readonly [Name in "padded" | "brackets" | "angles"]: ButtonGlyphs;
} = {
  /** The label with one space either side. */
  padded: { left: " ", right: " ", fill: " ", ellipsis: "…" },
  /** `[ OK ]`. */
  brackets: { left: "[ ", right: " ]", fill: " ", ellipsis: "…" },
  /** `‹ OK ›`. */
  angles: { left: "‹ ", right: " ›", fill: " ", ellipsis: "…" },
};

/**
 * What a button does in response to a key: `press` fires `onPress`.
 *
 * @category Controls
 */
export type ButtonAction = "press";

/**
 * Default key bindings of a {@linkcode Button}.
 *
 * @category Controls
 */
export const DEFAULT_BUTTON_KEYS: Readonly<
  Record<ButtonAction, readonly string[]>
> = {
  press: ["enter", "space"],
};

/**
 * Behaviour and look of a {@linkcode Button}. Every option is optional.
 *
 * @category Controls
 */
export interface ButtonOptions {
  /** Called on a bound key (Enter or Space by default) while focused, and on a release over the button after a press on it. */
  onPress?: () => void;
  /** Colour family of the button. Default `"default"`. */
  variant?: ButtonVariant;
  /** A disabled button ignores the keyboard and the mouse. Default false. */
  disabled?: boolean;
  /** Minimum width in cells, frame glyphs included; the label is centred. Default: the label plus the frame glyphs. */
  width?: number;
  /** Paints replacing the variant's defaults per state; see {@linkcode ButtonTheme}. */
  theme?: ButtonTheme;
  /** Characters around and inside the label, each replacing its default from {@linkcode BUTTON_GLYPHS}`.padded`. */
  glyphs?: Partial<ButtonGlyphs>;
  /** Key specs per action; an entry replaces the default list for that action. See {@link DEFAULT_BUTTON_KEYS}. */
  keys?: Partial<Record<ButtonAction, readonly string[]>>;
}

const BASE: Record<ButtonVariant, `#${string}`> = {
  default: "#4b5263",
  primary: "#3fb5e8",
  danger: "#e05050",
};

const LABEL: Record<ButtonVariant, `#${string}`> = {
  default: "#e5e9f0",
  primary: "#0b1a22",
  danger: "#ffffff",
};

function defaultTheme(variant: ButtonVariant): Required<ButtonTheme> {
  const base = BASE[variant];

  return {
    normal: { fg: LABEL[variant], bg: base },
    hover: { bg: mixColors(base, "#ffffff", 0.2) },
    focused: {
      bg: mixColors(base, "#ffffff", 0.1),
      bold: true,
      underline: true,
    },
    pressed: { bg: mixColors(base, "#000000", 0.3) },
    disabled: { fg: "#5c6370", bg: "#2c313a", bold: false, underline: false },
  };
}

/**
 * A one-row push button: the label centred on a coloured background.
 *
 * `onPress` fires on a bound key (Enter or Space by default) while the button
 * has focus, or on a left release over the button after a press on it. Moving
 * the pointer off the button before releasing cancels the press, as in a GUI.
 * Hover needs the TUI's mouse mode `"move"`; presses need `"click"` and
 * cancelling by moving off needs `"drag"`.
 *
 * @example Press a button with Enter
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Button, parseKey } from "@neonbyte/tui";
 *
 * let saved = 0;
 * const button = new Button("Save", { onPress: () => saved++ });
 *
 * button.handleInput({ type: "key", key: parseKey("\r") });
 *
 * assertEquals(saved, 1);
 * ```
 *
 * @category Controls
 */
export class Button implements Component, Focusable {
  /** Whether the button has keyboard focus; set by the TUI. */
  public focused = false;
  /** Whether the terminal's own cursor is shown instead of a drawn one; set by the TUI. A button has no caret, so it is ignored. */
  public hardwareCursor?: boolean;
  /** Draw as focused without holding keyboard focus; set by containers that track a selection themselves. */
  public highlighted = false;
  /** Called when the button is pressed. */
  public onPress?: () => void;
  /** A disabled button ignores keys and the mouse; the next render shows it. */
  public disabled: boolean;
  /** Colour family the button was created with. */
  public readonly variant: ButtonVariant;
  private text: string;
  private readonly minWidth: number;
  private readonly glyphs: ButtonGlyphs;
  private readonly keys: Readonly<Record<ButtonAction, readonly string[]>>;
  private theme: Required<ButtonTheme>;
  private hovered = false;
  private pressed = false;
  /** A left press landed on the button and has not been released. */
  private armed = false;
  private shownWidth = 0;
  private cacheKey = "";
  private cache: readonly string[] = [];

  /**
   * Create a button.
   *
   * @param label The text on the button; whitespace runs collapse to one space.
   * @param options Callback, variant, size, paints and key bindings; see {@linkcode ButtonOptions}.
   */
  public constructor(label: string, options: ButtonOptions = {}) {
    this.text = singleLine(label);
    this.onPress = options.onPress;
    this.variant = options.variant ?? "default";
    this.disabled = options.disabled ?? false;
    this.minWidth = Math.max(0, Math.floor(options.width ?? 0));
    this.glyphs = { ...BUTTON_GLYPHS.padded, ...options.glyphs };
    this.keys = bindKeys(DEFAULT_BUTTON_KEYS, options.keys);
    this.theme = {
      ...defaultTheme(this.variant),
      ...definedOnly(options.theme),
    };
    this.shownWidth = this.naturalWidth;
  }

  /** The label, with whitespace collapsed. */
  public get label(): string {
    return this.text;
  }

  /**
   * Replace the label.
   *
   * @param label The new text; whitespace runs collapse to one space.
   *
   * @example Relabel a button
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Button } from "@neonbyte/tui";
   *
   * const button = new Button("Save");
   * button.setLabel("Saved");
   *
   * assertEquals(button.label, "Saved");
   * assertEquals(button.naturalWidth, 7);
   * ```
   */
  public setLabel(label: string): void {
    this.text = singleLine(label);
  }

  /**
   * Replace some paints; others keep their values.
   *
   * @param theme The paints to change; see {@linkcode ButtonTheme}.
   *
   * @example Render without colours
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Button } from "@neonbyte/tui";
   *
   * const button = new Button("OK");
   * button.setTheme({ normal: {} });
   *
   * assertEquals(button.render(10), [" OK "]);
   * ```
   */
  public setTheme(theme: ButtonTheme): void {
    this.theme = { ...this.theme, ...definedOnly(theme) };
    this.cacheKey = "";
  }

  /** Cells the button takes when there is room: the label with the frame glyphs either side, at least `width`. */
  public get naturalWidth(): number {
    return Math.max(
      this.minWidth,
      visibleWidth(this.glyphs.left) + visibleWidth(this.text) +
        visibleWidth(this.glyphs.right),
    );
  }

  /**
   * Fire `onPress` unless the button is disabled.
   *
   * @example Press programmatically
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Button } from "@neonbyte/tui";
   *
   * let pressed = 0;
   * const button = new Button("Go", { onPress: () => pressed++ });
   * button.press();
   * button.disabled = true;
   * button.press();
   *
   * assertEquals(pressed, 1);
   * ```
   */
  public press(): void {
    if (!this.disabled) {
      this.onPress?.();
    }
  }

  /** Drop the cached row so the next render recomputes it. */
  public invalidate(): void {
    this.cacheKey = "";
  }

  /**
   * Press the button on a bound key; ignored while disabled.
   *
   * @param event The key press or paste; pastes are ignored.
   */
  public handleInput(event: InputEvent): void {
    if (event.type !== "key" || this.disabled) {
      return;
    }

    if (this.keys.press.some((spec) => matchesKey(event.key, spec))) {
      this.press();
    }
  }

  /**
   * Track hover and the press-release gesture; a release over the button after a press on it presses it.
   *
   * @param event The mouse report relative to the button.
   * @returns Whether the event was handled; always `false` while disabled.
   */
  public handleMouse(event: MouseInput): boolean {
    if (this.disabled) {
      this.hovered = false;
      this.pressed = false;
      this.armed = false;

      return false;
    }

    switch (event.action) {
      case "press":
        return this.mousePress(event);
      case "drag":
        return this.mouseDrag(event);
      case "release":
        return this.mouseRelease(event);
      case "move":
        this.hovered = this.contains(event);

        return this.hovered;
      case "leave":
        this.hovered = false;

        return false;
      default:
        return false;
    }
  }

  /**
   * Render the button as one row.
   *
   * @param width Available width in cells; the button is cut to fit.
   * @returns One row, as wide as the button's natural width or `width` if smaller.
   */
  public render(width: number): readonly string[] {
    const cells = Math.max(0, Math.min(width, this.naturalWidth));
    const state = this.paintState();
    const key = `${cells}\0${this.text}\0${this.variant}\0${state}`;

    if (key === this.cacheKey) {
      return this.cache;
    }

    this.cacheKey = key;
    this.shownWidth = cells;
    this.cache = [paint(this.face(cells), this.currentPaint())];

    return this.cache;
  }

  /** Arm a click when the left button goes down on the button. */
  private mousePress(event: MouseInput): boolean {
    if (event.button !== "left" || !this.contains(event)) {
      return false;
    }

    this.armed = true;
    this.pressed = true;

    return true;
  }

  /** Show the pressed state only while the pointer stays over an armed button. */
  private mouseDrag(event: MouseInput): boolean {
    if (!this.armed) {
      return false;
    }

    this.pressed = this.contains(event);

    return true;
  }

  /** Finish an armed click, pressing the button when released over it. */
  private mouseRelease(event: MouseInput): boolean {
    if (!this.armed) {
      return false;
    }

    const inside = this.contains(event);

    this.armed = false;
    this.pressed = false;

    if (inside) {
      this.press();
    }

    return true;
  }

  /** Whether the event lies on the button's single row. */
  private contains(event: MouseInput): boolean {
    return event.y === 0 && event.x >= 0 && event.x < this.shownWidth;
  }

  /** A string of the visual state flags, for the render cache key. */
  private paintState(): string {
    return [
      this.hovered,
      this.focused || this.highlighted,
      this.pressed,
      this.disabled,
    ].map((on) => on ? "1" : "0").join("");
  }

  /** The paint for the current state, layered over `normal`. */
  private currentPaint(): Paint {
    const theme = this.theme;

    return mergePaint(
      theme.normal,
      this.focused || this.highlighted ? theme.focused : undefined,
      this.hovered ? theme.hover : undefined,
      this.pressed ? theme.pressed : undefined,
      this.disabled ? theme.disabled : undefined,
    );
  }

  /** The label centred in exactly `cells` cells, cut with an ellipsis when too long. */
  private face(cells: number): string {
    if (cells <= 0) {
      return "";
    }

    const { left, right, fill, ellipsis } = this.glyphs;
    const text = truncateToWidth(left + this.text + right, cells, ellipsis);
    const room = cells - visibleWidth(text);
    const before = Math.floor(room / 2);

    return fill.repeat(before) + text + fill.repeat(room - before);
  }
}

/** Newlines, tabs and runs of spaces in a label become single spaces. */
function singleLine(label: string): string {
  return label.replace(/\s+/g, " ").trim();
}

/** `theme` without its undefined fields, so they do not replace defaults. */
function definedOnly(theme: ButtonTheme | undefined): ButtonTheme {
  const out: ButtonTheme = {};

  for (const key of THEME_KEYS) {
    if (theme?.[key] !== undefined) {
      out[key] = theme[key];
    }
  }

  return out;
}

const THEME_KEYS: readonly (keyof ButtonTheme)[] = [
  "normal",
  "hover",
  "focused",
  "pressed",
  "disabled",
];

/** Where a button sits in a {@link ButtonRow}. */
interface Slot {
  readonly index: number;
  readonly x: number;
  readonly width: number;
}

/**
 * Characters a {@linkcode ButtonRow} draws.
 *
 * @category Controls
 */
export interface ButtonRowGlyphs {
  /** Drawn in every cell between two buttons; one cell wide. Default `" "`. */
  readonly separator: string;
}

/**
 * Paints per element of a {@linkcode ButtonRow}.
 *
 * @category Controls
 */
export interface ButtonRowTheme {
  /** The separator glyph between buttons. Default none. */
  readonly separator?: Paint;
}

/**
 * What a button row does in response to a key: select the `previous` or
 * `next` button, or `press` the selected one.
 *
 * @category Controls
 */
export type ButtonRowAction = "previous" | "next" | "press";

/**
 * Default key bindings of a {@linkcode ButtonRow}.
 *
 * @category Controls
 */
export const DEFAULT_BUTTON_ROW_KEYS: Readonly<
  Record<ButtonRowAction, readonly string[]>
> = {
  previous: ["left", "shift+tab"],
  next: ["right", "tab"],
  press: ["enter", "space"],
};

/**
 * Look and behaviour of a {@linkcode ButtonRow}. Every option is optional.
 *
 * @category Controls
 */
export interface ButtonRowOptions {
  /** Cells between buttons. Default 2. */
  gap?: number;
  /** Where the buttons sit in the row. Default `"left"`. */
  align?: "left" | "center" | "right";
  /** Characters the row draws, each replacing its default; see {@linkcode ButtonRowGlyphs}. */
  glyphs?: Partial<ButtonRowGlyphs>;
  /** Paints for the row's own elements; see {@linkcode ButtonRowTheme}. */
  theme?: ButtonRowTheme;
  /** Key specs per action; an entry replaces the default list for that action. See {@link DEFAULT_BUTTON_ROW_KEYS}. */
  keys?: Partial<Record<ButtonRowAction, readonly string[]>>;
}

/**
 * Buttons side by side on one row. When the row is narrower than its
 * buttons, the last ones are dropped (and the first is cut) so it is never
 * wider than the width it is given.
 *
 * While the row has focus, ←/→ (and Tab/Shift+Tab) move the selected button
 * and Enter or Space presses it; `keys` rebinds them. The mouse reaches the
 * button under the pointer directly; pressing one selects it.
 *
 * @example Move the selection and press
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Button, ButtonRow, parseKey } from "@neonbyte/tui";
 *
 * const log: string[] = [];
 * const row = new ButtonRow([
 *   new Button("OK", { onPress: () => log.push("ok") }),
 *   new Button("Cancel", { onPress: () => log.push("cancel") }),
 * ]);
 *
 * row.handleInput({ type: "key", key: parseKey("\x1b[C") });
 * row.handleInput({ type: "key", key: parseKey("\r") });
 *
 * assertEquals(log, ["cancel"]);
 * ```
 *
 * @category Controls
 */
export class ButtonRow implements Component, Focusable {
  /** Whether the row has keyboard focus; set by the TUI. The selected button is drawn focused only then. */
  public focused = false;
  /** Whether the terminal's own cursor is shown instead of a drawn one; set by the TUI. A row has no caret, so it is ignored. */
  public hardwareCursor?: boolean;
  /** The buttons, left to right. */
  public readonly buttons: readonly Button[];
  private readonly gap: number;
  private readonly align: "left" | "center" | "right";
  private readonly glyphs: ButtonRowGlyphs;
  private readonly keys: Readonly<Record<ButtonRowAction, readonly string[]>>;
  private theme: Required<ButtonRowTheme>;
  private cursor = 0;
  private slots: readonly Slot[] = [];
  private cacheWidth = -1;
  private cacheParts: readonly (readonly string[])[] = [];
  private cache: readonly string[] = [];

  /**
   * Create a row of buttons.
   *
   * @param buttons The buttons, left to right.
   * @param options Gap, alignment, glyphs, paints and key bindings; see {@linkcode ButtonRowOptions}.
   */
  public constructor(
    buttons: readonly Button[],
    options: ButtonRowOptions = {},
  ) {
    this.buttons = buttons;
    this.gap = Math.max(0, Math.floor(options.gap ?? 2));
    this.align = options.align ?? "left";
    this.glyphs = { separator: " ", ...options.glyphs };
    this.keys = bindKeys(DEFAULT_BUTTON_ROW_KEYS, options.keys);
    this.theme = { separator: {}, ...options.theme };
    this.slots = this.layout(Infinity);
  }

  /**
   * Replace some paints; others keep their values.
   *
   * @param theme The paints to change; see {@linkcode ButtonRowTheme}.
   *
   * @example Paint the separator
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Button, ButtonRow } from "@neonbyte/tui";
   *
   * const row = new ButtonRow([new Button("OK")], { glyphs: { separator: "·" } });
   * row.setTheme({ separator: { fg: "#888888" } });
   *
   * assertEquals(row.render(10).length, 1);
   * ```
   */
  public setTheme(theme: ButtonRowTheme): void {
    this.theme = { ...this.theme, ...theme };
    this.cacheWidth = -1;
  }

  /** Index of the selected button. */
  public get selected(): number {
    return this.cursor;
  }

  /** Buttons shown at the last render width; the rest were dropped. */
  public get visibleCount(): number {
    return this.slots.length;
  }

  /**
   * Select a button; the index is clamped to the available buttons.
   *
   * @param index Index into {@linkcode ButtonRow.buttons}.
   *
   * @example Preselect the second button
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Button, ButtonRow } from "@neonbyte/tui";
   *
   * const row = new ButtonRow([new Button("OK"), new Button("Cancel")]);
   * row.select(5);
   *
   * assertEquals(row.selected, 1);
   * ```
   */
  public select(index: number): void {
    this.cursor = Math.min(
      Math.max(0, index),
      Math.max(0, this.buttons.length - 1),
    );
  }

  /** Drop the cached row and invalidate every button. */
  public invalidate(): void {
    this.cacheWidth = -1;

    for (const button of this.buttons) {
      button.invalidate();
    }
  }

  /**
   * Move the selection or press the selected button, per the bound keys.
   *
   * @param event The key press or paste; pastes are ignored.
   */
  public handleInput(event: InputEvent): void {
    if (event.type !== "key" || this.buttons.length === 0) {
      return;
    }

    const key = event.key;

    if (this.matches(key, "previous")) {
      this.move(-1);
    } else if (this.matches(key, "next")) {
      this.move(1);
    } else if (this.matches(key, "press")) {
      this.buttons[this.cursor]?.press();
    }
  }

  /**
   * Forward a mouse event to the button under the pointer; pressing a button selects it.
   *
   * @param event The mouse report relative to the row.
   * @returns Whether a button handled the event.
   */
  public handleMouse(event: MouseInput): boolean {
    if (event.y !== 0) {
      return false;
    }

    const slot = this.slots.find((s) =>
      event.x >= s.x && event.x < s.x + s.width
    );

    if (slot === undefined) {
      return false;
    }

    const handled = forwardMouse(this.buttons[slot.index], event, slot.x, 0);

    if (handled && event.action === "press") {
      this.cursor = slot.index;
    }

    return handled;
  }

  /**
   * Render the buttons that fit, side by side.
   *
   * @param width Available width in cells.
   * @returns One row, never wider than `width`.
   */
  public render(width: number): readonly string[] {
    this.slots = this.layout(Math.max(0, width));
    this.cursor = Math.min(this.cursor, Math.max(0, this.buttons.length - 1));

    const parts = this.slots.map((slot) => {
      const button = this.buttons[slot.index];

      button.highlighted = this.focused && slot.index === this.cursor;

      return button.render(slot.width);
    });

    if (width === this.cacheWidth && sameParts(parts, this.cacheParts)) {
      return this.cache;
    }

    this.cacheWidth = width;
    this.cacheParts = parts;
    this.cache = [this.compose(parts)];

    return this.cache;
  }

  /** Move the selection by `step` over enabled, visible buttons, wrapping around. */
  private move(step: number): void {
    const count = Math.max(1, this.slots.length);

    for (let i = 1; i <= count; i++) {
      const next = (this.cursor + step * i % count + count) % count;

      if (!this.buttons[next].disabled) {
        this.cursor = next;

        return;
      }
    }
  }

  /** Buttons that fit in `width`, left to right; at least one, cut if it alone is too wide. */
  private layout(width: number): Slot[] {
    const slots: Slot[] = [];
    let used = 0;

    for (let i = 0; i < this.buttons.length; i++) {
      const cells = this.buttons[i].naturalWidth;
      const next = used + (slots.length > 0 ? this.gap : 0) + cells;

      if (next > width && slots.length > 0) {
        break;
      }

      slots.push({ index: i, x: next - cells, width: Math.min(cells, width) });

      used = next;
    }

    const shift = this.offset(width, used);

    return slots.map((slot) => ({ ...slot, x: slot.x + shift }));
  }

  /** Cells to shift the buttons right of the left edge, per `align`. */
  private offset(width: number, used: number): number {
    if (!Number.isFinite(width)) {
      return 0;
    }

    const room = Math.max(0, width - used);

    if (this.align === "right") {
      return room;
    }

    return this.align === "center" ? Math.floor(room / 2) : 0;
  }

  /** Whether `key` is bound to `action`. */
  private matches(key: Key, action: ButtonRowAction): boolean {
    return this.keys[action].some((spec) => matchesKey(key, spec));
  }

  /** Join the rendered buttons and the separators between them into one row. */
  private compose(parts: readonly (readonly string[])[]): string {
    let row = "";
    let column = 0;

    for (let i = 0; i < parts.length; i++) {
      const slot = this.slots[i];
      const space = slot.x - column;

      row += (i > 0 ? this.separator(space) : " ".repeat(space)) +
        (parts[i][0] ?? "");
      column = slot.x + slot.width;
    }

    return row;
  }

  /** The cells between two buttons: `space` cells of the separator glyph. */
  private separator(space: number): string {
    return paint(this.glyphs.separator.repeat(space), this.theme.separator);
  }
}

function sameParts(
  a: readonly (readonly string[])[],
  b: readonly (readonly string[])[],
): boolean {
  return a.length === b.length && a.every((part, i) => part === b[i]);
}
