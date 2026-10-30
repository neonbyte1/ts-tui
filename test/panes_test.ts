import { assertEquals, assertThrows } from "@std/assert";
import {
  type Component,
  encodeMouse,
  type MouseInput,
  TUI,
  VirtualTerminal,
  visibleWidth,
} from "../mod.ts";
import { Panes, PANES_GLYPHS, type PaneSpec } from "../src/components/panes.ts";
import { ScrollView } from "../src/components/scroll-view.ts";

// deno-lint-ignore no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;:]*m/g, "");

/** Rows of one repeated glyph: `count` of them, or as many as the height it is given (else one). Logs what it is asked. */
class Fill implements Component {
  public readonly calls: string[] = [];
  public readonly mouse: string[] = [];
  private rows: readonly string[] = [];
  private key = "";

  public constructor(
    private readonly glyph: string,
    private readonly count?: number,
  ) {}

  public render(width: number, height?: number): readonly string[] {
    const key = `${width}x${height}`;

    this.calls.push(key);

    if (key !== this.key) {
      this.key = key;
      this.rows = Array.from(
        { length: this.count ?? height ?? 1 },
        () => this.glyph.repeat(width),
      );
    }

    return this.rows;
  }

  public handleMouse(event: MouseInput): boolean {
    this.mouse.push(`${event.action}@${event.x},${event.y}`);

    return true;
  }
}

/** `count` rows "line N". */
class Lines implements Component {
  private readonly rows: readonly string[];

  public constructor(count: number) {
    this.rows = Array.from({ length: count }, (_, i) => `line ${i}`);
  }

  public render(): readonly string[] {
    return this.rows;
  }
}

function plain(rows: readonly string[]): string[] {
  return rows.map(strip);
}

function horizontal(
  panes: readonly PaneSpec[],
  extra: Partial<ConstructorParameters<typeof Panes>[0]> = {},
): Panes {
  return new Panes({ direction: "horizontal", panes, height: 2, ...extra });
}

function spec(
  size?: PaneSpec["size"],
  min?: number,
  max?: number,
): PaneSpec {
  return { component: new Fill("x"), size, min, max };
}

function sizesAt(panes: Panes, width: number): readonly number[] {
  panes.render(width);

  return panes.sizes;
}

function setup(cols: number, rows: number, mode: "drag" | "move" = "drag") {
  const terminal = new VirtualTerminal(cols, rows);
  const tui = new TUI(terminal, { mouse: mode });

  return { terminal, tui };
}

Deno.test("fixed panes keep their cells and flexible ones share the rest, dividers excluded", () => {
  const panes = horizontal([spec(10), spec(), spec()]);

  assertEquals(sizesAt(panes, 40), [10, 14, 14]);
  assertEquals(sizesAt(panes, 41), [10, 15, 14]);
  assertEquals(sizesAt(panes, 60), [10, 24, 24]);
});

Deno.test("percentages are shares of the space left after the dividers", () => {
  const panes = horizontal([spec("25%"), spec("75%")]);

  assertEquals(sizesAt(panes, 81), [20, 60]);
  assertEquals(sizesAt(panes, 41), [10, 30]);

  const mixed = horizontal([spec("50%"), spec(8), spec()]);

  assertEquals(sizesAt(mixed, 62), [30, 8, 22]);
});

Deno.test("rounding always adds up: whole cells go to the largest fractions, earlier panes first", () => {
  const thirds = horizontal([spec("33.3%"), spec("33.3%"), spec("33.3%")]);

  assertEquals(sizesAt(thirds, 102), [34, 33, 33]);

  const equal = horizontal([spec(), spec(), spec()]);

  assertEquals(sizesAt(equal, 12), [4, 3, 3]);
});

Deno.test("min and max hold panes at their bounds and the others share what is left", () => {
  const withMin = horizontal([spec(undefined, 20), spec(), spec()]);

  assertEquals(sizesAt(withMin, 47), [20, 13, 12]);

  const withMax = horizontal([spec(undefined, 1, 10), spec()]);

  assertEquals(sizesAt(withMax, 41), [10, 30]);

  const fixed = horizontal([spec(50, 1, 20), spec()]);

  assertEquals(sizesAt(fixed, 41), [20, 20]);

  const floor = horizontal([spec(2, 6), spec()]);

  assertEquals(sizesAt(floor, 41), [6, 34]);
});

