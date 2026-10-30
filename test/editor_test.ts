import { assert, assertEquals } from "@std/assert";
import { CURSOR_MARKER, INVERSE } from "../src/ansi.ts";
import { parseKey, visibleWidth } from "../mod.ts";
import { Editor, EDITOR_GLYPHS } from "../src/components/editor.ts";

const ENTER = "\r";
const SHIFT_ENTER = "\x1b[13;2u";
const ALT_ENTER = "\x1b\r";
const CTRL_J = "\n";
const BACKSPACE = "\x7f";
const DELETE = "\x1b[3~";
const UP = "\x1b[A";
const DOWN = "\x1b[B";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const CTRL_Z = "\x1a";
const CTRL_UNDERSCORE = "\x1f";
const CTRL_MINUS_KITTY = "\x1b[45;5u";
const CTRL_W = "\x17";
const CTRL_U = "\x15";
const CTRL_K = "\x0b";
const ALT_B = "\x1bb";
const ALT_D = "\x1bd";
const HOME = "\x1b[H";
const END = "\x1b[F";

/** Feed raw key sequences; a sequence of more than one code point that is not an escape is typed char by char. */
function press(editor: Editor, ...sequences: string[]): void {
  for (const sequence of sequences) {
    if (sequence.startsWith("\x1b") || sequence.length === 1) {
      editor.handleInput({ type: "key", key: parseKey(sequence) });
    } else {
      for (const char of sequence) {
        editor.handleInput({ type: "key", key: parseKey(char) });
      }
    }
  }
}

function paste(editor: Editor, text: string): void {
  editor.handleInput({ type: "paste", text });
}

