import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  encodeMouse,
  InputParser,
  type MouseAction,
  type MouseInput,
  TUI,
  VirtualTerminal,
  visibleWidth,
} from "../mod.ts";
import { Button, BUTTON_GLYPHS, ButtonRow } from "../src/components/button.ts";

// deno-lint-ignore no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;:]*m/g, "");

function mouse(
  action: MouseAction,
  x: number,
  y = 0,
  button: MouseInput["button"] = action === "move" ? "none" : "left",
): MouseInput {
  return {
    type: "mouse",
    action,
    button,
    x,
    y,
    shift: false,
    alt: false,
    ctrl: false,
  };
}

function keys(target: Button | ButtonRow, input: string): void {
  new InputParser((event) => {
    if (event.type === "key" || event.type === "paste") {
      target.handleInput(event);
    }
  }).feed(input);
}

Deno.test("a button centres its label with one space on each side and honours a minimum width", () => {
  assertEquals(new Button("OK").render(20).map(strip), [" OK "]);
  assertEquals(new Button("OK", { width: 8 }).render(20).map(strip), [
    "   OK   ",
  ]);
  assertEquals(new Button("a\nb\tc").render(20).map(strip), [" a b c "]);
  assertEquals(new Button("OK").naturalWidth, 4);
});

Deno.test("a button never exceeds the width it is given", () => {
  const button = new Button("Confirm");

  for (let width = 0; width <= 12; width++) {
    const row = button.render(width)[0] ?? "";

    assert(visibleWidth(row) <= width, `width ${width}`);
  }

  assertEquals(strip(button.render(5)[0]), " Con…");
});

Deno.test("a button returns the same rows while nothing changed", () => {
  const button = new Button("OK");
  const first = button.render(10);

  assert(button.render(10) === first);

  button.setLabel("Done");

  assertNotEquals(button.render(10), first);
  assertEquals(button.render(10).map(strip), [" Done "]);
});

Deno.test("Enter and Space press a button; other keys and a disabled button do nothing", () => {
  let pressed = 0;
  const button = new Button("OK", { onPress: () => pressed++ });

  keys(button, "\r");
  keys(button, " ");
  keys(button, "a");
  keys(button, "\x1b[C");

  assertEquals(pressed, 2);

  button.disabled = true;

  keys(button, "\r");

  assertEquals(pressed, 2);
});

Deno.test("a left release over the button after a press on it presses it", () => {
  let pressed = 0;
  const button = new Button("OK", { onPress: () => pressed++ });
  const rest = button.render(10)[0];

  assertEquals(button.handleMouse(mouse("press", 1)), true);
  assertEquals(pressed, 0);
  // Pressed look between press and release.
  assertNotEquals(button.render(10)[0], rest);
  assertEquals(button.handleMouse(mouse("release", 1)), true);
  assertEquals(pressed, 1);
  assertEquals(button.render(10)[0], rest);
});

Deno.test("moving off the button before releasing cancels the press; moving back re-arms it", () => {
  let pressed = 0;
  const button = new Button("OK", { onPress: () => pressed++ });
  const rest = button.render(10)[0];

  button.handleMouse(mouse("press", 1));
  button.handleMouse(mouse("drag", 6));

  assertEquals(button.render(10)[0], rest);

  button.handleMouse(mouse("release", 6));

  assertEquals(pressed, 0);

  button.handleMouse(mouse("press", 2));
  button.handleMouse(mouse("drag", 2, 3));
  button.handleMouse(mouse("drag", 3));

  assertNotEquals(button.render(10)[0], rest);

  button.handleMouse(mouse("release", 3));

  assertEquals(pressed, 1);
});

Deno.test("only a left press on the button arms it; a stray release does nothing", () => {
  let pressed = 0;
  const button = new Button("OK", { onPress: () => pressed++ });

  assertEquals(button.handleMouse(mouse("press", 1, 0, "right")), false);
  assertEquals(button.handleMouse(mouse("press", 4)), false);
  assertEquals(button.handleMouse(mouse("press", 1, 1)), false);
  assertEquals(button.handleMouse(mouse("release", 1)), false);
  assertEquals(pressed, 0);
});

