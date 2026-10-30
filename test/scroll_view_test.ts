import { assertEquals } from "@std/assert";
import {
  type Component,
  Container,
  encodeMouse,
  type Focusable,
  type InputEvent,
  InputParser,
  type MouseInput,
  TUI,
  VirtualTerminal,
  visibleWidth,
} from "../mod.ts";
import { ScrollView } from "../src/components/scroll-view.ts";
import { SCROLLBAR_GLYPHS } from "../src/scrollbar.ts";

// deno-lint-ignore no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;:]*m/g, "");

/** `count` rows "line N"; records the widths it renders at and the input it receives. */
class Lines implements Component, Focusable {
  public focused = false;
  public readonly widths: number[] = [];
  public readonly keys: string[] = [];
  public readonly mouse: string[] = [];
  public rows: readonly string[];

  public constructor(
    count: number,
    private readonly handlesWheel = false,
  ) {
    this.rows = Array.from({ length: count }, (_, i) => `line ${i}`);
  }

  public setCount(count: number): void {
    this.rows = Array.from({ length: count }, (_, i) => `line ${i}`);
  }

  public render(width: number): readonly string[] {
    this.widths.push(width);

    return this.rows;
  }

  public handleInput(event: InputEvent): void {
    this.keys.push(event.type === "key" ? event.key.name : event.type);
  }

  public handleMouse(event: MouseInput): boolean {
    this.mouse.push(`${event.action}@${event.x},${event.y}`);

    return event.action !== "wheel" || this.handlesWheel;
  }
}

function plain(rows: readonly string[]): string[] {
  return rows.map(strip);
}

function key(view: ScrollView, input: string): void {
  new InputParser((event) => {
    if (event.type === "key" || event.type === "paste") {
      view.handleInput(event);
    }
  }).feed(input);
}

function mouse(
  action: MouseInput["action"],
  x: number,
  y: number,
  extra: Partial<MouseInput> = {},
): MouseInput {
  return {
    type: "mouse",
    action,
    button: action === "wheel" || action === "move" ? "none" : "left",
    x,
    y,
    shift: false,
    alt: false,
    ctrl: false,
    ...extra,
  };
}

function setup(rows = 6, cols = 20) {
  const terminal = new VirtualTerminal(cols, rows);
  const tui = new TUI(terminal, { mouse: "drag" });

  return { terminal, tui };
}

Deno.test("the view shows exactly the viewport rows, each as wide as the render width", () => {
  const view = new ScrollView(new Lines(10));
  const rows = view.render(12, 4);

  assertEquals(rows.length, 4);
  assertEquals(rows.map(visibleWidth), [12, 12, 12, 12]);
  assertEquals(plain(rows).map((row) => row.slice(0, 11).trimEnd()), [
    "line 0",
    "line 1",
    "line 2",
    "line 3",
  ]);
});

Deno.test("the viewport height is the render height, else the option, else every row", () => {
  const view = new ScrollView(new Lines(10), { height: 3 });

  assertEquals(view.render(10).length, 3);
  assertEquals(view.render(10, 5).length, 5);
  assertEquals(new ScrollView(new Lines(7)).render(10).length, 7);
  assertEquals(view.render(10, 0), []);
});

Deno.test("content shorter than the viewport is padded with blank rows", () => {
  const rows = new ScrollView(new Lines(2)).render(8, 4);

  assertEquals(rows.length, 4);
  assertEquals(rows.map(visibleWidth), [8, 8, 8, 8]);
  assertEquals(plain(rows).map((row) => row.trim()), [
    "line 0",
    "line 1",
    "",
    "",
  ]);
});

Deno.test("the child renders one column narrower, and auto keeps that column free when nothing overflows", () => {
  const short = new Lines(3);
  const tall = new Lines(30);
  const fits = new ScrollView(short, { height: 5 });
  const overflows = new ScrollView(tall, { height: 5 });

  assertEquals(plain(fits.render(10)).every((row) => row.endsWith(" ")), true);
  assertEquals(short.widths.at(-1), 9);
  assertEquals(tall.widths.length, 0);
  assertEquals(
    plain(overflows.render(10)).map((row) => row.at(-1)),
    ["┃", "│", "│", "│", "│"],
  );
  assertEquals(tall.widths.at(-1), 9);
});

