import { assertEquals } from "@std/assert";
import {
  BORDERS,
  type Component,
  encodeMouse,
  type Focusable,
  type InputEvent,
  type MouseInput,
  TUI,
  VirtualTerminal,
} from "../mod.ts";
import { Overlay } from "../src/components/overlay.ts";

/** Fixed rows that log the keys and mouse events they get. */
class Probe implements Component, Focusable {
  public focused = false;
  public readonly keys: string[] = [];
  public readonly mouse: string[] = [];

  public constructor(private readonly lines: readonly string[]) {}

  public render(): readonly string[] {
    return this.lines;
  }

  public handleInput(event: InputEvent): void {
    this.keys.push(event.type === "key" ? event.key.name : "paste");
  }

  public handleMouse(event: MouseInput): boolean {
    this.mouse.push(`${event.action}@${event.x},${event.y}`);

    return true;
  }
}

const ESCAPE = "\x1b[27u";

function setup() {
  const terminal = new VirtualTerminal(20, 6);
  const tui = new TUI(terminal, { mouse: "click" });
  const base = new Probe([
    "aaaaaaaaaaaaaaaaaaaa",
    "bbbbbbbbbbbbbbbbbbbb",
    "cccccccccccccccccccc",
  ]);

  tui.addChild(base);
  tui.start();

  return { terminal, tui, base };
}

const PLACE = { anchor: "top-left", margin: 0, width: 10 } as const;

Deno.test("show, hide and toggle draw and remove the framed panel", () => {
  const { terminal, tui } = setup();
  const panel = new Overlay(tui, new Probe(["hi"]), { ...PLACE, title: "T" });

  assertEquals(panel.visible, false);

  panel.show();
  panel.show();
  tui.renderNow();
  assertEquals(panel.visible, true);
  assertEquals(terminal.viewport().slice(0, 4), [
    "╭─ T ────╮aaaaaaaaaa",
    "│ hi     │bbbbbbbbbb",
    "╰────────╯cccccccccc",
    "",
  ]);

  panel.hide();
  tui.renderNow();
  assertEquals(panel.visible, false);
  assertEquals(terminal.viewport()[0], "aaaaaaaaaaaaaaaaaaaa");

  panel.toggle();
  assertEquals(panel.visible, true);
  panel.toggle();
  assertEquals(panel.visible, false);
  tui.stop();
});

Deno.test("border null draws the content alone; another glyph set replaces the frame", () => {
  const { terminal, tui } = setup();
  const bare = new Overlay(tui, new Probe(["bare"]), {
    ...PLACE,
    border: null,
  });
  const heavy = new Overlay(tui, new Probe(["x"]), {
    ...PLACE,
    border: BORDERS.ascii,
    offsetY: 3,
  });

  bare.show();
  heavy.show();
  tui.renderNow();
  assertEquals(terminal.viewport()[0], "bare      aaaaaaaaaa");
  assertEquals(terminal.viewport()[3], "+--------+");
  tui.stop();
});

Deno.test("while focused, Escape closes the panel before the content and other keys reach the content", () => {
  const { terminal, tui } = setup();
  const content = new Probe(["hi"]);
  let closed = 0;
  const panel = new Overlay(tui, content, {
    ...PLACE,
    onClose: () => closed++,
  });

  panel.show();
  assertEquals(content.focused, true);

  terminal.send("a");
  terminal.send("\x1b[C");
  assertEquals(content.keys, ["a", "right"]);

  terminal.send(ESCAPE);
  assertEquals(content.keys, ["a", "right"]);
  assertEquals(panel.visible, false);
  assertEquals(closed, 1);
  tui.stop();
});

Deno.test("closing restores the focus held before showing", () => {
  const { terminal, tui, base } = setup();
  const panel = new Overlay(tui, new Probe(["hi"]), PLACE);

  tui.setFocus(base);
  panel.show();
  assertEquals(base.focused, false);

  terminal.send(ESCAPE);
  assertEquals(tui.focused, base);
  assertEquals(base.focused, true);
  tui.stop();
});

Deno.test("Escape is left alone with closeOnEscape off, with focus off, and once the panel is hidden", () => {
  const { terminal, tui, base } = setup();

  tui.setFocus(base);

  const sticky = new Overlay(tui, new Probe(["hi"]), {
    ...PLACE,
    closeOnEscape: false,
  });

  sticky.show();
  terminal.send(ESCAPE);
  assertEquals(sticky.visible, true);
  sticky.hide();

  const passive = new Overlay(tui, new Probe(["hi"]), {
    ...PLACE,
    focus: false,
  });

  passive.show();
  terminal.send(ESCAPE);
  assertEquals(passive.visible, true);
  assertEquals(base.keys, ["escape"]);
  passive.hide();

  terminal.send(ESCAPE);
  assertEquals(base.keys, ["escape", "escape"]);
  tui.stop();
});

