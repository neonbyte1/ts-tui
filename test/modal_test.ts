import { assert, assertEquals } from "@std/assert";
import {
  type Component,
  encodeMouse,
  type Focusable,
  type InputEvent,
  TUI,
  VirtualTerminal,
} from "../mod.ts";
import { Button } from "../src/components/button.ts";
import { Modal, type ModalCloseReason } from "../src/components/modal.ts";
import { BORDERS } from "../src/components/box.ts";

const ESCAPE = "\x1b[27u";
const SHIFT_TAB = "\x1b[Z";

/** A focusable stand-in for a text field: shows what was typed. */
class Field implements Component, Focusable {
  public focused = false;
  public typed = "";
  private cacheKey = "";
  private cache: readonly string[] = [];

  public handleInput(event: InputEvent): void {
    if (event.type === "key" && event.key.text !== undefined) {
      this.typed += event.key.text;
    }
  }

  public render(): readonly string[] {
    const key = `${this.typed}\0${this.focused}`;

    if (key !== this.cacheKey) {
      this.cacheKey = key;
      this.cache = [`[${this.focused ? ">" : " "}${this.typed}]`];
    }

    return this.cache;
  }
}

function setup(columns = 40, rows = 14) {
  const terminal = new VirtualTerminal(columns, rows);
  const tui = new TUI(terminal, { mouse: "drag" });
  const base = { presses: 0 };
  const button = new Button("Base", { onPress: () => base.presses++ });

  tui.addChild(button);
  tui.start();
  tui.renderNow();

  return { terminal, tui, base, button };
}

/** Screen cell of the first occurrence of `text`. */
function find(terminal: VirtualTerminal, text: string): [number, number] {
  const rows = terminal.viewport();

  for (let y = 0; y < rows.length; y++) {
    const x = rows[y].indexOf(text);

    if (x !== -1) {
      return [x, y];
    }
  }

  throw new Error(`"${text}" is not on screen:\n${rows.join("\n")}`);
}

function click(
  terminal: VirtualTerminal,
  tui: TUI,
  x: number,
  y: number,
): void {
  terminal.send(encodeMouse({ action: "press", x, y }));
  terminal.send(encodeMouse({ action: "release", x, y }));
  tui.renderNow();
}

function clickOn(terminal: VirtualTerminal, tui: TUI, text: string): void {
  const [x, y] = find(terminal, text);

  click(terminal, tui, x + 1, y);
}

function send(terminal: VirtualTerminal, tui: TUI, input: string): void {
  terminal.send(input);
  tui.renderNow();
}

Deno.test("a modal draws a titled frame with its body and buttons over the screen, and removes them when closed", () => {
  const { terminal, tui } = setup();
  const modal = new Modal(tui, {
    title: "Confirm",
    body: "Really delete the file?",
    buttons: [{ label: "Cancel" }, { label: "OK", variant: "primary" }],
    width: 30,
  });

  assertEquals(modal.isOpen, false);

  modal.open();
  tui.renderNow();

  const screen = terminal.viewport();

  assertEquals(modal.isOpen, true);
  assert(screen.some((row) => row.includes("Confirm")));
  assert(screen.some((row) => row.includes("Really delete the file?")));
  assert(screen.some((row) => row.includes("Cancel") && row.includes("OK")));
  assert(screen.every((row) => row.length <= 40));

  modal.close();
  tui.renderNow();

  assertEquals(terminal.viewport().join("\n").includes("Confirm"), false);
  assertEquals(modal.isOpen, false);
  tui.stop();
});

Deno.test("a long body wraps inside the dialog", () => {
  const { terminal, tui } = setup();
  const modal = new Modal(tui, {
    body: "one two three four five six seven eight nine ten",
    buttons: [{ label: "OK" }],
    width: 24,
  });

  modal.open();
  tui.renderNow();

  const screen = terminal.viewport();

  assert(screen.some((row) => row.includes("one two three four")));
  assert(screen.some((row) => row.includes("five six seven")));
  assert(screen.some((row) => row.includes("eight nine ten")));
  assert(screen.every((row) => row.length <= 40));
  tui.stop();
});

