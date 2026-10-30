# @neonbyte/tui

A terminal UI library for Deno, Node and Bun that stays out of the way of your
terminal.

Most TUI frameworks take over the whole screen. `@neonbyte/tui` doesn't. It
renders inline, right below your shell prompt, and anything that scrolls off the
top ends up in the terminal's normal scrollback. You can still scroll up, select
text and copy it, and when the program exits the last frame stays on screen like
the output of any other command. It's built for chat clients, coding agents,
installers and build tools: programs where the history matters as much as the
live part.

Each frame is a list of strings, one per row. The TUI compares it with the
previous frame and rewrites only the rows that changed, all in one synchronized
write, so a spinner ticking at the bottom of a long transcript doesn't flicker
or redraw everything above it.

```ts ignore
import process from "node:process";
import { matchesKey, ProcessTerminal, Spinner, Text, TUI } from "@neonbyte/tui";

const tui = new TUI(new ProcessTerminal());
const spinner = new Spinner(tui, "Installing dependencies");

tui.addChild(new Text("flow v0.1.0"));
tui.addChild(spinner);
tui.addInputListener((event) => {
  if (event.type === "key" && matchesKey(event.key, "ctrl+c")) {
    tui.stop();
    process.exit(130);
  }
});
tui.start();
spinner.start();

setTimeout(() => {
  spinner.succeed("Installed 42 packages");
  tui.stop();
}, 2000);
```

## Contents

