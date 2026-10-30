import { assertEquals } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { BORDERS, encodeMouse, TUI, VirtualTerminal } from "../mod.ts";
import {
  TOAST_GLYPHS,
  Toaster,
  type ToasterOptions,
} from "../src/components/toast.ts";

/** A TUI with mouse motion on and a toaster whose clock follows the fake `time`. */
function setup(time: FakeTime, options: ToasterOptions = {}) {
  const terminal = new VirtualTerminal(30, 12);
  const tui = new TUI(terminal, { mouse: "move" });
  const toaster = new Toaster(tui, {
    anchor: "top-left",
    margin: 0,
    width: 20,
    clock: () => time.now,
    ...options,
  });

  tui.start();

  return {
    terminal,
    tui,
    toaster,
    advance(ms: number) {
      time.tick(ms);
    },
  };
}

function rows(terminal: VirtualTerminal, count: number): string[] {
  return terminal.viewport().slice(0, count).map((row) => row.trimEnd());
}

function mouse(
  terminal: VirtualTerminal,
  action: "press" | "release" | "move" | "wheel",
  x: number,
  y: number,
): void {
  terminal.send(
    encodeMouse({
      action,
      x,
      y,
      direction: action === "wheel" ? "down" : undefined,
    }),
  );
}

Deno.test("toasts stack oldest first, each with its kind icon and a frame", () => {
  using time = new FakeTime(0);

  const { terminal, tui, toaster } = setup(time);

  toaster.show("first");
  toaster.show("second", { kind: "success", title: "Done" });
  toaster.show("third", { kind: "warning" });
  toaster.show("fourth", { kind: "error" });
  tui.renderNow();

  assertEquals(rows(terminal, 12), [
    "╭──────────────────╮",
    "│ ℹ first          │",
    "╰──────────────────╯",
    "╭─ Done ───────────╮",
    "│ ✔ second         │",
    "╰──────────────────╯",
    "╭──────────────────╮",
    "│ ⚠ third          │",
    "╰──────────────────╯",
    "╭──────────────────╮",
    "│ ✘ fourth         │",
    "╰──────────────────╯",
  ]);
  tui.stop();
  toaster.dismissAll();
});

Deno.test("icons are coloured by kind and long messages wrap under the text", () => {
  using time = new FakeTime(0);

  const { terminal, tui, toaster } = setup(time, { width: 16 });

  toaster.show("alpha beta gamma delta", { kind: "error" });
  tui.renderNow();

  assertEquals(rows(terminal, 5), [
    "╭──────────────╮",
    "│ ✘ alpha beta │",
    "│   gamma      │",
    "│   delta      │",
    "╰──────────────╯",
  ]);
  assertEquals(
    terminal.writes.some((write) => write.includes("\x1b[38;2;224;80;80m✘")),
    true,
  );
  tui.stop();
  toaster.dismissAll();
});

Deno.test("showing more than max dismisses the oldest", () => {
  using time = new FakeTime(0);

  const { terminal, tui, toaster } = setup(time, { max: 2 });

  toaster.show("a");
  toaster.show("b");
  toaster.show("c");
  tui.renderNow();

  assertEquals(toaster.count, 2);
  assertEquals(rows(terminal, 6).filter((row) => row.includes("ℹ")), [
    "│ ℹ b              │",
    "│ ℹ c              │",
  ]);
  tui.stop();
  toaster.dismissAll();
});

Deno.test("toasts leave after their own duration and the overlay goes with the last one", () => {
  using time = new FakeTime(0);

  const { terminal, tui, toaster, advance } = setup(time, { durationMs: 1000 });

  toaster.show("short");
  toaster.show("long", { durationMs: 3000 });
  tui.renderNow();
  assertEquals(toaster.count, 2);

  advance(999);
  assertEquals(toaster.count, 2);

  advance(1);
  tui.renderNow();
  assertEquals(toaster.count, 1);
  assertEquals(rows(terminal, 3), [
    "╭──────────────────╮",
    "│ ℹ long           │",
    "╰──────────────────╯",
  ]);

  advance(2000);
  tui.renderNow();
  assertEquals(toaster.count, 0);
  assertEquals(rows(terminal, 3), ["", "", ""]);
  tui.stop();
});

Deno.test("sticky toasts stay until dismissed, through their handle", () => {
  using time = new FakeTime(0);

  const { terminal, tui, toaster, advance } = setup(time);
  const sticky = toaster.show("stays", { durationMs: 0 });

  advance(1_000_000);
  tui.renderNow();
  assertEquals(toaster.count, 1);

  sticky.update("changed");
  tui.renderNow();
  assertEquals(rows(terminal, 3)[1], "│ ℹ changed        │");

  sticky.dismiss();
  sticky.dismiss();
  sticky.update("ignored");
  tui.renderNow();
  assertEquals(toaster.count, 0);
  assertEquals(rows(terminal, 3), ["", "", ""]);
  tui.stop();
});

