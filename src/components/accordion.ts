import {
  bindKeys,
  type InputEvent,
  type Key,
  matchesKey,
  type MouseInput,
} from "../keys.ts";
import { mergePaint, type Paint, paint } from "../style.ts";
import { type Component, type Focusable, forwardMouse } from "../tui.ts";
import { truncateToWidth } from "../width.ts";

/**
 * One section: a header row and the content shown below it while it is open.
 *
 * @category Layout
 */
export interface AccordionSection {
  /** Text of the header row. */
  readonly title: string;
  /** Component shown below the header while the section is open. */
  readonly content: Component;
  /** Whether the section starts open. Default false. */
  readonly open?: boolean;
}

/**
 * Paints for the header rows; each value replaces that part's default.
 *
 * @category Layout
 */
export interface AccordionTheme {
  /** Every header. Default bold. */
  readonly header?: Paint;
  /** Added to the header of an open section. Default none. */
  readonly open?: Paint;
  /** Added to the selected header while the accordion has focus. Default accent `#3fb5e8`, bold. */
  readonly focused?: Paint;
  /** Added to the header under the pointer. Default accent `#3fb5e8`. */
  readonly hover?: Paint;
}

/**
 * The marker before a header's title, one cell wide for each state.
 *
 * @category Layout
 */
export interface AccordionGlyphs {
  /** Marks a closed section. */
  readonly closed: string;
  /** Marks an open section. */
  readonly open: string;
}

/**
 * Built-in marker sets: `triangle` (the default), `plus` and `ascii`.
 *
 * @category Layout
 */
export const ACCORDION_GLYPHS: {
  readonly [Name in "triangle" | "plus" | "ascii"]: AccordionGlyphs;
} = {
  triangle: { closed: "▸", open: "▾" },
  plus: { closed: "+", open: "-" },
  ascii: { closed: ">", open: "v" },
};

/**
 * What a key can do while the accordion has focus: move the selection, or toggle, open or close the selected section.
 *
 * @category Layout
 */
export type AccordionAction =
  | "up"
  | "down"
  | "first"
  | "last"
  | "toggle"
  | "open"
  | "close";

/**
 * Key specs (see {@linkcode matchesKey}) bound to each {@linkcode AccordionAction} by default.
 *
 * @category Layout
 */
export const DEFAULT_ACCORDION_KEYS: Readonly<
  Record<AccordionAction, readonly string[]>
> = {
  up: ["up"],
  down: ["down"],
  first: ["home"],
  last: ["end"],
  toggle: ["enter", "space"],
  open: ["right"],
  close: ["left"],
};

/**
 * Sections, look and behaviour of an {@linkcode Accordion}.
 *
 * @category Layout
 */
export interface AccordionOptions {
  /** The sections, top to bottom. */
  sections?: readonly AccordionSection[];
  /** Whether several sections can be open at once. When false, opening a section closes the others. Default false. */
  multiple?: boolean;
  /** Paints for the headers, each replacing its default. */
  theme?: AccordionTheme;
  /** The open and closed markers. Default `ACCORDION_GLYPHS.triangle`. */
  glyphs?: Partial<AccordionGlyphs>;
  /** Cells the content is indented below its header. Default 2. */
  indent?: number;
  /** Cells between the marker and the title. Default 1. */
  gap?: number;
  /** Replaces the end of a title that does not fit. Default `…`. */
  ellipsis?: string;
  /** Keys per action; an entry replaces that action's `DEFAULT_ACCORDION_KEYS` list. */
  keys?: Partial<Record<AccordionAction, readonly string[]>>;
}

interface Entry {
  title: string;
  readonly content: Component;
  open: boolean;
}

/** A section's content rows with the indent applied, reused while the content returns the same rows. */
interface Body {
  readonly source: readonly string[];
  readonly indent: number;
  readonly rows: readonly string[];
}

