import { assertEquals, assertThrows } from "@std/assert";
import {
  type Component,
  encodeMouse,
  graphemeWidth,
  type InputEvent,
  InputParser,
  type MouseInput,
  TUI,
  VirtualTerminal,
  visibleWidth,
} from "../mod.ts";
import {
  Accordion,
  ACCORDION_GLYPHS,
  type AccordionOptions,
} from "../src/components/accordion.ts";

// deno-lint-ignore no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;:]*m/g, "");

/** Rows cut to the width they get, the same array per width; logs every key and mouse event. */
class Probe implements Component {
  public readonly log: string[] = [];
  private readonly names: readonly string[];
  private width = -1;
  private rows: readonly string[] = [];

  public constructor(name: string, count = 2) {
    this.names = Array.from({ length: count }, (_, i) => `${name}${i}`);
  }

  public render(width: number): readonly string[] {
    if (width !== this.width) {
      this.width = width;
      this.rows = this.names.map((row) => row.slice(0, width));
    }

    return this.rows;
  }

  public handleInput(event: InputEvent): void {
    this.log.push(event.type === "key" ? `key:${event.key.name}` : "paste");
  }

  public handleMouse(event: MouseInput): boolean {
    this.log.push(`${event.action}@${event.x},${event.y}`);

    return true;
  }
}

function make(
  options: { multiple?: boolean; open?: number[]; indent?: number } = {},
  extra: Partial<AccordionOptions> = {},
) {
  const probes = [new Probe("a"), new Probe("b"), new Probe("c")];
  const titles = ["Alpha", "Beta", "Gamma"];
  const accordion = new Accordion({
    sections: probes.map((content, i) => ({
      title: titles[i],
      content,
      open: options.open?.includes(i),
    })),
    multiple: options.multiple,
    indent: options.indent,
    ...extra,
  });

  return { accordion, probes };
}

function send(accordion: Accordion, input: string): void {
  new InputParser((event) => {
    if (event.type === "key" || event.type === "paste") {
      accordion.handleInput(event);
    }
  }).feed(input);
}

function mouse(action: MouseInput["action"], x: number, y: number): MouseInput {
  return {
    type: "mouse",
    action,
    button: action === "move" || action === "leave" ? "none" : "left",
    x,
    y,
    shift: false,
    alt: false,
    ctrl: false,
  };
}

function screen(cols = 30, rows = 12) {
  const terminal = new VirtualTerminal(cols, rows);
  const tui = new TUI(terminal, { mouse: "drag" });

  return { terminal, tui };
}

function click(terminal: VirtualTerminal, x: number, y: number): void {
  terminal.send(encodeMouse({ action: "press", x, y }));
  terminal.send(encodeMouse({ action: "release", x, y }));
}

const plain = (rows: readonly string[]) => rows.map(strip);

Deno.test("the glyphs are one cell wide", () => {
  assertEquals([graphemeWidth("▸"), graphemeWidth("▾")], [1, 1]);
});

Deno.test("closed sections show only headers; an open one shows its content indented", () => {
  const { accordion } = make({ open: [1] });

  assertEquals(plain(accordion.render(20)), [
    "▸ Alpha",
    "▾ Beta",
    "  b0",
    "  b1",
    "▸ Gamma",
  ]);
  assertEquals(
    plain(make({ open: [0], indent: 4 }).accordion.render(20)).slice(0, 3),
    [
      "▾ Alpha",
      "    a0",
      "    a1",
    ],
  );
});

Deno.test("up, down, Home and End move between headers and stop at the ends", () => {
  const { accordion } = make();

  send(accordion, "\x1b[B");
  send(accordion, "\x1b[B");
  send(accordion, "\x1b[B");

  assertEquals(accordion.selected, 2);

  send(accordion, "\x1b[A");

  assertEquals(accordion.selected, 1);

  send(accordion, "\x1b[H");

  assertEquals(accordion.selected, 0);

  send(accordion, "\x1b[A");

  assertEquals(accordion.selected, 0);

  send(accordion, "\x1b[F");

  assertEquals(accordion.selected, 2);
});

Deno.test("Enter and Space toggle, right opens, left closes", () => {
  const { accordion } = make();
  const toggles: string[] = [];

  accordion.onToggle = (index, open) => toggles.push(`${index}:${open}`);

  send(accordion, "\r");

  assertEquals(accordion.isOpen(0), true);

  send(accordion, " ");

  assertEquals(accordion.isOpen(0), false);

  send(accordion, "\x1b[C");
  send(accordion, "\x1b[C");

  assertEquals(accordion.isOpen(0), true);

  send(accordion, "\x1b[D");
  send(accordion, "\x1b[D");

  assertEquals(accordion.isOpen(0), false);
  assertEquals(toggles, ["0:true", "0:false", "0:true", "0:false"]);
});