Deno.test("a disabled button ignores the mouse and looks different", () => {
  let pressed = 0;
  const button = new Button("OK", { onPress: () => pressed++ });
  const enabled = button.render(10)[0];

  button.disabled = true;

  assertEquals(button.handleMouse(mouse("press", 1)), false);
  assertEquals(button.handleMouse(mouse("release", 1)), false);
  assertEquals(button.handleMouse(mouse("move", 1)), false);
  assertEquals(pressed, 0);
  assertNotEquals(button.render(10)[0], enabled);
  assertEquals(strip(button.render(10)[0]), " OK ");

  button.disabled = false;

  assertEquals(button.render(10)[0], enabled);
});

Deno.test("hover paints the button on move and clears on leave", () => {
  const button = new Button("OK");
  const rest = button.render(10)[0];

  assertEquals(button.handleMouse(mouse("move", 2)), true);

  const hover = button.render(10)[0];

  assertNotEquals(hover, rest);
  assertEquals(button.handleMouse(mouse("move", 9)), false);
  assertEquals(button.render(10)[0], rest);

  button.handleMouse(mouse("move", 0));
  button.handleMouse(mouse("leave", 0, 0, "none"));

  assertEquals(button.render(10)[0], rest);
});

Deno.test("focused, hovered and pressed buttons each look different, and a theme overrides one state", () => {
  const button = new Button("OK");
  const looks = new Set<string>();

  looks.add(button.render(10)[0]);

  button.focused = true;

  looks.add(button.render(10)[0]);
  button.handleMouse(mouse("move", 1));
  looks.add(button.render(10)[0]);
  button.handleMouse(mouse("press", 1));
  looks.add(button.render(10)[0]);

  assertEquals(looks.size, 4);

  const themed = new Button("OK", { theme: { hover: { bg: "#ff0000" } } });

  themed.handleMouse(mouse("move", 1));

  assert(themed.render(10)[0].includes("48;2;255;0;0"));
});

Deno.test("variants have their own colours", () => {
  const rows = (["default", "primary", "danger"] as const).map((variant) =>
    new Button("OK", { variant }).render(10)[0]
  );

  assertEquals(new Set(rows).size, 3);
});

Deno.test("a click through the TUI focuses and presses the button; moving off cancels", () => {
  const terminal = new VirtualTerminal(20, 3);
  const tui = new TUI(terminal, { mouse: "drag" });
  let pressed = 0;
  const button = new Button("OK", { onPress: () => pressed++ });

  tui.addChild(button);
  tui.start();
  tui.renderNow();

  terminal.send(encodeMouse({ action: "press", x: 1, y: 0 }));

  assertEquals(tui.focused, button);

  terminal.send(encodeMouse({ action: "release", x: 1, y: 0 }));

  assertEquals(pressed, 1);

  terminal.send(encodeMouse({ action: "press", x: 1, y: 0 }));
  terminal.send(encodeMouse({ action: "drag", x: 12, y: 0 }));
  terminal.send(encodeMouse({ action: "release", x: 12, y: 0 }));

  assertEquals(pressed, 1);
  tui.stop();
});

Deno.test("hover reaches a button in mouse mode move and leave follows the pointer", () => {
  const terminal = new VirtualTerminal(20, 3);
  const tui = new TUI(terminal, { mouse: "move" });
  const button = new Button("OK");

  tui.addChild(button);
  tui.start();
  tui.renderNow();

  const rest = button.render(20)[0];

  terminal.send(encodeMouse({ action: "move", x: 1, y: 0 }));

  assertNotEquals(button.render(20)[0], rest);

  terminal.send(encodeMouse({ action: "move", x: 15, y: 0 }));

  assertEquals(button.render(20)[0], rest);

  terminal.send(encodeMouse({ action: "move", x: 1, y: 0 }));
  terminal.send(encodeMouse({ action: "move", x: 1, y: 2 }));
  tui.stop();
});

