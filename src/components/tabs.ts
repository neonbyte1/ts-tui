import {
  bindKeys,
  type InputEvent,
  type Key,
  matchesKey,
  type MouseInput,
} from "../keys.ts";
import { mergePaint, type Paint, paint } from "../style.ts";
import { type Component, type Focusable, forwardMouse } from "../tui.ts";
import { padToWidth, truncateToWidth, visibleWidth } from "../width.ts";

/**
 * One tab: the label in the bar and the content shown while it is selected.
 *
 * @category Layout
 */
export interface TabItem {
  /** Text in the bar. */
  readonly label: string;
  /** Component shown below the bar while the tab is selected. */
  readonly content: Component;
}

/**
 * `"line"`: labels over a rule with a heavy bar under the selected one. `"boxed"`: the selected label sits in an open box.
 *
 * @category Layout
 */
export type TabsStyle = "line" | "boxed";

/**
 * Paints for the parts of a tab bar; each value replaces that part's default.
 *
 * @category Layout
 */
export interface TabsTheme {
  /** The selected label. Default accent `#3fb5e8`. */
  readonly selected?: Paint;
  /** Unselected labels. Default none. */
  readonly tab?: Paint;
  /** An unselected label under the pointer. Default dimmed accent. */
  readonly hover?: Paint;
  /** Added to the selected label while the tabs have focus. Default bold. */
  readonly focused?: Paint;
  /** The rule and the borders of unselected tabs. Default grey `#5c6370`. */
  readonly rule?: Paint;
  /** The selected tab's indicator: the heavy bar in `"line"` style, the top and bottom of the open box in `"boxed"` style. Default accent `#3fb5e8`. */
  readonly indicator?: Paint;
  /** The `‹` and `›` scroll markers. Default grey `#5c6370`. */
  readonly marker?: Paint;
  /** The separator drawn between tabs. Default grey `#5c6370`. */
  readonly separator?: Paint;
}

/**
 * Characters a tab bar is drawn with; each must be one cell wide.
 *
 * @category Layout
 */
export interface TabsGlyphs {
  /** The rule under unselected tabs and the free room. */
  readonly rule: string;
  /** The bar under the selected tab in `"line"` style. */
  readonly indicator: string;
  /** Top-left corner of the selected tab's box in `"boxed"` style. */
  readonly boxTopLeft: string;
  /** Top edge of the selected tab's box. */
  readonly boxTop: string;
  /** Top-right corner of the selected tab's box. */
  readonly boxTopRight: string;
  /** Where the box's left side meets the rule. */
  readonly boxBottomLeft: string;
  /** Where the box's right side meets the rule. */
  readonly boxBottomRight: string;
  /** Left and right sides of the selected tab's box. */
  readonly boxSide: string;
  /** Marks tabs scrolled off the left of the bar. */
  readonly scrollLeft: string;
  /** Marks tabs scrolled off the right of the bar. */
  readonly scrollRight: string;
}

/**
 * Built-in glyph sets: `unicode` (the default) and `ascii`.
 *
 * @category Layout
 */
export const TABS_GLYPHS: {
  readonly [Name in "unicode" | "ascii"]: TabsGlyphs;
} = {
  unicode: {
    rule: "─",
    indicator: "━",
    boxTopLeft: "╭",
    boxTop: "─",
    boxTopRight: "╮",
    boxBottomLeft: "╯",
    boxBottomRight: "╰",
    boxSide: "│",
    scrollLeft: "‹",
    scrollRight: "›",
  },
  ascii: {
    rule: "-",
    indicator: "=",
    boxTopLeft: "+",
    boxTop: "-",
    boxTopRight: "+",
    boxBottomLeft: "+",
    boxBottomRight: "+",
    boxSide: "|",
    scrollLeft: "<",
    scrollRight: ">",
  },
};

/**
 * What a key can do while the tabs have focus: select the previous, next, first or last tab.
 *
 * @category Layout
 */
export type TabsAction = "prev" | "next" | "first" | "last";

/**
 * Key specs (see {@linkcode matchesKey}) bound to each {@linkcode TabsAction} by default.
 *
 * @category Layout
 */
export const DEFAULT_TABS_KEYS: Readonly<
  Record<TabsAction, readonly string[]>
> = {
  prev: ["left"],
  next: ["right"],
  first: ["home"],
  last: ["end"],
};