Deno.test("mouse events reach the content inside the frame in its own cells, and a click focuses it without losing Escape", () => {
  const { terminal, tui } = setup();
  const content = new Probe(["hi"]);
  const panel = new Overlay(tui, content, PLACE);

  panel.show();
  tui.renderNow();
  // Border column and top row, then the content's first cell at (2, 1).
  terminal.send(encodeMouse({ action: "press", x: 0, y: 0 }));
  terminal.send(encodeMouse({ action: "press", x: 3, y: 1 }));
  terminal.send(encodeMouse({ action: "release", x: 3, y: 1 }));
  assertEquals(content.mouse, ["press@1,0", "release@1,0"]);
  assertEquals(tui.focused, content);

  terminal.send(ESCAPE);
  assertEquals(panel.visible, false);
  tui.stop();
});

Deno.test("a press outside closes the panel only with closeOnPressOutside", () => {
  const { terminal, tui, base } = setup();
  const keep = new Overlay(tui, new Probe(["hi"]), PLACE);
  let closed = 0;
  const close = new Overlay(tui, new Probe(["hi"]), {
    ...PLACE,
    offsetY: 3,
    closeOnPressOutside: true,
    onClose: () => closed++,
  });

  keep.show();
  close.show();
  tui.renderNow();

  // Inside the second panel: nothing closes.
  terminal.send(encodeMouse({ action: "press", x: 3, y: 4 }));
  assertEquals(close.visible, true);

  terminal.send(encodeMouse({ action: "press", x: 15, y: 2 }));
  assertEquals(close.visible, false);
  assertEquals(keep.visible, true);
  assertEquals(closed, 1);
  // The press went on to the content beneath: the overlay is not modal.
  assertEquals(base.mouse, ["press@15,2"]);
  tui.stop();
});

Deno.test("setContent and setTitle change the panel and keep the focus on it", () => {
  const { terminal, tui } = setup();
  const first = new Probe(["one"]);
  const second = new Probe(["two"]);
  const panel = new Overlay(tui, first, { ...PLACE, title: "A" });

  panel.show();
  panel.setContent(second);
  panel.setTitle("B");
  tui.renderNow();

  assertEquals(first.focused, false);
  assertEquals(second.focused, true);
  assertEquals(terminal.viewport().slice(0, 2), [
    "╭─ B ────╮aaaaaaaaaa",
    "│ two    │bbbbbbbbbb",
  ]);

  terminal.send("x");
  assertEquals(second.keys, ["x"]);
  tui.stop();
});

Deno.test("keys.close replaces Escape, which then reaches the content", () => {
  const { terminal, tui } = setup();
  const content = new Probe(["hi"]);
  const panel = new Overlay(tui, content, { ...PLACE, keys: { close: ["q"] } });

  panel.show();
  terminal.send(ESCAPE);

  assertEquals(panel.visible, true);
  assertEquals(content.keys, ["escape"]);

  terminal.send("q");

  assertEquals(panel.visible, false);
  assertEquals(content.keys, ["escape"]);
  tui.stop();
});

Deno.test("frame footer, padding, ellipsis and theme pass through to the box, and setTheme repaints it", () => {
  const { terminal, tui } = setup();
  const panel = new Overlay(tui, new Probe(["hi"]), {
    ...PLACE,
    title: "A long title",
    footer: "end",
    padding: [1, 2],
    ellipsis: "~",
    theme: { border: { fg: "#ff0000" } },
  });

  panel.show();
  tui.renderNow();

  assertEquals(
    terminal.viewport().slice(0, 5),
    [
      "╭─ A l~ ─╮aaaaaaaaaa",
      "│        │bbbbbbbbbb",
      "│  hi    │cccccccccc",
      "│        │",
      "╰── end ─╯",
    ],
  );
  assertEquals(terminal.writes.join("").includes("38;2;255;0;0"), true);

  panel.setTheme({ border: { fg: "#00ff00" } });
  tui.renderNow();

  assertEquals(terminal.writes.join("").includes("38;2;0;255;0"), true);
  tui.stop();
});
