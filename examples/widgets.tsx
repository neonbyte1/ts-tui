// Widget gallery: tabs, buttons, a modal, toasts, links, text fields with a
// password mask, an accordion, resizable panes and scroll views, driven by
// keyboard and mouse. F1 help · F2 mouse mode · Tab next field · Ctrl+C quit.
// Written with @neonbyte/tui/reactive: state lives in signals and the components
// follow it.
// Run: deno task tui:widgets
import process from "node:process";
import {
  type Component,
  type Duration as DurationComponent,
  type MouseMode,
  openUrl,
  paint,
  ProcessTerminal,
  ROLL_GLYPHS,
  type Tabs as TabsComponent,
  TUI,
} from "../mod.ts";
import {
  type Child,
  effect,
  mount,
  signal,
  useInput,
  useInterval,
  useKeys,
  useToaster,
  useTUI,
} from "../reactive/mod.ts";
import {
  Accordion,
  Button,
  ButtonRow,
  Checklist,
  Column,
  Duration,
  Link,
  Modal,
  Overlay,
  Panes,
  ScrollView,
  Show,
  Spacer,
  Tabs,
  Text,
  TextField,
} from "../reactive/components/mod.ts";

const MODES: readonly MouseMode[] = ["move", "drag", "click", "off"];
const KINDS = ["info", "success", "warning", "error"] as const;
const grey = (text: string) => paint(text, { fg: "#5c6370" });
const bold = (text: string) => paint(text, { bold: true });
const FILES = Array.from(
  { length: 120 },
  (_, i) => `${String(i + 1).padStart(3)}  src/file-${i + 1}.ts`,
).join("\n");
const HELP = [
  "F1        this help",
  "F2        cycle mouse mode",
  "Tab       next field (Shift+Tab back)",
  "←/→       switch tabs (tab bar focused)",
  "Enter     press the focused button",
  "Esc       close this panel or the modal",
  "Ctrl+C    quit",
].join("\n");

function strengthOf(length: number): string {
  if (length >= 12) {
    return "strong";
  }

  return length >= 8 ? "ok" : "weak";
}

/** A grey label in a fixed column, then `children`. */
function Labelled(props: { label: string; children: Child }) {
  return (
    <Panes
      direction="horizontal"
      glyphs={{ horizontal: " " }}
      resizable={false}
      panes={[
        { content: <Text>{grey(props.label)}</Text>, size: 10 },
        { content: props.children },
      ]}
    />
  );
}