Deno.test("opening a section closes the others unless multiple is set", () => {
  const single = make({ open: [0] });
  const closed: string[] = [];

  single.accordion.onToggle = (index, open) => closed.push(`${index}:${open}`);

  send(single.accordion, "\x1b[B");
  send(single.accordion, "\r");

  assertEquals([0, 1, 2].map((i) => single.accordion.isOpen(i)), [
    false,
    true,
    false,
  ]);
  assertEquals(closed, ["0:false", "1:true"]);

  const multi = make({ open: [0], multiple: true });

  multi.accordion.open(2);
  multi.accordion.toggle(1);

  assertEquals([0, 1, 2].map((i) => multi.accordion.isOpen(i)), [
    true,
    true,
    true,
  ]);

  multi.accordion.close(0);

  assertEquals([0, 1, 2].map((i) => multi.accordion.isOpen(i)), [
    false,
    true,
    true,
  ]);
});

Deno.test("single mode starts with only the first open section open", () => {
  const { accordion } = make({ open: [1, 2] });

  assertEquals([0, 1, 2].map((i) => accordion.isOpen(i)), [false, true, false]);
});

Deno.test("the methods work silently and reject unknown sections", () => {
  const { accordion } = make();
  let calls = 0;

  accordion.onToggle = () => calls++;

  accordion.toggle(1);
  accordion.open(2);
  accordion.close(2);
  accordion.select(9);

  assertEquals([accordion.isOpen(1), accordion.isOpen(2)], [false, false]);
  assertEquals(accordion.selected, 2);
  assertEquals(calls, 0);
  assertThrows(() => accordion.open(3), RangeError);
  assertThrows(() => accordion.isOpen(-1), RangeError);
});

Deno.test("only a focused accordion highlights the selected header, and the highlight follows the selection", () => {
  const { accordion } = make();
  const idle = accordion.render(20);

  accordion.focused = true;

  const focused = accordion.render(20);

  assertEquals(plain(focused), plain(idle));
  assertEquals(focused[0] === idle[0], false);
  assertEquals(focused[1], idle[1]);

  send(accordion, "\x1b[B");

  const moved = accordion.render(20);

  assertEquals(moved[0], idle[0]);
  assertEquals(moved[1] === idle[1], false);

  accordion.focused = false;

  assertEquals(accordion.render(20)[1], idle[1]);
});

Deno.test("keys the accordion does not use go to the selected section's content while it is open", () => {
  const { accordion, probes } = make({ open: [0] });

  send(accordion, "x");
  send(accordion, "\x1b[200~hi\x1b[201~");
  send(accordion, "\x1b[B");
  send(accordion, "y");

  assertEquals(probes[0].log, ["key:x", "paste"]);
  assertEquals(probes[1].log, []);
});

Deno.test("clicking a header toggles it, moves the selection there and focuses the accordion", () => {
  const { terminal, tui } = screen();
  const { accordion } = make({ open: [0] });
  const toggles: string[] = [];

  accordion.onToggle = (index, open) => toggles.push(`${index}:${open}`);

  tui.addChild(accordion);
  tui.start();
  tui.renderNow();

  // Rows: 0 Alpha, 1-2 a0 a1, 3 Beta, 4 Gamma.
  click(terminal, 3, 3);
  tui.renderNow();

  assertEquals(accordion.selected, 1);
  assertEquals(tui.focused, accordion);
  assertEquals(terminal.viewport().slice(0, 6).map((row) => row.trimEnd()), [
    "▸ Alpha",
    "▾ Beta",
    "  b0",
    "  b1",
    "▸ Gamma",
    "",
  ]);
  assertEquals(toggles, ["0:false", "1:true"]);

  click(terminal, 0, 1);
  tui.renderNow();

  assertEquals(accordion.isOpen(1), false);
  assertEquals(terminal.viewport().slice(0, 3).map((row) => row.trimEnd()), [
    "▸ Alpha",
    "▸ Beta",
    "▸ Gamma",
  ]);
  tui.stop();
});

Deno.test("mouse events on content rows reach that content at its own row and indent", () => {
  const { terminal, tui } = screen();
  const { accordion, probes } = make({ open: [0, 1], multiple: true });

  tui.addChild(accordion);
  tui.start();
  tui.renderNow();

  // Rows: 0 Alpha, 1-2 a0 a1, 3 Beta, 4-5 b0 b1, 6 Gamma.
  terminal.send(encodeMouse({ action: "press", x: 5, y: 2 }));
  terminal.send(encodeMouse({ action: "drag", x: 8, y: 7 }));
  terminal.send(encodeMouse({ action: "release", x: 8, y: 7 }));
  terminal.send(encodeMouse({ action: "press", x: 2, y: 4 }));
  terminal.send(
    encodeMouse({ action: "wheel", direction: "down", x: 3, y: 5 }),
  );

  assertEquals(probes[0].log, ["press@3,1", "drag@6,6", "release@6,6"]);
  assertEquals(probes[1].log, ["press@0,0", "wheel@1,1"]);
  assertEquals(accordion.selected, 0);
  tui.stop();
});

