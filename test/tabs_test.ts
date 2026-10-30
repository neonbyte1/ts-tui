import { assertEquals, assertThrows } from "@std/assert";
import {
  type Component,
  encodeMouse,
  type InputEvent,
  InputParser,
  type MouseInput,
  TUI,
  VirtualTerminal,
  visibleWidth,
} from "../mod.ts";
import { Tabs, TABS_GLYPHS, type TabsOptions } from "../src/components/tabs.ts";

// deno-lint-ignore no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;:]*m/g, "");

/** Content that logs what it receives and returns the same rows until its width or height changes. */
class Probe implements Component {
  public readonly log: string[] = [];
  public readonly heights: (number | undefined)[] = [];
  private key = "";
  private rows: readonly string[] = [];

  public constructor(
    private readonly name: string,
    private readonly count = 3,
  ) {}

  public render(width: number, height?: number): readonly string[] {
    this.heights.push(height);

    const key = `${width}x${height}`;

    if (key !== this.key) {
      this.key = key;
      this.rows = Array.from(
        { length: height ?? this.count },
        (_, i) => `${this.name}${i}`,
      );
    }

    return this.rows;
  }

  public handleInput(event: InputEvent): void {
    this.log.push(
      event.type === "key" ? `key:${event.key.name}` : `paste:${event.text}`,
    );
  }

  public handleMouse(event: MouseInput): boolean {
    this.log.push(`${event.action}@${event.x},${event.y}`);

    return true;
  }
}

function send(tabs: Tabs, input: string): void {
  new InputParser((event) => {
    if (event.type === "key" || event.type === "paste") {
      tabs.handleInput(event);
    }
  }).feed(input);
}

function mouse(
  action: MouseInput["action"],
  x: number,
  y: number,
  direction?: MouseInput["direction"],
): MouseInput {
  return {
    type: "mouse",
    action,
    button: action === "move" || action === "wheel" || action === "leave"
      ? "none"
      : "left",
    direction,
    x,
    y,
    shift: false,
    alt: false,
    ctrl: false,
  };
}

function three(options: Partial<TabsOptions> = {}) {
  const probes = [new Probe("a"), new Probe("b"), new Probe("c")];
  const tabs = new Tabs({
    tabs: [
      { label: "One", content: probes[0] },
      { label: "Two", content: probes[1] },
      { label: "Three", content: probes[2] },
    ],
    ...options,
  });

  return { tabs, probes };
}

function four(style?: "line" | "boxed"): Tabs {
  return new Tabs({
    tabs: ["Alpha", "Beta", "Gamma", "Delta"].map((label) => ({
      label,
      content: new Probe(label[0], 1),
    })),
    style,
  });
}

function screen(cols = 40, rows = 10) {
  const terminal = new VirtualTerminal(cols, rows);
  const tui = new TUI(terminal, { mouse: "drag" });

  return { terminal, tui };
}

function click(terminal: VirtualTerminal, x: number, y: number): void {
  terminal.send(encodeMouse({ action: "press", x, y }));
  terminal.send(encodeMouse({ action: "release", x, y }));
}

const plain = (rows: readonly string[]) => rows.map(strip);

Deno.test("Tabs draw the labels over a rule with a heavy bar under the selected one, then its content", () => {
  const { tabs } = three({ selected: 1 });

  assertEquals(plain(tabs.render(20)), [
    " One  Two  Three    ",
    "─────━━━━━──────────",
    "b0",
    "b1",
    "b2",
  ]);
});

Deno.test("boxed tabs open a box around the selected label", () => {
  const { tabs } = three({ style: "boxed" });

  assertEquals(plain(tabs.render(24)).slice(0, 3), [
    "╭─────╮".padEnd(24),
    "│ One │  Two    Three   ",
    "╯     ╰".padEnd(24, "─"),
  ]);
});

