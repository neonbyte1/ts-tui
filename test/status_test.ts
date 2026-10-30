import { assertEquals, assertThrows } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import {
  Checklist,
  type ChecklistItem,
  CURSOR_MARKER,
  InputParser,
  Spinner,
  STATUS_GLYPHS,
  visibleWidth,
} from "../mod.ts";

// deno-lint-ignore no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;:]*m/g, "");

function counter() {
  const host = { renders: 0, requestRender: () => host.renders++ };

  return host;
}

function send(list: Checklist, input: string): void {
  new InputParser((event) => {
    if (event.type === "key" || event.type === "paste") {
      list.handleInput(event);
    }
  }).feed(input);
}

Deno.test("Spinner spins while running, then settles into a check mark and stops its timer", () => {
  using time = new FakeTime(0);
  const host = counter();
  const spinner = new Spinner(host, "Installing", { clock: () => time.now });

  assertEquals(spinner.render(40).map(strip), ["○ Installing"]);

  spinner.start();

  assertEquals(spinner.render(40).map(strip), ["⠋ Installing"]);

  time.tick(160);

  assertEquals(spinner.render(40).map(strip), ["⠹ Installing"]);

  spinner.succeed("Installed 42 packages");

  const settle = [];

  for (let i = 0; i < 5; i++) {
    settle.push(strip(spinner.render(40)[0]));
    time.tick(80);
  }

  assertEquals(settle, [
    "⣀ Installed 42 packages",
    "⣤ Installed 42 packages",
    "⣶ Installed 42 packages",
    "⣿ Installed 42 packages",
    "✔ Installed 42 packages",
  ]);
  assertEquals(spinner.animating, false);

  const renders = host.renders;

  time.tick(1000);

  assertEquals(host.renders, renders);
});

Deno.test("Spinner fades the settling glyph from the running colour to the final one", () => {
  using time = new FakeTime(0);
  const spinner = new Spinner(counter(), "", { clock: () => time.now });

  spinner.start();
  spinner.succeed();

  // 1/5 of the way from cyan #3fb5e8 to green #50c050.
  assertEquals(spinner.render(10), ["\x1b[38;2;66;183;202m⣀\x1b[39m"]);

  time.tick(400);

  assertEquals(spinner.render(10), ["\x1b[38;2;80;192;80m✔\x1b[39m"]);

  spinner.start();
  spinner.fail();
  time.tick(400);

  assertEquals(spinner.render(10), ["\x1b[38;2;224;80;80m✘\x1b[39m"]);

  spinner.reset();

  assertEquals(spinner.animating, false);
  assertEquals(spinner.render(10), ["\x1b[38;2;92;99;112m○\x1b[39m"]);
});

Deno.test("Spinner pads glyphs to the widest one and accepts theme and label paints", () => {
  using time = new FakeTime(0);
  const spinner = new Spinner(counter(), "lint", {
    glyphs: { ...STATUS_GLYPHS.ascii, settle: [], done: "ok" },
    theme: { glyph: { done: {} }, label: { done: { bold: true } } },
    clock: () => time.now,
  });

  assertEquals(spinner.render(20), ["\x1b[38;2;92;99;112m[ ]\x1b[39m lint"]);

  spinner.succeed();

  // No settle frames: the mark appears at once, padded to three cells.
  assertEquals(spinner.animating, false);
  assertEquals(spinner.render(20), ["ok  \x1b[1mlint\x1b[22m"]);
  assertEquals(spinner.render(3), ["ok…"]);
});

Deno.test("Checklist shows items in their states, wrapping labels under themselves", () => {
  using time = new FakeTime(0);
  const list = new Checklist(counter(), {
    items: [
      { label: "Read the renderer", state: "done" },
      { label: "Write the spinner component", state: "running", note: "12s" },
      { label: "Ship it", state: "pending" },
      { label: "Deploy", state: "failed" },
    ],
    clock: () => time.now,
  });

  assertEquals(list.render(20).map(strip), [
    "☑ Read the renderer",
    "◰ Write the spinner",
    "  component 12s",
    "☐ Ship it",
    "☒ Deploy",
  ]);
  // Done labels are struck through and dim; running ones bold.
  assertEquals(list.render(40)[0].includes("\x1b[2;9mRead the renderer"), true);
  assertEquals(list.render(40)[1].includes("\x1b[1mWrite"), true);
  // Items given up front appear settled: only the running one animates.
  list.setState(1, "done");
  assertEquals(strip(list.render(40)[1]), "◧ Write the spinner component 12s");

  time.tick(160);

  assertEquals(strip(list.render(40)[1]), "☑ Write the spinner component 12s");
  assertEquals(list.animating, false);
});

