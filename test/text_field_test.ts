import { assert, assertEquals } from "@std/assert";
import { CURSOR_MARKER, INVERSE, INVERSE_OFF } from "../src/ansi.ts";
import {
  encodeMouse,
  InputParser,
  type MouseInput,
  TUI,
  VirtualTerminal,
  visibleWidth,
} from "../mod.ts";
import { TextField } from "../src/components/text-field.ts";

const CTRL_LEFT = "\x1b[1;5D";
const CTRL_W = "\x17";
const LEFT = "\x1b[D";
const HOME = "\x1b[H";

/** Feed raw input to the field the way the TUI would. */
function type(field: TextField, input: string): void {
  new InputParser((event) => {
    if (event.type === "key" || event.type === "paste") {
      field.handleInput(event);
    }
  }).feed(input);
}

function paste(field: TextField, text: string): void {
  field.handleInput({ type: "paste", text });
}

function mouse(
  action: MouseInput["action"],
  x: number,
  button: MouseInput["button"] = "left",
): MouseInput {
  return {
    type: "mouse",
    action,
    button,
    x,
    y: 0,
    shift: false,
    alt: false,
    ctrl: false,
  };
}

/** The drawn caret cell: marker plus inverse video. */
const caret = (cell: string) => CURSOR_MARKER + INVERSE + cell + INVERSE_OFF;

Deno.test("a masked field draws one bullet per grapheme and never the value", () => {
  const field = new TextField({ prompt: "> ", mask: true });

  field.setValue("hunter2");

  assertEquals(field.render(20), ["> ••••••• "]);

  field.focused = true;

  assertEquals(field.render(20), ["> •••••••" + caret(" ")]);

  paste(field, " secret\nline");

  assertEquals(field.value, "hunter2 secret line");
  assert(!field.render(40)[0].includes("secret"));
  assert(!field.render(40)[0].includes("hunter"));
});

Deno.test("a mask string picks the character; anything but one single-cell grapheme falls back to the bullet", () => {
  const star = new TextField({ mask: "*" });
  const wide = new TextField({ mask: "日" });
  const long = new TextField({ mask: "ab" });

  for (const field of [star, wide, long]) {
    field.setValue("abc");
  }

  assertEquals(star.render(10), ["*** "]);
  assertEquals(wide.render(10), ["••• "]);
  assertEquals(long.render(10), ["••• "]);
});

Deno.test("setMasked toggles the display and keeps the caret", () => {
  const field = new TextField({ mask: true });

  field.focused = true;
  field.hardwareCursor = true;

  field.setValue("abc");
  type(field, LEFT);

  assertEquals(field.masked, true);
  assertEquals(field.render(10), ["••" + CURSOR_MARKER + "•"]);

  field.setMasked(false);

  assertEquals(field.masked, false);
  assertEquals(field.render(10), ["ab" + CURSOR_MARKER + "c"]);

  field.setMasked(true);

  assertEquals(field.render(10), ["••" + CURSOR_MARKER + "•"]);
  assertEquals(new TextField().masked, false);
});

Deno.test("the caret and scrolling follow the masked width of wide characters", () => {
  const plain = new TextField({ prompt: "> " });
  const masked = new TextField({ prompt: "> ", mask: true });

  for (const field of [plain, masked]) {
    field.focused = true;
    field.hardwareCursor = true;

    field.setValue("日本語");
  }

  // Wide characters: the first one scrolls out to make room for the caret cell.
  assertEquals(plain.render(8), ["> 本語" + CURSOR_MARKER + " "]);
  // Masked: three one-cell bullets fit with the caret.
  assertEquals(masked.render(8), ["> •••" + CURSOR_MARKER + " "]);

  type(masked, LEFT);

  assertEquals(masked.render(8), ["> ••" + CURSOR_MARKER + "•"]);

  masked.setValue("日本語日本語日本語");

  const line = masked.render(8)[0];

  assertEquals(visibleWidth(line), 8);
  assertEquals(line, "> •••••" + CURSOR_MARKER + " ");
});

