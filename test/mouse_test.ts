import { assertEquals } from "@std/assert";
import {
  type Component,
  Container,
  encodeMouse,
  type Focusable,
  forwardMouse,
  type MouseInput,
  TUI,
  VirtualTerminal,
} from "../mod.ts";

/** Fixed rows that log every mouse event it gets; handles everything unless `handles` says otherwise. */
class Probe implements Component, Focusable {
  public focused = false;
  public readonly events: string[] = [];

  public constructor(
    public lines: readonly string[],
    private readonly handles: (e: MouseInput) => boolean = () => true,
  ) {}

  public render(): readonly string[] {
    return this.lines;
  }

  public handleMouse(event: MouseInput): boolean {
    this.events.push(`${event.action}@${event.x},${event.y}`);

    return this.handles(event);
  }
}

/** Two probes side by side, `split` cells apart: a minimal horizontal composite. */
class Row implements Component {
  public constructor(
    public readonly left: Probe,
    public readonly right: Probe,
    private readonly split: number,
  ) {}

  public render(width: number): readonly string[] {
    return [
      `${this.left.lines[0].padEnd(this.split)}${this.right.lines[0]}`.slice(
        0,
        width,
      ),
    ];
  }

  public handleMouse(event: MouseInput): boolean {
    return event.x < this.split
      ? forwardMouse(this.left, event)
      : forwardMouse(this.right, event, this.split, 0);
  }
}

function setup(rows = 6) {
  const terminal = new VirtualTerminal(20, rows);
  const tui = new TUI(terminal, { mouse: "drag" });

  return { terminal, tui };
}

function press(terminal: VirtualTerminal, x: number, y: number): void {
  terminal.send(encodeMouse({ action: "press", x, y }));
}

Deno.test("mouse reporting is off by default and follows setMouse and stop", () => {
  const terminal = new VirtualTerminal(20, 4);
  const tui = new TUI(terminal);

  tui.start();
  assertEquals(terminal.mouseModes, []);
  tui.setMouse("click");
  assertEquals(terminal.mouseModes, [1000, 1006]);
  tui.setMouse("move");
  assertEquals(terminal.mouseModes, [1003, 1006]);
  tui.stop();
  assertEquals(terminal.mouseModes, []);
  tui.start();
  assertEquals(terminal.mouseModes, [1003, 1006]);
  tui.setMouse("off");
  assertEquals(terminal.mouseModes, []);
  assertEquals(tui.mouse, "off");
  tui.stop();
});

Deno.test("mouse events reach the child under the pointer in its own cells, through nested composites", () => {
  const { terminal, tui } = setup();
  const top = new Probe(["top"]);
  const left = new Probe(["left"]);
  const right = new Probe(["right"]);
  const nested = new Container();

  nested.addChild(new Row(left, right, 8));
  tui.addChild(top);
  tui.addChild(nested);
  tui.start();
  tui.renderNow();

  press(terminal, 2, 0);
  terminal.send(encodeMouse({ action: "release", x: 2, y: 0 }));
  press(terminal, 9, 1);
  terminal.send(encodeMouse({ action: "wheel", direction: "up", x: 3, y: 1 }));
  // Below the content: nothing is there.
  press(terminal, 0, 4);

  assertEquals(top.events, ["press@2,0", "release@2,0"]);
  assertEquals(right.events, ["press@1,0"]);
  assertEquals(left.events, ["wheel@3,0"]);
  tui.stop();
});

Deno.test("a handled press captures drags and the release, even outside the component", () => {
  const { terminal, tui } = setup();
  const a = new Probe(["aaaa"]);
  const b = new Probe(["bbbb"]);

  tui.addChild(a);
  tui.addChild(b);
  tui.start();
  tui.renderNow();

  press(terminal, 1, 0);
  terminal.send(encodeMouse({ action: "drag", x: 3, y: 1 }));
  terminal.send(encodeMouse({ action: "drag", x: 0, y: 3 }));
  terminal.send(encodeMouse({ action: "release", x: 0, y: 3 }));
  terminal.send(encodeMouse({ action: "drag", x: 1, y: 1 }));

  assertEquals(a.events, ["press@1,0", "drag@3,1", "drag@0,3", "release@0,3"]);
  // After the release, drags are hit-tested again.
  assertEquals(b.events, ["drag@1,0"]);
  tui.stop();
});

Deno.test("a handled press focuses the innermost Focusable; unhandled ones do not", () => {
  const { terminal, tui } = setup();
  const a = new Probe(["aaaa"]);
  const b = new Probe(["bbbb"], (e) => e.action !== "press");

  tui.addChild(a);
  tui.addChild(b);
  tui.start();
  tui.renderNow();

  press(terminal, 0, 1);
  assertEquals(tui.focused, null);
  press(terminal, 0, 0);
  assertEquals(tui.focused, a);
  assertEquals(a.focused, true);
  tui.stop();
});