Deno.test("scrollbar always draws the track when everything fits, never gives the child the full width", () => {
  const always = new ScrollView(new Lines(2), {
    height: 3,
    scrollbar: "always",
  });
  const childNever = new Lines(30);
  const never = new ScrollView(childNever, {
    height: 3,
    scrollbar: "never",
  });

  assertEquals(plain(always.render(8)).map((row) => row.at(-1)), [
    "│",
    "│",
    "│",
  ]);
  assertEquals(plain(never.render(8)).join("").includes("│"), false);
  assertEquals(childNever.widths.at(-1), 8);
  assertEquals(never.render(8).map(visibleWidth), [8, 8, 8]);
});

Deno.test("the scrollbar thumb follows the offset", () => {
  const view = new ScrollView(new Lines(20), { height: 5 });
  const bar = () => plain(view.render(10)).map((row) => row.at(-1)).join("");

  assertEquals(bar(), "┃││││");
  view.scrollToBottom();
  assertEquals(bar(), "││││┃");
});

Deno.test("rows wider than the child's width are cut and styles end at the edge", () => {
  const child = new Lines(0);

  child.rows = ["\x1b[31mred red red red red"];

  const [row] = new ScrollView(child, { height: 1 }).render(8);

  assertEquals(visibleWidth(row), 8);
  assertEquals(row.startsWith("\x1b[31mred red"), true);
  assertEquals(
    row.slice(row.indexOf("red red") + 7).startsWith("\x1b[0m"),
    true,
  );
});

Deno.test("render returns the same array while nothing changed", () => {
  const view = new ScrollView(new Lines(20), { height: 5 });
  const first = view.render(10);

  assertEquals(view.render(10), first);

  view.scrollBy(1);

  const moved = view.render(10);

  assertEquals(moved === first, false);
  assertEquals(view.render(10), moved);
  assertEquals(view.render(11) === moved, false);
});

Deno.test("scrollTo and scrollBy clamp to the content and report changes through onScroll", () => {
  const view = new ScrollView(new Lines(20), { height: 5 });
  const seen: number[] = [];

  view.onScroll = (offset) => seen.push(offset);

  view.render(10);

  assertEquals(view.maxScroll, 15);

  view.scrollBy(4);
  view.scrollBy(-10);
  view.scrollTo(99);
  view.scrollTo(99);
  view.scrollTo(-3);

  assertEquals(seen, [4, 0, 15, 0]);
  assertEquals(view.scrollTop, 0);
});

Deno.test("the offset is clamped when the content shrinks", () => {
  const child = new Lines(30);
  const view = new ScrollView(child, { height: 5 });

  view.render(10);
  view.scrollTo(25);
  child.setCount(12);

  const rows = plain(view.render(10));

  assertEquals(view.scrollTop, 7);
  assertEquals(rows[0].slice(0, 9).trimEnd(), "line 7");
  assertEquals(rows[4].slice(0, 9).trimEnd(), "line 11");

  child.setCount(3);
  view.render(10);

  assertEquals(view.scrollTop, 0);
});

Deno.test("follow keeps the view at the bottom while it is there, and lets go when scrolled up", () => {
  const child = new Lines(10);
  const view = new ScrollView(child, { height: 4, follow: true });
  const last = () => plain(view.render(10)).at(-1)?.slice(0, 9).trimEnd();

  assertEquals(last(), "line 9");

  child.setCount(14);
  assertEquals(last(), "line 13");

  view.scrollBy(-3);
  child.setCount(20);
  assertEquals(last(), "line 10");
  assertEquals(view.scrollTop, 7);

  view.scrollToBottom();
  child.setCount(25);
  assertEquals(last(), "line 24");
});

Deno.test("without follow the view stays put while content grows", () => {
  const child = new Lines(10);
  const view = new ScrollView(child, { height: 4 });

  view.render(10);
  view.scrollToBottom();
  child.setCount(14);
  view.render(10);

  assertEquals(view.scrollTop, 6);
});