function row(align?: "left" | "center" | "right", gap?: number) {
  const log: string[] = [];
  const buttons = ["Yes", "No", "Cancel"].map((label) =>
    new Button(label, { onPress: () => log.push(label) })
  );

  return { log, buttons, row: new ButtonRow(buttons, { align, gap }) };
}

Deno.test("a button row lays buttons out with a gap and alignment", () => {
  assertEquals(row().row.render(30).map(strip), [" Yes    No    Cancel "]);
  assertEquals(row("left", 1).row.render(30).map(strip), [
    " Yes   No   Cancel ",
  ]);
  assertEquals(row("right").row.render(30).map(strip), [
    "          Yes    No    Cancel ",
  ]);
  assertEquals(row("center").row.render(30).map(strip), [
    "     Yes    No    Cancel ",
  ]);
});

Deno.test("buttons that do not fit are dropped from the end, and the row never exceeds its width", () => {
  const { row: r } = row();

  assertEquals(r.render(16).map(strip), [" Yes    No "]);
  assertEquals(r.visibleCount, 2);
  assertEquals(r.render(10).map(strip), [" Yes "]);
  assertEquals(r.visibleCount, 1);
  assertEquals(r.render(3).map(strip), [" Y…"]);

  for (let width = 0; width <= 30; width++) {
    assert(visibleWidth(r.render(width)[0] ?? "") <= width, `width ${width}`);
  }

  assertEquals(r.render(30).map(strip), [" Yes    No    Cancel "]);
  assertEquals(r.visibleCount, 3);
});

Deno.test("a button row returns the same rows while nothing changed", () => {
  const { row: r, buttons } = row();
  const first = r.render(30);

  assert(r.render(30) === first);

  buttons[0].setLabel("Sure");
  buttons[0].invalidate();

  assertNotEquals(r.render(30), first);
});

Deno.test("the mouse reaches the button under the pointer in its own cells", () => {
  const { row: r, log } = row();

  r.render(30);

  // Gap cells and cells past the last button are not buttons.
  assertEquals(r.handleMouse(mouse("press", 5)), false);
  assertEquals(r.handleMouse(mouse("press", 25)), false);
  assertEquals(r.handleMouse(mouse("press", 0, 1)), false);

  // " Yes " occupies 0-4, " No " 7-10, " Cancel " 13-20.
  assertEquals(r.handleMouse(mouse("press", 8)), true);
  assertEquals(r.selected, 1);
  // The release is delivered to the button directly by the TUI.
  r.buttons[1].handleMouse(mouse("release", 1));

  assertEquals(log, ["No"]);
});

Deno.test("a click on a right-aligned row hits the shifted buttons; dropped ones are unreachable", () => {
  const { row: r, log } = row("right");

  r.render(30);

  // Shifted by 30 - 21 = 9: " Yes " 9-13.
  assertEquals(r.handleMouse(mouse("press", 3)), false);
  assertEquals(r.handleMouse(mouse("press", 10)), true);
  r.buttons[0].handleMouse(mouse("release", 1));

  assertEquals(log, ["Yes"]);

  // 16 cells hold two buttons (11 cells) shifted by 5: " Yes " 5-9, " No " 12-15.
  r.render(16);

  assertEquals(r.handleMouse(mouse("press", 13)), true);
  assertEquals(r.selected, 1);
  assertEquals(r.handleMouse(mouse("press", 3)), false);

  const narrow = row().row;

  // At 10 cells only " Yes " fits; " No " would have been at 7-10.
  narrow.render(10);

  assertEquals(narrow.handleMouse(mouse("press", 8)), false);
});

Deno.test("hover moves between the buttons of a row", () => {
  const { row: r, buttons } = row();

  r.render(30);

  const rest = buttons[0].render(5)[0];

  assertEquals(r.handleMouse(mouse("move", 2)), true);
  assertNotEquals(buttons[0].render(5)[0], rest);
  // The TUI sends leave to the previous hover target when the pointer moves on.
  buttons[0].handleMouse(mouse("leave", 0, 0, "none"));

  assertEquals(buttons[0].render(5)[0], rest);
  assertEquals(r.handleMouse(mouse("move", 5)), false);
});