Deno.test("a masked value is one word: word motion and deletion jump to its ends", () => {
  const field = new TextField({ mask: true });

  type(field, "foo bar/baz");
  type(field, CTRL_LEFT);
  type(field, "X");

  assertEquals(field.value, "Xfoo bar/baz");

  type(field, "\x1b[1;5C");
  type(field, "Y");

  assertEquals(field.value, "Xfoo bar/bazY");

  type(field, LEFT + CTRL_W);

  assertEquals(field.value, "Y");

  field.setMasked(false);
  field.setValue("foo bar");
  type(field, CTRL_LEFT + "X");

  assertEquals(field.value, "foo Xbar");
});

Deno.test("maxLength cuts typing and paste by graphemes", () => {
  const field = new TextField({ maxLength: 4 });
  const changes: string[] = [];

  field.onChange = (value) => changes.push(value);

  type(field, "abcdef");

  assertEquals(field.value, "abcd");
  assertEquals(changes, ["a", "ab", "abc", "abcd"]);

  paste(field, "xyz");

  assertEquals(field.value, "abcd");
  assertEquals(changes.length, 4);

  type(field, "\x7f\x7f");
  paste(field, "123456");

  assertEquals(field.value, "ab12");
});

Deno.test("maxLength counts a multi-codepoint emoji as one", () => {
  const field = new TextField({ maxLength: 2 });

  paste(field, "👍🏽👍🏽👍🏽");

  assertEquals(field.value, "👍🏽👍🏽");

  field.setValue("a👨‍👩‍👧b");

  assertEquals(field.value, "a👨‍👩‍👧");
  assertEquals(new TextField({ maxLength: 0 }).render(5).length, 1);
});

Deno.test("paste turns newlines into spaces and tabs into four", () => {
  const field = new TextField();

  paste(field, "a\r\nb\tc");

  assertEquals(field.value, "a b    c");
});

Deno.test("the placeholder is dim while empty, truncated to the width, and gone once there is text", () => {
  const field = new TextField({ prompt: "> ", placeholder: "type here" });

  assertEquals(field.render(30), [">  \x1b[2mtype here\x1b[22m"]);

  field.focused = true;

  assertEquals(field.render(30), [
    "> " + caret(" ") + "\x1b[2mtype here\x1b[22m",
  ]);
  assertEquals(visibleWidth(field.render(6)[0]) <= 6, true);
  assertEquals(field.render(3)[0].includes("type"), false);

  type(field, "h");

  assertEquals(field.render(30), ["> h" + caret(" ")]);
});

Deno.test("onChange reports edits, not cursor motion, setValue or no-op deletes", () => {
  const field = new TextField();
  const changes: string[] = [];

  field.onChange = (value) => changes.push(value);

  type(field, "ab");
  type(field, "\x7f");
  type(field, HOME + "\x7f");
  type(field, "\x1b[3~");
  field.setValue("zzz");
  paste(field, "!");

  assertEquals(changes, ["a", "ab", "a", "", "zzz!"]);
});

Deno.test("render returns the same array while nothing changed", () => {
  const field = new TextField({ mask: true });

  field.setValue("abc");

  const first = field.render(10);

  assertEquals(field.render(10), first);
  assert(field.render(10) === first);
  assert(field.render(11) !== first);

  const again = field.render(10);

  field.setMasked(false);

  assert(field.render(10) !== again);
});

Deno.test("a click places the caret at the cell, through horizontal scroll", () => {
  const field = new TextField();

  field.setValue("0123456789abcdef");

  // At the end the view starts at "7": "789abcdef" plus the caret cell.
  assertEquals(field.render(10), ["789abcdef "]);
  assertEquals(field.handleMouse(mouse("press", 0)), true);

  type(field, "X");

  assertEquals(field.value, "0123456X789abcdef");

  field.setValue("0123456789abcdef");
  field.render(10);

  assertEquals(field.handleMouse(mouse("press", 8)), true);

  type(field, "X");

  assertEquals(field.value, "0123456789abcdeXf");
});

Deno.test("clicking past the end or on the prompt", () => {
  const field = new TextField({ prompt: "> " });

  field.setValue("abc");
  field.render(20);
  field.handleMouse(mouse("press", 0));
  type(field, "X");

  assertEquals(field.value, "Xabc");

  field.handleMouse(mouse("press", 3));
  type(field, "Y");

  assertEquals(field.value, "XYabc");

  field.handleMouse(mouse("press", 19));
  type(field, "Z");

  assertEquals(field.value, "XYabcZ");
});