function App() {
  const tui = useTUI();
  const toaster = useToaster();
  const mouse = signal(tui.mouse);
  const focusName = signal("nothing");
  const help = signal(false);
  const confirming = signal(false);
  const password = signal("");
  const masked = signal(true);
  const log = signal<string[]>([]);
  let toasts = 0;
  let tabs: TabsComponent | undefined;
  let countdown: DurationComponent | undefined;
  /** Focus order for Tab, per tab; only components of the visible tab take part. */
  const rings: Component[][] = [[], [], []];
  const inRing = (tab: number) => (component: Component) =>
    rings[tab].push(component);

  const refreshFocus = () =>
    focusName.set(tui.focused?.constructor.name ?? "nothing");

  effect(() => tui.setMouse(mouse()));
  // After mount has created the tree and the tab bar took the focus.
  queueMicrotask(refreshFocus);
  // First listener, so it sees every event, including the ones consumed below.
  useInput(() => {
    queueMicrotask(refreshFocus);
  });
  useKeys({
    // Leaves the last frame in the scrollback, minus the toasts.
    "ctrl+c": () => {
      toaster.dismissAll();
      tui.stop();
      process.exit(0);
    },
    f1: () => help.update((open) => !open),
    f2: () =>
      mouse.update((mode) => MODES[(MODES.indexOf(mode) + 1) % MODES.length]),
    // The modal cycles its own focus while open.
    tab: () => !confirming() && cycleFocus(1),
    "shift+tab": () => !confirming() && cycleFocus(-1),
  });
  useInterval(() => {
    log.update((lines) => [
      ...lines,
      grey(new Date().toLocaleTimeString()) + ` event ${lines.length + 1}`,
    ]);
  }, 700);

  function cycleFocus(step: number): true {
    const ring = [tabs!, ...rings[tabs!.selected]];
    const current = ring.indexOf(tui.focused as Component);
    const next = (current + step + ring.length) % ring.length;

    tui.setFocus(ring[current === -1 ? 0 : next]);

    return true;
  }

  function showToast(): void {
    const kind = KINDS[toasts++ % KINDS.length];

    toaster.show(`Toast number ${toasts}`, { kind, title: kind });
  }

  function open(url: string): void {
    // openUrl needs --allow-run and --allow-env on Deno; without them Deno
    // would prompt over the UI. Node and Bun have no permission model.
    if (
      typeof Deno !== "undefined" &&
      (["run", "env"] as const).some((name) =>
        Deno.permissions.querySync({ name }).state !== "granted"
      )
    ) {
      toaster.show(`Run with --allow-run --allow-env to open ${url}`, {
        kind: "warning",
      });

      return;
    }

    openUrl(url).catch((error) =>
      toaster.show(String(error), { kind: "error", title: "openUrl" })
    );
  }

  const widgets = (
    <Column>
      <Text>{bold("Buttons")}</Text>
      <ButtonRow
        buttons={[
          {
            label: "Open modal",
            variant: "primary",
            onPress: () => confirming.set(true),
          },
          { label: "Toast", onPress: showToast },
          {
            label: "Delete",
            variant: "danger",
            onPress: () => confirming.set(true),
          },
          { label: "Disabled", disabled: true },
        ]}
        ref={(row) => rings[0].push(...row.buttons)}
      />
      <Spacer />
      <Text>{bold("Links")}</Text>
      <Link
        text="Deno manual"
        url="https://docs.deno.com"
        onOpen={open}
        ref={inRing(0)}
      />
      <Link
        text="Source on GitHub"
        url="https://github.com/neonbyte1/ts-tui"
        onOpen={open}
        ref={inRing(0)}
      />
      <Spacer />
      <Text>{bold("Text fields")}</Text>
      <TextField
        prompt="Name      "
        placeholder="your name"
        onSubmit={(value) => toaster.show(`Hello, ${value || "stranger"}!`)}
        ref={inRing(0)}
      />
      <Panes
        direction="horizontal"
        glyphs={{ horizontal: " " }}
        resizable={false}
        panes={[
          {
            content: (
              <TextField
                prompt="Password  "
                placeholder="at least 8 characters"
                masked={masked}
                maxLength={64}
                onChange={password.set}
                ref={inRing(0)}
              />
            ),
          },
          {
            content: (
              <Button
                onPress={() => masked.update((value) => !value)}
                ref={inRing(0)}
              >
                {() => masked() ? "Show" : "Hide"}
              </Button>
            ),
            size: 6,
          },
        ]}
      />
      <Text>
        {() =>
          grey(
            `          ${password().length} characters · ${
              strengthOf(password().length)
            }`,
          )}
      </Text>
      <Spacer />
      <Text>{bold("Duration")}</Text>
      {/* Starts just before ten minutes so the minute digits roll soon. */}
      <Labelled label="stopwatch">
        <Duration running value={9 * 60_000 + 55_000} />
      </Labelled>
      <Labelled label="roll down">
        <Duration
          running
          roll={ROLL_GLYPHS.down}
          theme={{
            digits: { fg: "#e5c07b", bold: true },
            units: { fg: "#5c6370" },
          }}
          labels={{ m: " min", s: " sec" }}
          minParts={2}
        />
      </Labelled>
      <Labelled label="countdown">
        <Duration
          running
          countdown={15_000}
          roll={ROLL_GLYPHS.fade}
          theme={{ entering: { fg: "#50c050" }, leaving: { fg: "#e05050" } }}
          onDone={() => {
            toaster.show("Countdown finished", { kind: "success" });
            countdown?.reset();
            countdown?.start();
          }}
          ref={(timer) => {
            countdown = timer;
          }}
        />
      </Labelled>
      <Spacer />
      <Text>{bold("Accordion")}</Text>
      <Accordion
        ref={inRing(0)}
        sections={[
          {
            title: "What is this?",
            content:
              "A gallery of @neonbyte/tui widgets, all usable by keyboard and mouse.",
            open: true,
          },
          {
            title: "Mouse modes",
            content:
              "off: the terminal keeps wheel scrolling and selection. click: presses and wheel. " +
              "drag: also motion with a button held (dividers, scrollbar thumbs). move: also hover.",
          },
          {
            title: "Keyboard",
            content:
              "Tab moves between fields, ←/→ switch tabs, Enter or Space press buttons.",
          },
        ]}
      />
    </Column>
  );
  const panes = (
    <Panes
      direction="horizontal"
      panes={[
        {
          content: (
            <ScrollView>
              <Text text={FILES} />
            </ScrollView>
          ),
          size: "35%",
          min: 12,
        },
        {
          content: (
            <Panes
              direction="vertical"
              panes={[
                {
                  content: (
                    <ScrollView follow>
                      <Text>{() => log().join("\n")}</Text>
                    </ScrollView>
                  ),
                  min: 3,
                },
                {
                  content: (
                    <Checklist
                      interactive
                      items={[
                        { label: "Drag the dividers", state: "pending" },
                        {
                          label: "Scroll the file list with the wheel",
                          state: "pending",
                        },
                        { label: "Drag a scrollbar thumb", state: "pending" },
                        { label: "Click items to check them", state: "done" },
                      ]}
                      ref={inRing(1)}
                    />
                  ),
                  size: 6,
                  min: 3,
                },
              ]}
            />
          ),
          min: 20,
        },
      ]}
    />
  );

  return (
    <>
      <Text>
        {bold("@neonbyte/tui widgets") +
          grey("  F1 help · F2 mouse · Ctrl+C quit")}
      </Text>
      <Panes
        direction="vertical"
        glyphs={{ vertical: " " }}
        resizable={false}
        height={() => tui.terminal.rows - 2}
        panes={[{
          content: (
            <Tabs
              focus
              tabs={[
                {
                  label: "Widgets",
                  content: <ScrollView>{widgets}</ScrollView>,
                },
                { label: "Panes", content: panes },
                {
                  label: "About",
                  content:
                    "Every row here is plain inline output: the TUI repaints only what changed. " +
                    "Mouse reporting is opt-in (F2 cycles it) because while it is on the terminal " +
                    "stops scrolling its scrollback with the wheel and selecting text on drag.",
                },
              ]}
              onChange={() => tui.setFocus(tabs!)}
              ref={(component) => {
                tabs = component;
              }}
            />
          ),
        }]}
      />
      <Text>{() => grey(`mouse: ${mouse()} · focus: ${focusName()}`)}</Text>
      <Show when={help}>
        <Overlay
          title="Keys"
          anchor="top-right"
          width={44}
          closeOnPressOutside
          onClose={() => help.set(false)}
        >
          <Text text={HELP} />
        </Overlay>
      </Show>
      <Show when={confirming}>
        <Modal
          title="Delete project?"
          buttons={[
            { label: "Cancel" },
            {
              label: "Delete",
              variant: "danger",
              onPress: () => toaster.show("Project deleted", { kind: "error" }),
            },
          ]}
          onClose={(reason) => {
            confirming.set(false);

            if (reason !== "button") {
              toaster.show(`Kept (closed by ${reason})`, { kind: "info" });
            }
          }}
        >
          This removes 42 files from disk. Esc or Cancel keeps everything.
        </Modal>
      </Show>
    </>
  );
}

mount(<App />, new TUI(new ProcessTerminal(), { mouse: "move" }));
