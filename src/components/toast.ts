import type { MouseInput } from "../keys.ts";
import { mergePaint, type Paint, paint } from "../style.ts";
import type {
  Component,
  OverlayAnchor,
  OverlayHandle,
  OverlaySize,
  TUI,
} from "../tui.ts";
import { visibleWidth, wrapText } from "../width.ts";
import { type BorderGlyphs, Box } from "./box.ts";

/**
 * What a toast reports; picks its colour and icon.
 *
 * @category Overlays
 */
export type ToastKind = "info" | "success" | "warning" | "error";

/**
 * Icon drawn before the message, per kind; may span several cells. An empty icon leaves the message unindented.
 *
 * @category Overlays
 */
export interface ToastGlyphs {
  /** Icon of `"info"` toasts. */
  readonly info: string;
  /** Icon of `"success"` toasts. */
  readonly success: string;
  /** Icon of `"warning"` toasts. */
  readonly warning: string;
  /** Icon of `"error"` toasts. */
  readonly error: string;
}

/**
 * Built-in icon sets: `unicode` (the default) and `ascii`.
 *
 * @category Overlays
 */
export const TOAST_GLYPHS: {
  readonly [Name in "unicode" | "ascii"]: ToastGlyphs;
} = {
  unicode: { info: "ℹ", success: "✔", warning: "⚠", error: "✘" },
  ascii: { info: "i", success: "+", warning: "!", error: "x" },
};

/**
 * Paint per kind, colouring its icon, frame and title (each replaces that
 * kind's default), and paints for single elements layered over the kind's.
 *
 * @category Overlays
 */
export interface ToasterTheme {
  /** Default accent blue `#3fb5e8`. */
  info?: Paint;
  /** Default green `#50c050`. */
  success?: Paint;
  /** Default amber `#e5c07b`. */
  warning?: Paint;
  /** Default red `#e05050`. */
  error?: Paint;
  /** Paint of the message text. Default none. */
  message?: Paint;
  /** Layered over the kind's paint on the icon. Default none. */
  icon?: Paint;
  /** Layered over the kind's paint on the frame. Default none. */
  border?: Paint;
  /** Layered over the kind's paint, bold, on the title. Default none. */
  title?: Paint;
}

/**
 * Placement, limits, look and clock of a {@linkcode Toaster}.
 *
 * @category Overlays
 */
export interface ToasterOptions {
  /** Where the stack sits on screen. Default `"bottom-right"`. */
  anchor?: OverlayAnchor;
  /** Cells or a percentage of the terminal width, frames included. Default 40. */
  width?: OverlaySize;
  /** Toasts visible at once; showing more dismisses the oldest. Default 4. */
  max?: number;
  /** How long a toast stays; 0 keeps toasts until dismissed. Default 4000 ms. */
  durationMs?: number;
  /** Distance kept from the screen edges. Default 1. */
  margin?: number;
  /** Shift of the stack from its anchor, in columns. Default 0. */
  offsetX?: number;
  /** Shift of the stack from its anchor, in rows. Default 0. */
  offsetY?: number;
  /** Empty rows between toasts. Default 0. */
  gap?: number;
  /** Paints per kind and element; see {@linkcode ToasterTheme}. */
  theme?: ToasterTheme;
  /** Icon per kind, each replacing its default from `TOAST_GLYPHS.unicode`. */
  glyphs?: Partial<ToastGlyphs>;
  /** Cells between the icon and the message. Default 1. */
  iconGap?: number;
  /** Frame glyphs of every toast. Default `BORDERS.rounded`. */
  border?: BorderGlyphs;
  /** Cells between a frame and its content: `[vertical, horizontal]` or one value for both. Default `[0, 1]`. */
  padding?: number | readonly [number, number];
  /** Mark at the end of a title cut to fit. Default `"…"`. */
  ellipsis?: string;
  /** Millisecond clock the timeouts follow. Default `performance.now`. */
  clock?: () => number;
}

/**
 * Look and lifetime of one toast; see {@linkcode Toaster.show}.
 *
 * @category Overlays
 */
export interface ToastOptions {
  /** Default `"info"`. */
  kind?: ToastKind;
  /** Bold text in the top edge of the toast. */
  title?: string;
  /** Icon for this toast, replacing the one of its kind. */
  icon?: string;
  /** Overrides the toaster's duration for this toast; 0 keeps it until dismissed. */
  durationMs?: number;
}

/**
 * Controls of a toast shown by {@linkcode Toaster.show}.
 *
 * @category Overlays
 */
export interface ToastHandle {
  /** Remove the toast; does nothing once it is gone. */
  dismiss(): void;
  /** Replace the message. The timeout keeps running. */
  update(message: string): void;
}

