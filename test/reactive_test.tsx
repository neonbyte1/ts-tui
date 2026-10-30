import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { type Component, TUI, VirtualTerminal } from "../mod.ts";
import {
  batch,
  computed,
  effect,
  mount,
  onCleanup,
  root,
  signal,
  toComponent,
  useKeys,
} from "../reactive/mod.ts";
import { Editor, For, Show, Text } from "../reactive/components/mod.ts";

Deno.test("an effect over a diamond runs once per write and never sees a mixed state", () => {
  const first = signal("a");
  const upper = computed(() => first().toUpperCase());
  const twice = computed(() => first() + first());
  const seen: string[] = [];

  effect(() => {
    seen.push(`${upper()}/${twice()}`);
  });
  first.set("b");

  assertEquals(seen, ["A/aa", "B/bb"]);
});

Deno.test("a computed that recomputes to an equal value does not re-run its dependants", () => {
  const count = signal(1);
  const parity = computed(() => count() % 2);
  let runs = 0;

  effect(() => {
    parity();

    runs++;
  });
  count.set(3);

  assertEquals(runs, 1);
});

Deno.test("re-running an effect disposes the effects and cleanups it created", () => {
  const outer = signal(0);
  const inner = signal(0);
  const log: string[] = [];

  effect(() => {
    const generation = outer();

    effect(() => {
      log.push(`inner ${generation}:${inner()}`);
    });
    onCleanup(() => log.push(`cleanup ${generation}`));
  });
  outer.set(1);
  inner.set(1);

  assertEquals(log, [
    "inner 0:0",
    "cleanup 0",
    "inner 1:0",
    "inner 1:1",
  ]);
});

Deno.test("batch runs affected effects once after all writes", () => {
  const a = signal(1);
  const b = signal(2);
  const sums: number[] = [];

  effect(() => {
    sums.push(a() + b());
  });
  batch(() => {
    a.set(10);
    b.set(20);
  });

  assertEquals(sums, [3, 30]);
});

Deno.test("a throwing effect does not stop the others, and the error reaches the writer", () => {
  const count = signal(0);
  const seen: number[] = [];

  effect(() => {
    if (count() === 1) {
      throw new Error("boom");
    }
  });
  effect(() => {
    seen.push(count());
  });

  assertThrows(() => count.set(1), Error, "boom");
  assertEquals(seen, [0, 1]);

  count.set(2);

  assertEquals(seen, [0, 1, 2]);
});

Deno.test("an effect writing a signal it reads does not loop", () => {
  const count = signal(0);

  effect(() => {
    if (count() < 5) {
      count.set(count() + 1);
    }
  });

  assertEquals(count(), 1);
});

Deno.test("For keeps the component of an item that stays and disposes removed ones", () => {
  const a = { name: "a" };
  const b = { name: "b" };
  const items = signal([a, b]);
  const disposed: string[] = [];
  const created = new Map<string, Component>();

  root(() => {
    const list = toComponent(
      <For each={items}>
        {(item) => {
          const text = toComponent(<Text>{item.name}</Text>);

          created.set(item.name, text);
          onCleanup(() => disposed.push(item.name));

          return text;
        }}
      </For>,
    );
    const kept = created.get("b");

    items.set([b]);

    assertEquals(list.render(5), ["b"]);
    assertEquals(disposed, ["a"]);
    assertStrictEquals(created.get("b"), kept);

    items.set([{ name: "c" }, b]);

    assertEquals(list.render(5), ["c", "b"]);
    assertStrictEquals(created.get("b"), kept);
  });
});

Deno.test("Show disposes its children when hidden and creates fresh ones when shown again", () => {
  const open = signal(true);
  let created = 0;
  let disposed = 0;

  function Panel() {
    created++;

    onCleanup(() => disposed++);

    return "panel";
  }

  root(() => {
    const view = toComponent(
      <Show when={open} fallback="closed">
        <Panel />
      </Show>,
    );

    open.set(false);

    assertEquals(view.render(10), ["closed"]);
    assertEquals(disposed, 1);

    open.set(true);

    assertEquals(view.render(10), ["panel"]);
    assertEquals(created, 2);
  });
});

Deno.test("an accessor child that returns text updates one component in place", () => {
  const count = signal(0);

  root(() => {
    const view = toComponent(() => `count ${count()}`) as {
      children: Component[];
    } & Component;
    const text = view.children[0];

    count.set(1);

    assertEquals(view.render(10), ["count 1"]);
    assertStrictEquals(view.children[0], text);
  });
});

Deno.test("disposing a mounted app removes its rows and its key bindings", () => {
  const terminal = new VirtualTerminal(20, 3);
  const tui = new TUI(terminal);
  let presses = 0;

  function App() {
    useKeys({ "ctrl+o": () => presses++ });

    return "app";
  }

  const dispose = mount(<App />, tui);

  terminal.send("\x0f");
  dispose();
  terminal.send("\x0f");
  tui.renderNow();

  assertEquals(presses, 1);
  assertEquals(terminal.viewport()[0], "");
  tui.stop();
});

Deno.test("the focus prop follows its signal and is released on dispose", () => {
  const terminal = new VirtualTerminal(20, 5);
  const tui = new TUI(terminal);
  const editing = signal(true);
  const shown = signal(true);
  let editor: Component | undefined;

  mount(
    <Show when={shown}>
      <Editor
        focus={editing}
        ref={(instance) => {
          editor = instance;
        }}
      />
    </Show>,
    tui,
  );

  assertStrictEquals(tui.focused, editor);

  editing.set(false);

  assertEquals(tui.focused, null);

  editing.set(true);
  shown.set(false);

  assertEquals(tui.focused, null);
  tui.stop();
});

Deno.test("a two-way bound editor keeps its undo history while typing", () => {
  const terminal = new VirtualTerminal(20, 5);
  const tui = new TUI(terminal);
  const draft = signal("");

  mount(<Editor focus value={draft} onChange={draft.set} />, tui);
  terminal.send("ab");
  terminal.send("\x1a"); // ctrl+z

  assertEquals(draft(), "");
  tui.stop();
});
