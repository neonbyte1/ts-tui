import { assertEquals } from "@std/assert";
import {
  encodeMouse,
  InputParser,
  type MouseInput,
  TUI,
  VirtualTerminal,
} from "../mod.ts";
import { Editor } from "../src/components/editor.ts";

const TEXT = "alpha beta gamma delta epsilon zeta eta theta iota kappa";

function type(editor: Editor, input: string): void {
  new InputParser((event) => {
    if (event.type === "key" || event.type === "paste") {
      editor.handleInput(event);
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
    button: action === "wheel" ? "none" : "left",
    x,
    y,
    shift: false,
    alt: false,
    ctrl: false,
    ...extra,
  };
}

function wheel(direction: "up" | "down" | "left" | "right"): MouseInput {
  return mouse("wheel", 3, 1, { direction });
}

Deno.test("a click places the cursor on the clicked wrapped row and column", () => {
  const editor = new Editor({ maxHeight: 3 });

  editor.setText(TEXT);
  editor.render(12);

  // Row 0 of the screen is the "↑ 2 more" border: the first text row is y = 1.
  assertEquals(editor.handleMouse(mouse("press", 5, 1)), true);

  type(editor, "X");

  assertEquals(editor.text, TEXT.replace("epsilon", "epsilXon"));

  editor.setText(TEXT);
  editor.render(12);
  editor.handleMouse(mouse("press", 0, 3));
  type(editor, "X");

  assertEquals(editor.text, TEXT.replace("iota", "Xiota"));
});

Deno.test("clicking past the end of a wrapped row stays on that row; past a final row goes to its end", () => {
  const editor = new Editor({ maxHeight: 3 });

  editor.setText(TEXT);
  editor.render(12);
  editor.handleMouse(mouse("press", 11, 2));
  type(editor, "X");

  // Not at the start of "iota": the cursor stays on the " eta theta " row.
  assertEquals(editor.text, TEXT.replace("theta ", "thetaX "));

  editor.setText(TEXT);
  editor.render(12);
  editor.handleMouse(mouse("press", 11, 3));
  type(editor, "X");

  assertEquals(editor.text, `${TEXT}X`);
});

Deno.test("clicks account for the scroll offset and for wide characters", () => {
  const editor = new Editor({ maxHeight: 3, border: false });

  editor.setText("日本語日本語日本語\nab");

  // Rows: 日本語日 / 本語日本 / 語 / ab, scrolled to show the last three.
  assertEquals(editor.render(8), ["本語日本", "語", "ab"]);

  editor.handleMouse(mouse("press", 3, 0));
  type(editor, "X");

  assertEquals(editor.text, "日本語日本X語日本語\nab");

  editor.setText("日本語日本語日本語\nab");
  editor.render(8);
  editor.handleMouse(mouse("press", 0, 2));
  type(editor, "X");

  assertEquals(editor.text, "日本語日本語日本語\nXab");
});

Deno.test("a press on a border row is handled without moving the cursor; other buttons are not handled", () => {
  const editor = new Editor({ maxHeight: 3 });

  editor.setText(TEXT);
  editor.render(12);

  assertEquals(editor.handleMouse(mouse("press", 3, 0)), true);
  assertEquals(editor.handleMouse(mouse("press", 3, 4)), true);
  assertEquals(
    editor.handleMouse(mouse("press", 3, 1, { button: "right" })),
    false,
  );
  assertEquals(
    editor.handleMouse(mouse("move", 3, 1, { button: "none" })),
    false,
  );

  type(editor, "X");

  assertEquals(editor.text, `${TEXT}X`);
});

Deno.test("dragging moves the cursor without selecting, scrolling at the window's edges", () => {
  const editor = new Editor({ maxHeight: 3 });

  editor.setText(TEXT);
  editor.render(12);
  editor.handleMouse(mouse("press", 2, 3));

  // Above the window: one row up per event, and the view follows.
  editor.handleMouse(mouse("drag", 2, -5));

  assertEquals(editor.render(12)[0], "─\x1b[2m ↑ 1 more \x1b[22m─");

  editor.handleMouse(mouse("drag", 2, -5));

  assertEquals(editor.render(12)[0], "────────────");

  type(editor, "X");

  assertEquals(editor.text, TEXT.replace("alpha", "alXpha"));
});

Deno.test("the wheel scrolls the view by three rows and keeps the cursor inside it", () => {
  const editor = new Editor({ maxHeight: 3 });

  editor.setText(TEXT);

  assertEquals(editor.render(12)[0], "─\x1b[2m ↑ 2 more \x1b[22m─");
  assertEquals(editor.handleMouse(wheel("up")), true);
  assertEquals(editor.render(12), [
    "────────────",
    "alpha beta ",
    "gamma delta ",
    "epsilon zeta",
    "─\x1b[2m ↓ 2 more \x1b[22m─",
  ]);

  // The cursor was on the last row of the text; it moved to the last visible row.
  type(editor, "X");

  assertEquals(editor.text, TEXT.replace("zeta", "zeXta"));
  assertEquals(editor.handleMouse(wheel("left")), false);
});

Deno.test("the wheel leaves the cursor alone while it stays visible, and stops at the ends", () => {
  const editor = new Editor({ maxHeight: 3 });

  editor.setText(TEXT);
  editor.render(12);

  // Up: the cursor is pulled to the last visible row. Back down: it is still
  // visible, so it stays where it was.
  editor.handleMouse(wheel("up"));
  editor.handleMouse(wheel("down"));

  assertEquals(editor.render(12)[0], "─\x1b[2m ↑ 2 more \x1b[22m─");

  type(editor, "X");

  assertEquals(editor.text, TEXT.replace("zeta", "zeXta"));

  // Already at the bottom: wheeling further changes nothing.
  editor.handleMouse(wheel("down"));
  type(editor, "Y");

  assertEquals(editor.text, TEXT.replace("zeta", "zeXYta"));
});

Deno.test("wheel on a short editor does nothing visible", () => {
  const editor = new Editor({ maxHeight: 5 });

  editor.setText("one\ntwo");
  editor.render(12);

  assertEquals(editor.handleMouse(wheel("up")), true);

  type(editor, "X");

  assertEquals(editor.text, "one\ntwoX");
});

Deno.test("clicking in the TUI focuses the editor and places the cursor under the pointer", () => {
  const terminal = new VirtualTerminal(14, 6);
  const tui = new TUI(terminal, { mouse: "click" });
  const editor = new Editor({ maxHeight: 3 });

  editor.setText("one two\nthree four");
  tui.addChild(editor);
  tui.start();
  tui.renderNow();

  terminal.send(encodeMouse({ action: "press", x: 2, y: 2 }));

  assertEquals(tui.focused, editor);

  terminal.send("X");

  assertEquals(editor.text, "one two\nthXree four");

  terminal.send(encodeMouse({ action: "wheel", direction: "up", x: 2, y: 1 }));
  terminal.send("Y");

  assertEquals(editor.text, "one two\nthXYree four");
  tui.stop();
});