Deno.test("Escape closes the modal unless closeOnEscape is off", () => {
  const { terminal, tui } = setup();
  const reasons: ModalCloseReason[] = [];
  const modal = new Modal(tui, {
    body: "Hi",
    buttons: [{ label: "OK" }],
    onClose: (reason) => reasons.push(reason),
  });

  modal.open();
  send(terminal, tui, ESCAPE);

  assertEquals(modal.isOpen, false);
  assertEquals(reasons, ["escape"]);

  const sticky = new Modal(tui, {
    buttons: [{ label: "OK" }],
    closeOnEscape: false,
    onClose: (reason) => reasons.push(reason),
  });

  sticky.open();
  send(terminal, tui, ESCAPE);

  assertEquals(sticky.isOpen, true);
  assertEquals(reasons, ["escape"]);

  sticky.close();

  assertEquals(reasons, ["escape", "close"]);
  tui.stop();
});

Deno.test("clicking a button presses it and closes the modal", () => {
  const { terminal, tui } = setup();
  const log: string[] = [];
  const modal = new Modal(tui, {
    body: "Sure?",
    buttons: [
      { label: "Cancel", onPress: () => log.push("cancel") },
      { label: "OK", variant: "primary", onPress: () => log.push("ok") },
    ],
    onClose: (reason) => log.push(`closed:${reason}`),
  });

  modal.open();
  tui.renderNow();
  clickOn(terminal, tui, "OK");

  assertEquals(log, ["ok", "closed:button"]);
  assertEquals(modal.isOpen, false);
  tui.stop();
});

Deno.test("a button with close: false leaves the modal open", () => {
  const { terminal, tui } = setup();
  let applied = 0;
  const modal = new Modal(tui, {
    buttons: [
      { label: "Apply", close: false, onPress: () => applied++ },
      { label: "Done" },
    ],
  });

  modal.open();
  tui.renderNow();
  clickOn(terminal, tui, "Apply");
  clickOn(terminal, tui, "Apply");

  assertEquals(applied, 2);
  assertEquals(modal.isOpen, true);

  clickOn(terminal, tui, "Done");

  assertEquals(modal.isOpen, false);
  tui.stop();
});

Deno.test("releasing away from the clicked button does not press it", () => {
  const { terminal, tui } = setup();
  let pressed = 0;
  const modal = new Modal(tui, {
    buttons: [{ label: "OK", onPress: () => pressed++ }],
  });

  modal.open();
  tui.renderNow();

  const [x, y] = find(terminal, "OK");

  terminal.send(encodeMouse({ action: "press", x: x + 1, y }));
  terminal.send(encodeMouse({ action: "drag", x: x + 1, y: y - 2 }));
  terminal.send(encodeMouse({ action: "release", x: x + 1, y: y - 2 }));

  assertEquals(pressed, 0);
  assertEquals(modal.isOpen, true);
  tui.stop();
});

Deno.test("Enter presses the focused button, which starts on the primary one", () => {
  const { terminal, tui } = setup();
  const log: string[] = [];
  const modal = new Modal(tui, {
    buttons: [
      { label: "Cancel", onPress: () => log.push("cancel") },
      { label: "OK", variant: "primary", onPress: () => log.push("ok") },
    ],
  });

  modal.open();
  send(terminal, tui, "\r");

  assertEquals(log, ["ok"]);
  assertEquals(modal.isOpen, false);

  const plain = new Modal(tui, {
    buttons: [
      { label: "First", onPress: () => log.push("first") },
      { label: "Second", onPress: () => log.push("second") },
    ],
  });

  plain.open();
  send(terminal, tui, " ");

  assertEquals(log, ["ok", "first"]);
  tui.stop();
});

Deno.test("Tab and Shift+Tab cycle the focus over a focusable body and the buttons, and other keys reach the focused one", () => {
  const { terminal, tui } = setup();
  const field = new Field();
  const log: string[] = [];
  const modal = new Modal(tui, {
    title: "Rename",
    body: field,
    buttons: [
      { label: "Cancel", onPress: () => log.push("cancel") },
      { label: "Save", variant: "primary", onPress: () => log.push("save") },
    ],
  });

  modal.open();
  send(terminal, tui, "ab");

  // The body takes the initial focus when it is focusable.
  assertEquals(tui.focused, field);
  assertEquals(field.typed, "ab");

  send(terminal, tui, "\t");

  const first = tui.focused;

  assert(first !== field && first !== null);

  send(terminal, tui, "\t");

  assert(tui.focused !== first && tui.focused !== field);

  send(terminal, tui, "\t");

  assertEquals(tui.focused, field);

  send(terminal, tui, SHIFT_TAB);

  assertEquals(tui.focused === field, false);

  send(terminal, tui, "\x1b[D");
  send(terminal, tui, "\r");

  assertEquals(log, ["cancel"]);
  assertEquals(field.typed, "ab");
  tui.stop();
});