const DEFAULT_THEME: Required<AccordionTheme> = {
  header: { bold: true },
  open: {},
  focused: { fg: "#3fb5e8", bold: true },
  hover: { fg: "#3fb5e8" },
};

const NO_ROWS: readonly string[] = [];

const ACCORDION_ACTIONS: readonly AccordionAction[] = [
  "up",
  "down",
  "first",
  "last",
  "toggle",
  "open",
  "close",
];

/**
 * Collapsible sections: a `▸ Title` header per section, and below an open
 * one its content, indented. While the accordion has focus, up/down move
 * between headers, Enter and Space toggle, right opens and left closes; keys
 * it does not use go to the selected section's content while that is open.
 * Clicking a header toggles it; clicks and wheel inside open content go to
 * that content. The keys are configurable (`keys`).
 *
 * @example Open a section with the keyboard
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Accordion, Text, TUI, VirtualTerminal } from "@neonbyte/tui";
 *
 * const terminal = new VirtualTerminal(20, 6);
 * const tui = new TUI(terminal);
 * const accordion = new Accordion({
 *   sections: [
 *     { title: "General", content: new Text("hello") },
 *     { title: "Advanced", content: new Text("secret") },
 *   ],
 * });
 *
 * tui.addChild(accordion);
 * tui.setFocus(accordion);
 * tui.start();
 * tui.renderNow();
 * assertEquals(terminal.viewport().slice(0, 2), ["▸ General", "▸ Advanced"]);
 *
 * terminal.send("\r"); // Enter toggles the selected section
 * tui.renderNow();
 * assertEquals(terminal.viewport().slice(0, 3), [
 *   "▾ General",
 *   "  hello",
 *   "▸ Advanced",
 * ]);
 * tui.stop();
 * ```
 *
 * @category Layout
 */
export class Accordion implements Component, Focusable {
  /** Whether the accordion has the keyboard focus. */
  public focused = false;
  /** Called after the user opens or closes a section. Opening a section in single mode reports the sections it closed first. */
  public onToggle?: (index: number, open: boolean) => void;
  private readonly multiple: boolean;
  private readonly glyphs: AccordionGlyphs;
  private readonly gap: number;
  private readonly ellipsis: string;
  private readonly keys: Readonly<Record<AccordionAction, readonly string[]>>;
  private readonly indent: number;
  private theme: Required<AccordionTheme>;
  private readonly entries: Entry[];
  private cursor = 0;
  private hover = -1;
  private pressedHeader = false;
  /** Rows of each section's body at the last render, for mouse hit-testing. */
  private bodyRows: number[] = [];
  private bodies = new Map<Entry, Body>();
  private cacheKey = "";
  private cacheParts: readonly (readonly string[])[] = [];
  private cache: readonly string[] = [];

  /**
   * Create an accordion.
   *
   * @param options Sections, look and behaviour; see {@linkcode AccordionOptions}.
   */
  public constructor(options: AccordionOptions = {}) {
    this.multiple = options.multiple ?? false;
    this.theme = { ...DEFAULT_THEME, ...options.theme };
    this.glyphs = { ...ACCORDION_GLYPHS.triangle, ...options.glyphs };
    this.gap = Math.max(0, Math.floor(options.gap ?? 1));
    this.ellipsis = options.ellipsis ?? "…";
    this.keys = bindKeys(DEFAULT_ACCORDION_KEYS, options.keys);
    this.indent = Math.max(0, options.indent ?? 2);
    this.entries = (options.sections ?? []).map((section) => ({
      title: section.title,
      content: section.content,
      open: section.open ?? false,
    }));

    if (!this.multiple) {
      const firstOpen = this.entries.findIndex((entry) => entry.open);

      this.entries.forEach((entry, i) => {
        entry.open = i === firstOpen;
      });
    }
  }

  /** Index of the selected header. */
  public get selected(): number {
    return this.cursor;
  }

  /** Number of sections. */
  public get count(): number {
    return this.entries.length;
  }

