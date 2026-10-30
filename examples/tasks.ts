// Task indicators: a spinner per glyph set that settles into ✔ / ✘ / skipped
// and starts again, an agent-style plan that works through its steps, and an
// interactive to-do list. ↑/↓ select, Space toggles, Ctrl+C quits.
// Run: deno task tui:tasks
import process from "node:process";
import {
  Checklist,
  type ChecklistItem,
  matchesKey,
  paint,
  ProcessTerminal,
  Spacer,
  Spinner,
  STATUS_GLYPHS,
  Text,
  TUI,
} from "../mod.ts";

const tui = new TUI(new ProcessTerminal());
const heading = (text: string) => new Text(paint(text, { bold: true }));
const grey = (text: string) => paint(text, { fg: "#5c6370" });

function wait(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();

  setTimeout(resolve, ms);

  return promise;
}

// One spinner per glyph set, each ending a different way on every pass.
const endings = ["succeed", "fail", "skip"] as const;
const outcomes = { succeed: "done", fail: "failed", skip: "skipped" };

async function loopSpinner(spinner: Spinner, name: string, offset: number) {
  for (let pass = offset;; pass++) {
    const ending = endings[pass % endings.length];

    spinner.start(`${name.padEnd(9)}${grey("working…")}`);

    await wait(1200 + 300 * offset);

    spinner[ending](`${name.padEnd(9)}${grey(outcomes[ending])}`);

    await wait(1500);
  }
}

tui.addChild(heading("spinners"));

Object.entries(STATUS_GLYPHS).forEach(([name, glyphs], i) => {
  const spinner = new Spinner(tui, name, { glyphs });

  tui.addChild(spinner);

  void loopSpinner(spinner, name, i);
});

// An agent working through a plan: one step at a time, then a failing test
// run and a skipped step, and the plan starts over.
const steps: ChecklistItem[] = [
  "Read src/tui.ts",
  "Design the Spinner API",
  "Write src/status.ts and the two components",
  "Run deno test",
  "Update the README",
].map((label) => ({ label, state: "pending" }));
const plan = new Checklist(tui, { items: steps, glyphs: STATUS_GLYPHS.dots });

async function loopPlan() {
  for (;;) {
    plan.setItems(steps);

    await wait(800);

    for (let i = 0; i < 3; i++) {
      plan.setState(i, "running");

      await wait(1400);

      plan.setState(i, "done");
    }

    plan.update(3, { state: "running", note: "114 tests" });

    await wait(1800);

    plan.update(3, { state: "failed", note: "1 failed" });
    plan.setState(4, "skipped");

    await wait(3000);
  }
}

tui.addChild(new Spacer());
tui.addChild(heading("agent plan"));
tui.addChild(plan);

void loopPlan();

// A to-do list the keyboard controls.
const todo = new Checklist(tui, {
  interactive: true,
  items: [
    { label: "Buy milk", state: "done" },
    { label: "Water the plants", state: "pending" },
    {
      label:
        "Read the WezTerm docs on cursor styles and blink rates, then tidy the config",
      state: "pending",
    },
    { label: "Call the bank about the card", state: "pending" },
  ],
});
const summary = new Text("");

function updateSummary(): void {
  const done = todo.items.filter((item) => item.state === "done").length;

  summary.setText(
    grey(
      `${done}/${todo.items.length} done · ↑/↓ select · space toggles · ctrl+c quits`,
    ),
  );
}

todo.onToggle = updateSummary;

tui.addChild(new Spacer());
tui.addChild(heading("to-do"));
tui.addChild(todo);
tui.addChild(summary);
tui.setFocus(todo);
tui.addInputListener((event) => {
  if (event.type === "key" && matchesKey(event.key, "ctrl+c")) {
    tui.stop();
    process.exit(0);
  }
});

updateSummary();
tui.start();