Deno.test("left, right, Home and End switch tabs and stop at the ends; other keys go to the content", () => {
  const { tabs, probes } = three();
  const changes: number[] = [];

  tabs.onChange = (index) => changes.push(index);

  send(tabs, "\x1b[C");
  send(tabs, "\x1b[C");
  send(tabs, "\x1b[C");

  assertEquals(tabs.selected, 2);

  send(tabs, "\x1b[D");
  send(tabs, "\x1b[H");
  send(tabs, "\x1b[D");

  assertEquals(tabs.selected, 0);

  send(tabs, "\x1b[F");

  assertEquals(tabs.selected, 2);
  assertEquals(changes, [1, 2, 1, 0, 2]);

  send(tabs, "x");
  send(tabs, "\x1b[A");
  send(tabs, "\x1b[200~hi\x1b[201~");

  assertEquals(probes[2].log, ["key:x", "key:up", "paste:hi"]);
  assertEquals(probes[0].log, []);
});

Deno.test("select clamps without calling onChange; addTab, removeTab and setLabel keep the selection on its tab", () => {
  const { tabs } = three();
  let calls = 0;

  tabs.onChange = () => calls++;

  tabs.select(9);

  assertEquals([tabs.selected, calls], [2, 0]);

  tabs.select(-4);

  assertEquals(tabs.selected, 0);
  assertEquals(tabs.addTab("Four", new Probe("d")), 3);

  tabs.select(2);
  tabs.removeTab(0);

  assertEquals(tabs.selected, 1);
  assertEquals(plain(tabs.render(30))[0], " Two  Three  Four ".padEnd(30));

  tabs.removeTab(1);

  assertEquals(plain(tabs.render(30))[2], "d0");

  tabs.setLabel(0, "Second");

  assertEquals(plain(tabs.render(30))[0].trimEnd(), " Second  Four");
  assertThrows(() => tabs.removeTab(5), RangeError);
  assertThrows(() => tabs.setLabel(-1, "x"), RangeError);
});

Deno.test("clicking a label selects it, focuses the tabs and reports the change", () => {
  const { terminal, tui } = screen();
  const { tabs } = three();
  const changes: number[] = [];

  tabs.onChange = (index) => changes.push(index);

  tui.addChild(tabs);
  tui.start();
  tui.renderNow();

  // " One  Two  Three ": Two covers cells 5-9, Three 10-16.
  click(terminal, 11, 0);
  tui.renderNow();

  assertEquals(tabs.selected, 2);
  assertEquals(changes, [2]);
  assertEquals(tui.focused, tabs);
  assertEquals(terminal.viewport()[2].trimEnd(), "c0");

  // The rule row is part of the bar, and a label's last cell hits it.
  click(terminal, 9, 1);
  tui.renderNow();

  assertEquals(tabs.selected, 1);
  assertEquals(terminal.viewport()[2].trimEnd(), "b0");

  // Empty bar space and the selected label's own cells change nothing.
  click(terminal, 30, 0);
  click(terminal, 7, 0);

  assertEquals(changes, [2, 1]);
  tui.stop();
});

Deno.test("boxed tabs take clicks on any of their three bar rows", () => {
  const { terminal, tui } = screen();
  const { tabs } = three({ style: "boxed" });

  tui.addChild(tabs);
  tui.start();
  tui.renderNow();

  // One covers cells 0-6, Two 7-13, Three 14-22.
  click(terminal, 9, 2);

  assertEquals(tabs.selected, 1);

  click(terminal, 15, 0);

  assertEquals(tabs.selected, 2);
  tui.stop();
});

Deno.test("mouse events below the bar reach the selected content in its own cells", () => {
  const { terminal, tui } = screen();
  const { tabs, probes } = three({ selected: 1 });

  tui.addChild(tabs);
  tui.start();
  tui.renderNow();

  terminal.send(encodeMouse({ action: "press", x: 6, y: 3 }));
  terminal.send(encodeMouse({ action: "drag", x: 8, y: 6 }));
  terminal.send(encodeMouse({ action: "release", x: 8, y: 6 }));
  terminal.send(
    encodeMouse({ action: "wheel", direction: "down", x: 2, y: 2 }),
  );

  assertEquals(probes[1].log, [
    "press@6,1",
    "drag@8,4",
    "release@8,4",
    "wheel@2,0",
  ]);
  assertEquals(probes[0].log, []);
  assertEquals(tabs.selected, 1);
  tui.stop();
});