/**
 * Tabs, look and behaviour of a {@linkcode Tabs}.
 *
 * @category Layout
 */
export interface TabsOptions {
  /** The tabs, in order. Add more later with {@linkcode Tabs.addTab}. */
  tabs?: readonly TabItem[];
  /** Index of the initially selected tab. Default 0. */
  selected?: number;
  /** Called after the user switches tab (keys, click or wheel), with the new index. `select()` does not call it. */
  onChange?: (index: number) => void;
  /** Paints for the parts of the bar, each replacing its default. */
  theme?: TabsTheme;
  /** Default `"line"`. */
  style?: TabsStyle;
  /** Characters of the rule, indicator, box and scroll markers; unset ones keep `TABS_GLYPHS.unicode`. */
  glyphs?: Partial<TabsGlyphs>;
  /** Cells either side of a label, inside any border. Default 1. */
  padding?: number;
  /** Drawn between neighbouring tabs on the label row (the rule continues through it). Default none. */
  separator?: string;
  /** Replaces the end of a label that does not fit. Default `…`. */
  ellipsis?: string;
  /** Keys per action; an entry replaces that action's `DEFAULT_TABS_KEYS` list. */
  keys?: Partial<Record<TabsAction, readonly string[]>>;
}

/** A tab's cells in the bar. */
interface Slot {
  readonly index: number;
  readonly start: number;
  readonly width: number;
}

/** Which tabs the bar shows from the first visible one, and whether tabs are hidden on either side. */
interface BarLayout {
  readonly slots: readonly Slot[];
  readonly left: boolean;
  readonly right: boolean;
}

/** What is under a bar cell: a scroll marker or a tab. */
type BarHit = { readonly scroll: "left" | "right" } | {
  readonly tab: number;
};

const DEFAULT_THEME: Required<TabsTheme> = {
  selected: { fg: "#3fb5e8" },
  tab: {},
  hover: { fg: "#3fb5e8", dim: true },
  focused: { bold: true },
  rule: { fg: "#5c6370" },
  indicator: { fg: "#3fb5e8" },
  marker: { fg: "#5c6370" },
  separator: { fg: "#5c6370" },
};

/** Bar rows for each style. */
const BAR_ROWS: Record<TabsStyle, number> = {
  line: 2,
  boxed: 3,
};

/** Cells the borders of a label take for each style. */
const BORDER_CELLS: Record<TabsStyle, number> = {
  line: 0,
  boxed: 2,
};

const TABS_ACTIONS: readonly TabsAction[] = ["prev", "next", "first", "last"];

const WHEEL_STEP: Record<string, number> = {
  up: -1,
  left: -1,
  down: 1,
  right: 1,
};

/** Cut or pad plain `s` to exactly `width` cells. */
function fit(s: string, width: number): string {
  return padToWidth(truncateToWidth(s, width, ""), width);
}

/**
 * A tab bar over the selected tab's content. Left/right (and Home/End) switch
 * tabs while the tabs have focus; every other key goes to the selected content.
 * Clicking a label selects it and the wheel over the bar steps through tabs.
 * When the labels do not fit, the bar scrolls to keep the selected tab visible
 * and shows `‹`/`›` markers that scroll it when clicked.
 *
 * Given a height, the content gets the rows below the bar and the component
 * returns exactly that many rows.
 *
 * @example Switch tabs with the keyboard
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Tabs, Text, TUI, VirtualTerminal } from "@neonbyte/tui";
 *
 * const terminal = new VirtualTerminal(24, 5);
 * const tui = new TUI(terminal);
 * const tabs = new Tabs({
 *   tabs: [
 *     { label: "One", content: new Text("first") },
 *     { label: "Two", content: new Text("second") },
 *   ],
 * });
 *
 * tui.addChild(tabs);
 * tui.setFocus(tabs);
 * tui.start();
 * tui.renderNow();
 * assertEquals(terminal.viewport()[2], "first");
 *
 * terminal.send("\x1b[C"); // Right
 * tui.renderNow();
 * assertEquals(terminal.viewport()[2], "second");
 * assertEquals(tabs.selected, 1);
 * tui.stop();
 * ```
 *
 * @category Layout
 */
