import { assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import {
  Checklist,
  type ChecklistItem,
  encodeMouse,
  type MouseInput,
  TUI,
  VirtualTerminal,
} from "../mod.ts";

const ITEMS: readonly ChecklistItem[] = [
  { label: "milk", state: "pending" },
  { label: "a very long label that wraps around twice", state: "pending" },
  { label: "eggs", state: "pending" },
];

// At width 14 with pointer ">" the rows are: 0 milk, 1-5 the long label, 6 eggs.
// Columns: pointer 0, glyph 2, label from 4.
function setup(interactive = true) {
  const time = new FakeTime(0);
  const toggled: string[] = [];
  const list = new Checklist({ requestRender() {} }, {
    items: ITEMS,
    interactive,
    pointer: ">",
    clock: () => time.now,
  });

  list.onToggle = (index, item) => toggled.push(`${index}:${item.state}`);

  list.render(14);

  return {
    list,
    toggled,
    [Symbol.dispose]: () => time[Symbol.dispose](),
  };
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
    button: action === "wheel" ? "none" : "left",
    x,
    y,
    shift: false,
    alt: false,
    ctrl: false,
    ...extra,
  };
}

const states = (list: Checklist) => list.items.map((item) => item.state);

Deno.test("clicking the glyph or the label selects and toggles the item", () => {
  using ctx = setup();

  const { list, toggled } = ctx;

  assertEquals(list.handleMouse(mouse("press", 2, 0)), true);
  assertEquals(list.selected, 0);
  assertEquals(states(list), ["done", "pending", "pending"]);

  list.render(14);

  assertEquals(list.handleMouse(mouse("press", 5, 6)), true);
  assertEquals(list.selected, 2);
  assertEquals(states(list), ["done", "pending", "done"]);

  list.render(14);
  list.handleMouse(mouse("press", 2, 0));

  assertEquals(states(list), ["pending", "pending", "done"]);
  assertEquals(toggled, ["0:done", "2:done", "0:pending"]);
});

Deno.test("clicking a wrapped continuation row selects the item, and its text toggles it", () => {
  using ctx = setup();

  const { list, toggled } = ctx;

  // The label's third line ("that wraps").
  assertEquals(list.handleMouse(mouse("press", 6, 3)), true);
  assertEquals(list.selected, 1);
  assertEquals(toggled, ["1:done"]);

  // The indent under the glyph and the blank after the text only select.
  list.select(0);
  list.render(14);
  list.handleMouse(mouse("press", 1, 4));

  assertEquals(list.selected, 1);

  list.select(0);
  list.render(14);
  list.handleMouse(mouse("press", 13, 5));

  assertEquals(list.selected, 1);
  assertEquals(toggled, ["1:done"]);
});

Deno.test("the pointer column and the space after the label only select", () => {
  using ctx = setup();

  const { list, toggled } = ctx;

  assertEquals(list.handleMouse(mouse("press", 0, 6)), true);
  assertEquals(list.selected, 2);

  list.handleMouse(mouse("press", 3, 0));
  list.handleMouse(mouse("press", 12, 0));

  assertEquals(list.selected, 0);
  assertEquals(toggled, []);
  assertEquals(states(list), ["pending", "pending", "pending"]);
});

Deno.test("the wheel moves the selection and stops at the ends", () => {
  using ctx = setup();

  const { list } = ctx;

  assertEquals(
    list.handleMouse(mouse("wheel", 0, 0, { direction: "down" })),
    true,
  );
  assertEquals(list.selected, 1);

  list.handleMouse(mouse("wheel", 0, 0, { direction: "down" }));
  list.handleMouse(mouse("wheel", 0, 0, { direction: "down" }));

  assertEquals(list.selected, 2);

  list.handleMouse(mouse("wheel", 0, 0, { direction: "up" }));

  assertEquals(list.selected, 1);
  assertEquals(
    list.handleMouse(mouse("wheel", 0, 0, { direction: "left" })),
    false,
  );
  assertEquals(states(list), ["pending", "pending", "pending"]);
});

Deno.test("presses below the last item, other buttons and other actions are not handled", () => {
  using ctx = setup();

  const { list, toggled } = ctx;

  assertEquals(list.handleMouse(mouse("press", 2, 7)), false);
  assertEquals(
    list.handleMouse(mouse("press", 2, 0, { button: "right" })),
    false,
  );
  assertEquals(list.handleMouse(mouse("release", 2, 0)), false);
  assertEquals(list.handleMouse(mouse("drag", 2, 0)), false);
  assertEquals(
    list.handleMouse(mouse("move", 2, 0, { button: "none" })),
    false,
  );
  assertEquals(toggled, []);
  assertEquals(list.selected, 0);
});

Deno.test("a non-interactive list ignores the mouse", () => {
  using ctx = setup(false);

  const { list, toggled } = ctx;

  assertEquals(list.handleMouse(mouse("press", 2, 0)), false);
  assertEquals(
    list.handleMouse(mouse("wheel", 2, 0, { direction: "down" })),
    false,
  );
  assertEquals(toggled, []);
  assertEquals(states(list), ["pending", "pending", "pending"]);
});

Deno.test("an empty interactive list handles nothing", () => {
  const list = new Checklist({ requestRender() {} }, { interactive: true });

  list.render(14);

  assertEquals(list.handleMouse(mouse("press", 2, 0)), false);
  assertEquals(
    list.handleMouse(mouse("wheel", 2, 0, { direction: "down" })),
    false,
  );
});

Deno.test("clicking in the TUI focuses the list and toggles the clicked item", () => {
  using time = new FakeTime(0);
  const terminal = new VirtualTerminal(14, 8);
  const tui = new TUI(terminal, { mouse: "click" });
  const list = new Checklist(tui, {
    items: ITEMS,
    interactive: true,
    pointer: ">",
    clock: () => time.now,
  });

  tui.addChild(list);
  tui.start();
  tui.renderNow();

  terminal.send(encodeMouse({ action: "press", x: 2, y: 6 }));
  time.tick(1000);

  assertEquals(tui.focused, list);
  assertEquals(list.selected, 2);
  assertEquals(states(list), ["pending", "pending", "done"]);

  terminal.send(encodeMouse({ action: "wheel", direction: "up", x: 0, y: 0 }));
  terminal.send(" ");
  time.tick(1000);
  tui.renderNow();

  assertEquals(list.selected, 1);
  assertEquals(states(list), ["pending", "done", "done"]);
  assertEquals(terminal.viewport()[0], "  ☐ milk");
  assertEquals(terminal.viewport()[1], "> ☑ a very");
  tui.stop();
});
