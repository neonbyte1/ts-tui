import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";
import { HYPERLINK_CLOSE } from "../ansi.ts";
import {
  bindKeys,
  type InputEvent,
  matchesKey,
  type MouseInput,
} from "../keys.ts";
import { mergePaint, mixColors, type Paint, paint } from "../style.ts";
import type { Component, Focusable } from "../tui.ts";
import { truncateToWidth, visibleWidth } from "../width.ts";

/**
 * Paints per state, each replacing that state's default. States combine:
 * focused over hover over visited over normal.
 *
 * @category Controls
 */
export interface LinkTheme {
  /** Default accent blue `#3fb5e8`, underlined. */
  normal?: Paint;
  /** Added while the pointer is over the label. Default brighter and bold. */
  hover?: Paint;
  /** Added while the link has keyboard focus. Default inverse video. */
  focused?: Paint;
  /** Added after the link has been opened. Default purple `#a07de0`. */
  visited?: Paint;
}

/**
 * What a key does to a focused {@linkcode Link}: `open` activates it.
 *
 * @category Controls
 */
export type LinkAction = "open";

/**
 * Default key bindings of a {@linkcode Link}.
 *
 * @category Controls
 */
export const DEFAULT_LINK_KEYS: Readonly<
  Record<LinkAction, readonly string[]>
> = {
  open: ["enter"],
};

/**
 * Behaviour and look of a {@linkcode Link}. Every option is optional.
 *
 * @category Controls
 */
export interface LinkOptions {
  /** Called with the URL on a bound key (Enter by default) or a left click. Without it the link is only a native terminal hyperlink. */
  onOpen?: (url: string) => void;
  /** Paints per state; see {@linkcode LinkTheme}. */
  theme?: LinkTheme;
  /** Mark at the end of a label cut to fit. Default `"…"`. */
  ellipsis?: string;
  /** Key specs per action; an entry replaces the default list for that action. See {@link DEFAULT_LINK_KEYS}. */
  keys?: Partial<Record<LinkAction, readonly string[]>>;
}

const ACCENT = "#3fb5e8";

const DEFAULT_THEME: Required<LinkTheme> = {
  normal: { fg: ACCENT, underline: true },
  hover: { fg: mixColors(ACCENT, "#ffffff", 0.35), bold: true },
  focused: { inverse: true },
  visited: { fg: "#a07de0" },
};

// deno-lint-ignore no-control-regex
const CONTROL = /[\x00-\x1f\x7f]/g;

/**
 * `text` as an OSC 8 terminal hyperlink to `url`, for use inside any text a
 * component renders. Control characters are stripped from the URL so it cannot
 * end the sequence early. Terminals without OSC 8 support show just the text.
 *
 * @param text The visible label; may carry its own styling.
 * @param url The absolute URL the terminal opens when the label is clicked.
 * @returns The label wrapped in OSC 8 open and close sequences.
 *
 * @example Link a word inside a sentence
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { hyperlink } from "@neonbyte/tui";
 *
 * const line = `See ${hyperlink("the docs", "https://jsr.io/@neonbyte/tui")}.`;
 *
 * assertEquals(
 *   line,
 *   "See \x1b]8;;https://jsr.io/@neonbyte/tui\x07the docs\x1b]8;;\x07.",
 * );
 * ```
 *
 * @category Controls
 */
export function hyperlink(text: string, url: string): string {
  return `\x1b]8;;${url.replace(CONTROL, "")}\x07${text}${HYPERLINK_CLOSE}`;
}

/** The command that opens `url` with the platform's default handler. */
function openerFor(url: string): { command: string; args: string[] } {
  switch (process.platform) {
    case "darwin":
      return { command: "open", args: [url] };
    case "win32":
      return { command: "cmd", args: ["/c", "start", "", url] };
    default:
      return { command: "xdg-open", args: [url] };
  }
}

/** `base` with the paints `theme` sets; unset keys keep `base`. */
function withTheme(
  base: Required<LinkTheme>,
  theme: LinkTheme | undefined,
): Required<LinkTheme> {
  return {
    normal: theme?.normal ?? base.normal,
    hover: theme?.hover ?? base.hover,
    focused: theme?.focused ?? base.focused,
    visited: theme?.visited ?? base.visited,
  };
}