export class Tabs implements Component, Focusable {
  /** Whether the tabs have the keyboard focus. */
  public focused = false;
  /** Called after the user switches tab, with the new index. */
  public onChange?: (index: number) => void;
  private readonly style: TabsStyle;
  private readonly glyphs: TabsGlyphs;
  private readonly padding: number;
  private readonly separator: string;
  private readonly separatorWidth: number;
  private readonly ellipsis: string;
  private readonly keys: Readonly<Record<TabsAction, readonly string[]>>;
  private theme: Required<TabsTheme>;
  private tabs: TabItem[];
  private current: number;
  /** Index of the first tab the bar shows. */
  private first = 0;
  private hover = -1;
  private pressedBar = false;
  private revealPending = true;
  private width = 0;
  private cacheKey = "";
  private cacheContent: readonly string[] | undefined;
  private cache: readonly string[] = [];

  /**
   * Create a tab bar.
   *
   * @param options Tabs, look and behaviour; see {@linkcode TabsOptions}.
   */
  public constructor(options: TabsOptions = {}) {
    this.style = options.style ?? "line";
    this.glyphs = { ...TABS_GLYPHS.unicode, ...options.glyphs };
    this.padding = Math.max(0, Math.floor(options.padding ?? 1));
    this.separator = options.separator ?? "";
    this.separatorWidth = visibleWidth(this.separator);
    this.ellipsis = options.ellipsis ?? "…";
    this.keys = bindKeys(DEFAULT_TABS_KEYS, options.keys);
    this.theme = { ...DEFAULT_THEME, ...options.theme };
    this.tabs = [...(options.tabs ?? [])];
    this.current = this.clamp(options.selected ?? 0);
    this.onChange = options.onChange;
  }

  /** Index of the selected tab. */
  public get selected(): number {
    return this.current;
  }

  /** Number of tabs. */
  public get count(): number {
    return this.tabs.length;
  }

  /**
   * Replace some paints; others keep their values. Request a render afterwards.
   *
   * @param theme The paints to change; see {@linkcode TabsTheme}.
   *
   * @example Recolour the selected label
   * ```ts
   * import { assert } from "@std/assert";
   * import { Tabs, Text } from "@neonbyte/tui";
   *
   * const tabs = new Tabs({ tabs: [{ label: "One", content: new Text("first") }] });
   *
   * tabs.setTheme({ selected: { fg: "#ff0000" } });
   * assert(tabs.render(20)[0].includes("\x1b[38;2;255;0;0m"));
   * ```
   */
  public setTheme(theme: TabsTheme): void {
    this.theme = { ...this.theme, ...theme };
    this.cacheKey = "";
  }

  /**
   * Select the tab at `index` (clamped to the existing tabs). Does not call `onChange`.
   *
   * @param index Index of the tab to select.
   *
   * @example Select a tab from code
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Tabs, Text } from "@neonbyte/tui";
   *
   * const tabs = new Tabs({
   *   tabs: [
   *     { label: "One", content: new Text("first") },
   *     { label: "Two", content: new Text("second") },
   *   ],
   * });
   *
   * tabs.select(1);
   * assertEquals(tabs.selected, 1);
   * assertEquals(tabs.render(20)[2], "second");
   *
   * tabs.select(9); // clamped to the last tab
   * assertEquals(tabs.selected, 1);
   * ```
   */
  public select(index: number): void {
    this.current = this.clamp(index);
    this.revealPending = true;
  }

  /**
   * Append a tab.
   *
   * @param label Text in the bar.
   * @param content Component shown while the tab is selected.
   * @returns The index of the new tab.
   *
   * @example Add a tab
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Tabs, Text } from "@neonbyte/tui";
   *
   * const tabs = new Tabs();
   *
   * assertEquals(tabs.addTab("Logs", new Text("no logs")), 0);
   * assertEquals(tabs.addTab("Help", new Text("press ?")), 1);
   * assertEquals(tabs.count, 2);
   * ```
   */
  public addTab(label: string, content: Component): number {
    this.tabs.push({ label, content });

    this.revealPending = true;

    return this.tabs.length - 1;
  }