Deno.test("hover moves between components with a leave event for the old one", () => {
  const { terminal, tui } = setup();
  const a = new Probe(["aaaa"]);
  const b = new Probe(["bbbb"]);

  tui.addChild(a);
  tui.addChild(b);
  tui.start();
  tui.renderNow();

  terminal.send(encodeMouse({ action: "move", x: 1, y: 0 }));
  terminal.send(encodeMouse({ action: "move", x: 2, y: 0 }));
  terminal.send(encodeMouse({ action: "move", x: 2, y: 1 }));
  terminal.send(encodeMouse({ action: "move", x: 2, y: 5 }));

  assertEquals(a.events, ["move@1,0", "move@2,0", "leave@2,1"]);
  assertEquals(b.events, ["move@2,0", "leave@2,4"]);
  tui.stop();
});

Deno.test("screen rows map to content rows when the TUI starts below shell output and after scrolling", () => {
  const terminal = new VirtualTerminal(20, 4);

  terminal.write("$ one\r\n$ two\r\n");

  const tui = new TUI(terminal, { mouse: "click" });
  const rows = ["r0", "r1"].map((line) => new Probe([line]));

  for (const probe of rows) {
    tui.addChild(probe);
  }

  tui.start();
  tui.renderNow();
  assertEquals(terminal.viewport(), ["$ one", "$ two", "r0", "r1"]);
  press(terminal, 0, 3);
  assertEquals(rows[1].events, ["press@0,0"]);

  // Two more rows scroll the screen: r0 is now on screen row 0.
  const more = ["r2", "r3"].map((line) => new Probe([line]));

  for (const probe of more) {
    tui.addChild(probe);
  }

  tui.renderNow();
  assertEquals(terminal.viewport(), ["r0", "r1", "r2", "r3"]);
  press(terminal, 0, 0);
  press(terminal, 0, 2);
  assertEquals(rows[0].events, ["press@0,0"]);
  assertEquals(more[0].events, ["press@0,0"]);

  // A resize repaints from the top of the screen.
  terminal.resize(20, 6);
  tui.renderNow();
  press(terminal, 0, 1);
  assertEquals(rows[1].events, ["press@0,0", "press@0,0"]);
  tui.stop();
});

Deno.test("overlays get mouse events first; modal ones block the content beneath", () => {
  const { terminal, tui } = setup();
  const base = new Probe(["base row 0", "base row 1", "base row 2"]);
  const popup = new Probe(["popup"]);
  let outside = 0;

  tui.addChild(base);
  tui.start();

  const handle = tui.showOverlay(popup, {
    anchor: "top-left",
    margin: 0,
    offsetX: 2,
    offsetY: 1,
    width: 5,
    focus: false,
    onPressOutside: () => outside++,
  });

  tui.renderNow();
  press(terminal, 3, 1);
  press(terminal, 8, 1);
  assertEquals(popup.events, ["press@1,0"]);
  assertEquals(base.events, ["press@8,1"]);
  assertEquals(outside, 1);

  handle.hide();

  tui.showOverlay(popup, {
    anchor: "top-left",
    margin: 0,
    width: 5,
    modal: true,
    backdrop: { fg: "#5c6370" },
  });
  tui.renderNow();
  press(terminal, 0, 2);
  assertEquals(base.events, ["press@8,1"]);
  // The backdrop restyles the rows beneath in plain grey.
  assertEquals(terminal.viewport()[2], "base row 2");
  assertEquals(
    terminal.writes.at(-1)?.includes("\x1b[38;2;92;99;112mbase row 2\x1b[39m"),
    true,
  );
  tui.stop();
});

Deno.test("hiding an overlay restores the focus held before it, even after a click focused something inside", () => {
  const { terminal, tui } = setup();
  const before = new Probe(["editor"]);
  const inner = new Probe(["button"]);
  const dialog = new Container();

  dialog.addChild(inner);
  tui.addChild(before);
  tui.setFocus(before);
  tui.start();

  const handle = tui.showOverlay(dialog, {
    anchor: "top-left",
    margin: 0,
    width: 8,
    offsetY: 2,
    modal: true,
  });

  tui.renderNow();
  press(terminal, 1, 2);
  assertEquals(tui.focused, inner);
  handle.hide();
  assertEquals(tui.focused, before);
  tui.stop();
});

Deno.test("input listeners see mouse events in content cells and can consume them", () => {
  const { terminal, tui } = setup();
  const a = new Probe(["aaaa"]);
  const seen: string[] = [];

  tui.addChild(a);
  tui.addInputListener((event) => {
    if (event.type === "mouse") {
      seen.push(`${event.action}@${event.x},${event.y}`);

      return event.x === 3;
    }
  });
  tui.start();
  tui.renderNow();
  press(terminal, 3, 0);
  press(terminal, 1, 0);

  assertEquals(seen, ["press@3,0", "press@1,0"]);
  assertEquals(a.events, ["press@1,0"]);
  tui.stop();
});