/**
 * Open `url` in the default browser or handler: `xdg-open` on Linux, `open`
 * on macOS, `cmd /c start` on Windows. Rejects when `url` is not an absolute
 * URL, the opener is missing, or it exits with an error. On Deno it needs the
 * `--allow-run` and `--allow-env` permissions.
 *
 * @param url The absolute URL to open.
 * @returns A promise that resolves once the opener has exited successfully.
 * @throws {TypeError} When `url` is not an absolute URL.
 * @throws {Error} When the opener exits with a non-zero code.
 *
 * @example Open a page when a link is activated
 * ```ts ignore
 * import { Link, openUrl } from "@neonbyte/tui";
 *
 * const link = new Link("Docs", "https://jsr.io/@neonbyte/tui", {
 *   onOpen: (url) => void openUrl(url).catch(() => {}),
 * });
 * ```
 *
 * @category Controls
 */
export async function openUrl(url: string): Promise<void> {
  if (!URL.canParse(url)) {
    throw new TypeError(`Not an absolute URL: ${url}`);
  }

  const { command, args } = openerFor(url);

  try {
    await promisify(execFile)(command, args, { encoding: "utf8" });
  } catch (error) {
    // Errors without an exit code (e.g. a denied permission) propagate as-is.
    if (!(error instanceof Error && "code" in error)) {
      throw error;
    }

    const stderr = "stderr" in error && typeof error.stderr === "string"
      ? error.stderr
      : "";
    const detail = stderr.trim();

    throw new Error(
      `${command} exited with code ${error.code}${
        detail === "" ? "" : `: ${detail}`
      }`,
    );
  }
}

/**
 * A one-row clickable label drawn as an OSC 8 hyperlink, so terminals can open
 * it themselves (with mouse reporting on, most need Shift+click). With
 * `onOpen`, Enter (or another key from `keys`) while focused or a left click
 * on the label calls it with the URL and marks the link visited; hovering
 * restyles the label.
 *
 * @example Activate a focused link with Enter
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Link, parseKey } from "@neonbyte/tui";
 *
 * const opened: string[] = [];
 * const link = new Link("Docs", "https://jsr.io/@neonbyte/tui", {
 *   onOpen: (url) => opened.push(url),
 * });
 *
 * link.handleInput({ type: "key", key: parseKey("\r") });
 *
 * assertEquals(opened, ["https://jsr.io/@neonbyte/tui"]);
 * assertEquals(link.visited, true);
 * ```
 *
 * @category Controls
 */
export class Link implements Component, Focusable {
  /** Whether the link has keyboard focus; set by the TUI. */
  public focused = false;
  /** Whether the terminal's own cursor is shown instead of a drawn one; set by the TUI. A link has no caret, so it is ignored. */
  public hardwareCursor?: boolean;
  /** Called with the URL when the link is activated. */
  public onOpen?: (url: string) => void;

  private readonly ellipsis: string;
  private readonly keys: Readonly<Record<LinkAction, readonly string[]>>;
  private theme: Required<LinkTheme>;
  private label: string;
  private target: string;
  private hovering = false;
  private pressing = false;
  private seen = false;
  private shownWidth = 0;
  private cacheKey = "";
  private cache: readonly string[] = [];

  /**
   * Create a link.
   *
   * @param text The label; runs of whitespace collapse to one space.
   * @param url The absolute URL the label points to.
   * @param options Callback, paints and key bindings; see {@linkcode LinkOptions}.
   */
  public constructor(text: string, url: string, options: LinkOptions = {}) {
    this.label = text.replace(/\s+/g, " ");
    this.target = url;
    this.onOpen = options.onOpen;
    this.theme = withTheme(DEFAULT_THEME, options.theme);
    this.ellipsis = options.ellipsis ?? "…";
    this.keys = bindKeys(DEFAULT_LINK_KEYS, options.keys);
  }

  /** The label, with whitespace collapsed. */
  public get text(): string {
    return this.label;
  }

  /** The URL the label points to. */
  public get url(): string {
    return this.target;
  }

  /** Whether the link has been opened (or marked with `setVisited`). */
  public get visited(): boolean {
    return this.seen;
  }

  /**
   * Replace the label.
   *
   * @param text The new label; runs of whitespace collapse to one space.
   *
   * @example Retitle a link
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Link } from "@neonbyte/tui";
   *
   * const link = new Link("Docs", "https://jsr.io/@neonbyte/tui");
   * link.setText("API  reference");
   *
   * assertEquals(link.text, "API reference");
   * ```
   */
  public setText(text: string): void {
    this.label = text.replace(/\s+/g, " ");
  }