Deno.test("the indent gutter, closed content and rows below the last section are not content", () => {
  const { accordion, probes } = make({ open: [0] });

  accordion.render(20);

  assertEquals(accordion.handleMouse(mouse("press", 1, 1)), false);
  assertEquals(accordion.handleMouse(mouse("press", 0, 2)), false);
  assertEquals(accordion.handleMouse(mouse("press", 4, 9)), false);
  assertEquals(accordion.handleMouse(mouse("press", 4, 2)), true);
  assertEquals(probes[0].log, ["press@2,1"]);
  assertEquals(probes[1].log, []);
});

Deno.test("a press on a header captures the pointer so its drag and release do not reach content below", () => {
  const { accordion, probes } = make({ open: [1], multiple: true });

  accordion.render(20);

  assertEquals(accordion.handleMouse(mouse("press", 1, 0)), true);
  assertEquals(accordion.handleMouse(mouse("drag", 4, 3)), true);
  assertEquals(accordion.handleMouse(mouse("release", 4, 3)), true);
  assertEquals(accordion.isOpen(0), true);
  assertEquals(probes[1].log, []);
});

Deno.test("hovering a header restyles it until the pointer leaves or moves onto content", () => {
  const { accordion } = make({ open: [0] });
  const before = accordion.render(20);

  assertEquals(accordion.handleMouse(mouse("move", 2, 3)), true);

  const hovered = accordion.render(20);

  assertEquals(plain(hovered), plain(before));
  assertEquals(hovered[3] === before[3], false);
  assertEquals(hovered[0], before[0]);

  assertEquals(accordion.handleMouse(mouse("move", 4, 1)), true);
  assertEquals(accordion.render(20)[3], before[3]);

  accordion.handleMouse(mouse("move", 2, 0));
  accordion.handleMouse(mouse("leave", 0, 0));

  assertEquals(accordion.render(20)[0], before[0]);
});

Deno.test("rows are reused while nothing changed, and content is not re-indented when it returns the same rows", () => {
  const { accordion } = make({ open: [0] });
  const first = accordion.render(20);

  assertEquals(accordion.render(20) === first, true);
  assertEquals(accordion.render(21) === first, false);

  const again = accordion.render(20);

  accordion.toggle(1);

  const opened = accordion.render(20);

  assertEquals(opened === again, false);
  assertEquals(plain(opened), ["▸ Alpha", "▾ Beta", "  b0", "  b1", "▸ Gamma"]);
});

Deno.test("narrow widths cut headers, drop content that has no room, and never overflow", () => {
  const { accordion } = make({ open: [0], multiple: true });

  for (let width = 1; width <= 12; width++) {
    for (const row of accordion.render(width)) {
      assertEquals(
        visibleWidth(row) <= width,
        true,
        `width ${width}: ${strip(row)}`,
      );
    }
  }

  assertEquals(plain(accordion.render(5)), [
    "▾ Al…",
    "  a0",
    "  a1",
    "▸ Be…",
    "▸ Ga…",
  ]);
  assertEquals(plain(accordion.render(2)), ["▾…", "▸…", "▸…"]);
  assertEquals(accordion.render(2).length, 3);
  assertEquals(accordion.render(0), []);
});

Deno.test("an empty accordion renders nothing and ignores input", () => {
  const accordion = new Accordion();

  accordion.focused = true;

  send(accordion, "\x1b[B");
  send(accordion, "\r");

  assertEquals(accordion.render(10), []);
  assertEquals(accordion.handleMouse(mouse("press", 0, 0)), false);
});

Deno.test("custom keys replace the default ones for their action", () => {
  const { accordion, probes } = make({}, { keys: { toggle: ["x"] } });

  send(accordion, "\r");

  assertEquals(accordion.isOpen(0), false);

  send(accordion, "x");

  assertEquals(accordion.isOpen(0), true);

  send(accordion, "\r");

  assertEquals(accordion.isOpen(0), true);
  assertEquals(probes[0].log, ["key:enter"]);
});

Deno.test("theme paints reach the headers and setTheme changes the next render", () => {
  const { accordion } = make({ open: [1] }, {
    theme: { open: { fg: "#ff0000" } },
  });
  const [closed, open] = accordion.render(20);

  assertEquals(open.includes("38;2;255;0;0"), true);
  assertEquals(closed.includes("38;2;255;0;0"), false);

  accordion.setTheme({ open: { fg: "#00ff00" } });

  const [, again] = accordion.render(20);

  assertEquals(again.includes("38;2;0;255;0"), true);
  assertEquals(again.includes("38;2;255;0;0"), false);
});

Deno.test("custom glyphs, gap and ellipsis shape the headers", () => {
  const { accordion } = make({ open: [1] }, {
    glyphs: ACCORDION_GLYPHS.ascii,
    gap: 2,
    ellipsis: "~",
  });

  assertEquals(plain(accordion.render(20)).slice(0, 2), [
    ">  Alpha",
    "v  Beta",
  ]);
  assertEquals(plain(accordion.render(6))[0], ">  Al~");
});