  /**
   * Whether the section at `index` is open.
   *
   * @param index Index of the section.
   * @returns `true` while the section is open.
   * @throws {RangeError} When there is no section at `index`.
   *
   * @example Ask whether a section is open
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Accordion, Text } from "@neonbyte/tui";
   *
   * const accordion = new Accordion({
   *   sections: [
   *     { title: "One", content: new Text("a"), open: true },
   *     { title: "Two", content: new Text("b") },
   *   ],
   * });
   *
   * assertEquals(accordion.isOpen(0), true);
   * assertEquals(accordion.isOpen(1), false);
   * ```
   */
  public isOpen(index: number): boolean {
    return this.entryAt(index).open;
  }

  /**
   * Open the section at `index`; in single mode this closes the others. Does not call `onToggle`.
   *
   * @param index Index of the section to open.
   * @throws {RangeError} When there is no section at `index`.
   *
   * @example Open a section from code
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Accordion, Text } from "@neonbyte/tui";
   *
   * const accordion = new Accordion({
   *   sections: [
   *     { title: "One", content: new Text("a"), open: true },
   *     { title: "Two", content: new Text("b") },
   *   ],
   * });
   *
   * accordion.open(1); // single mode: closes "One"
   * assertEquals(accordion.isOpen(0), false);
   * assertEquals(accordion.isOpen(1), true);
   * ```
   */
  public open(index: number): void {
    this.apply(index, true);
  }

  /**
   * Close the section at `index`. Does not call `onToggle`.
   *
   * @param index Index of the section to close.
   * @throws {RangeError} When there is no section at `index`.
   *
   * @example Close a section from code
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Accordion, Text } from "@neonbyte/tui";
   *
   * const accordion = new Accordion({
   *   sections: [{ title: "One", content: new Text("a"), open: true }],
   * });
   *
   * accordion.close(0);
   * assertEquals(accordion.isOpen(0), false);
   * ```
   */
  public close(index: number): void {
    this.apply(index, false);
  }

  /**
   * Open the section at `index` if it is closed, close it if it is open. Does not call `onToggle`.
   *
   * @param index Index of the section to toggle.
   * @throws {RangeError} When there is no section at `index`.
   *
   * @example Toggle a section
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Accordion, Text } from "@neonbyte/tui";
   *
   * const accordion = new Accordion({
   *   sections: [{ title: "One", content: new Text("a") }],
   * });
   *
   * accordion.toggle(0);
   * assertEquals(accordion.isOpen(0), true);
   * accordion.toggle(0);
   * assertEquals(accordion.isOpen(0), false);
   * ```
   */
  public toggle(index: number): void {
    this.apply(index, !this.entryAt(index).open);
  }

  /**
   * Move the selection to the header at `index` (clamped).
   *
   * @param index Index of the section whose header to select.
   *
   * @example Select a header
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Accordion, Text } from "@neonbyte/tui";
   *
   * const accordion = new Accordion({
   *   sections: [
   *     { title: "One", content: new Text("a") },
   *     { title: "Two", content: new Text("b") },
   *   ],
   * });
   *
   * accordion.select(1);
   * assertEquals(accordion.selected, 1);
   * accordion.select(9); // clamped to the last header
   * assertEquals(accordion.selected, 1);
   * ```
   */
  public select(index: number): void {
    this.cursor = Math.min(
      Math.max(0, index),
      Math.max(0, this.entries.length - 1),
    );
  }

  /**
   * Rename the section at `index`.
   *
   * @param index Index of the section.
   * @param title The new header text.
   * @throws {RangeError} When there is no section at `index`.
   *
   * @example Rename a section
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Accordion, Text } from "@neonbyte/tui";
   *
   * const accordion = new Accordion({
   *   sections: [{ title: "One", content: new Text("a") }],
   *   theme: { header: {}, open: {}, focused: {}, hover: {} },
   * });
   *
   * accordion.setTitle(0, "Uno");
   * assertEquals(accordion.render(20), ["▸ Uno"]);
   * ```
   */
  public setTitle(index: number, title: string): void {
    this.entryAt(index).title = title;
  }