Deno.test("with no flexible pane the last panes absorb a size change within their bounds", () => {
  const panes = horizontal([spec(10), spec(10, 4, 50)]);

  assertEquals(sizesAt(panes, 31), [10, 20]);
  assertEquals(sizesAt(panes, 15), [10, 4]);
});

Deno.test("when the bounds cannot be met the last panes shrink below their minimum so the sum still holds", () => {
  const panes = horizontal([
    spec(undefined, 5),
    spec(undefined, 5),
    spec(undefined, 5),
  ]);

  assertEquals(sizesAt(panes, 5), [3, 0, 0]);
  assertEquals(sizesAt(panes, 0), [0, 0, 0]);
});

Deno.test("every row is exactly as wide as the render width at any width", () => {
  const panes = horizontal([spec(7), spec("30%"), spec(undefined, 3, 9)]);

  for (let width = 0; width <= 80; width++) {
    const rows = panes.render(width);
    const sizes = panes.sizes;

    assertEquals(rows.length, 2);

    for (const row of rows) {
      assertEquals(visibleWidth(row) <= width, true);
    }

    if (width >= 2) {
      assertEquals(sizes.reduce((a, b) => a + b, 0) + 2, width);
      assertEquals(rows.map(visibleWidth), [width, width]);
    }
  }
});

Deno.test("sizes are recomputed when the width changes, keeping fixed panes", () => {
  const panes = horizontal([spec(12), spec()]);

  assertEquals(sizesAt(panes, 40), [12, 27]);
  assertEquals(sizesAt(panes, 70), [12, 57]);
  assertEquals(sizesAt(panes, 20), [12, 7]);
});

Deno.test("panes render at their width and height and sit side by side with a divider", () => {
  const a = new Fill("a");
  const b = new Fill("b");
  const panes = horizontal([
    { component: a, size: 3 },
    { component: b },
  ], { height: 2 });
  const rows = panes.render(10);

  assertEquals(plain(rows), ["aaa│bbbbbb", "aaa│bbbbbb"]);
  assertEquals(a.calls, ["3x2"]);
  assertEquals(b.calls, ["6x2"]);
});

Deno.test("a horizontal layout is as tall as its tallest pane by default, shorter panes padded", () => {
  const panes = new Panes({
    direction: "horizontal",
    panes: [
      { component: new Fill("a", 2), size: 3 },
      { component: new Fill("b", 4) },
    ],
  });

  assertEquals(plain(panes.render(8)), [
    "aaa│bbbb",
    "aaa│bbbb",
    "   │bbbb",
    "   │bbbb",
  ]);
});

Deno.test("height can be a function, and the render height wins over the option", () => {
  let rows = 2;
  const panes = horizontal([spec(2), spec()], { height: () => rows });

  assertEquals(panes.render(8).length, 2);

  rows = 4;

  assertEquals(panes.render(8).length, 4);
  assertEquals(panes.render(8, 3).length, 3);
});

Deno.test("children taller than the pane are cut and wider rows are cut to the pane width", () => {
  const long = new Fill("L", 9);
  const wide: Component = { render: () => ["0123456789", "你好你好你好"] };
  const panes = horizontal([
    { component: long, size: 4 },
    { component: wide, size: 5 },
    { component: new Fill("z") },
  ], { height: 3 });
  const rows = panes.render(16);

  assertEquals(rows.length, 3);
  assertEquals(rows.map(visibleWidth), [16, 16, 16]);
  assertEquals(plain(rows), [
    "LLLL│01234│zzzzz",
    "LLLL│你好 │zzzzz",
    "LLLL│     │zzzzz",
  ]);
});

Deno.test("styles end at the pane edge so colours never bleed into the next pane", () => {
  const open: Component = { render: () => ["\x1b[31;1mred red red red"] };
  const panes = horizontal([
    { component: open, size: 6 },
    { component: new Fill("b") },
  ], { height: 1 });
  const [row] = panes.render(14);
  const divider = row.indexOf("│");
  const reset = row.indexOf("\x1b[0m");

  assertEquals(reset > 0 && reset < divider, true);
  assertEquals(plain([row]), ["red re│bbbbbbb"]);
  assertEquals(row.slice(reset + 4, divider).includes("\x1b[31"), false);
  assertEquals(row.slice(divider).includes("\x1b[31"), false);
});