  /**
   * Remove the tab at `index`. The selection follows its tab; removing the selected tab selects its neighbour.
   *
   * @param index Index of the tab to remove.
   * @throws {RangeError} When there is no tab at `index`.
   *
   * @example Close a tab
   * ```ts
   * import { assertEquals } from "@std/assert";
   * import { Tabs, Text } from "@neonbyte/tui";
   *
   * const tabs = new Tabs({
   *   tabs: [
   *     { label: "One", content: new Text("first") },
   *     { label: "Two", content: new Text("second") },
   *   ],
   *   selected: 1,
   * });
   *
   * tabs.removeTab(0);
   * assertEquals(tabs.count, 1);
   * assertEquals(tabs.selected, 0); // still the "Two" tab
   * ```
   */
  public removeTab(index: number): void {
    this.tabAt(index);
    this.tabs.splice(index, 1);

    this.current = this.clamp(
      index < this.current ? this.current - 1 : this.current,
    );
    this.first = Math.min(this.first, Math.max(0, this.tabs.length - 1));
    this.hover = -1;
    this.revealPending = true;
  }

  /**
   * Rename the tab at `index`.
   *
   * @param index Index of the tab to rename.
   * @param label The new text in the bar.
   * @throws {RangeError} When there is no tab at `index`.
   *
   * @example Rename a tab
   * ```ts
   * import { assert } from "@std/assert";
   * import { Tabs, Text } from "@neonbyte/tui";
   *
   * const tabs = new Tabs({ tabs: [{ label: "Untitled", content: new Text("") }] });
   *
   * tabs.setLabel(0, "notes.txt");
   * assert(tabs.render(20)[0].includes("notes.txt"));
   * ```
   */
  public setLabel(index: number, label: string): void {
    const tab = this.tabAt(index);

    this.tabs[index] = { label, content: tab.content };
    this.revealPending = true;
  }

  public invalidate(): void {
    this.cacheKey = "";

    for (const tab of this.tabs) {
      tab.content.invalidate?.();
    }
  }

  /**
   * Switch tabs on a tab key, else pass the event on to the selected content.
   *
   * @param event The key or paste event.
   */
  public handleInput(event: InputEvent): void {
    if (event.type === "key") {
      const target = this.keyTarget(event.key);

      if (target !== undefined) {
        this.pick(target);

        return;
      }
    }

    this.tabs[this.current]?.content.handleInput?.(event);
  }

  /**
   * Select a clicked label, scroll the bar from its markers, step through tabs with the wheel, or pass the event on to the selected content.
   *
   * @param event The mouse report, relative to the tabs.
   * @returns Whether the tabs or their content handled the event.
   */
  public handleMouse(event: MouseInput): boolean {
    if (event.action === "leave") {
      this.hover = -1;

      return false;
    }

    if (
      this.pressedBar && (event.action === "drag" || event.action === "release")
    ) {
      this.pressedBar = event.action === "drag";

      return true;
    }

    if (event.y < this.barRows) {
      return this.handleBar(event);
    }

    this.hover = -1;

    if (this.current >= this.tabs.length) {
      return false;
    }

    return forwardMouse(
      this.tabs[this.current].content,
      event,
      0,
      this.barRows,
    );
  }

  /**
   * Draw the bar and the selected tab's content.
   *
   * @param width Available width in cells.
   * @param height Rows to fill; the content gets the rows below the bar. Default: as many as the content needs.
   * @returns The rendered rows.
   */
  public render(width: number, height?: number): readonly string[] {
    if (width < 1) {
      return [];
    }

    const layout = this.layoutAt(width);
    const rows = this.barRows;
    const bodyHeight = height === undefined
      ? undefined
      : Math.max(0, height - rows);
    const content =
      this.tabs[this.current]?.content.render(width, bodyHeight) ?? [];
    const key = [
      width,
      height,
      this.current,
      this.focused,
      this.hover,
      this.first,
      this.style,
      ...this.tabs.map((tab) => tab.label),
    ].join("\0");

    if (key === this.cacheKey && content === this.cacheContent) {
      return this.cache;
    }

    this.cacheKey = key;
    this.cacheContent = content;

    const body = bodyHeight === undefined
      ? content
      : Array.from({ length: bodyHeight }, (_, i) => content[i] ?? "");
    const out = [...this.bar(width, layout), ...body];

    this.cache = height === undefined ? out : out.slice(0, height);

    return this.cache;
  }

  /** Rows the bar takes for the current style. */
  private get barRows(): number {
    return BAR_ROWS[this.style];
  }

  /** `index` limited to the existing tabs. */
  private clamp(index: number): number {
    return Math.min(Math.max(0, index), Math.max(0, this.tabs.length - 1));
  }