Deno.test("with a plain body, Tab and arrows move between buttons", () => {
  const { terminal, tui } = setup();
  const log: string[] = [];
  const modal = new Modal(tui, {
    body: "Pick one",
    buttons: [
      { label: "A", onPress: () => log.push("a"), close: false },
      { label: "B", onPress: () => log.push("b"), close: false },
      { label: "C", onPress: () => log.push("c"), close: false },
    ],
  });

  modal.open();
  send(terminal, tui, "\r");
  send(terminal, tui, "\t");
  send(terminal, tui, "\r");
  send(terminal, tui, "\x1b[C");
  send(terminal, tui, "\r");
  send(terminal, tui, "\x1b[C");
  send(terminal, tui, "\r");
  send(terminal, tui, SHIFT_TAB);
  send(terminal, tui, "\r");

  assertEquals(log, ["a", "b", "c", "a", "c"]);
  tui.stop();
});

Deno.test("clicking a button focuses it, and Tab continues from there", () => {
  const { terminal, tui } = setup();
  const log: string[] = [];
  const modal = new Modal(tui, {
    buttons: [
      { label: "One", onPress: () => log.push("one"), close: false },
      { label: "Two", onPress: () => log.push("two"), close: false },
    ],
  });

  modal.open();
  tui.renderNow();

  const [x, y] = find(terminal, "Two");

  // Press only: focus moves to the button; release elsewhere cancels the press.
  terminal.send(encodeMouse({ action: "press", x: x + 1, y }));
  terminal.send(encodeMouse({ action: "release", x: 0, y: 0 }));
  send(terminal, tui, "\t");
  send(terminal, tui, "\r");

  assertEquals(log, ["one"]);
  tui.stop();
});

Deno.test("the modal blocks clicks on the content beneath, and closeOnBackdrop turns an outside click into a close", () => {
  const { terminal, tui, base } = setup();
  const reasons: ModalCloseReason[] = [];
  const modal = new Modal(tui, {
    body: "Blocked",
    buttons: [{ label: "OK" }],
    onClose: (reason) => reasons.push(reason),
  });

  modal.open();
  tui.renderNow();

  const [x, y] = find(terminal, "Base");

  click(terminal, tui, x + 1, y);

  assertEquals(base.presses, 0);
  assertEquals(modal.isOpen, true);

  modal.close();
  click(terminal, tui, x + 1, y);

  assertEquals(base.presses, 1);

  const dismissable = new Modal(tui, {
    body: "Blocked",
    buttons: [{ label: "OK" }],
    closeOnBackdrop: true,
    onClose: (reason) => reasons.push(reason),
  });

  dismissable.open();
  tui.renderNow();
  click(terminal, tui, x + 1, y);

  assertEquals(base.presses, 1);
  assertEquals(dismissable.isOpen, false);
  assertEquals(reasons, ["close", "backdrop"]);
  tui.stop();
});

Deno.test("closing restores the focus held before opening, also after a click inside", () => {
  const { terminal, tui, button } = setup();

  tui.setFocus(button);

  const modal = new Modal(tui, {
    body: "x",
    buttons: [
      { label: "Stay", close: false },
      { label: "Bye" },
    ],
  });

  modal.open();
  tui.renderNow();

  assert(tui.focused !== button);

  clickOn(terminal, tui, "Stay");

  assert(tui.focused !== button);

  clickOn(terminal, tui, "Bye");

  assertEquals(modal.isOpen, false);
  assertEquals(tui.focused, button);
  assertEquals(button.focused, true);
  tui.stop();
});

Deno.test("keys go back to the focused component once the modal is closed", () => {
  const { terminal, tui } = setup();
  const field = new Field();

  tui.addChild(field);
  tui.setFocus(field);
  tui.renderNow();

  const modal = new Modal(tui, { buttons: [{ label: "OK" }] });

  modal.open();
  send(terminal, tui, "a");
  send(terminal, tui, "\t");

  assertEquals(field.typed, "");

  modal.close();
  send(terminal, tui, "b");
  // The listener is gone: Escape no longer reaches a closed modal.
  send(terminal, tui, ESCAPE);

  assertEquals(field.typed, "b");
  assertEquals(tui.focused, field);
  tui.stop();
});

Deno.test("open does nothing while open, and a closed modal can open again", () => {
  const { terminal, tui } = setup();
  const reasons: ModalCloseReason[] = [];
  const modal = new Modal(tui, {
    buttons: [{ label: "OK" }],
    onClose: (reason) => reasons.push(reason),
  });

  modal.open();
  modal.open();
  modal.close();
  modal.close();

  assertEquals(reasons, ["close"]);

  modal.open();
  tui.renderNow();

  assertEquals(modal.isOpen, true);

  clickOn(terminal, tui, "OK");

  assertEquals(reasons, ["close", "button"]);
  tui.stop();
});