Deno.test("a press on focusable content focuses that content; a press on the bar focuses the tabs", () => {
  const { terminal, tui } = screen();
  const content = Object.assign(new Probe("f"), { focused: false });
  const tabs = new Tabs({
    tabs: [{ label: "One", content }, {
      label: "Two",
      content: new Probe("b"),
    }],
  });

  tui.addChild(tabs);
  tui.start();
  tui.renderNow();
  click(terminal, 1, 4);

  assertEquals(tui.focused, content);

  click(terminal, 7, 0);

  assertEquals(tui.focused, tabs);
  tui.stop();
});

Deno.test("the wheel over the bar steps through tabs and stops at the ends", () => {
  const { tabs } = three();
  const changes: number[] = [];

  tabs.onChange = (index) => changes.push(index);

  tabs.render(30);

  assertEquals(tabs.handleMouse(mouse("wheel", 3, 0, "down")), true);
  assertEquals(tabs.handleMouse(mouse("wheel", 3, 1, "right")), true);
  assertEquals(tabs.handleMouse(mouse("wheel", 3, 0, "down")), true);
  assertEquals(tabs.selected, 2);

  tabs.handleMouse(mouse("wheel", 3, 0, "up"));
  tabs.handleMouse(mouse("wheel", 3, 0, "left"));
  tabs.handleMouse(mouse("wheel", 3, 0, "up"));

  assertEquals(tabs.selected, 0);
  assertEquals(changes, [1, 2, 1, 0]);
});

Deno.test("hovering an unselected label restyles it until the pointer leaves", () => {
  const { tabs } = three();
  const before = tabs.render(30);

  assertEquals(tabs.handleMouse(mouse("move", 6, 0)), true);

  const hovered = tabs.render(30);

  assertEquals(hovered === before, false);
  assertEquals(plain(hovered), plain(before));
  assertEquals(hovered[0] === before[0], false);

  // The selected label looks the same hovered; empty space is no hover target.
  assertEquals(tabs.handleMouse(mouse("move", 2, 0)), true);
  assertEquals(tabs.render(30)[0], before[0]);
  assertEquals(tabs.handleMouse(mouse("move", 25, 0)), false);

  tabs.handleMouse(mouse("move", 6, 0));
  tabs.handleMouse(mouse("leave", 0, 0));

  assertEquals(tabs.render(30)[0], before[0]);
});

Deno.test("given a height, the content gets the rows below the bar and exactly that many rows come back", () => {
  const { tabs, probes } = three();

  assertEquals(plain(tabs.render(20, 6)), [
    " One  Two  Three    ",
    "━━━━━───────────────",
    "a0",
    "a1",
    "a2",
    "a3",
  ]);
  assertEquals(probes[0].heights.at(-1), 4);

  // Short content is padded; a height under the bar cuts the bar.
  const short = new Tabs({
    tabs: [{ label: "x", content: { render: () => ["only"] } }],
  });

  assertEquals(plain(short.render(10, 5)), [
    " x        ",
    "━━━───────",
    "only",
    "",
    "",
  ]);
  assertEquals(tabs.render(20, 1).length, 1);
  assertEquals(tabs.render(20, 0), []);
  assertEquals(probes[0].heights.at(-1), 0);
});

Deno.test("rows are reused while nothing changed and rebuilt when something does", () => {
  const { tabs } = three();
  const first = tabs.render(30, 8);

  assertEquals(tabs.render(30, 8) === first, true);
  assertEquals(tabs.render(31, 8) === first, false);

  const again = tabs.render(30, 8);

  tabs.select(1);

  assertEquals(plain(tabs.render(30, 8))[2], "b0");

  tabs.select(0);

  const back = tabs.render(30, 8);

  tabs.focused = true;

  assertEquals(tabs.render(30, 8)[0] === back[0], false);
  assertEquals(again[0], first[0]);
});

Deno.test("labels that do not fit scroll the bar to the selected tab and show markers", () => {
  const tabs = four();
  const bar = (width: number) => plain(tabs.render(width)).slice(0, 2);

  assertEquals(bar(16), [
    " Alpha  Beta   ›",
    "━━━━━━━─────────",
  ]);

  tabs.select(3);

  assertEquals(bar(16), [
    "‹ Gamma  Delta  ",
    "────────━━━━━━━─",
  ]);

  tabs.select(0);

  assertEquals(bar(16)[0], " Alpha  Beta   ›");

  // Everything fits again: no markers.
  assertEquals(bar(30)[0].trimEnd(), " Alpha  Beta  Gamma  Delta");
});

