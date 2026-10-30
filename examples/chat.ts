// Echo chat exercising the package: transcript that scrolls into native
// scrollback, a spinner while "thinking", and a focused input line.
// Run: deno task tui:demo
import process from "node:process";
import {
  Container,
  Loader,
  matchesKey,
  ProcessTerminal,
  Spacer,
  Text,
  TextField,
  TUI,
} from "../mod.ts";

const tui = new TUI(new ProcessTerminal());
const transcript = new Container();
const input = new TextField({
  prompt: "\x1b[36m›\x1b[39m ",
  placeholder: "message, /quit to exit",
});
const loaders = new Set<Loader>();

tui.addChild(
  new Text("\x1b[1mflow tui demo\x1b[22m  Enter sends, Ctrl+C quits"),
);
tui.addChild(transcript);
tui.addChild(new Spacer());
tui.addChild(input);
tui.setFocus(input);

function quit(): never {
  for (const loader of loaders) {
    loader.stop();
  }

  tui.stop();
  process.exit(0);
}

tui.addInputListener((event) => {
  if (
    event.type === "key" &&
    (matchesKey(event.key, "ctrl+c") || matchesKey(event.key, "ctrl+d"))
  ) {
    quit();
  }
});

input.onSubmit = (value) => {
  const message = value.trim();

  if (message === "") {
    return;
  }

  if (message === "/quit") {
    quit();
  }

  input.setValue("");
  transcript.addChild(
    new Text(
      `you: ${message}`,
      1,
      0,
      (line) => `\x1b[48;5;236m${line}\x1b[49m`,
    ),
  );

  const loader = new Loader(tui, "thinking…", {
    theme: { spinner: { fg: "yellow" } },
  });

  loaders.add(loader);
  transcript.addChild(loader);
  loader.start();
  setTimeout(() => {
    loader.stop();
    loaders.delete(loader);
    transcript.removeChild(loader);
    transcript.addChild(new Text(`echo: ${message}`, 1));
    tui.requestRender();
  }, 600);
};

tui.start();