Deno.test("clicking a wide character puts the caret before it from either half", () => {
  const field = new TextField();

  field.setValue("a日b");
  field.render(10);

  for (
    const [x, expected] of [[1, "aX日b"], [2, "aX日b"], [3, "a日Xb"], [
      9,
      "a日bX",
    ]] as const
  ) {
    field.setValue("a日b");
    field.render(10);
    field.handleMouse(mouse("press", x));
    type(field, "X");

    assertEquals(field.value, expected);
  }
});

Deno.test("clicking on a masked field maps cells to graphemes", () => {
  const field = new TextField({ mask: true });

  field.setValue("日本語");
  field.render(10);
  field.handleMouse(mouse("press", 1));
  type(field, "X");

  assertEquals(field.value, "日X本語");
});

Deno.test("a click does not scroll the view; dragging past the edges does", () => {
  const field = new TextField();

  field.setValue("0123456789abcdef");

  field.focused = true;
  field.hardwareCursor = true;

  field.render(10);

  field.handleMouse(mouse("press", 3));

  assertEquals(field.render(10), ["789" + CURSOR_MARKER + "abcdef"]);

  field.handleMouse(mouse("drag", -4));

  assertEquals(field.render(10), [CURSOR_MARKER + "6789abcdef"]);

  field.handleMouse(mouse("drag", 30));

  assertEquals(field.render(10), ["789abcdef" + CURSOR_MARKER + " "]);
});

Deno.test("only left press and drag are handled", () => {
  const field = new TextField();

  field.setValue("abc");
  field.render(10);

  assertEquals(field.handleMouse(mouse("press", 0, "right")), false);
  assertEquals(field.handleMouse(mouse("wheel", 0, "none")), false);
  assertEquals(field.handleMouse(mouse("move", 0, "none")), false);
  assertEquals(field.handleMouse(mouse("release", 0)), false);

  type(field, "X");

  assertEquals(field.value, "abcX");
});

Deno.test("clicking in the TUI focuses the field and moves its caret", () => {
  const terminal = new VirtualTerminal(20, 4);
  const tui = new TUI(terminal, { mouse: "click" });
  const first = new TextField({ prompt: "1> " });
  const second = new TextField({ prompt: "2> " });

  first.setValue("hello");
  second.setValue("world");
  tui.addChild(first);
  tui.addChild(second);
  tui.start();
  tui.renderNow();

  terminal.send(encodeMouse({ action: "press", x: 5, y: 1 }));

  assertEquals(tui.focused, second);

  terminal.send("X");

  assertEquals(second.value, "woXrld");

  terminal.send(encodeMouse({ action: "press", x: 4, y: 0 }));

  assertEquals(tui.focused, first);

  terminal.send("Y");
  tui.renderNow();

  assertEquals(first.value, "hYello");
  assertEquals(terminal.viewport().slice(0, 2), ["1> hYello", "2> woXrld"]);
  tui.stop();
});

Deno.test("custom keys replace the default bindings of an action", () => {
  const submitted: string[] = [];
  const field = new TextField({
    keys: { home: ["ctrl+q"], submit: ["ctrl+s"] },
  });

  field.onSubmit = (value) => submitted.push(value);

  type(field, "abc");
  type(field, HOME);
  type(field, "x");

  assertEquals(field.value, "abcx");

  type(field, "\x11");
  type(field, "y");

  assertEquals(field.value, "yabcx");

  type(field, "\r");

  assertEquals(submitted, []);

  type(field, "\x13");

  assertEquals(submitted, ["yabcx"]);
});

Deno.test("theme and glyphs reach the rendered row, setTheme changes the next one", () => {
  const field = new TextField({
    prompt: "> ",
    placeholder: "name",
    theme: { prompt: { bold: true }, placeholder: { fg: "red" } },
    glyphs: { caret: "_" },
  });

  field.focused = true;

  assertEquals(field.render(20), [
    "\x1b[1m> \x1b[22m" + CURSOR_MARKER + INVERSE + "_" + INVERSE_OFF +
    "\x1b[31mname\x1b[39m",
  ]);

  field.setTheme({ caret: { bg: "blue" } });

  assertEquals(field.render(20), [
    "\x1b[1m> \x1b[22m" + CURSOR_MARKER + "\x1b[44m_\x1b[49m" +
    "\x1b[31mname\x1b[39m",
  ]);
});