Deno.test("scrollToBottom before the first render lands at the end", () => {
  const view = new ScrollView(new Lines(20), { height: 5 });

  view.scrollToBottom();
  view.render(10);

  assertEquals(view.scrollTop, 15);
});

Deno.test("ensureVisible scrolls the least that shows a row", () => {
  const view = new ScrollView(new Lines(30), { height: 5 });

  view.render(10);
  view.ensureVisible(3);
  assertEquals(view.scrollTop, 0);

  view.ensureVisible(9);
  assertEquals(view.scrollTop, 5);

  view.ensureVisible(7);
  assertEquals(view.scrollTop, 5);

  view.ensureVisible(2);
  assertEquals(view.scrollTop, 2);
});

Deno.test("keys scroll: arrows by a row, page keys by a page, Home and End to the ends", () => {
  const child = new Lines(30);
  const view = new ScrollView(child, { height: 6 });

  view.render(10);

  key(view, "\x1b[B");
  key(view, "\x1b[B");
  assertEquals(view.scrollTop, 2);

  key(view, "\x1b[A");
  assertEquals(view.scrollTop, 1);

  key(view, "\x1b[6~");
  assertEquals(view.scrollTop, 6);

  key(view, "\x1b[5~");
  assertEquals(view.scrollTop, 1);

  key(view, "\x1b[F");
  assertEquals(view.scrollTop, 24);

  key(view, "\x1b[H");
  assertEquals(view.scrollTop, 0);

  key(view, "\x1b[1;5F");
  assertEquals(view.scrollTop, 24);

  key(view, "\x1b[1;5H");
  assertEquals(view.scrollTop, 0);
  assertEquals(child.keys, []);
});

Deno.test("other keys and paste go to the child", () => {
  const child = new Lines(30);
  const view = new ScrollView(child, { height: 6 });

  key(view, "x");
  key(view, "\r");
  key(view, "\x1b[200~pasted\x1b[201~");

  assertEquals(child.keys, ["x", "enter", "paste"]);
  assertEquals(view.scrollTop, 0);
});

Deno.test("focusing the view focuses a focusable child", () => {
  const child = new Lines(3);
  const view = new ScrollView(child);

  view.focused = true;

  assertEquals(child.focused, true);

  view.focused = false;

  assertEquals(child.focused, false);
});

Deno.test("the wheel scrolls by the wheel step", () => {
  const view = new ScrollView(new Lines(40), { height: 5, wheelStep: 2 });

  view.render(10);

  assertEquals(
    view.handleMouse(mouse("wheel", 2, 1, { direction: "down" })),
    true,
  );
  assertEquals(view.scrollTop, 2);

  view.handleMouse(mouse("wheel", 2, 1, { direction: "down" }));
  view.handleMouse(mouse("wheel", 9, 1, { direction: "up" }));
  assertEquals(view.scrollTop, 2);

  const dflt = new ScrollView(new Lines(40), { height: 5 });

  dflt.render(10);
  dflt.handleMouse(mouse("wheel", 2, 1, { direction: "down" }));
  assertEquals(dflt.scrollTop, 3);
});

Deno.test("the wheel is left to the enclosing view when this one cannot scroll further", () => {
  const view = new ScrollView(new Lines(40), { height: 5 });

  view.render(10);

  assertEquals(
    view.handleMouse(mouse("wheel", 2, 1, { direction: "up" })),
    false,
  );
  view.scrollToBottom();
  assertEquals(
    view.handleMouse(mouse("wheel", 2, 1, { direction: "down" })),
    false,
  );
});

Deno.test("a nested view takes the wheel first, then hands it to the outer one at its end", () => {
  const inner = new ScrollView(new Lines(10), { height: 3 });
  const content = new Container();

  content.addChild(inner);
  content.addChild(new Lines(40));

  const outer = new ScrollView(content, { height: 8 });

  outer.render(20);

  const wheel = () =>
    outer.handleMouse(mouse("wheel", 2, 1, { direction: "down" }));

  wheel();
  assertEquals([inner.scrollTop, outer.scrollTop], [3, 0]);

  inner.scrollToBottom();
  wheel();
  assertEquals([inner.scrollTop, outer.scrollTop], [7, 3]);
});