  /** The tab at `index`; throws a `RangeError` when there is none. */
  private tabAt(index: number): TabItem {
    if (!Number.isInteger(index) || index < 0 || index >= this.tabs.length) {
      throw new RangeError(`No tab at index ${index}`);
    }

    return this.tabs[index];
  }

  /** The tab a key switches to, or undefined when the key is not for the bar. */
  private keyTarget(key: Key): number | undefined {
    const action = TABS_ACTIONS.find((name) =>
      this.keys[name].some((spec) => matchesKey(key, spec))
    );

    switch (action) {
      case "prev":
        return this.current - 1;
      case "next":
        return this.current + 1;
      case "first":
        return 0;
      case "last":
        return this.tabs.length - 1;
      default:
        return undefined;
    }
  }

  /** Select by user action: clamp, and tell `onChange` if the tab changed. */
  private pick(index: number): void {
    const next = this.clamp(index);

    if (next === this.current) {
      return;
    }

    this.select(next);
    this.onChange?.(next);
  }

  /** Cells the tab's padded label and borders take without cutting. */
  private naturalWidth(index: number): number {
    return visibleWidth(this.tabs[index].label) + 2 * this.padding +
      BORDER_CELLS[this.style];
  }

  /** The tabs that fit from `first` on, within `width` cells. Markers need room for both and a cell between. */
  private layout(first: number, width: number): BarLayout {
    const markers = width >= 3;
    const left = markers && first > 0;
    const start = left ? 1 : 0;
    const remaining = this.tabs.length - first;
    let total = Math.max(0, remaining - 1) * this.separatorWidth;

    for (let i = first; i < this.tabs.length; i++) {
      total += this.naturalWidth(i);
    }

    // A lone tab too wide for the bar is cut rather than flagged as scrolled.
    const right = markers && remaining > 1 && start + total > width;
    const slots = this.place(first, start, width - (right ? 1 : 0));

    return { slots, left, right };
  }

  /** Lay tabs out from `first` between cells `start` and `end`; only the first may be cut to fit. */
  private place(first: number, start: number, end: number): Slot[] {
    const slots: Slot[] = [];
    let at = start;

    for (let i = first; i < this.tabs.length; i++) {
      const gap = slots.length > 0 ? this.separatorWidth : 0;
      const room = end - at - gap;

      if (room <= 0) {
        break;
      }

      const natural = this.naturalWidth(i);

      if (natural > room && slots.length > 0) {
        break;
      }

      const cells = Math.min(natural, room);

      slots.push({ index: i, start: at + gap, width: cells });

      at += gap + cells;
    }

    return slots;
  }

  /** Scroll the bar so the selected tab shows, and use free room on the right for tabs scrolled off the left. */
  private reveal(width: number): void {
    this.first = Math.min(this.first, this.current);

    while (
      this.first < this.current &&
      !this.layout(this.first, width).slots.some((slot) =>
        slot.index === this.current
      )
    ) {
      this.first++;
    }

    while (this.first > 0 && !this.layout(this.first - 1, width).right) {
      this.first--;
    }
  }

  /** Lay the bar out for `width`, first revealing the selected tab if needed. */
  private layoutAt(width: number): BarLayout {
    if (width !== this.width) {
      this.width = width;
      this.revealPending = true;
    }

    if (this.revealPending) {
      this.revealPending = false;

      this.reveal(width);
    }

    return this.layout(this.first, width);
  }

  /** What is under bar cell `x`. */
  private pickAt(x: number): BarHit | undefined {
    const layout = this.layoutAt(this.width);

    if (layout.left && x === 0) {
      return { scroll: "left" };
    }

    if (layout.right && x === this.width - 1) {
      return { scroll: "right" };
    }

    const slot = layout.slots.find((candidate) =>
      x >= candidate.start && x < candidate.start + candidate.width
    );

    return slot === undefined ? undefined : { tab: slot.index };
  }

  /** Handle the wheel, hover and presses on the bar rows. */
  private handleBar(event: MouseInput): boolean {
    if (event.action === "wheel") {
      this.pick(this.current + (WHEEL_STEP[event.direction ?? ""] ?? 0));

      return true;
    }

    const hit = this.pickAt(event.x);

    if (event.action === "move") {
      this.hover = hit !== undefined && "tab" in hit ? hit.tab : -1;

      return this.hover >= 0;
    }

    if (event.action !== "press" || event.button !== "left") {
      return false;
    }

    this.pressedBar = true;
    this.hover = -1;

    this.pressHit(hit);

    return true;
  }