function strip(row: string): string {
  // deno-lint-ignore no-control-regex
  return row.replaceAll(CURSOR_MARKER, "").replace(/\x1b\[[0-9;]*m/g, "");
}

function plain(editor: Editor, width: number): string[] {
  return editor.render(width).map(strip);
}

function newEditor(options: ConstructorParameters<typeof Editor>[0] = {}) {
  const editor = new Editor({ border: false, ...options });

  editor.focused = true;

  return editor;
}

Deno.test("newline via shift+enter, alt+enter, ctrl+j and backslash+enter", () => {
  const editor = newEditor();

  press(
    editor,
    "a",
    SHIFT_ENTER,
    "b",
    ALT_ENTER,
    "c",
    CTRL_J,
    "d",
    "\\",
    ENTER,
    "e",
  );
  assertEquals(editor.text, "a\nb\nc\nd\ne");
});

Deno.test("backslash is removed when Enter turns it into a newline", () => {
  const editor = newEditor();
  let submitted = 0;

  editor.onSubmit = () => submitted++;

  press(editor, "a", "\\", ENTER);
  assertEquals(editor.text, "a\n");
  assertEquals(submitted, 0);
});

Deno.test("Enter submits the text and disableSubmit suppresses it", () => {
  const editor = newEditor();
  const submitted: string[] = [];

  editor.onSubmit = (text) => submitted.push(text);

  press(editor, "h", "i", SHIFT_ENTER, "x", ENTER);
  assertEquals(submitted, ["hi\nx"]);

  editor.disableSubmit = true;

  press(editor, ENTER);
  assertEquals(submitted, ["hi\nx"]);

  editor.disableSubmit = false;

  editor.setText("");
  assertEquals(editor.text, "");
  press(editor, "z", ENTER);
  assertEquals(submitted, ["hi\nx", "z"]);
});

Deno.test("backspace at column 0 joins with the previous line, delete at end joins the next", () => {
  const editor = newEditor();

  editor.setText("ab\ncd");
  press(editor, LEFT, LEFT, BACKSPACE);
  assertEquals(editor.text, "abcd");
  editor.setText("ab\ncd");
  press(editor, UP, END, DELETE);
  assertEquals(editor.text, "abcd");
});

Deno.test("line and word deletion", () => {
  const editor = newEditor();

  editor.setText("one two\nthree four");
  press(editor, CTRL_W);
  assertEquals(editor.text, "one two\nthree ");
  press(editor, CTRL_U);
  assertEquals(editor.text, "one two\n");
  press(editor, CTRL_W);
  assertEquals(editor.text, "one two");
  press(editor, ALT_B, ALT_D);
  assertEquals(editor.text, "one ");
  editor.setText("ab\ncd");
  press(editor, UP, HOME, RIGHT, CTRL_K);
  assertEquals(editor.text, "a\ncd");
  press(editor, CTRL_K);
  assertEquals(editor.text, "acd");
});

Deno.test("up/down move across wrapped rows keeping the preferred column", () => {
  const editor = newEditor();

  editor.setText("abcdefghij klm\nxy\nabcdefghij");
  assertEquals(plain(editor, 6), [
    "abcdef",
    "ghij ",
    "klm",
    "xy",
    "abcdef",
    "ghij ",
  ]);
  // Cursor is at column 4 of the last row. The short rows clamp it, but the
  // preferred column is remembered.
  press(editor, UP, UP, UP, UP);
  press(editor, "!");
  assertEquals(editor.text, "abcdefghij! klm\nxy\nabcdefghij");
});

Deno.test("preferred column survives a short row", () => {
  const editor = newEditor();

  editor.setText("abcdef\nxy\nabcdef");
  editor.render(20);
  press(editor, UP, UP);
  // cursor was at column 6 on the last line; short middle row clamps, top restores
  press(editor, "!");
  assertEquals(editor.text, "abcdef!\nxy\nabcdef");
  press(editor, DOWN, DOWN, "?");
  assertEquals(editor.text, "abcdef!\nxy\nabcdef?");
});

Deno.test("history recall walks back, forward, and restores the draft", () => {
  const editor = newEditor();

  editor.addToHistory("first");
  editor.addToHistory("second");
  editor.addToHistory("second");
  editor.addToHistory("");
  press(editor, "d", "r", "a", "f", "t");
  editor.render(20);
  press(editor, UP);
  assertEquals(editor.text, "second");
  press(editor, UP);
  assertEquals(editor.text, "first");
  press(editor, UP);
  assertEquals(editor.text, "first");
  press(editor, DOWN);
  assertEquals(editor.text, "second");
  press(editor, DOWN);
  assertEquals(editor.text, "draft");
  press(editor, DOWN);
  assertEquals(editor.text, "draft");
});

Deno.test("up inside multi-line text moves the cursor instead of recalling history", () => {
  const editor = newEditor();

  editor.addToHistory("old");
  editor.setText("a\nb");
  editor.render(20);
  press(editor, UP);
  assertEquals(editor.text, "a\nb");
  press(editor, UP);
  assertEquals(editor.text, "old");
});

Deno.test("undo restores text and cursor after typing, coalescing the run", () => {
  const editor = newEditor();

  press(editor, "a", "b", "c", SHIFT_ENTER, "d", "e");
  press(editor, CTRL_Z);
  assertEquals(editor.text, "abc\n");
  press(editor, CTRL_UNDERSCORE);
  assertEquals(editor.text, "abc");
  press(editor, CTRL_MINUS_KITTY);
  assertEquals(editor.text, "");
  press(editor, CTRL_Z);
  assertEquals(editor.text, "");
});

Deno.test("undo after paste removes the whole paste and restores the cursor", () => {
  const editor = newEditor();

  press(editor, "a", "b", LEFT);
  paste(editor, "X\r\nY\tZ\rW");
  assertEquals(editor.text, "aX\nY    Z\nWb");
  press(editor, CTRL_Z);
  assertEquals(editor.text, "ab");
  press(editor, "!");
  assertEquals(editor.text, "a!b");
});

Deno.test("paste of multi-line text renders one row per line", () => {
  const editor = newEditor();

  paste(editor, "one\ntwo\nthree");
  assertEquals(plain(editor, 20), ["one", "two", "three "]);
});

Deno.test("every row fits the width, including wide and combining text", () => {
  const texts = [
    "hello world this is a long line of words that wraps",
    "日本語のテキストはセル幅二で折り返される\n漢字 and ascii mixed",
    "supercalifragilisticexpialidocious-and-more",
    "e\u0301e\u0301e\u0301 👨‍👩‍👧 emoji 🎉 flags 🇯🇵",
    "",
  ];

  for (const text of texts) {
    for (const width of [2, 3, 5, 8, 13, 40]) {
      for (const focused of [true, false]) {
        const editor = new Editor({ maxHeight: 4 });

        editor.focused = focused;

        editor.setText(text);

        for (const row of editor.render(width)) {
          assert(
            visibleWidth(row) <= width,
            `width ${width}: ${JSON.stringify(row)} is ${
              visibleWidth(row)
            } wide`,
          );
        }
      }
    }
  }
});

Deno.test("a cursor at the end of an exactly full row wraps to a visible row", () => {
  const editor = newEditor();

  editor.setText("abcd");

  const rows = editor.render(4);

  assertEquals(rows.map(strip), ["abcd", " "]);
  assert(rows[1].includes(CURSOR_MARKER));
  press(editor, LEFT);
  assertEquals(editor.render(4).map(strip), ["abcd"]);
});

Deno.test("CURSOR_MARKER appears exactly once when focused and never when not", () => {
  for (
    const text of [
      "",
      "abc",
      "ab\ncd",
      "日本語日本語",
      "a long line that wraps around",
    ]
  ) {
    const editor = new Editor({ placeholder: "type here" });

    editor.setText(text);

    editor.focused = true;

    const count = editor.render(8).join("\n").split(CURSOR_MARKER).length - 1;

    assertEquals(count, 1, JSON.stringify(text));

    editor.focused = false;

    assertEquals(editor.render(8).join("").includes(CURSOR_MARKER), false);
  }
});

Deno.test("caret is inverse video unless the hardware cursor is used", () => {
  const editor = newEditor();

  editor.setText("ab");
  press(editor, LEFT);
  assert(editor.render(10)[0].includes(`${CURSOR_MARKER}${INVERSE}b`));

  editor.hardwareCursor = true;

  const row = editor.render(10)[0];

  assert(row.includes(`${CURSOR_MARKER}b`));
  assertEquals(row.includes(INVERSE), false);
});

Deno.test("placeholder is dim while empty and gone once text exists", () => {
  const editor = new Editor({ placeholder: "ask me", border: false });

  assertEquals(plain(editor, 20), ["ask me"]);
  assert(editor.render(20)[0].includes("\x1b[2m"));

  editor.focused = true;

  assertEquals(plain(editor, 20), [" ask me"]);
  press(editor, "x");
  assertEquals(plain(editor, 20), ["x "]);
});

Deno.test("borders are full-width rules painted with the border theme", () => {
  const editor = new Editor({ theme: { border: { fg: "red" } } });

  editor.setText("hi");

  const rows = editor.render(5);
  const rule = "\x1b[31m─────\x1b[39m";

  assertEquals(rows.length, 3);
  assertEquals(rows[0], rule);
  assertEquals(rows[2], rule);

  editor.setTheme({ border: { fg: "blue" } });

  assertEquals(editor.render(5)[0], "\x1b[34m─────\x1b[39m");
});

Deno.test("scroll indicators show hidden rows and follow the cursor", () => {
  const editor = new Editor({ maxHeight: 3 });

  editor.focused = true;

  editor.setText("1\n2\n3\n4\n5\n6");

  let rows = plain(editor, 20);

  assertEquals(rows.length, 5);
  assert(rows[0].includes("↑ 3 more"), rows[0]);
  assertEquals(rows.slice(1, 4), ["4", "5", "6 "]);
  assertEquals(rows[4], "─".repeat(20));
  press(editor, UP, UP, UP, UP, UP);

  rows = plain(editor, 20);

  assertEquals(rows[0], "─".repeat(20));
  assertEquals(rows.slice(1, 4), ["1 ", "2", "3"]);
  assert(rows[4].includes("↓ 3 more"), rows[4]);
  press(editor, DOWN, DOWN, DOWN);

  rows = plain(editor, 20);

  assert(rows[0].includes("↑ 1 more"), rows[0]);
  assert(rows[4].includes("↓ 2 more"), rows[4]);
  assertEquals(rows.slice(1, 4), ["2", "3", "4 "]);
});

Deno.test("scroll indicator is truncated to fit narrow borders", () => {
  for (const width of [1, 2, 4, 6, 12]) {
    const editor = new Editor({ maxHeight: 1 });

    editor.focused = true;

    editor.setText("a\nb\nc");
    editor.render(width);
    press(editor, UP);

    const rows = editor.render(width);

    assertEquals(rows.length, 3);
    assertEquals(visibleWidth(rows[0]), width, JSON.stringify(rows[0]));
    assertEquals(visibleWidth(rows[2]), width, JSON.stringify(rows[2]));
    assert(strip(rows[0]).startsWith("─"));
  }
});

Deno.test("render returns the same rows until something visible changes", () => {
  const editor = newEditor();

  editor.setText("abc");

  const first = editor.render(10);

  assert(editor.render(10) === first);
  assert(editor.render(11) !== first);

  const second = editor.render(11);

  press(editor, LEFT);

  const third = editor.render(11);

  assert(third !== second);
  assert(editor.render(11) === third);

  editor.focused = false;

  assert(editor.render(11) !== third);
});

Deno.test("word navigation crosses line boundaries", () => {
  const editor = newEditor();

  editor.setText("foo bar\nbaz");
  press(editor, ALT_B, ALT_B, "|");
  assertEquals(editor.text, "foo bar|\nbaz");
  press(editor, ALT_B, "^");
  assertEquals(editor.text, "foo ^bar|\nbaz");
});

Deno.test("custom keys replace the default bindings of an action", () => {
  const submitted: string[] = [];
  const editor = newEditor({
    keys: { submit: ["ctrl+s"], newline: ["enter"], left: ["ctrl+b"] },
  });

  editor.onSubmit = (text) => submitted.push(text);

  press(editor, "a", ENTER, "b");

  assertEquals(editor.text, "a\nb");

  press(editor, LEFT, "x");

  assertEquals(editor.text, "a\nbx");

  press(editor, "\x02", "y");

  assertEquals(editor.text, "a\nbyx");

  press(editor, "\x13");

  assertEquals(submitted, ["a\nbyx"]);
});

Deno.test("theme, glyphs and labels reach the rendered rules and text", () => {
  const editor = newEditor({
    border: true,
    maxHeight: 1,
    theme: {
      text: { fg: "green" },
      caret: { bg: "red" },
      label: { fg: "yellow" },
    },
    glyphs: EDITOR_GLYPHS.ascii,
    labels: { below: (count) => ` ${count} below ` },
  });

  editor.setText("a\nb\nc");

  const rows = editor.render(20);

  assert(rows[0].startsWith("-\x1b[33m ^ 2 more \x1b[39m-"), rows[0]);
  assert(rows[1].startsWith("\x1b[32mc\x1b[39m"), rows[1]);
  assert(rows[1].includes("\x1b[32;41m \x1b[39;49m"), rows[1]);
  assertEquals(rows[2], "-".repeat(20));

  press(editor, UP, UP);

  assert(editor.render(20)[2].includes("\x1b[33m 2 below \x1b[39m"));
});