Deno.test("render returns the same array while nothing changed and a new one after a resize", () => {
  const panes = horizontal([spec(4), spec()]);
  const first = panes.render(20);

  assertEquals(panes.render(20), first);
  assertEquals(panes.render(21) === first, false);

  const again = panes.render(21);

  panes.setSizes([6, 8]);
  assertEquals(panes.render(21) === again, false);
});

Deno.test("a vertical layout stacks panes with a divider row and scissors each to its height", () => {
  const top = new Fill("t", 8);
  const bottom = new Fill("b", 1);
  const panes = new Panes({
    direction: "vertical",
    panes: [{ component: top, size: 3 }, { component: bottom }],
    height: 9,
  });
  const rows = panes.render(6);

  assertEquals(plain(rows), [
    "tttttt",
    "tttttt",
    "tttttt",
    "──────",
    "bbbbbb",
    "      ",
    "      ",
    "      ",
    "      ",
  ]);
  assertEquals(top.calls, ["6x3"]);
  assertEquals(bottom.calls, ["6x5"]);
  assertEquals(panes.sizes, [3, 5]);
});

Deno.test("a vertical layout takes its height from the render call, and needs one", () => {
  const panes = new Panes({
    direction: "vertical",
    panes: [{ component: new Fill("a") }, { component: new Fill("b") }],
  });

  assertThrows(() => panes.render(5), Error, "needs a height");
  assertEquals(plain(panes.render(5, 5)), [
    "aaaaa",
    "aaaaa",
    "─────",
    "bbbbb",
    "bbbbb",
  ]);
  assertEquals(panes.render(5, 3).length, 3);
});

Deno.test("dragging a divider resizes its two neighbours and turns them fixed", () => {
  const { terminal, tui } = setup(41, 3);
  const resized: number[][] = [];
  const panes = new Panes({
    direction: "horizontal",
    panes: [
      { component: new Fill("a"), size: 10 },
      { component: new Fill("b") },
      { component: new Fill("c") },
    ],
    height: 3,
    onResize: (sizes) => resized.push([...sizes]),
  });

  tui.addChild(panes);
  tui.start();
  tui.renderNow();
  assertEquals(panes.sizes, [10, 15, 14]);

  terminal.send(encodeMouse({ action: "press", x: 10, y: 1 }));
  terminal.send(encodeMouse({ action: "drag", x: 14, y: 1 }));
  assertEquals(panes.sizes, [14, 11, 14]);

  tui.renderNow();
  assertEquals(
    terminal.viewport()[1],
    `${"a".repeat(14)}│${"b".repeat(11)}│${"c".repeat(14)}`,
  );

  // The pointer may leave the divider's row and the screen: the drag is captured.
  terminal.send(encodeMouse({ action: "drag", x: 0, y: 0 }));
  assertEquals(panes.sizes, [1, 24, 14]);
  terminal.send(encodeMouse({ action: "drag", x: 40, y: 2 }));
  assertEquals(panes.sizes, [24, 1, 14]);
  terminal.send(encodeMouse({ action: "release", x: 40, y: 2 }));
  terminal.send(encodeMouse({ action: "drag", x: 5, y: 1 }));
  assertEquals(panes.sizes, [24, 1, 14]);
  assertEquals(resized, [[14, 11, 14], [1, 24, 14], [24, 1, 14]]);
  tui.stop();
});

Deno.test("dragging stays within the neighbours' min and max", () => {
  const { terminal, tui } = setup(41, 2);
  const panes = horizontal([
    { component: new Fill("a"), size: 10, min: 5, max: 12 },
    { component: new Fill("b"), min: 3 },
  ]);

  tui.addChild(panes);
  tui.start();
  tui.renderNow();

  terminal.send(encodeMouse({ action: "press", x: 10, y: 0 }));
  terminal.send(encodeMouse({ action: "drag", x: 2, y: 0 }));
  assertEquals(panes.sizes, [5, 35]);
  terminal.send(encodeMouse({ action: "drag", x: 30, y: 0 }));
  assertEquals(panes.sizes, [12, 28]);
  terminal.send(encodeMouse({ action: "release", x: 30, y: 0 }));
  tui.stop();
});

