import { assertEquals } from "@std/assert";
import {
  BORDERS,
  Box,
  type Component,
  encodeMouse,
  type MouseInput,
  Text,
  TUI,
  VirtualTerminal,
} from "../mod.ts";

// deno-lint-ignore no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

Deno.test("Box frames wrapped content with a title and a right-aligned footer", () => {
  const box = new Box(new Text("hello world, this wraps"), {
    title: "Title",
    footer: "1/2",
  });

  assertEquals(box.render(16).map(strip), [
    "╭─ Title ──────╮",
    "│ hello world, │",
    "│ this wraps   │",
    "╰──────── 1/2 ─╯",
  ]);
  // A title that does not fit is cut, never wider than the box.
  assertEquals(
    new Box(new Text("x"), { title: "a very long title" }).render(8).map(strip),
    ["╭─ a… ─╮", "│ x    │", "╰──────╯"],
  );
});

Deno.test("Box fills a given height and passes the inner height to its child", () => {
  let innerHeight: number | undefined;
  const child: Component = {
    render: (_width, height) => {
      innerHeight = height;

      return ["one", "two", "three", "four"];
    },
  };
  const box = new Box(child, { border: BORDERS.ascii, padding: [1, 0] });

  assertEquals(box.render(7, 6).map(strip), [
    "+-----+",
    "|     |",
    "|one  |",
    "|two  |",
    "|     |",
    "+-----+",
  ]);
  assertEquals(innerHeight, 2);
  assertEquals(box.inset, [2, 1]);
});

Deno.test("Box forwards mouse events to its child in the child's cells", () => {
  const terminal = new VirtualTerminal(20, 6);
  const tui = new TUI(terminal, { mouse: "click" });
  const events: string[] = [];
  const child: Component = {
    render: () => ["inside"],
    handleMouse: (event: MouseInput) => {
      events.push(`${event.action}@${event.x},${event.y}`);

      return true;
    },
  };

  tui.addChild(new Box(child));
  tui.start();
  tui.renderNow();
  terminal.send(encodeMouse({ action: "press", x: 3, y: 1 }));
  assertEquals(events, ["press@1,0"]);
  tui.stop();
});

Deno.test("Box marks a cut title with the configured ellipsis", () => {
  const box = new Box(new Text("x"), {
    title: "a very long title",
    ellipsis: "~",
  });

  assertEquals(strip(box.render(10)[0]), "╭─ a v~ ─╮");
});