  /** Select the pressed tab or scroll the bar by one tab. */
  private pressHit(hit: BarHit | undefined): void {
    if (hit === undefined) {
      return;
    }

    if ("tab" in hit) {
      this.pick(hit.tab);
    } else if (hit.scroll === "left") {
      this.first = Math.max(0, this.first - 1);
    } else {
      this.first = Math.min(this.tabs.length - 1, this.first + 1);
    }
  }

  /** The painted rows of the bar. */
  private bar(width: number, layout: BarLayout): string[] {
    return Array.from(
      { length: this.barRows },
      (_, row) => this.barRow(row, width, layout),
    );
  }

  /** One painted row of the bar. */
  private barRow(row: number, width: number, layout: BarLayout): string {
    const labelRow = this.style === "line" ? 0 : 1;
    const isRule = row === this.barRows - 1;
    const fill = isRule ? paint(this.glyphs.rule, this.theme.rule) : " ";
    const marker = (glyph: string) =>
      row === labelRow ? paint(glyph, this.theme.marker) : fill;
    let out = layout.left ? marker(this.glyphs.scrollLeft) : "";
    let at = layout.left ? 1 : 0;

    for (const slot of layout.slots) {
      const gap = slot.start - at;

      if (gap > 0) {
        out += row === labelRow
          ? paint(fit(this.separator, gap), this.theme.separator)
          : fill.repeat(gap);
      }

      out += this.slotCell(slot, row);
      at = slot.start + slot.width;
    }

    const end = width - (layout.right ? 1 : 0);

    out += fill.repeat(Math.max(0, end - at));

    return layout.right ? out + marker(this.glyphs.scrollRight) : out;
  }

  /** Paint of a label by state: selected (focused or not), hovered or plain. */
  private labelPaint(index: number): Paint {
    if (index === this.current) {
      return mergePaint(
        this.theme.tab,
        this.theme.selected,
        this.focused ? this.theme.focused : undefined,
      );
    }

    return index === this.hover
      ? mergePaint(this.theme.tab, this.theme.hover)
      : this.theme.tab;
  }

  /** A label with its padding, cut with the ellipsis to fit `room` cells. */
  private paddedLabel(index: number, room: number): string {
    const pad = " ".repeat(this.padding);
    const label = truncateToWidth(
      this.tabs[index].label,
      Math.max(0, room - 2 * this.padding),
      this.ellipsis,
    );

    return `${pad}${label}${pad}`;
  }

  /** One tab's cells on bar row `row`. */
  private slotCell(slot: Slot, row: number): string {
    const selected = slot.index === this.current;
    const own = this.labelPaint(slot.index);
    const text = (plain: string) => paint(fit(plain, slot.width), own);

    if (this.style === "line") {
      if (row === 0) {
        return text(this.paddedLabel(slot.index, slot.width));
      }

      return selected
        ? paint(this.glyphs.indicator.repeat(slot.width), this.theme.indicator)
        : paint(this.glyphs.rule.repeat(slot.width), this.theme.rule);
    }

    return this.boxedCell(slot, row, selected, text);
  }

  /** One tab's cells on bar row `row` in the boxed style. */
  private boxedCell(
    slot: Slot,
    row: number,
    selected: boolean,
    text: (plain: string) => string,
  ): string {
    const glyphs = this.glyphs;
    const inner = Math.max(0, slot.width - 2);

    if (row === 2) {
      return selected
        ? paint(
          fit(
            `${glyphs.boxBottomLeft}${
              " ".repeat(inner)
            }${glyphs.boxBottomRight}`,
            slot.width,
          ),
          this.theme.indicator,
        )
        : paint(glyphs.rule.repeat(slot.width), this.theme.rule);
    }

    if (row === 0) {
      return selected
        ? paint(
          fit(
            `${glyphs.boxTopLeft}${
              glyphs.boxTop.repeat(inner)
            }${glyphs.boxTopRight}`,
            slot.width,
          ),
          this.theme.indicator,
        )
        : " ".repeat(slot.width);
    }

    const label = this.paddedLabel(slot.index, inner);
    const body = selected
      ? `${glyphs.boxSide}${padToWidth(label, inner)}${glyphs.boxSide}`
      : ` ${padToWidth(label, inner)} `;

    return text(body);
  }
}