Deno.test("dragged panes stay fixed when the width changes, the last absorbing the difference", () => {
  const { terminal, tui } = setup(41, 2);
  const panes = horizontal([spec(), spec()]);

  tui.addChild(panes);
  tui.start();
  tui.renderNow();
  terminal.send(encodeMouse({ action: "press", x: 20, y: 0 }));
  terminal.send(encodeMouse({ action: "drag", x: 12, y: 0 }));
  terminal.send(encodeMouse({ action: "release", x: 12, y: 0 }));
  assertEquals(panes.sizes, [12, 28]);

  assertEquals(sizesAt(panes, 61), [12, 48]);
  assertEquals(sizesAt(panes, 21), [12, 8]);
  tui.stop();
});

Deno.test("a press on a divider captures and handles; panes that are not resizable leave dividers alone", () => {
  const panes = horizontal([spec(5), spec()]);
  const fixed = horizontal([spec(5), spec()], { resizable: false });

  panes.render(20);
  fixed.render(20);

  const press = (x: number): MouseInput => ({
    type: "mouse",
    action: "press",
    button: "left",
    x,
    y: 0,
    shift: false,
    alt: false,
    ctrl: false,
  });

  assertEquals(panes.handleMouse(press(5)), true);
  assertEquals(fixed.handleMouse(press(5)), false);
  assertEquals(fixed.handleMouse({ ...press(5), action: "move" }), false);
  assertEquals(fixed.handleMouse({ ...press(5), action: "drag" }), false);
  assertEquals(fixed.sizes, [5, 14]);
});

Deno.test("right-button presses on a divider do not start a drag", () => {
  const panes = horizontal([spec(5), spec()]);

  panes.render(20);

  assertEquals(
    panes.handleMouse({
      type: "mouse",
      action: "press",
      button: "right",
      x: 5,
      y: 0,
      shift: false,
      alt: false,
      ctrl: false,
    }),
    false,
  );
});

Deno.test("the divider under the pointer is highlighted until the pointer leaves it", () => {
  const { terminal, tui } = setup(21, 2, "move");
  const panes = horizontal([
    { component: new Fill("a"), size: 5 },
    { component: new Fill("b") },
  ]);
  const colour = "38;2;63;181;232";

  tui.addChild(panes);
  tui.start();
  tui.renderNow();
  assertEquals(panes.render(21)[0].includes(colour), false);

  terminal.send(encodeMouse({ action: "move", x: 5, y: 1 }));
  assertEquals(panes.render(21)[0].includes(colour), true);
  assertEquals(panes.render(21)[1].includes(colour), true);

  terminal.send(encodeMouse({ action: "move", x: 9, y: 1 }));
  assertEquals(panes.render(21)[0].includes(colour), false);

  terminal.send(encodeMouse({ action: "move", x: 5, y: 0 }));
  assertEquals(panes.render(21)[0].includes(colour), true);
  terminal.send(encodeMouse({ action: "move", x: 5, y: 5 }));
  assertEquals(panes.render(21)[0].includes(colour), false);
  tui.stop();
});

Deno.test("mouse events go to the pane under the pointer in its own cells", () => {
  const { terminal, tui } = setup(21, 3);
  const a = new Fill("a");
  const b = new Fill("b");
  const panes = horizontal([
    { component: a, size: 5 },
    { component: b },
  ], { height: 3 });

  tui.addChild(panes);
  tui.start();
  tui.renderNow();

  terminal.send(encodeMouse({ action: "press", x: 3, y: 1 }));
  terminal.send(encodeMouse({ action: "release", x: 3, y: 1 }));
  terminal.send(encodeMouse({ action: "press", x: 9, y: 2 }));
  terminal.send(encodeMouse({ action: "release", x: 9, y: 2 }));

  assertEquals(a.mouse, ["press@3,1", "release@3,1"]);
  assertEquals(b.mouse, ["press@3,2", "release@3,2"]);
  tui.stop();
});

Deno.test("vertical panes forward in their own cells and dragging a divider row resizes them", () => {
  const { terminal, tui } = setup(10, 9);
  const top = new Fill("t");
  const bottom = new Fill("b");
  const panes = new Panes({
    direction: "vertical",
    panes: [{ component: top }, { component: bottom }],
    height: 9,
  });

  tui.addChild(panes);
  tui.start();
  tui.renderNow();
  assertEquals(panes.sizes, [4, 4]);

  terminal.send(encodeMouse({ action: "press", x: 3, y: 6 }));
  terminal.send(encodeMouse({ action: "release", x: 3, y: 6 }));
  assertEquals(bottom.mouse, ["press@3,1", "release@3,1"]);

  terminal.send(encodeMouse({ action: "press", x: 3, y: 4 }));
  terminal.send(encodeMouse({ action: "drag", x: 3, y: 6 }));
  terminal.send(encodeMouse({ action: "release", x: 3, y: 6 }));
  assertEquals(panes.sizes, [6, 2]);
  assertEquals(top.mouse, []);

  tui.renderNow();
  assertEquals(terminal.viewport(), [
    "tttttttttt",
    "tttttttttt",
    "tttttttttt",
    "tttttttttt",
    "tttttttttt",
    "tttttttttt",
    "──────────",
    "bbbbbbbbbb",
    "bbbbbbbbbb",
  ]);
  tui.stop();
});