Deno.test("mouse events inside the view reach the child in its own scrolled cells", () => {
  const child = new Lines(40);
  const view = new ScrollView(child, { height: 5 });

  view.render(10);
  view.scrollTo(10);

  assertEquals(view.handleMouse(mouse("press", 3, 2)), true);
  view.handleMouse(mouse("move", 0, 0));
  assertEquals(child.mouse, ["press@3,12", "move@0,10"]);
});

Deno.test("mouse events outside the viewport are not forwarded", () => {
  const child = new Lines(40);
  const view = new ScrollView(child, { height: 5 });

  view.render(10);

  assertEquals(view.handleMouse(mouse("press", 3, 5)), false);
  assertEquals(view.handleMouse(mouse("press", 3, -1)), false);
  assertEquals(view.handleMouse(mouse("press", 10, 1)), false);
  assertEquals(child.mouse, []);
});

Deno.test("a child that handles the wheel keeps it; otherwise the view scrolls", () => {
  const keeps = new Lines(40, true);
  const view = new ScrollView(keeps, { height: 5 });

  view.render(10);
  view.handleMouse(mouse("wheel", 2, 1, { direction: "down" }));

  assertEquals(keeps.mouse, ["wheel@2,1"]);
  assertEquals(view.scrollTop, 0);

  const passes = new Lines(40);
  const other = new ScrollView(passes, { height: 5 });

  other.render(10);
  other.handleMouse(mouse("wheel", 2, 1, { direction: "down" }));

  assertEquals(passes.mouse, ["wheel@2,1"]);
  assertEquals(other.scrollTop, 3);
});

Deno.test("pressing the track pages towards the pointer", () => {
  const child = new Lines(50);
  const { terminal, tui } = setup(5, 20);
  const view = new ScrollView(child, { height: 5 });

  tui.addChild(view);
  tui.start();
  tui.renderNow();

  // The thumb is one cell at the top; a press below it pages down by a page less a row.
  terminal.send(encodeMouse({ action: "press", x: 19, y: 4 }));
  assertEquals(view.scrollTop, 4);

  terminal.send(encodeMouse({ action: "release", x: 19, y: 4 }));
  terminal.send(encodeMouse({ action: "press", x: 19, y: 4 }));
  terminal.send(encodeMouse({ action: "release", x: 19, y: 4 }));
  assertEquals(view.scrollTop, 8);

  tui.renderNow();

  // The thumb has moved down by a cell, so a press above it pages back up.
  terminal.send(encodeMouse({ action: "press", x: 19, y: 0 }));
  assertEquals(view.scrollTop, 4);
  assertEquals(tui.focused, view);
  tui.stop();
});

Deno.test("dragging the thumb scrolls proportionally, even outside the view, and release ends it", () => {
  const child = new Lines(50);
  const { terminal, tui } = setup(5, 20);
  const view = new ScrollView(child, { height: 5 });

  tui.addChild(view);
  tui.start();
  tui.renderNow();

  terminal.send(encodeMouse({ action: "press", x: 19, y: 0 }));
  assertEquals(view.scrollTop, 0);

  terminal.send(encodeMouse({ action: "drag", x: 19, y: 2 }));
  assertEquals(view.scrollTop, 23);

  terminal.send(encodeMouse({ action: "drag", x: 3, y: 4 }));
  assertEquals(view.scrollTop, 45);

  terminal.send(encodeMouse({ action: "drag", x: 0, y: 30 }));
  assertEquals(view.scrollTop, 45);

  terminal.send(encodeMouse({ action: "drag", x: 5, y: 0 }));
  assertEquals(view.scrollTop, 0);
  terminal.send(encodeMouse({ action: "release", x: 5, y: 0 }));

  tui.renderNow();
  assertEquals(child.mouse, []);

  // After the release, a drag over the content is no longer ours.
  terminal.send(encodeMouse({ action: "drag", x: 19, y: 3 }));
  assertEquals(view.scrollTop, 0);
  tui.stop();
});