  /**
   * Replace some paints; others keep their values. Request a render afterwards.
   *
   * @param theme The paints to change; see {@linkcode AccordionTheme}.
   *
   * @example Recolour the headers
   * ```ts
   * import { assert } from "@std/assert";
   * import { Accordion, Text } from "@neonbyte/tui";
   *
   * const accordion = new Accordion({
   *   sections: [{ title: "One", content: new Text("a") }],
   * });
   *
   * accordion.setTheme({ header: { fg: "#ff0000" } });
   * assert(accordion.render(20)[0].includes("\x1b[38;2;255;0;0m"));
   * ```
   */
  public setTheme(theme: AccordionTheme): void {
    this.theme = { ...this.theme, ...theme };
    this.cacheKey = "";
  }

  public invalidate(): void {
    this.cacheKey = "";

    this.bodies.clear();

    for (const entry of this.entries) {
      entry.content.invalidate?.();
    }
  }

  /**
   * Navigate or toggle on a navigation key, else pass the event on to the selected section's content while it is open.
   *
   * @param event The key or paste event.
   */
  public handleInput(event: InputEvent): void {
    if (
      event.type === "key" && this.entries.length > 0 &&
      this.navigate(event.key)
    ) {
      return;
    }

    const entry = this.entries[this.cursor];

    if (entry?.open) {
      entry.content.handleInput?.(event);
    }
  }

  /**
   * Toggle a clicked header, or pass the event on to the open content beneath the pointer.
   *
   * @param event The mouse report, relative to the accordion.
   * @returns Whether the accordion or its content handled the event.
   */
  public handleMouse(event: MouseInput): boolean {
    if (event.action === "leave") {
      this.hover = -1;

      return false;
    }

    if (
      this.pressedHeader &&
      (event.action === "drag" || event.action === "release")
    ) {
      this.pressedHeader = event.action === "drag";

      return true;
    }

    const hit = this.locate(event.y);

    if (hit === undefined) {
      this.hover = -1;

      return false;
    }

    if (hit.row === 0) {
      return this.handleHeader(event, hit.index);
    }

    this.hover = -1;

    if (event.x < this.indent) {
      return false;
    }

    return forwardMouse(
      this.entries[hit.index].content,
      event,
      this.indent,
      event.y - hit.row + 1,
    );
  }

  /**
   * Draw the headers, each followed by its content while open.
   *
   * @param width Available width in cells.
   * @returns The rendered rows.
   */
  public render(width: number): readonly string[] {
    if (width < 1) {
      return [];
    }

    const parts = this.entries.map((entry) => this.bodyOf(entry, width));
    const key = [
      width,
      this.focused,
      this.cursor,
      this.hover,
      ...this.entries.flatMap((entry) => [entry.open, entry.title]),
    ].join("\0");

    this.bodyRows = parts.map((rows) => rows.length);

    if (key === this.cacheKey && this.sameParts(parts)) {
      return this.cache;
    }

    this.cacheKey = key;
    this.cacheParts = parts;
    this.cache = parts.flatMap((rows, i) => [
      this.header(i, width),
      ...rows,
    ]);

    return this.cache;
  }

  /** The section at `index`; throws a `RangeError` when there is none. */
  private entryAt(index: number): Entry {
    if (!Number.isInteger(index) || index < 0 || index >= this.entries.length) {
      throw new RangeError(`No accordion section at index ${index}`);
    }

    return this.entries[index];
  }