Deno.test("nested panes get their width and height from the outer one and receive coordinates in their own cells", () => {
  const { terminal, tui } = setup(30, 6);
  const left = new Fill("l");
  const top = new Fill("t");
  const bottom = new Fill("b");
  const inner = new Panes({
    direction: "vertical",
    panes: [{ component: top }, { component: bottom }],
  });
  const outer = new Panes({
    direction: "horizontal",
    panes: [{ component: left, size: 10 }, { component: inner }],
    height: 6,
  });

  tui.addChild(outer);
  tui.start();
  tui.renderNow();

  assertEquals(top.calls.at(-1), "19x3");
  assertEquals(bottom.calls.at(-1), "19x2");
  assertEquals(inner.sizes, [3, 2]);

  terminal.send(encodeMouse({ action: "press", x: 13, y: 4 }));
  terminal.send(encodeMouse({ action: "release", x: 13, y: 4 }));
  terminal.send(encodeMouse({ action: "press", x: 12, y: 1 }));
  terminal.send(encodeMouse({ action: "release", x: 12, y: 1 }));
  terminal.send(encodeMouse({ action: "press", x: 3, y: 2 }));
  terminal.send(encodeMouse({ action: "release", x: 3, y: 2 }));

  assertEquals(bottom.mouse, ["press@2,0", "release@2,0"]);
  assertEquals(top.mouse, ["press@1,1", "release@1,1"]);
  assertEquals(left.mouse, ["press@3,2", "release@3,2"]);

  // The inner divider row (screen row 3) drags inside the inner layout; the outer one still works.
  terminal.send(encodeMouse({ action: "press", x: 15, y: 3 }));
  terminal.send(encodeMouse({ action: "drag", x: 15, y: 1 }));
  terminal.send(encodeMouse({ action: "release", x: 15, y: 1 }));
  assertEquals(inner.sizes, [1, 4]);

  terminal.send(encodeMouse({ action: "press", x: 10, y: 5 }));
  terminal.send(encodeMouse({ action: "drag", x: 14, y: 5 }));
  terminal.send(encodeMouse({ action: "release", x: 14, y: 5 }));
  assertEquals(outer.sizes, [14, 15]);
  assertEquals(inner.sizes, [1, 4]);

  tui.renderNow();
  assertEquals(top.calls.at(-1), "15x1");
  tui.stop();
});

Deno.test("a ScrollView in a pane receives the pane height and scrolls with the wheel", () => {
  const { terminal, tui } = setup(21, 5);
  const view = new ScrollView(new Lines(30));
  const panes = horizontal([
    { component: new Fill("x"), size: 6 },
    { component: view },
  ], { height: 5 });

  tui.addChild(panes);
  tui.start();
  tui.renderNow();

  const rows = terminal.viewport();

  assertEquals(rows.length, 5);
  assertEquals(rows[0], `xxxxxx│${"line 0".padEnd(13)}┃`);
  assertEquals(rows[4], `xxxxxx│${"line 4".padEnd(13)}│`);

  terminal.send(
    encodeMouse({ action: "wheel", direction: "down", x: 12, y: 2 }),
  );
  tui.renderNow();
  assertEquals(view.scrollTop, 3);
  assertEquals(terminal.viewport()[0].slice(0, 14), "xxxxxx│line 3 ");

  // Over the fixed pane the wheel is not the view's.
  terminal.send(
    encodeMouse({ action: "wheel", direction: "down", x: 2, y: 2 }),
  );
  assertEquals(view.scrollTop, 3);
  tui.stop();
});

