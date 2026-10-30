import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  encodeMouse,
  InputParser,
  type MouseInput,
  TUI,
  VirtualTerminal,
  visibleWidth,
} from "../mod.ts";
import { hyperlink, Link } from "../src/components/link.ts";

const URL_TEXT = "https://example.com/docs";

/** Feed raw input to `link` the way the TUI does. */
function press(link: Link, sequence: string): void {
  new InputParser((event) => {
    if (event.type === "key" || event.type === "paste") {
      link.handleInput(event);
    }
  }).feed(sequence);
}

function mouse(
  action: MouseInput["action"],
  x: number,
  y = 0,
): MouseInput {
  return {
    type: "mouse",
    action,
    button: action === "move" || action === "leave" ? "none" : "left",
    x,
    y,
    shift: false,
    alt: false,
    ctrl: false,
  };
}

Deno.test("hyperlink wraps text in OSC 8 without adding visible width", () => {
  const text = hyperlink("docs", URL_TEXT);

  assertEquals(text, `\x1b]8;;${URL_TEXT}\x07docs\x1b]8;;\x07`);
  assertEquals(visibleWidth(text), 4);
});

Deno.test("hyperlink strips control characters from the URL", () => {
  assertEquals(
    hyperlink("x", "https://a.example/\x07\x1b[31m\n"),
    "\x1b]8;;https://a.example/[31m\x07x\x1b]8;;\x07",
  );
});

Deno.test("a link renders one row with the OSC 8 target and exactly its text width", () => {
  const link = new Link("Read the docs", URL_TEXT);
  const rows = link.render(40);

  assertEquals(rows.length, 1);
  assertStringIncludes(rows[0], `\x1b]8;;${URL_TEXT}\x07`);
  assertStringIncludes(rows[0], "Read the docs");
  assertEquals(visibleWidth(rows[0]), 13);
  assertEquals(link.render(40), rows);
});

Deno.test("a narrow width truncates the label but keeps the hyperlink closed", () => {
  const link = new Link("Read the docs", URL_TEXT);
  const [row] = link.render(8);

  assertEquals(visibleWidth(row), 8);
  assertEquals(row.endsWith("\x1b]8;;\x07"), true);
  assertEquals(link.render(0), []);
});

Deno.test("newlines in the label collapse to spaces so it stays one row", () => {
  assertEquals(new Link("a\nb\tc", URL_TEXT).text, "a b c");
});

Deno.test("Enter opens the link, marks it visited and restyles it", () => {
  const opened: string[] = [];
  const link = new Link("docs", URL_TEXT, {
    onOpen: (url) => opened.push(url),
  });
  const before = link.render(20)[0];

  press(link, "x");
  assertEquals(opened, []);

  press(link, "\r");
  assertEquals(opened, [URL_TEXT]);
  assertEquals(link.visited, true);
  assertEquals(link.render(20)[0] === before, false);

  link.setVisited(false);
  assertEquals(link.render(20)[0], before);
});

Deno.test("Enter without onOpen does nothing and leaves the link unvisited", () => {
  const link = new Link("docs", URL_TEXT);

  press(link, "\r");
  assertEquals(link.visited, false);
});

Deno.test("a left click opens the link when pressed and released over the label", () => {
  const opened: string[] = [];
  const link = new Link("docs", URL_TEXT, {
    onOpen: (url) => opened.push(url),
  });

  link.render(20);

  assertEquals(link.handleMouse(mouse("press", 1)), true);
  assertEquals(opened, []);
  link.handleMouse(mouse("release", 2));
  assertEquals(opened, [URL_TEXT]);

  // Dragged off the label before releasing: no click.
  link.handleMouse(mouse("press", 0));
  link.handleMouse(mouse("release", 9));
  assertEquals(opened, [URL_TEXT]);

  // Past the end of the label there is nothing to press.
  assertEquals(link.handleMouse(mouse("press", 10)), false);
  link.handleMouse(mouse("release", 10));
  assertEquals(opened, [URL_TEXT]);
});

Deno.test("without onOpen a press is left to the terminal", () => {
  const link = new Link("docs", URL_TEXT);

  link.render(20);
  assertEquals(link.handleMouse(mouse("press", 1)), false);
});

Deno.test("hovering restyles the label until the pointer leaves", () => {
  const link = new Link("docs", URL_TEXT);
  const normal = link.render(20)[0];

  link.render(20);
  assertEquals(link.handleMouse(mouse("move", 1)), true);

  const hover = link.render(20)[0];

  assertEquals(hover === normal, false);
  assertEquals(visibleWidth(hover), 4);

  link.handleMouse(mouse("leave", 1));
  assertEquals(link.render(20)[0], normal);

  // Beside the label is not hovering.
  assertEquals(link.handleMouse(mouse("move", 8)), false);
  assertEquals(link.render(20)[0], normal);
});

Deno.test("focus is shown, and a theme replaces the default paint per state", () => {
  const link = new Link("docs", URL_TEXT, {
    theme: { normal: { fg: "#ff0000" }, focused: { bold: true } },
  });
  const normal = link.render(20)[0];

  assertStringIncludes(normal, "\x1b[38;2;255;0;0m");

  link.focused = true;

  assertStringIncludes(link.render(20)[0], "\x1b[38;2;255;0;0;1m");
});

Deno.test("in a TUI, moving the pointer over the link and clicking it works end to end", () => {
  const terminal = new VirtualTerminal(30, 4);
  const tui = new TUI(terminal, { mouse: "move" });
  const opened: string[] = [];
  const link = new Link("open docs", URL_TEXT, {
    onOpen: (url) => opened.push(url),
  });

  tui.addChild(link);
  tui.start();
  tui.renderNow();

  const normal = link.render(30)[0];

  terminal.send(encodeMouse({ action: "move", x: 3, y: 0 }));
  assertEquals(link.render(30)[0] === normal, false);

  terminal.send(encodeMouse({ action: "move", x: 20, y: 0 }));
  assertEquals(link.render(30)[0], normal);

  terminal.send(encodeMouse({ action: "press", x: 3, y: 0 }));
  terminal.send(encodeMouse({ action: "release", x: 3, y: 0 }));
  assertEquals(opened, [URL_TEXT]);
  assertEquals(tui.focused, link);
  assertEquals(terminal.viewport()[0].trimEnd(), "open docs");

  terminal.send("\r");
  assertEquals(opened, [URL_TEXT, URL_TEXT]);
  tui.stop();
});

Deno.test("link keys replace Enter, the ellipsis is configurable, and setTheme changes the next render", () => {
  const opened: string[] = [];
  const link = new Link("documentation", URL_TEXT, {
    onOpen: (url) => opened.push(url),
    keys: { open: ["o"] },
    ellipsis: "~",
  });

  press(link, "\r");

  assertEquals(opened, []);

  press(link, "o");

  assertEquals(opened, [URL_TEXT]);
  assertStringIncludes(link.render(6)[0], "docum~");

  link.setTheme({ visited: { fg: "#00ff00" } });

  assertStringIncludes(link.render(6)[0], "38;2;0;255;0");
});