Deno.test("Checklist updates, adds and removes items", () => {
  using time = new FakeTime(0);
  const list = new Checklist(counter(), {
    glyphs: STATUS_GLYPHS.ascii,
    theme: { label: { done: undefined } },
    clock: () => time.now,
  });
  const first = list.add("one");

  list.add("two", "running", "slow");
  list.update(first, { label: "uno", state: "skipped" });
  list.update(1, { note: undefined });

  time.tick(1000);

  assertEquals(
    list.items,
    [
      { label: "uno", state: "skipped" },
      { label: "two", state: "running" },
    ] satisfies ChecklistItem[],
  );

  list.remove(0);

  assertEquals(list.items.map((item) => item.label), ["two"]);
  assertThrows(() => list.setState(5, "done"), RangeError);

  list.setState(0, "done");
  time.tick(1000);
  assertEquals(list.render(20), ["\x1b[38;2;80;192;80m[x]\x1b[39m two"]);
});

Deno.test("Interactive Checklist toggles the selected item with Space and Enter", () => {
  using time = new FakeTime(0);
  const toggled: string[] = [];
  const list = new Checklist(counter(), {
    items: [
      { label: "milk", state: "pending" },
      { label: "eggs", state: "pending" },
    ],
    interactive: true,
    pointer: ">",
    clock: () => time.now,
  });

  list.onToggle = (index, item) => toggled.push(`${index}:${item.state}`);

  // Not focused: no pointer, but the column is kept so rows do not shift.
  assertEquals(list.render(20).map(strip), ["  ☐ milk", "  ☐ eggs"]);

  list.focused = true;

  send(list, "\x1b[B ");
  time.tick(1000);

  assertEquals(list.selected, 1);
  assertEquals(list.render(20).map(strip), [
    "  ☐ milk",
    `> ${CURSOR_MARKER}☑ eggs`,
  ]);

  send(list, "k\r\r\x1b[F");

  assertEquals(list.selected, 1);
  assertEquals(toggled, ["1:done", "0:done", "0:pending"]);
  assertEquals(list.items.map((item) => item.state), ["pending", "done"]);
});

Deno.test("Non-interactive Checklist ignores input and every glyph set has one width", () => {
  using time = new FakeTime(0);
  const list = new Checklist(counter(), {
    items: [{ label: "a", state: "pending" }],
    clock: () => time.now,
  });

  list.focused = true;

  send(list, " ");

  assertEquals(list.items[0].state, "pending");

  for (const [name, glyphs] of Object.entries(STATUS_GLYPHS)) {
    const widths = new Set(
      [
        glyphs.pending,
        glyphs.done,
        glyphs.failed,
        glyphs.skipped,
        ...glyphs.running,
        ...glyphs.settle,
      ].map((g) => visibleWidth(g)),
    );

    assertEquals(widths.size, 1, name);
  }
});

Deno.test("Spinner gap and ellipsis apply, and setTheme repaints the label and redraws", () => {
  using time = new FakeTime(0);
  const host = counter();
  const spinner = new Spinner(host, "lint", {
    glyphs: STATUS_GLYPHS.ascii,
    theme: { glyph: { pending: {} } },
    gap: 3,
    ellipsis: "~",
    clock: () => time.now,
  });

  assertEquals(spinner.render(20), ["[ ]   lint"]);
  assertEquals(spinner.render(8), ["[ ]   l~"]);

  spinner.setTheme({ label: { pending: { italic: true } } });

  assertEquals(host.renders, 1);
  assertEquals(spinner.render(20), ["[ ]   \x1b[3mlint\x1b[23m"]);
});

Deno.test("Checklist keys replace the defaults of the actions they name", () => {
  using time = new FakeTime(0);
  const list = new Checklist(counter(), {
    items: [
      { label: "milk", state: "pending" },
      { label: "eggs", state: "pending" },
    ],
    interactive: true,
    keys: { down: ["n"], toggle: ["x"] },
    clock: () => time.now,
  });

  list.focused = true;

  // Default bindings of the rebound actions are gone.
  send(list, "j \r");

  assertEquals(list.selected, 0);
  assertEquals(list.items.map((item) => item.state), ["pending", "pending"]);

  send(list, "nx");

  assertEquals(list.selected, 1);
  assertEquals(list.items.map((item) => item.state), ["pending", "done"]);

  // Actions that were not named keep their defaults.
  send(list, "k");

  assertEquals(list.selected, 0);
});

Deno.test("Checklist theme, pointer, gaps and note separator shape the row, and setTheme changes the next render", () => {
  using time = new FakeTime(0);
  const host = counter();
  const list = new Checklist(host, {
    items: [{ label: "a", state: "pending", note: "n" }],
    interactive: true,
    pointer: "→",
    pointerGap: 2,
    gap: 2,
    noteSeparator: " — ",
    theme: {
      glyph: { pending: {} },
      label: { pending: {} },
      note: { italic: true },
      pointer: { bold: true },
    },
    clock: () => time.now,
  });

  list.focused = true;

  assertEquals(list.render(30), [
    `\x1b[1m→\x1b[22m  ${CURSOR_MARKER}☐  a — \x1b[3mn\x1b[23m`,
  ]);

  const renders = host.renders;

  list.setTheme({ note: { bold: true } });

  assertEquals(host.renders, renders + 1);
  assertEquals(list.render(30), [
    `\x1b[1m→\x1b[22m  ${CURSOR_MARKER}☐  a — \x1b[1mn\x1b[22m`,
  ]);
});