Deno.test("a drag keeps the grabbed cell of the thumb under the pointer", () => {
  const view = new ScrollView(new Lines(30), { height: 10 });

  view.render(12);

  // Thumb of 3 cells at the top; grab its last cell.
  assertEquals(view.handleMouse(mouse("press", 11, 2)), true);
  view.handleMouse(mouse("drag", 11, 2));
  assertEquals(view.scrollTop, 0);

  view.handleMouse(mouse("drag", 11, 9));
  assertEquals(view.scrollTop, 20);
  view.handleMouse(mouse("release", 11, 9));
});

Deno.test("the wheel and keys move the view through the TUI, and a press focuses it", () => {
  const { terminal, tui } = setup(4, 20);
  const view = new ScrollView(new Lines(30), { height: 4 });

  tui.addChild(view);
  tui.start();
  tui.renderNow();

  assertEquals(terminal.viewport().map((row) => row.slice(0, 8).trimEnd()), [
    "line 0",
    "line 1",
    "line 2",
    "line 3",
  ]);

  terminal.send(
    encodeMouse({ action: "wheel", direction: "down", x: 2, y: 1 }),
  );
  tui.renderNow();
  assertEquals(terminal.viewport()[0].slice(0, 8).trimEnd(), "line 3");

  // Pressing the track pages down by three rows and focuses the view.
  terminal.send(encodeMouse({ action: "press", x: 19, y: 3 }));
  assertEquals(tui.focused, view);

  terminal.send("\x1b[B");
  tui.renderNow();
  assertEquals(terminal.viewport()[0].slice(0, 8).trimEnd(), "line 7");
  tui.stop();
});

Deno.test("hovering the thumb highlights it until the pointer leaves", () => {
  const view = new ScrollView(new Lines(30), {
    height: 5,
    theme: { thumb: { fg: "#ff0000" }, thumbActive: { fg: "#00ff00" } },
  });
  const thumb = () => view.render(10)[0];

  assertEquals(thumb().includes("38;2;255;0;0"), true);

  assertEquals(view.handleMouse(mouse("move", 9, 0)), true);
  assertEquals(thumb().includes("38;2;0;255;0"), true);

  assertEquals(view.handleMouse(mouse("move", 9, 3)), true);
  assertEquals(thumb().includes("38;2;255;0;0"), true);

  view.handleMouse(mouse("move", 9, 0));
  view.handleMouse({ ...mouse("leave", 9, 0), button: "none" });
  assertEquals(thumb().includes("38;2;255;0;0"), true);
});

Deno.test("a track with nothing to scroll ignores presses", () => {
  const view = new ScrollView(new Lines(3), { height: 5, scrollbar: "always" });

  view.render(10);

  assertEquals(view.handleMouse(mouse("press", 9, 3)), false);
  assertEquals(view.scrollTop, 0);
});

Deno.test("very narrow widths still render the exact viewport", () => {
  const view = new ScrollView(new Lines(20), { height: 3 });

  assertEquals(view.render(0), []);
  assertEquals(view.render(1).map(visibleWidth), [1, 1, 1]);
  assertEquals(view.render(2).map(visibleWidth), [2, 2, 2]);
});

Deno.test("custom keys replace the default ones for their action", () => {
  const child = new Lines(20);
  const view = new ScrollView(child, {
    height: 5,
    keys: { down: ["j"], pageDown: ["ctrl+d"] },
  });

  view.render(10);
  key(view, "j");

  assertEquals(view.scrollTop, 1);

  key(view, "\x1b[B");

  assertEquals(view.scrollTop, 1);
  assertEquals(child.keys, ["down"]);

  key(view, "\x04");

  assertEquals(view.scrollTop, 5);
});

Deno.test("glyphs, theme and page overlap come from the options and setTheme changes the next render", () => {
  const view = new ScrollView(new Lines(20), {
    height: 5,
    glyphs: SCROLLBAR_GLYPHS.ascii,
    theme: { thumb: { fg: "#ff0000" } },
    pageOverlap: 0,
  });
  const rows = view.render(10);

  assertEquals(plain(rows).map((row) => row.slice(-1)).join(""), "#||||");
  assertEquals(rows[0].includes("38;2;255;0;0"), true);

  view.setTheme({ thumb: { fg: "#00ff00" } });

  assertEquals(view.render(10)[0].includes("38;2;0;255;0"), true);

  key(view, "\x1b[6~");

  assertEquals(view.scrollTop, 5);
});
