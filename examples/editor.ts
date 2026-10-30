// Editor playground: a multi-line prompt with wrapping, scrolling, history,
// undo, and a live status line. Submitted text is echoed above the prompt and
// scrolls into the terminal's scrollback.
// Run: deno task tui:editor
import process from "node:process";
import {
  Container,
  Editor,
  matchesKey,
  ProcessTerminal,
  Spacer,
  Text,
  TUI,
} from "../mod.ts";

const DIM = (s: string) => `\x1b[2m${s}\x1b[22m`;

const tui = new TUI(new ProcessTerminal());
const editor = new Editor({
  placeholder: "Type something. Up recalls history.",
  maxHeight: 6,
  theme: { border: { fg: "cyan" } },
});
const status = new Text("", 0, 0, DIM);
let hardwareCursor = false;

// Seed history so Up has something to recall right away.
editor.addToHistory("cd /var/www/data && ls -la");
editor.addToHistory(
  "A multi-line entry:\n- shift+enter adds a line\n- so does a trailing \\",
);

tui.addChild(
  new Text(
    "\x1b[1mflow editor example\x1b[22m\n" +
      DIM(
        "Enter submit · Shift/Alt+Enter newline · Ctrl+Z undo · Ctrl+C quit\n" +
          "Ctrl+←/→ word · Ctrl+W delete word · ↑/↓ history · Ctrl+T cursor",
      ),
  ),
);
tui.addChild(new Spacer());

const submitted = new Container();

tui.addChild(submitted);
tui.addChild(editor);
tui.addChild(status);
tui.setFocus(editor);

function updateStatus(text: string): void {
  const lines = text === "" ? 0 : text.split("\n").length;
  const chars = [...new Intl.Segmenter().segment(text)].length;

  status.setText(
    `${lines} line${lines === 1 ? "" : "s"} · ${chars} char${
      chars === 1 ? "" : "s"
    } · terminal cursor ${hardwareCursor ? "on" : "off"}`,
  );
}

editor.onChange = updateStatus;
editor.onSubmit = (text) => {
  if (text.trim() === "") {
    return;
  }

  editor.addToHistory(text);
  editor.setText("");
  updateStatus("");
  // Added above the editor, so the prompt stays at the bottom.
  submitted.addChild(
    new Text(text, 1, 0, (line) => `\x1b[48;5;236m${line}\x1b[49m`),
  );
  submitted.addChild(new Spacer());
};

tui.addInputListener((event) => {
  if (event.type !== "key") {
    return;
  }

  if (matchesKey(event.key, "ctrl+c")) {
    tui.stop();
    process.exit(0);
  }

  if (matchesKey(event.key, "ctrl+t")) {
    hardwareCursor = !hardwareCursor;

    tui.setHardwareCursor(hardwareCursor);
    updateStatus(editor.text);

    return true;
  }
});

updateStatus("");
tui.start();