  /**
   * Replace some paints; others keep their values.
   *
   * @param theme The paints to change; see {@linkcode LinkTheme}.
   *
   * @example Drop all styling
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { hyperlink, Link } from "@neonbyte/tui";
   *
   * const link = new Link("Docs", "https://jsr.io/@neonbyte/tui");
   * link.setTheme({ normal: {}, hover: {}, focused: {}, visited: {} });
   *
   * assertEquals(link.render(10), [hyperlink("Docs", "https://jsr.io/@neonbyte/tui")]);
   * ```
   */
  public setTheme(theme: LinkTheme): void {
    this.theme = withTheme(this.theme, theme);
    this.cacheKey = "";
  }

  /**
   * Point the link elsewhere; it counts as not visited yet.
   *
   * @param url The new absolute URL.
   *
   * @example Retarget a visited link
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Link } from "@neonbyte/tui";
   *
   * const link = new Link("Docs", "https://example.com");
   * link.setVisited(true);
   * link.setUrl("https://jsr.io/@neonbyte/tui");
   *
   * assertEquals(link.url, "https://jsr.io/@neonbyte/tui");
   * assertEquals(link.visited, false);
   * ```
   */
  public setUrl(url: string): void {
    this.target = url;
    this.seen = false;
  }

  /**
   * Mark the link as visited or not, which switches to the visited paint.
   *
   * @param visited Whether the link counts as visited.
   *
   * @example Restore visited state
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Link } from "@neonbyte/tui";
   *
   * const link = new Link("Docs", "https://jsr.io/@neonbyte/tui");
   * link.setVisited(true);
   *
   * assertEquals(link.visited, true);
   * ```
   */
  public setVisited(visited: boolean): void {
    this.seen = visited;
  }

  /** Drop the cached row so the next render recomputes it. */
  public invalidate(): void {
    this.cacheKey = "";
  }

  /**
   * Enter (or another key bound to `open`) calls `onOpen`.
   *
   * @param event The key press or paste; pastes are ignored.
   */
  public handleInput(event: InputEvent): void {
    if (
      event.type === "key" &&
      this.keys.open.some((spec) => matchesKey(event.key, spec))
    ) {
      this.open();
    }
  }

  /**
   * Hover restyles the label. A left press on it arms a click that the
   * release completes while still over the label; both need `onOpen`.
   *
   * @param event The mouse report relative to the link.
   * @returns Whether the event was handled: a move or press over the label, or the release that ends an armed click.
   */
  public handleMouse(event: MouseInput): boolean {
    if (event.action === "leave") {
      this.hovering = false;
      this.pressing = false;

      return false;
    }

    const inside = event.y === 0 && event.x >= 0 && event.x < this.shownWidth;

    if (event.action === "move") {
      this.hovering = inside;

      return inside;
    }

    if (event.action === "press" && event.button === "left") {
      this.pressing = inside && this.onOpen !== undefined;

      return this.pressing;
    }

    if (event.action === "release" && this.pressing) {
      this.pressing = false;

      if (inside) {
        this.open();
      }

      return true;
    }

    return false;
  }

  /**
   * Render the label as one hyperlink row, cut to fit.
   *
   * @param width Available width in cells.
   * @returns One row, or none when `width` is below 1.
   */
  public render(width: number): readonly string[] {
    if (width < 1) {
      return [];
    }

    const key =
      `${width}\0${this.label}\0${this.target}\0${this.focused}\0${this.hovering}\0${this.seen}`;

    if (key === this.cacheKey) {
      return this.cache;
    }

    const text = truncateToWidth(this.label, width, this.ellipsis);
    const style = mergePaint(
      this.theme.normal,
      this.seen ? this.theme.visited : undefined,
      this.hovering ? this.theme.hover : undefined,
      this.focused ? this.theme.focused : undefined,
    );

    this.shownWidth = visibleWidth(text);
    this.cacheKey = key;
    this.cache = [hyperlink(paint(text, style), this.target)];

    return this.cache;
  }

  /** Mark the link visited and call `onOpen`, if set. */
  private open(): void {
    if (this.onOpen === undefined) {
      return;
    }

    this.seen = true;

    this.onOpen(this.target);
  }
}
