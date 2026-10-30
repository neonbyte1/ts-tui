import { assertEquals } from "@std/assert";
import {
  type Component,
  CURSOR_MARKER,
  IMAGE_RESERVED,
  terminalInfo,
  TextField,
  TUI,
  VirtualTerminal,
} from "../mod.ts";

class Lines implements Component {
  public constructor(public lines: readonly string[]) {}
  public render(): readonly string[] {
    return this.lines;
  }
}

class FakeImage implements Component {
  private readonly rows: readonly string[];
  public constructor(sequence: string, rows: number) {
    this.rows = [sequence, ...Array(rows - 1).fill(IMAGE_RESERVED)];
  }
  public render(): readonly string[] {
    return this.rows;
  }
}

const kittyImage = (id: number, rows: number) =>
  new FakeImage(
    `\x1b_Ga=T,f=100,t=d,i=${id},p=1,c=4,r=${rows},C=1,q=2,m=0;AAAA\x1b\\`,
    rows,
  );

function frames(terminal: VirtualTerminal, from: number): string {
  return terminal.writes.slice(from).join("");
}

Deno.test("terminal cursor follows the focused caret and survives diffs above it", () => {
  const terminal = new VirtualTerminal(30, 6);
  const tui = new TUI(terminal);
  const above = new Lines(["header"]);
  const input = new TextField({ prompt: "> " });
  const below = new Lines(["status line"]);

  tui.addChild(above);
  tui.addChild(input);
  tui.addChild(below);
  tui.setFocus(input);
  tui.start();

  terminal.send("hello\x1b[D");
  tui.renderNow();
  assertEquals(terminal.viewport().slice(0, 3), [
    "header",
    "> hello",
    "status line",
  ]);
  assertEquals(terminal.cursor, { x: 6, y: 1, visible: false });
  assertEquals(frames(terminal, 0).includes(CURSOR_MARKER), false);

  // The cursor is parked mid-content; edits above and below must still land on the right rows.
  above.lines = ["HEADER", "second"];

  tui.renderNow();

  below.lines = ["status line", "more"];

  tui.renderNow();
  assertEquals(terminal.viewport().slice(0, 5), [
    "HEADER",
    "second",
    "> hello",
    "status line",
    "more",
  ]);
  assertEquals(terminal.cursor, { x: 6, y: 2, visible: false });

  const before = terminal.writes.length;

  tui.setHardwareCursor(true);
  tui.renderNow();
  assertEquals(terminal.cursor, { x: 6, y: 2, visible: true });
  assertEquals(frames(terminal, before).includes("\x1b[7m"), false);

  tui.stop();
  assertEquals(
    terminal.cursor.y,
    5,
    "stop leaves the cursor below the content",
  );
});

Deno.test("overlay draws over the screen and keeps the content around it", () => {
  const terminal = new VirtualTerminal(20, 6);
  const tui = new TUI(terminal);

  tui.addChild(new Lines(["0123456789abcdefghij", "klmnopqrstuvwxyzABCD"]));
  tui.start();
  tui.renderNow();

  const handle = tui.showOverlay(new Lines(["+--+", "|hi|", "+--+"]), {
    width: 4,
  });

  tui.renderNow();
  assertEquals(terminal.viewport(), [
    "0123456789abcdefghij",
    "klmnopqr+--+wxyzABCD",
    "        |hi|",
    "        +--+",
    "",
    "",
  ]);

  handle.hide();
  tui.renderNow();
  assertEquals(terminal.viewport(), [
    "0123456789abcdefghij",
    "klmnopqrstuvwxyzABCD",
    "",
    "",
    "",
    "",
  ]);
  tui.stop();
});

Deno.test("overlay takes focus and returns it when hidden", () => {
  const terminal = new VirtualTerminal(30, 5);
  const tui = new TUI(terminal);
  const base = new TextField({ prompt: "> " });

  tui.addChild(base);
  tui.setFocus(base);
  tui.start();

  const dialog = new TextField({ prompt: "? " });
  const handle = tui.showOverlay(dialog, {
    width: 10,
    anchor: "top-left",
    margin: 0,
  });

  terminal.send("yes");
  tui.renderNow();
  assertEquals(dialog.value, "yes");
  assertEquals(base.value, "");
  assertEquals(terminal.viewport()[0], "? yes");
  assertEquals(terminal.cursor.x, 5, "caret is inside the overlay");

  handle.setHidden(true);
  terminal.send("no");
  assertEquals(base.value, "no");
  handle.setHidden(false);
  terminal.send("!");
  assertEquals(dialog.value, "yes!");
  handle.hide();
  terminal.send("?");
  assertEquals(base.value, "no?");
  tui.stop();
});