Deno.test("the screen beneath is restyled with the backdrop paint, and left alone for null", () => {
  const dimmed = setup();

  new Modal(dimmed.tui, {
    buttons: [{ label: "OK" }],
    theme: { backdrop: { fg: "#ff0000" } },
  }).open();
  dimmed.tui.renderNow();

  assert(dimmed.terminal.writes.join("").includes("38;2;255;0;0"));
  dimmed.tui.stop();

  const plain = setup();

  new Modal(plain.tui, {
    buttons: [{ label: "OK" }],
    theme: { backdrop: null },
  }).open();
  plain.tui.renderNow();

  assertEquals(plain.terminal.writes.join("").includes("38;2;255;0;0"), false);
  plain.tui.stop();
});

Deno.test("a modal wider than the terminal shrinks to fit and stays usable", () => {
  const { terminal, tui } = setup(20, 10);
  let pressed = 0;
  const modal = new Modal(tui, {
    title: "A rather long title",
    body: "A body that must wrap in a narrow terminal",
    buttons: [
      { label: "Cancel" },
      { label: "Confirm", onPress: () => pressed++ },
    ],
    width: 60,
  });

  modal.open();
  tui.renderNow();

  assert(terminal.viewport().every((row) => row.length <= 20));

  send(terminal, tui, "\r");

  // The first button had the focus, so Enter pressed it and closed the dialog.
  assertEquals(pressed, 0);
  assertEquals(modal.isOpen, false);
  tui.stop();
});

Deno.test("modal keys replace the defaults per action", () => {
  const { terminal, tui } = setup();
  const log: string[] = [];
  const reasons: ModalCloseReason[] = [];
  const modal = new Modal(tui, {
    buttons: [
      { label: "A", onPress: () => log.push("A") },
      { label: "B", onPress: () => log.push("B") },
    ],
    keys: { close: ["q"], focusNext: ["j"] },
    onClose: (reason) => reasons.push(reason),
  });

  modal.open();
  tui.renderNow();

  // Escape and Tab are unbound now; j moves from A to B.
  send(terminal, tui, ESCAPE);

  assertEquals(modal.isOpen, true);

  send(terminal, tui, "\t");
  send(terminal, tui, "j");
  send(terminal, tui, "\r");

  assertEquals(log, ["B"]);
  assertEquals(reasons, ["button"]);

  modal.open();
  tui.renderNow();
  send(terminal, tui, "q");

  assertEquals(reasons, ["button", "escape"]);
  tui.stop();
});

Deno.test("frame glyphs, padding, footer and body gap pass through, and the button row follows its options", () => {
  const { terminal, tui } = setup();
  const modal = new Modal(tui, {
    title: "T",
    footer: "F",
    body: "hi",
    buttons: [{ label: "OK", glyphs: { left: "[", right: "]" } }],
    width: 20,
    border: BORDERS.ascii,
    padding: [0, 1],
    bodyGap: 0,
    buttonRow: { align: "left" },
  });

  modal.open();
  tui.renderNow();

  const screen = terminal.viewport().map((row) => row.trimEnd());
  const top = screen.findIndex((row) => row.includes("+- T"));

  assertEquals(top !== -1, true);
  assertEquals(
    screen.slice(top, top + 4).map((row) => row.trim()),
    [
      "+- T --------------+",
      "| hi               |",
      "| [OK]             |",
      "+-------------- F -+",
    ].map((row) => row.trim()),
  );
  tui.stop();
});

Deno.test("theme paints the frame and buttons, and setTheme restyles the backdrop of an open modal", () => {
  const { terminal, tui } = setup();
  const modal = new Modal(tui, {
    buttons: [{ label: "OK" }, {
      label: "No",
      theme: { normal: { fg: "#0000aa" } },
    }],
    theme: {
      border: { fg: "#ff0000" },
      buttons: { normal: { fg: "#00ff00" } },
    },
  });

  modal.open();
  tui.renderNow();

  const written = () => terminal.writes.join("");

  assertEquals(written().includes("38;2;255;0;0"), true);
  assertEquals(written().includes("38;2;0;255;0"), true);
  assertEquals(written().includes("38;2;0;0;170"), true);
  assertEquals(written().includes("38;2;1;2;3"), false);

  modal.setTheme({ backdrop: { fg: "#010203" } });
  tui.renderNow();

  assertEquals(written().includes("38;2;1;2;3"), true);
  tui.stop();
});