const DEFAULT_THEME: Record<ToastKind, Paint> = {
  info: { fg: "#3fb5e8" },
  success: { fg: "#50c050" },
  warning: { fg: "#e5c07b" },
  error: { fg: "#e05050" },
};

/** The icon and wrapped message inside one toast's frame. */
class ToastBody implements Component {
  private message: string;
  private readonly icon: string;
  private readonly iconGap: number;
  private iconPaint: Paint | undefined;
  private textPaint: Paint | undefined;
  private cacheKey = "";
  private cache: readonly string[] = [];

  public constructor(message: string, icon: string, iconGap: number) {
    this.message = message;
    this.icon = icon;
    this.iconGap = iconGap;
  }

  public setMessage(message: string): void {
    this.message = message;
  }

  public setStyle(
    iconPaint: Paint | undefined,
    textPaint: Paint | undefined,
  ): void {
    this.iconPaint = iconPaint;
    this.textPaint = textPaint;
    this.cacheKey = "";
  }

  public invalidate(): void {
    this.cacheKey = "";
  }

  public render(width: number): readonly string[] {
    const key = `${width}\0${this.message}`;

    if (key === this.cacheKey) {
      return this.cache;
    }

    // Columns taken by the icon and the gap after it; none without an icon.
    const lead = this.icon === "" ? 0 : visibleWidth(this.icon) + this.iconGap;
    const first = this.icon === ""
      ? ""
      : paint(this.icon, this.iconPaint) + " ".repeat(this.iconGap);
    const lines = wrapText(
      paint(this.message, this.textPaint),
      Math.max(1, width - lead),
    );

    this.cacheKey = key;
    this.cache = lines.map((line, i) =>
      (i === 0 ? first : " ".repeat(lead)) + line
    );

    return this.cache;
  }
}

/** One live toast. */
interface Toast {
  readonly kind: ToastKind;
  readonly body: ToastBody;
  readonly box: Box;
  readonly durationMs: number;
  /** Clock time it expires at while the timer runs. */
  deadline: number;
  /** Time left while the pointer holds the timer. `undefined` while it runs. */
  remaining: number | undefined;
}

/** The toasts, oldest first, drawn as one column and hit-tested by row. */
class ToastStack implements Component {
  private readonly toasts: readonly Toast[];
  private readonly gap: number;
  private readonly onClick: (toast: Toast) => void;
  private readonly onHover: (toast: Toast | undefined) => void;
  /** First row of each toast in the last render. */
  private starts: number[] = [];
  private parts: readonly (readonly string[])[] = [];
  private cacheWidth = -1;
  private cache: readonly string[] = [];
  private pressed: Toast | undefined;

  public constructor(
    toasts: readonly Toast[],
    gap: number,
    onClick: (toast: Toast) => void,
    onHover: (toast: Toast | undefined) => void,
  ) {
    this.toasts = toasts;
    this.gap = gap;
    this.onClick = onClick;
    this.onHover = onHover;
  }

  public invalidate(): void {
    this.cacheWidth = -1;

    for (const toast of this.toasts) {
      toast.box.invalidate();
    }
  }

  public handleMouse(event: MouseInput): boolean {
    const toast = this.toastAt(event.y);

    if (event.action === "leave") {
      this.pressed = undefined;

      this.onHover(undefined);

      return false;
    }

    if (event.action === "move") {
      this.onHover(toast);

      return toast !== undefined;
    }

    if (event.action === "press" && event.button === "left") {
      this.pressed = toast;

      return toast !== undefined;
    }

    if (event.action === "release" && this.pressed !== undefined) {
      const armed = this.pressed;

      this.pressed = undefined;

      if (toast === armed && event.x >= 0 && event.x < this.cacheWidth) {
        this.onClick(armed);
      }

      return true;
    }

    return false;
  }

  public render(width: number): readonly string[] {
    const parts = this.toasts.map((toast) => toast.box.render(width));

    if (
      width === this.cacheWidth && parts.length === this.parts.length &&
      parts.every((rows, i) => rows === this.parts[i])
    ) {
      return this.cache;
    }

    const blank = " ".repeat(width);
    const rows: string[] = [];

    this.starts = parts.map((part, i) => {
      if (i > 0) {
        for (let g = 0; g < this.gap; g++) {
          rows.push(blank);
        }
      }

      const start = rows.length;

      rows.push(...part);

      return start;
    });
    this.parts = parts;
    this.cacheWidth = width;
    this.cache = rows;

    return this.cache;
  }

  /** The toast drawn on `row` of the last render. */
  private toastAt(row: number): Toast | undefined {
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      if (this.starts[i] !== undefined && row >= this.starts[i]) {
        return row < this.starts[i] + this.parts[i].length
          ? this.toasts[i]
          : undefined;
      }
    }