Deno.test("setPane swaps a pane's component and setSizes replaces every size", () => {
  const a = new Fill("a");
  const b = new Fill("b");
  const c = new Fill("c");
  const panes = horizontal([{ component: a, size: 4 }, { component: b }]);

  assertEquals(plain(panes.render(9)), ["aaaa│bbbb", "aaaa│bbbb"]);

  panes.setPane(1, c);
  assertEquals(plain(panes.render(9)), ["aaaa│cccc", "aaaa│cccc"]);

  panes.setSizes(["50%", "50%"]);
  assertEquals(plain(panes.render(9)), ["aaaa│cccc", "aaaa│cccc"]);

  panes.setSizes([2, 6]);
  assertEquals(panes.sizes, [2, 6]);
  assertEquals(plain(panes.render(9)), ["aa│cccccc", "aa│cccccc"]);
});

Deno.test("resizeBy moves a divider from code within bounds and reports whether it moved", () => {
  const panes = horizontal([spec(10, 4), spec(undefined, 5)]);

  assertEquals(panes.resizeBy(0, 3), false);

  panes.render(31);

  assertEquals(panes.resizeBy(0, 3), true);
  assertEquals(panes.sizes, [13, 17]);
  assertEquals(panes.resizeBy(0, -50), true);
  assertEquals(panes.sizes, [4, 26]);
  assertEquals(panes.resizeBy(0, -1), false);
  assertEquals(panes.resizeBy(0, 99), true);
  assertEquals(panes.sizes, [25, 5]);
});

Deno.test("invalid sizes and indexes are rejected", () => {
  assertThrows(
    () => horizontal([spec("abc" as `${number}%`)]),
    RangeError,
    "Invalid pane size",
  );

  const panes = horizontal([spec(3), spec()]);

  assertThrows(() => panes.setSizes([1]), RangeError);
  assertThrows(() => panes.setSizes([1, "x%" as `${number}%`]), RangeError);
  assertThrows(() => panes.setPane(5, new Fill("x")), RangeError);
  assertThrows(() => panes.resizeBy(1, 1), RangeError);
});

Deno.test("a single pane fills the width and has no dividers", () => {
  const panes = horizontal([{ component: new Fill("a") }]);

  assertEquals(plain(panes.render(6)), ["aaaaaa", "aaaaaa"]);
  assertEquals(panes.sizes, [6]);
});

Deno.test("mouse input before the first render, or outside the layout, is ignored", () => {
  const panes = horizontal([spec(5), spec()]);
  const press = (x: number, y: number): MouseInput => ({
    type: "mouse",
    action: "press",
    button: "left",
    x,
    y,
    shift: false,
    alt: false,
    ctrl: false,
  });

  assertEquals(panes.handleMouse(press(2, 0)), false);

  panes.render(20);

  assertEquals(panes.handleMouse(press(2, 5)), false);
  assertEquals(panes.handleMouse(press(-1, 0)), false);
  assertEquals(panes.handleMouse(press(25, 0)), false);
});

Deno.test("divider glyphs are chosen per direction", () => {
  const side = horizontal([spec(3), spec()], { glyphs: PANES_GLYPHS.ascii });
  const stacked = new Panes({
    direction: "vertical",
    panes: [spec(1), spec()],
    height: 3,
    glyphs: { vertical: "=" },
  });

  assertEquals(plain(side.render(8)), ["xxx|xxxx", "xxx|xxxx"]);
  assertEquals(plain(stacked.render(4)), ["xxxx", "====", "xxxx"]);
});

Deno.test("divider paints cover normal and dragging states, and setTheme changes the next render", () => {
  const { terminal, tui } = setup(21, 2);
  const red = "38;2;255;0;0";
  const blue = "38;2;0;0;255";
  const green = "38;2;0;255;0";
  const panes = horizontal([
    { component: new Fill("a"), size: 5 },
    { component: new Fill("b") },
  ], {
    theme: { divider: { fg: "#ff0000" }, dividerDragging: { fg: "#00ff00" } },
  });

  tui.addChild(panes);
  tui.start();
  tui.renderNow();
  assertEquals(panes.render(21)[0].includes(red), true);

  panes.setTheme({ divider: { fg: "#0000ff" } });

  assertEquals(panes.render(21)[0].includes(blue), true);
  assertEquals(panes.render(21)[0].includes(red), false);

  terminal.send(encodeMouse({ action: "press", x: 5, y: 1 }));

  assertEquals(panes.render(21)[0].includes(green), true);
  assertEquals(panes.render(21)[0].includes(blue), false);
  tui.stop();
});