Deno.test("an idle toaster leaves no timer behind", () => {
  const terminal = new VirtualTerminal(30, 6);
  const toaster = new Toaster(new TUI(terminal));

  // The test sanitizer fails this test if any timer is still pending.
  toaster.show("one");
  toaster.show("two", { durationMs: 0 }).dismiss();
  toaster.dismissAll();
});

Deno.test("clicking a toast dismisses it and the ones below move up", () => {
  using time = new FakeTime(0);

  const { terminal, tui, toaster } = setup(time);

  toaster.show("first", { durationMs: 0 });
  toaster.show("second", { durationMs: 0 });
  tui.renderNow();

  // A press alone does nothing; the release over the same toast completes the click.
  mouse(terminal, "press", 4, 1);
  assertEquals(toaster.count, 2);
  mouse(terminal, "release", 4, 1);
  tui.renderNow();

  assertEquals(toaster.count, 1);
  assertEquals(rows(terminal, 3), [
    "╭──────────────────╮",
    "│ ℹ second         │",
    "╰──────────────────╯",
  ]);

  // Pressing one toast and releasing over another is not a click.
  toaster.show("third", { durationMs: 0 });
  tui.renderNow();
  mouse(terminal, "press", 4, 1);
  mouse(terminal, "release", 4, 4);
  assertEquals(toaster.count, 2);

  // Clicks outside the stack reach the content beneath, not the toasts.
  mouse(terminal, "press", 25, 8);
  mouse(terminal, "release", 25, 8);
  assertEquals(toaster.count, 2);
  tui.stop();
  toaster.dismissAll();
});

Deno.test("the wheel over a toast does nothing", () => {
  using time = new FakeTime(0);

  const { terminal, tui, toaster } = setup(time);

  toaster.show("scroll me", { durationMs: 0 });
  tui.renderNow();
  mouse(terminal, "wheel", 4, 1);
  assertEquals(toaster.count, 1);
  tui.stop();
  toaster.dismissAll();
});

Deno.test("hovering a toast holds its timer until the pointer leaves", () => {
  using time = new FakeTime(0);

  const { terminal, tui, toaster, advance } = setup(time, { durationMs: 1000 });

  toaster.show("held");
  tui.renderNow();

  advance(600);
  mouse(terminal, "move", 4, 1);
  advance(5000);
  assertEquals(toaster.count, 1);

  // Off the stack: 400 ms of the timeout are left.
  mouse(terminal, "move", 25, 9);
  advance(399);
  assertEquals(toaster.count, 1);

  advance(1);
  assertEquals(toaster.count, 0);
  tui.stop();
});

Deno.test("moving from one toast to another holds only the one under the pointer", () => {
  using time = new FakeTime(0);

  const { terminal, tui, toaster, advance } = setup(time, { durationMs: 1000 });

  toaster.show("a");
  toaster.show("b");
  tui.renderNow();

  mouse(terminal, "move", 4, 1);
  advance(2000);
  // Only the hovered first toast survives; the second one ran out.
  assertEquals(toaster.count, 1);

  mouse(terminal, "move", 4, 1);
  tui.renderNow();
  assertEquals(rows(terminal, 3)[1], "│ ℹ a              │");
  tui.stop();
  toaster.dismissAll();
});

Deno.test("icons, icon gap, frame glyphs and the gap between toasts are configurable", () => {
  using time = new FakeTime(0);

  const { terminal, tui, toaster } = setup(time, {
    glyphs: TOAST_GLYPHS.ascii,
    iconGap: 2,
    border: BORDERS.ascii,
    gap: 1,
  });

  toaster.show("first", { durationMs: 0 });
  toaster.show("second", { kind: "error", icon: ">>", durationMs: 0 });
  tui.renderNow();

  assertEquals(rows(terminal, 7), [
    "+------------------+",
    "| i  first         |",
    "+------------------+",
    "",
    "+------------------+",
    "| >>  second       |",
    "+------------------+",
  ]);

  // The blank row between toasts is not a toast.
  mouse(terminal, "press", 4, 3);
  mouse(terminal, "release", 4, 3);

  assertEquals(toaster.count, 2);
  tui.stop();
  toaster.dismissAll();
});

Deno.test("theme keys reach the output and setTheme repaints toasts already shown", () => {
  using time = new FakeTime(0);

  const { terminal, tui, toaster } = setup(time, {
    theme: { message: { fg: "#102030" }, icon: { bold: true } },
  });

  toaster.show("hello", { kind: "success", title: "T", durationMs: 0 });
  tui.renderNow();

  const written = () => terminal.writes.join("");

  assertEquals(written().includes("38;2;16;32;48"), true);
  assertEquals(written().includes("\x1b[38;2;80;192;80;1m✔"), true);

  toaster.setTheme({ success: { fg: "#aa00aa" } });
  tui.renderNow();

  assertEquals(written().includes("38;2;170;0;170"), true);
  tui.stop();
  toaster.dismissAll();
});