    return undefined;
  }
}

/**
 * Stacked notifications in one corner of the screen. Each toast is a framed
 * block with a coloured icon and its wrapped message, oldest on top. They sit
 * in a single overlay that never takes focus or blocks the mouse beneath, and
 * that goes away with the last toast.
 *
 * Toasts leave after their duration; hovering one (mouse mode `"move"`) holds
 * its timer, and clicking it dismisses it. Showing more than `max` dismisses
 * the oldest. Timers run only while an expiring toast is shown, so an idle
 * toaster does not keep the process alive.
 *
 * @example Show a notification
 * ```ts
 * import { assert, assertEquals } from "@std/assert";
 * import { Toaster, TUI, VirtualTerminal } from "@neonbyte/tui";
 *
 * const terminal = new VirtualTerminal(30, 8);
 * const tui = new TUI(terminal);
 * const toaster = new Toaster(tui, { anchor: "top-right" });
 *
 * tui.start();
 * toaster.show("Saved", { kind: "success", durationMs: 0 });
 * tui.renderNow();
 * assert(terminal.viewport().some((row) => row.includes("✔ Saved")));
 *
 * toaster.dismissAll();
 * assertEquals(toaster.count, 0);
 * tui.stop();
 * ```
 *
 * @category Overlays
 */
export class Toaster {
  private readonly tui: TUI;
  private readonly options: ToasterOptions;
  private readonly glyphs: ToastGlyphs;
  private readonly clock: () => number;
  private readonly max: number;
  private readonly toasts: Toast[] = [];
  private readonly stack: ToastStack;
  private theme: ToasterTheme;
  private hovered: Toast | undefined;
  private handle: OverlayHandle | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Create a toaster; nothing is shown until {@linkcode Toaster.show} is called.
   *
   * @param tui The TUI the toasts are shown on.
   * @param options Placement, limits, look and clock; see {@linkcode ToasterOptions}.
   */
  public constructor(tui: TUI, options: ToasterOptions = {}) {
    this.tui = tui;
    this.options = options;
    this.theme = { ...options.theme };
    this.glyphs = { ...TOAST_GLYPHS.unicode, ...options.glyphs };
    this.clock = options.clock ?? (() => performance.now());
    this.max = Math.max(1, Math.floor(options.max ?? 4));
    this.stack = new ToastStack(
      this.toasts,
      Math.max(0, Math.floor(options.gap ?? 0)),
      (toast) => this.remove(toast),
      (toast) => this.hover(toast),
    );
  }

  /** Toasts currently shown. */
  public get count(): number {
    return this.toasts.length;
  }

  /**
   * Replace some paints, on the toasts shown now and the ones to come; others keep their values.
   *
   * @param theme The paints to change; see {@linkcode ToasterTheme}.
   *
   * @example Recolour errors
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Toaster, TUI, VirtualTerminal } from "@neonbyte/tui";
   *
   * const tui = new TUI(new VirtualTerminal(30, 8));
   * const toaster = new Toaster(tui);
   *
   * tui.start();
   * toaster.setTheme({ error: { fg: "#ff0000" } });
   * toaster.show("Failed", { kind: "error", durationMs: 0 });
   * assertEquals(toaster.count, 1);
   * toaster.dismissAll();
   * tui.stop();
   * ```
   */
  public setTheme(theme: ToasterTheme): void {
    this.theme = { ...this.theme, ...theme };

    for (const toast of this.toasts) {
      this.style(toast);
    }

    this.tui.requestRender();
  }

  /**
   * Add a toast below the others, dismissing the oldest ones beyond `max`.
   *
   * @param message The text, wrapped to the toast's width.
   * @param options Kind, title, icon and duration; see {@linkcode ToastOptions}.
   * @returns A handle to update or dismiss the toast.
   *
   * @example Update a toast while work progresses
   * ```ts
   * import { assert, assertEquals } from "@std/assert";
   * import { Toaster, TUI, VirtualTerminal } from "@neonbyte/tui";
   *
   * const terminal = new VirtualTerminal(30, 8);
   * const tui = new TUI(terminal);
   * const toaster = new Toaster(tui);
   *
   * tui.start();
   * const toast = toaster.show("Uploading…", { title: "Upload", durationMs: 0 });
   * toast.update("Done");
   * tui.renderNow();
   * assert(terminal.viewport().some((row) => row.includes("Done")));
   *
   * toast.dismiss();
   * assertEquals(toaster.count, 0);
   * tui.stop();
   * ```
   */
  public show(message: string, options: ToastOptions = {}): ToastHandle {
    const kind = options.kind ?? "info";
    const durationMs = Math.max(
      0,
      options.durationMs ?? this.options.durationMs ?? 4000,
    );
    const body = new ToastBody(
      message,
      options.icon ?? this.glyphs[kind],
      Math.max(0, Math.floor(this.options.iconGap ?? 1)),
    );
    const toast: Toast = {
      kind,
      body,
      box: new Box(body, {
        title: options.title,
        border: this.options.border,
        padding: this.options.padding,
        ellipsis: this.options.ellipsis,
      }),
      durationMs,
      deadline: this.clock() + durationMs,
      remaining: undefined,
    };

    this.style(toast);
    this.toasts.push(toast);

    while (this.toasts.length > this.max) {
      this.drop(this.toasts[0]);
    }

    this.sync();

    return {
      dismiss: () => this.remove(toast),
      update: (text) => {
        if (this.toasts.includes(toast)) {
          toast.body.setMessage(text);
          this.tui.requestRender();
        }
      },
    };
  }