Deno.test("kitty image is placed once its rows exist, moves with content, and is deleted when removed", () => {
  const terminal = new VirtualTerminal(20, 8);
  const tui = new TUI(terminal);
  const top = new Lines(["top"]);
  const image = kittyImage(7, 3);

  tui.addChild(top);
  tui.addChild(image);
  tui.addChild(new Lines(["after"]));
  tui.start();
  tui.renderNow();
  assertEquals(terminal.images(), [{
    row: 1,
    col: 0,
    protocol: "kitty",
    id: 7,
  }]);
  assertEquals(terminal.viewport().slice(0, 5), ["top", "", "", "", "after"]);

  top.lines = ["top", "inserted"];

  tui.renderNow();
  assertEquals(terminal.images(), [{
    row: 2,
    col: 0,
    protocol: "kitty",
    id: 7,
  }]);
  assertEquals(terminal.viewport()[5], "after");

  const before = terminal.writes.length;

  tui.removeChild(image);
  tui.renderNow();
  assertEquals(terminal.images(), []);
  assertEquals(frames(terminal, before).includes("a=d,d=I,i=7"), true);
  assertEquals(terminal.viewport().slice(0, 3), ["top", "inserted", "after"]);
  tui.stop();
});

Deno.test("iTerm2 image is not erased by updates below it and redraws when content above changes", () => {
  const terminal = new VirtualTerminal(20, 8);
  const tui = new TUI(terminal);
  const top = new Lines(["top"]);
  const status = new Lines(["s1"]);

  tui.addChild(top);
  tui.addChild(
    new FakeImage(
      "\x1b]1337;File=inline=1;size=3;width=4;height=2;preserveAspectRatio=0:AAAA\x07",
      2,
    ),
  );
  tui.addChild(status);
  tui.start();
  tui.renderNow();
  assertEquals(terminal.images(), [{ row: 1, col: 0, protocol: "iterm2" }]);

  status.lines = ["s2"];

  tui.renderNow();
  assertEquals(terminal.images(), [{ row: 1, col: 0, protocol: "iterm2" }]);

  top.lines = ["top", "x"];

  tui.renderNow();
  assertEquals(terminal.images(), [{ row: 2, col: 0, protocol: "iterm2" }]);
  assertEquals(terminal.viewport().slice(0, 5), ["top", "x", "", "", "s2"]);
  tui.stop();
});

Deno.test("images are drawn during a full repaint taller than the screen", () => {
  const terminal = new VirtualTerminal(20, 6);
  const tui = new TUI(terminal);

  tui.addChild(kittyImage(1, 2)); // scrolls into scrollback during the paint
  tui.addChild(new Lines(Array.from({ length: 8 }, (_, i) => `line ${i}`)));
  tui.addChild(kittyImage(2, 2));
  tui.addChild(new Lines(["end"]));
  tui.start();
  tui.renderNow();
  assertEquals(terminal.images(), [{
    row: 3,
    col: 0,
    protocol: "kitty",
    id: 2,
  }]);
  assertEquals(terminal.viewport(), [
    "line 5",
    "line 6",
    "line 7",
    "",
    "",
    "end",
  ]);
  tui.stop();
});

Deno.test("terminal replies enable kitty keyboard and images without reaching components", () => {
  const saved = { ...terminalInfo };

  try {
    const terminal = new VirtualTerminal(20, 4);
    const tui = new TUI(terminal);
    const input = new TextField();
    let listenerCalls = 0;

    tui.addChild(input);
    tui.setFocus(input);
    tui.addInputListener(() => {
      listenerCalls++;
    });
    tui.start();

    const probes = frames(terminal, 0);

    assertEquals(probes.includes("\x1b[?u"), true);
    assertEquals(probes.includes("\x1b_Gi=31,"), true);

    terminal.send("\x1b[?0u\x1b_Gi=31;OK\x1b\\\x1b[6;20;10t");
    assertEquals(terminalInfo.kittyKeyboard, true);
    assertEquals(terminalInfo.imageProtocol, null, "applied on the DA1 reply");
    terminal.send("\x1b[?62;22c");
    assertEquals(terminalInfo.imageProtocol, "kitty");
    assertEquals(
      [terminalInfo.cellWidthPx, terminalInfo.cellHeightPx],
      [10, 20],
    );
    assertEquals(listenerCalls, 0);
    assertEquals(input.value, "");
    assertEquals(frames(terminal, 0).includes("\x1b[>1u"), true);

    terminal.send("\x1b[104;2u"); // kitty-encoded shift+h
    assertEquals(input.value, "h");
    assertEquals(listenerCalls, 1);

    const before = terminal.writes.length;

    tui.stop();
    assertEquals(frames(terminal, before).includes("\x1b[<u"), true);
    assertEquals(terminalInfo.kittyKeyboard, false);
  } finally {
    Object.assign(terminalInfo, saved);
  }
});