- [What's included](#whats-included)
- [Installing](#installing)
- [A first app](#a-first-app)
- [Reactive components and JSX](#reactive-components-and-jsx)
- [How rendering works](#how-rendering-works)
- [Writing your own component](#writing-your-own-component)
- [Keys, focus and the mouse](#keys-focus-and-the-mouse)
- [Overlays, modals and toasts](#overlays-modals-and-toasts)
- [Colours, glyphs and key bindings](#colours-glyphs-and-key-bindings)
- [Images and terminal features](#images-and-terminal-features)
- [Testing](#testing)
- [Permissions](#permissions)
- [Examples](#examples)
- [Working on the package](#working-on-the-package)

## What's included

| Area                 | Components                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Text and editing     | `Text`, `Markdown`, `TextField` (with a password mask), `Editor` (multi-line, with history and undo)                  |
| Layout               | `Container`, `Box`, `Spacer`, `Panes` (resizable), `ScrollView`, `Tabs`, `Accordion`                                  |
| Controls             | `Button`, `ButtonRow`, `Link`, `Checklist`                                                                            |
| Overlays             | `Overlay`, `Modal`, `Toaster`                                                                                         |
| Progress and status  | `ProgressBar`, `Spinner`, `Loader`, `Thinking`, `Shimmer`, `Duration`, `Sparkline`                                    |
| Terminal integration | inline `Image`s (kitty graphics and iTerm2), kitty keyboard protocol, OSC 8 hyperlinks, hardware cursor, opt-in mouse |

There are also the building blocks the components use, exported so you can use
them in your own: `paint()` and colour helpers, width-aware string functions
(`visibleWidth`, `wrapText`, `truncateToWidth`, `sliceColumns`), a key parser
with `matchesKey()`, `renderBar()` for custom bars, `renderScrollbar()`, and
`formatBytes` / `formatCount` / `formatDuration`.

The package has one dependency,
[`marked`](https://www.npmjs.com/package/marked), which `Markdown` uses to parse
its input.

## Installing

```sh
deno add jsr:@neonbyte/tui      # Deno
npx jsr add @neonbyte/tui       # Node
bunx jsr add @neonbyte/tui      # Bun
```

The package talks to the terminal through `node:process` and `node:fs`, which
all three runtimes provide, so the same code runs everywhere. There is nothing
Deno-specific in the public API.

The entry points:

| Import                               | What's in it                                                              |
| ------------------------------------ | ------------------------------------------------------------------------- |
| `@neonbyte/tui`                      | The `TUI`, terminals, every class component, and the helpers              |
| `@neonbyte/tui/reactive`             | Signals, effects, `mount()`, `bind()` and composables like `useKeys()`    |
| `@neonbyte/tui/reactive/components`  | A JSX component for each class component, plus `Show`, `For` and `Column` |
| `@neonbyte/tui/reactive/jsx-runtime` | The JSX runtime; you never import it yourself                             |

## A first app

Messages collect above a prompt, and Ctrl+C quits:

```ts ignore
import process from "node:process";
import {
  Container,
  matchesKey,
  ProcessTerminal,
  Text,
  TextField,
  TUI,
} from "@neonbyte/tui";

const tui = new TUI(new ProcessTerminal());
const messages = new Container();
const field = new TextField({ prompt: "> ", placeholder: "say something" });

field.onSubmit = (value) => {
  messages.addChild(new Text(`you said: ${value}`));
  field.setValue("");
};

tui.addChild(new Text("Hello from @neonbyte/tui"));
tui.addChild(messages);
tui.addChild(field);
tui.setFocus(field);
tui.addInputListener((event) => {
  if (event.type === "key" && matchesKey(event.key, "ctrl+c")) {
    tui.stop();
    process.exit(0);
  }
});
tui.start();
```

A few things to know from this:

- `new ProcessTerminal()` is the real terminal. It needs stdin to be a TTY and
  throws otherwise, so check `process.stdin.isTTY` first if your program can
  also run in a pipe.
- `tui.start()` puts the terminal into raw mode and starts reading input.
  `tui.stop()` puts it back. Always call `stop()` before you exit. If the
  process crashes or exits without it, the TUI still restores the cursor and
  turns off mouse and paste reporting on the way out, so you don't end up with a
  broken shell.
- Once you've changed a component, call `tui.requestRender()`. Several requests
  in a row are merged into one frame, and frames are capped at about 60 a
  second. You can skip it inside input handlers, because the TUI repaints after
  every input event, and animated components like `Spinner` and `ProgressBar`
  schedule their own frames.

## Reactive components and JSX

Calling setters and `requestRender()` by hand gets tedious once there's real
state. `@neonbyte/tui/reactive` adds signals, and
`@neonbyte/tui/reactive/components` has a JSX version of every component that
follows them. A component function runs once; after that only the props that
read a signal update.

Turn on JSX in `deno.json` (or `compilerOptions` in `tsconfig.json`):

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@neonbyte/tui/reactive"
  }
}
```

Then:

```tsx ignore
import { ProcessTerminal, TUI } from "@neonbyte/tui";
import { mount, signal, useKeys, useTUI } from "@neonbyte/tui/reactive";
import {
  Column,
  Editor,
  For,
  Markdown,
  Show,
  Spinner,
} from "@neonbyte/tui/reactive/components";

function Chat() {
  const tui = useTUI();
  const replies = signal<string[]>([]);
  const thinking = signal(false);

  useKeys({ "ctrl+c": () => tui.stop() });

  function ask(question: string) {
    thinking.set(true);
    setTimeout(() => {
      replies.update((list) => [...list, `**You asked:** ${question}`]);
      thinking.set(false);
    }, 800);
  }

  return (
    <Column>
      <For each={replies}>{(reply) => <Markdown>{reply}</Markdown>}</For>
      <Show when={thinking}>
        <Spinner text="Thinking" />
      </Show>
      <Editor focus placeholder="Ask something" onSubmit={ask} />
    </Column>
  );
}

mount(<Chat />, new TUI(new ProcessTerminal()));
```

There is no compiler magic, so how you pass a value decides whether it updates:

- `text={count}` passes the signal. The prop follows it.
- `text={() => count() * 2}` passes an accessor. Also reactive.
- `text={count()}` reads the value once, when the component is created.

Props typed `MaybeAccessor<T>` in the docs are the reactive ones. Pass `ref` to
get the class component underneath when you need to call a method on it.

The composables are plain functions with no rules about order or conditionals:
`useKeys()` and `useInput()` for input, `useInterval()` for timers that stop
when the component goes away, `useTerminalSize()` for a reactive size,
`useToaster()` for toasts, and `useTUI()` for the TUI itself.

If you'd rather keep the class components but drive them from signals, `bind()`
does that without JSX:

```ts
import { Text } from "@neonbyte/tui";
import { bind, signal } from "@neonbyte/tui/reactive";

const tokens = signal(0);
const status = new Text();

bind(status, "text", () => `${tokens()} tokens`);
tokens.set(42);
// status.text is now "42 tokens"
```

## How rendering works

A component is anything with a `render(width)` method that returns an array of
strings, one per screen row. Each string can contain ANSI escapes but must not
be wider than `width` cells.

The TUI renders its children top to bottom and writes the rows below where the
cursor was when it started. Then on every frame:

1. It renders the tree again and compares each row with the last frame.
2. If only rows still on screen changed, it moves the cursor there and rewrites
   just those rows, wrapped in synchronized-output escapes so the terminal shows
   them all at once.
3. If a row that already scrolled into the scrollback changed, or the terminal
   was resized, there's no way to edit it in place. The TUI clears the screen
   and the scrollback and paints everything again.

Two consequences are worth designing around. Keep the parts that change near the
bottom (the prompt, the spinner, the status line) and let finished content above
them stay as it is. And because a row wider than the terminal would wrap and
break the cursor maths, the TUI throws on the next paint if a component returns
one. Wrap or truncate in `render()`; `wrapText()` and `truncateToWidth()` handle
wide characters, emoji and escape codes for you.

Components that return the same array object as last time are treated as
unchanged, which lets a `Container` skip comparing their rows. The built-in
components cache this way, and it's an easy win in your own.

## Writing your own component

```ts
import { type Component, TUI, VirtualTerminal } from "@neonbyte/tui";

class Counter implements Component {
  public count = 0;

  public render(width: number): readonly string[] {
    return [`count: ${this.count}`.slice(0, width)];
  }
}

const terminal = new VirtualTerminal(20, 2);
const tui = new TUI(terminal);
const counter = new Counter();

tui.addChild(counter);
tui.start();
counter.count = 3;
tui.renderNow();

console.log(terminal.viewport()[0]); // "count: 3"
tui.stop();
```

`Component` has a few optional methods beyond `render`:

- `handleInput(event)` receives keys and pastes while the component has focus.
- `handleMouse(event)` receives mouse events in the component's own coordinates,
  with `(0, 0)` at its top-left cell.
- `invalidate()` is called when cached rows can't be trusted any more, for
  example after a theme change. Drop your cache there.

Implement `Focusable` too if the component shows a caret. While it's focused,
put `CURSOR_MARKER` right before the caret cell. The marker takes up no space;
the TUI strips it and, when `hardwareCursor` is on, puts the terminal's real
cursor there. In that case don't draw a caret of your own.

## Keys, focus and the mouse

Input reaches the app in two places, in this order:

1. Listeners from `tui.addInputListener()`. A listener that returns `true` stops
   the event there, which is how global shortcuts work.
2. The focused component, set with `tui.setFocus()`.

Match keys with `matchesKey(event.key, "ctrl+c")`. Specs are a key name with
optional modifiers: `"up"`, `"shift+tab"`, `"ctrl+shift+p"`. When the terminal
supports the kitty keyboard protocol it's turned on automatically, so keys like
Shift+Enter arrive as themselves instead of looking like plain Enter. That's how
`Editor` tells "submit" from "new line". Turn it off with
`{ kittyKeyboard: false }`.

The mouse is off by default, on purpose. While a terminal reports the mouse to
the program, the wheel stops scrolling the scrollback and dragging stops
selecting text, and for an inline UI those are usually the more useful
behaviours. Turn it on when you need it:

```ts ignore
const tui = new TUI(new ProcessTerminal(), { mouse: "click" });

// or later, e.g. while a menu is open
tui.setMouse("drag");
tui.setMouse("off");
```

The modes, from least to most reporting, are `"off"`, `"click"`, `"drag"` and
`"move"` (move also reports hover, which `Button` and `Link` use for their hover
styles).

## Overlays, modals and toasts

`tui.showOverlay(component, options)` draws a component on top of the bottom
screenful, anchored to a corner, an edge or the centre. It returns a handle to
hide it again. `Overlay` wraps that with a border and a title, takes focus while
it's open, closes on Esc (and, if you ask, on a press outside), and gives focus
back when it closes. `Modal` adds a message and a row of buttons, blocks the
mouse to everything beneath, and dims it. `Toaster` stacks short notifications
in a corner (bottom right by default) that dismiss themselves:

```ts ignore
import { Toaster } from "@neonbyte/tui";

const toaster = new Toaster(tui);

toaster.show("Saved", { kind: "success" });
toaster.show("Couldn't reach the server", { kind: "error" });
```

While any overlay is visible, the TUI pads the output to the full terminal
height so there's always room to draw it.

## Colours, glyphs and key bindings

Components never hard-code their look. Colours come from a `theme` of `Paint`s:

```ts
import { paint, ProgressBar } from "@neonbyte/tui";

const bar = new ProgressBar({
  theme: {
    fill: { fg: "#61afef" },
    track: { fg: "#3e4451" },
  },
});

const warning = paint("disk almost full", { fg: "yellow", bold: true });
```

A `Color` is a hex string, a 256-colour index, a named ANSI colour like `"red"`,
or `"default"`. Paint fields you leave out keep whatever the surrounding text
uses, and `mergePaint()`, `mixColors()` and `gradient()` help build themes.

Most components also accept:

- **`glyphs`** for the characters they draw. There are preset sets such as
  `BORDERS`, `STATUS_GLYPHS`, `BAR_GLYPHS` and `SPARKLINE_LEVELS`, and you can
  pass your own, for example plain ASCII for terminals with poor fonts.
- **`labels`** for the fixed texts they show, for translation.
- **`keys`** to rebind their actions. Each component exports its defaults
  (`DEFAULT_EDITOR_KEYS`, `DEFAULT_TABS_KEYS` and so on); what you pass replaces
  the bindings for the actions you name and leaves the others alone.

## Images and terminal features

`Image` shows images inline on terminals that speak the kitty graphics protocol
or iTerm2's inline images. Kitty's protocol only takes PNG; iTerm2 also draws
JPEG, GIF and WebP. Where the image can't be drawn, it shows a one-line
placeholder like `[image: png 640x480]` instead. Reading the file is up to you:

```ts ignore
import { readFileSync } from "node:fs";
import { Image } from "@neonbyte/tui";

tui.addChild(new Image(readFileSync("diagram.png"), { maxWidth: 60 }));
```

The TUI asks the terminal what it supports when it starts. Pass
`{ images: "off" }` to skip images, or name a protocol to force one.
`terminalInfo()` gives you the same detection for your own decisions.

`hyperlink(text, url)` wraps text in an OSC 8 link that most modern terminals
make clickable. `Link` is a focusable component around it that opens the URL
with the system opener (`open`, `xdg-open` or `start`) when activated, through
`openUrl()`.

`{ hardwareCursor: true }` shows the terminal's own cursor at the focused caret
instead of a drawn one, so it blinks and looks the way the user has set up their
terminal.

## Testing

`VirtualTerminal` is an in-memory terminal that interprets the escape codes the
TUI writes. Render into it, send it input, and read back plain text, with no
real terminal needed. It works with any test runner:

```ts
import { deepStrictEqual } from "node:assert/strict";
import { ProgressBar, Text, TUI, VirtualTerminal } from "@neonbyte/tui";

const terminal = new VirtualTerminal(24, 4);
const tui = new TUI(terminal);
const bar = new ProgressBar({ barWidth: 10, theme: { fill: {}, track: {} } });

tui.addChild(new Text("Downloading"));
tui.addChild(bar);
tui.start();
bar.setProgress(0.5);
tui.renderNow();

deepStrictEqual(terminal.viewport().slice(0, 2), [
  "Downloading",
  "█████       50%",
]);
tui.stop();
```

- `terminal.send("\x1b[A")` types input (here, the Up arrow). `encodeMouse()`
  builds mouse reports to send.
- `tui.renderNow()` paints immediately instead of waiting for the next frame.
- `terminal.viewport()` returns the visible rows. The scrollback and any images
  drawn are available too.

The same approach works for reactive components: `mount()` onto a `TUI` with a
`VirtualTerminal`, change your signals, `renderNow()`, and check the screen.

## Permissions

On Deno, rendering and input need no permissions at all. The only part that
needs any is `openUrl()` (and `Link`, which calls it): starting the system's URL
opener needs `--allow-run`, and Deno's `node:child_process` also needs
`--allow-env`. Node and Bun have no permission model, so none of this applies
there.

## Examples

The repository has runnable examples in `examples`.

| Command                  | What it shows                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `deno task tui:demo`     | An echo chat: a transcript that scrolls into the scrollback, a spinner, an input line       |
| `deno task tui:editor`   | The multi-line `Editor` with wrapping, scrolling, history, undo and a live status line      |
| `deno task tui:progress` | Every progress bar style, theme and glyph set, a download with speed and ETA, a sparkline   |
| `deno task tui:tasks`    | Spinners settling into done, failed and skipped, an agent-style plan, an interactive to-do  |
| `deno task tui:widgets`  | The widget gallery in JSX: tabs, buttons, a modal, toasts, links, panes; keyboard and mouse |

In the widget gallery, F1 shows the keys and F2 switches mouse modes. Every
example quits with Ctrl+C.

## Working on the package

```sh
deno task test        # unit tests, plus every code example in the docs and this README
deno task docs:check  # every public symbol documented the way JSR shows it
deno lint
deno fmt
```

`docs:check` wants a doc comment, a `@category` and parameter docs on every
export, and a titled example on every exported function and class. Examples run
as tests unless they're marked `ignore` (the ones that need a real terminal), so
if you change an API, its examples will tell you.