  /** Paint `toast`'s icon, message and frame from the theme and its kind. */
  private style(toast: Toast): void {
    const theme = this.theme;
    const accent = theme[toast.kind] ?? DEFAULT_THEME[toast.kind];

    toast.body.setStyle(mergePaint(accent, theme.icon), theme.message);
    toast.box.setTheme({
      border: mergePaint(accent, theme.border),
      title: mergePaint(accent, { bold: true }, theme.title),
    });
  }

  /**
   * Remove every toast and stop the timer.
   *
   * @example Clear all notifications
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Toaster, TUI, VirtualTerminal } from "@neonbyte/tui";
   *
   * const tui = new TUI(new VirtualTerminal(30, 8));
   * const toaster = new Toaster(tui);
   *
   * tui.start();
   * toaster.show("One", { durationMs: 0 });
   * toaster.show("Two", { durationMs: 0 });
   * assertEquals(toaster.count, 2);
   *
   * toaster.dismissAll();
   * assertEquals(toaster.count, 0);
   * tui.stop();
   * ```
   */
  public dismissAll(): void {
    this.toasts.length = 0;
    this.hovered = undefined;

    this.sync();
  }

  /** Dismiss `toast` and repaint; does nothing once it is gone. */
  private remove(toast: Toast): void {
    if (this.toasts.includes(toast)) {
      this.drop(toast);
      this.sync();
    }
  }

  /** Take `toast` out of the list without repainting. */
  private drop(toast: Toast): void {
    this.toasts.splice(this.toasts.indexOf(toast), 1);

    if (this.hovered === toast) {
      this.hovered = undefined;
    }
  }

  /** Hold `toast`'s timer and release the one held before. */
  private hover(toast: Toast | undefined): void {
    if (toast === this.hovered) {
      return;
    }

    const now = this.clock();

    if (this.hovered !== undefined && this.hovered.remaining !== undefined) {
      this.hovered.deadline = now + this.hovered.remaining;
      this.hovered.remaining = undefined;
    }

    if (toast !== undefined && toast.durationMs > 0) {
      toast.remaining = Math.max(0, toast.deadline - now);
    }

    this.hovered = toast;

    this.schedule();
  }

  /** Show, repaint or hide the overlay for the current toasts, and rearm the timer. */
  private sync(): void {
    if (this.toasts.length === 0) {
      this.handle?.hide();

      this.handle = undefined;
    } else if (this.handle === undefined) {
      this.handle = this.tui.showOverlay(this.stack, {
        anchor: this.options.anchor ?? "bottom-right",
        width: this.options.width ?? 40,
        margin: this.options.margin,
        offsetX: this.options.offsetX,
        offsetY: this.options.offsetY,
        focus: false,
      });
    } else {
      this.tui.requestRender();
    }

    this.schedule();
  }

  /** Arm one timer for the soonest expiry among toasts that are neither sticky nor held. */
  private schedule(): void {
    clearTimeout(this.timer);

    this.timer = undefined;

    let next: number | undefined;

    for (const toast of this.toasts) {
      if (toast.durationMs > 0 && toast.remaining === undefined) {
        next = Math.min(next ?? toast.deadline, toast.deadline);
      }
    }

    if (next !== undefined) {
      this.timer = setTimeout(
        () => this.expire(),
        Math.max(0, next - this.clock()),
      );
    }
  }

  /** Drop the toasts whose time is up. */
  private expire(): void {
    this.timer = undefined;

    const now = this.clock();
    const due = this.toasts.filter((toast) =>
      toast.durationMs > 0 && toast.remaining === undefined &&
      toast.deadline <= now
    );

    for (const toast of due) {
      this.drop(toast);
    }

    this.sync();
  }
}