Deno.test("the selected tab stays visible at every width and no bar row is wider than the bar", () => {
  const labels = ["Alpha", "Beta", "Gamma", "Delta"];
  const tabs = four("boxed");

  for (let width = 1; width <= 40; width++) {
    for (let selected = 0; selected < 4; selected++) {
      tabs.select(selected);

      const bar = tabs.render(width).slice(0, 3);

      for (const row of bar) {
        assertEquals(
          visibleWidth(row) <= width,
          true,
          `width ${width}: ${strip(row)}`,
        );
      }

      if (width >= 12) {
        assertEquals(
          strip(bar[1]).includes(`│ ${labels[selected]} │`),
          true,
          `selected ${selected} at width ${width}`,
        );
      }
    }
  }
});

Deno.test("clicking a scroll marker scrolls the bar without changing the selection", () => {
  const { terminal, tui } = screen(16, 8);
  const tabs = four();

  tui.addChild(tabs);
  tui.start();
  tui.renderNow();

  assertEquals(terminal.viewport()[0], " Alpha  Beta   ›");

  click(terminal, 15, 0);
  tui.renderNow();

  assertEquals(terminal.viewport()[0], "‹ Beta  Gamma  ›");
  assertEquals(tabs.selected, 0);

  click(terminal, 15, 0);
  tui.renderNow();

  assertEquals(terminal.viewport()[0].trimEnd(), "‹ Gamma  Delta");
  assertEquals(tabs.selected, 0);

  click(terminal, 0, 0);
  tui.renderNow();

  assertEquals(terminal.viewport()[0], "‹ Beta  Gamma  ›");

  // A label shown after scrolling is clickable at its new cells.
  click(terminal, 10, 0);

  assertEquals(tabs.selected, 2);
  tui.stop();
});

Deno.test("a label wider than the bar is cut with an ellipsis and an empty width renders nothing", () => {
  const tabs = new Tabs({
    tabs: [{ label: "A very long label", content: new Probe("a", 1) }],
  });

  assertEquals(plain(tabs.render(8))[0], " A ver… ");
  assertEquals(tabs.render(0), []);
  assertEquals(new Tabs().render(5, 3).length, 3);
});

Deno.test("custom keys replace the default ones for their action", () => {
  const { tabs, probes } = three({
    keys: { next: ["ctrl+right"], prev: ["ctrl+left"] },
  });

  send(tabs, "\x1b[C");

  assertEquals(tabs.selected, 0);
  assertEquals(probes[0].log, ["key:right"]);

  send(tabs, "\x1b[1;5C");

  assertEquals(tabs.selected, 1);

  send(tabs, "\x1b[1;5D");

  assertEquals(tabs.selected, 0);

  send(tabs, "\x1b[F");

  assertEquals(tabs.selected, 2);
});

Deno.test("theme paints reach the bar and setTheme changes the next render", () => {
  const { tabs } = three({ theme: { indicator: { fg: "#ff0000" } } });

  assertEquals(tabs.render(20)[1].includes("38;2;255;0;0"), true);

  tabs.setTheme({ indicator: { fg: "#00ff00" } });

  const [, rule] = tabs.render(20);

  assertEquals(rule.includes("38;2;0;255;0"), true);
  assertEquals(rule.includes("38;2;255;0;0"), false);
});

Deno.test("custom glyphs, padding and separator shape the bar", () => {
  const { tabs } = three({
    glyphs: TABS_GLYPHS.ascii,
    padding: 2,
    separator: "|",
  });

  assertEquals(plain(tabs.render(30)), [
    "  One  |  Two  |  Three       ",
    `=======${"-".repeat(23)}`,
    "a0",
    "a1",
    "a2",
  ]);
});

Deno.test("the scroll markers and the ellipsis come from the options", () => {
  const tabs = new Tabs({
    tabs: ["Alpha", "Beta", "Gamma"].map((label) => ({
      label,
      content: new Probe(label[0], 1),
    })),
    selected: 2,
    glyphs: TABS_GLYPHS.ascii,
    ellipsis: "~",
  });

  assertEquals(plain(tabs.render(12))[0].startsWith("<"), true);
  assertEquals(plain(tabs.render(5))[0], "< G~ ");
});