  /** Open or close without notifying `onToggle`; returns the indices whose state changed, in the order they changed. */
  private apply(index: number, open: boolean): [number, boolean][] {
    const entry = this.entryAt(index);
    const changes: [number, boolean][] = [];

    if (open && !this.multiple) {
      this.entries.forEach((other, i) => {
        if (other.open && i !== index) {
          other.open = false;

          changes.push([i, false]);
        }
      });
    }

    if (entry.open !== open) {
      entry.open = open;

      changes.push([index, open]);
    }

    return changes;
  }

  /** Like `apply`, but reports each change to `onToggle`. */
  private userSetOpen(index: number, open: boolean): void {
    for (const [i, state] of this.apply(index, open)) {
      this.onToggle?.(i, state);
    }
  }

  /** Handle a header-navigation key; false when the key is not one. */
  private navigate(key: Key): boolean {
    const action = ACCORDION_ACTIONS.find((name) =>
      this.keys[name].some((spec) => matchesKey(key, spec))
    );

    if (action === undefined) {
      return false;
    }

    this.perform(action);

    return true;
  }

  /** Run the action a key is bound to. */
  private perform(action: AccordionAction): void {
    switch (action) {
      case "up":
        this.select(this.cursor - 1);

        break;
      case "down":
        this.select(this.cursor + 1);

        break;
      case "first":
        this.select(0);

        break;
      case "last":
        this.select(this.entries.length - 1);

        break;
      case "toggle":
        this.userSetOpen(this.cursor, !this.entries[this.cursor].open);

        break;
      case "open":
        this.userSetOpen(this.cursor, true);

        break;
      case "close":
        this.userSetOpen(this.cursor, false);

        break;
    }
  }

  /** Select the pressed or hovered header and toggle it on a left press. */
  private handleHeader(event: MouseInput, index: number): boolean {
    if (event.action === "move") {
      this.hover = index;

      return true;
    }

    if (event.action !== "press" || event.button !== "left") {
      return false;
    }

    this.pressedHeader = true;
    this.hover = -1;
    this.cursor = index;

    this.userSetOpen(index, !this.entries[index].open);

    return true;
  }

  /** The section at content row `y` and the row's offset from its header (0 is the header). */
  private locate(y: number): { index: number; row: number } | undefined {
    let top = 0;

    for (let i = 0; i < this.entries.length; i++) {
      const rows = this.entries[i].open ? this.bodyRows[i] ?? 0 : 0;

      if (y >= top && y <= top + rows) {
        return { index: i, row: y - top };
      }

      top += 1 + rows;
    }

    return undefined;
  }

  /** The indented content rows of `entry` while it is open, cached between renders. */
  private bodyOf(entry: Entry, width: number): readonly string[] {
    const room = width - this.indent;

    if (!entry.open || room < 1) {
      this.bodies.delete(entry);

      return NO_ROWS;
    }

    const source = entry.content.render(room);
    const cached = this.bodies.get(entry);

    if (cached?.source === source && cached.indent === this.indent) {
      return cached.rows;
    }

    const pad = " ".repeat(this.indent);
    const rows = source.map((row) => pad + row);

    this.bodies.set(entry, { source, indent: this.indent, rows });

    return rows;
  }

  /** Whether every section's rows are the ones of the cached render. */
  private sameParts(parts: readonly (readonly string[])[]): boolean {
    return parts.length === this.cacheParts.length &&
      parts.every((rows, i) => rows === this.cacheParts[i]);
  }

  /** The painted header row of section `index`. */
  private header(index: number, width: number): string {
    const entry = this.entries[index];
    const marker = entry.open ? this.glyphs.open : this.glyphs.closed;
    const text = truncateToWidth(
      `${marker}${" ".repeat(this.gap)}${entry.title}`,
      width,
      this.ellipsis,
    );
    const { header, open, focused, hover } = this.theme;
    const base = entry.open ? mergePaint(header, open) : header;

    if (this.focused && index === this.cursor) {
      return paint(text, mergePaint(base, focused));
    }

    return paint(
      text,
      index === this.hover ? mergePaint(base, hover) : base,
    );
  }
}