Deno.test("a focused row moves its selection with arrows and Tab, and Enter or Space presses it", () => {
  const { row: r, log } = row();

  r.focused = true;

  const selection = () => r.render(30)[0];
  const first = selection();

  keys(r, "\r");

  assertEquals(log, ["Yes"]);

  keys(r, "\x1b[C");

  assertEquals(r.selected, 1);
  assertNotEquals(selection(), first);

  keys(r, " ");
  keys(r, "\t");

  assertEquals(r.selected, 2);

  keys(r, "\t");

  assertEquals(r.selected, 0);

  keys(r, "\x1b[Z");

  assertEquals(r.selected, 2);

  keys(r, "\x1b[D");
  keys(r, "\r");

  assertEquals(log, ["Yes", "No", "No"]);
});

Deno.test("selection skips disabled buttons and stays among visible ones", () => {
  const { row: r, buttons } = row();

  r.focused = true;
  buttons[1].disabled = true;

  r.render(30);
  keys(r, "\x1b[C");

  assertEquals(r.selected, 2);

  r.render(10);
  keys(r, "\x1b[D");

  assertEquals(r.selected, 0);
});

Deno.test("an unfocused row looks different from a focused one", () => {
  const { row: r } = row();
  const rest = r.render(30)[0];

  r.focused = true;

  assertNotEquals(r.render(30)[0], rest);

  r.focused = false;

  assertEquals(r.render(30)[0], rest);
});

Deno.test("button glyphs frame the label, fill the width and mark a cut", () => {
  const brackets = new Button("OK", { glyphs: BUTTON_GLYPHS.brackets });

  assertEquals(brackets.naturalWidth, 6);
  assertEquals(brackets.render(20).map(strip), ["[ OK ]"]);

  const filled = new Button("OK", { width: 8, glyphs: { fill: "·" } });

  assertEquals(filled.render(20).map(strip), ["·· OK ··"]);
  assertEquals(
    new Button("Confirm", { glyphs: { ellipsis: "~" } }).render(3).map(strip),
    [" C~"],
  );
});

Deno.test("button keys replace the defaults", () => {
  let pressed = 0;
  const button = new Button("OK", {
    onPress: () => pressed++,
    keys: { press: ["x"] },
  });

  keys(button, "\r");
  keys(button, " ");

  assertEquals(pressed, 0);

  keys(button, "x");

  assertEquals(pressed, 1);
});

Deno.test("setTheme changes the next render of a button and keeps the other states", () => {
  const button = new Button("OK");

  assertEquals(button.render(10)[0].includes("48;2;255;0;0"), false);

  button.setTheme({ normal: { bg: "#ff0000" } });

  assert(button.render(10)[0].includes("48;2;255;0;0"));

  button.handleMouse(mouse("move", 1));

  // The default hover paint still layers over the new normal paint.
  assertNotEquals(button.render(10)[0], new Button("OK").render(10)[0]);
});

Deno.test("a button row draws its separator glyph in the gap, with its own paint", () => {
  const { row: r } = row();
  const dotted = new ButtonRow(r.buttons, {
    glyphs: { separator: "·" },
    theme: { separator: { fg: "#ff0000" } },
  });

  assertEquals(dotted.render(30).map(strip), [" Yes ·· No ·· Cancel "]);
  assert(dotted.render(30)[0].includes("38;2;255;0;0"));

  dotted.setTheme({ separator: { fg: "#00ff00" } });

  assert(dotted.render(30)[0].includes("38;2;0;255;0"));
});

Deno.test("button row keys replace the defaults per action", () => {
  const { buttons, log } = row();
  const r = new ButtonRow(buttons, {
    keys: { next: ["j"], previous: ["k"], press: ["x"] },
  });

  r.focused = true;

  r.render(30);

  keys(r, "\t");
  keys(r, "\x1b[C");
  keys(r, "\r");

  assertEquals(r.selected, 0);
  assertEquals(log, []);

  keys(r, "j");

  assertEquals(r.selected, 1);

  keys(r, "x");

  assertEquals(log, ["No"]);

  keys(r, "k");

  assertEquals(r.selected, 0);
});
