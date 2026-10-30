import { assertEquals, assertThrows } from "@std/assert";
import { type Component, TextField, TUI, VirtualTerminal } from "../mod.ts";

class Lines implements Component {
  public constructor(public lines: readonly string[]) {}
  public render(): readonly string[] {
    return this.lines;
  }
}

function setup(columns: number, rows: number, lines: string[]) {
  const terminal = new VirtualTerminal(columns, rows);
  const content = new Lines(lines);
  const tui = new TUI(terminal);

  tui.addChild(content);
  tui.start();
  tui.renderNow();

  return { terminal, content, tui };
}

/** Everything the user can see by scrolling: native scrollback followed by the screen, without trailing blank rows. */
function transcript(terminal: VirtualTerminal): string[] {
  const all = [...terminal.scrollback(), ...terminal.viewport()];

  while (all.length > 0 && all[all.length - 1] === "") {
    all.pop();
  }

  return all;
}

const FULL_CLEAR = "\x1b[2J";

Deno.test("first paint starts below existing shell output", () => {
  const terminal = new VirtualTerminal(20, 5);

  terminal.write("$ flow\r\n");

  const tui = new TUI(terminal);

  tui.addChild(new Lines(["one", "two"]));
  tui.start();
  tui.renderNow();
  assertEquals(terminal.viewport(), ["$ flow", "one", "two", "", ""]);
  tui.stop();
});

Deno.test("changing a visible row rewrites in place without clearing the screen", () => {
  const { terminal, content, tui } = setup(20, 5, ["a", "b", "c"]);
  const writes = terminal.writes.length;

  content.lines = ["a", "B!", "c"];

  tui.renderNow();
  assertEquals(terminal.viewport(), ["a", "B!", "c", "", ""]);

  const frame = terminal.writes.slice(writes).join("");

  assertEquals(frame.includes(FULL_CLEAR), false);
  assertEquals(frame.includes("a"), false, "unchanged rows are not rewritten");
  tui.stop();
});

Deno.test("an unchanged frame writes nothing", () => {
  const { terminal, content, tui } = setup(20, 5, ["a", "b"]);
  const writes = terminal.writes.length;

  content.lines = ["a", "b"];

  tui.renderNow();
  assertEquals(terminal.writes.length, writes);
  tui.stop();
});

Deno.test("removed rows are erased and appended rows extend the content", () => {
  const { terminal, content, tui } = setup(20, 6, ["a", "b", "c", "d"]);

  content.lines = ["a", "x"];

  tui.renderNow();
  assertEquals(terminal.viewport(), ["a", "x", "", "", "", ""]);

  content.lines = ["a", "x", "y", "z"];

  tui.renderNow();
  assertEquals(terminal.viewport(), ["a", "x", "y", "z", "", ""]);

  content.lines = [];

  tui.renderNow();
  assertEquals(terminal.viewport(), ["", "", "", "", "", ""]);

  content.lines = ["again"];

  tui.renderNow();
  assertEquals(terminal.viewport(), ["again", "", "", "", "", ""]);
  tui.stop();
});

Deno.test("content taller than the screen scrolls into native scrollback", () => {
  const rows = Array.from({ length: 8 }, (_, i) => `row ${i}`);
  const { terminal, content, tui } = setup(20, 4, rows);

  assertEquals(terminal.viewport(), ["row 4", "row 5", "row 6", "row 7"]);
  assertEquals(terminal.scrollback(), ["row 0", "row 1", "row 2", "row 3"]);

  // Growing and editing visible rows keeps history and uses the diff path.
  const writes = terminal.writes.length;

  content.lines = [...rows.slice(0, 6), "ROW 6", "row 7", "row 8", "row 9"];

  tui.renderNow();
  assertEquals(
    terminal.writes.slice(writes).join("").includes(FULL_CLEAR),
    false,
  );
  assertEquals(transcript(terminal), content.lines);
  tui.stop();
});

Deno.test("a change above the viewport triggers a full repaint with correct history", () => {
  const rows = Array.from({ length: 8 }, (_, i) => `row ${i}`);
  const { terminal, content, tui } = setup(20, 4, rows);
  const writes = terminal.writes.length;

  content.lines = ["ROW 0", ...rows.slice(1, 7)];

  tui.renderNow();
  assertEquals(
    terminal.writes.slice(writes).join("").includes(FULL_CLEAR),
    true,
  );
  assertEquals(transcript(terminal), content.lines);
  tui.stop();
});

Deno.test("resize repaints everything at the new width", () => {
  const { terminal, content, tui } = setup(20, 4, ["abc", "def"]);

  terminal.resize(10, 4);

  content.lines = ["ABC", "def"];

  tui.renderNow();
  assertEquals(terminal.viewport(), ["ABC", "def", "", ""]);
  tui.stop();
});

Deno.test("rows wider than the terminal are rejected", () => {
  const { content, tui } = setup(5, 4, ["ok"]);

  content.lines = ["much too wide"];

  assertThrows(() => tui.renderNow(), Error, "13 cells wide");
  tui.stop();
});

Deno.test("input listeners see keys before the focused component and can consume them", () => {
  const terminal = new VirtualTerminal(20, 3);
  const tui = new TUI(terminal);
  const input = new TextField({ prompt: "> " });
  const submitted: string[] = [];

  input.onSubmit = (value) => submitted.push(value);

  tui.addChild(input);
  tui.setFocus(input);
  tui.addInputListener((event) =>
    event.type === "key" && event.key.name === "x"
  );
  tui.start();

  terminal.send("hix\x1b[200~ there\x1b[201~\x7f!");
  tui.renderNow();
  assertEquals(input.value, "hi ther!");
  assertEquals(terminal.viewport()[0], "> hi ther!");
  terminal.send("\r");
  assertEquals(submitted, ["hi ther!"]);
  tui.stop();
});
