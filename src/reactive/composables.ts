import {
  type InputListener,
  type Key,
  matchesKey,
  Toaster,
  type ToasterOptions,
  type TUI,
} from "../../mod.ts";
import { TUIContext } from "./host.ts";
import {
  type Accessor,
  onCleanup,
  type Signal,
  signal,
  useContext,
} from "./signal.ts";

/**
 * The TUI the current component tree is mounted on.
 *
 * @returns The TUI passed to {@linkcode mount}.
 * @throws {Error} Outside a mounted tree.
 *
 * @example Stop the TUI from a component
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { mount, useTUI } from "@neonbyte/tui/reactive";
 *
 * const tui = new TUI(new VirtualTerminal(20, 3));
 * let seen: TUI | undefined;
 *
 * function App() {
 *   seen = useTUI();
 *
 *   return "app";
 * }
 *
 * mount(<App />, tui);
 * assertEquals(seen, tui);
 * tui.stop();
 * ```
 *
 * @category Composables
 */
export function useTUI(): TUI {
  const tui = useContext(TUIContext);

  if (tui === undefined) {
    throw new Error("useTUI() needs a mounted tree: call it inside mount()");
  }

  return tui;
}

/**
 * Receive every key, paste and mouse event before the focused component, for
 * as long as the current owner lives. Return `true` from the listener to
 * consume the event.
 *
 * @param listener Called with each event.
 * @throws {Error} Outside a mounted tree.
 *
 * @example Count pastes
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { mount, useInput } from "@neonbyte/tui/reactive";
 *
 * const terminal = new VirtualTerminal(20, 3);
 * const tui = new TUI(terminal);
 * const pasted: string[] = [];
 *
 * function App() {
 *   useInput((event) => {
 *     if (event.type === "paste") {
 *       pasted.push(event.text);
 *     }
 *   });
 *
 *   return null;
 * }
 *
 * const dispose = mount(<App />, tui);
 *
 * terminal.send("\x1b[200~hello\x1b[201~");
 * dispose();
 * terminal.send("\x1b[200~ignored\x1b[201~");
 * tui.stop();
 *
 * assertEquals(pasted, ["hello"]);
 * ```
 *
 * @category Composables
 */
export function useInput(listener: InputListener): void {
  onCleanup(useTUI().addInputListener(listener));
}

/**
 * Handle global shortcuts for as long as the current owner lives. Each key
 * spec (see {@linkcode matchesKey}) maps to a handler; a matching key is
 * consumed unless its handler returns `false`.
 *
 * @param bindings Handler per key spec, e.g. `{ "ctrl+o": toggleHelp }`.
 * @throws {Error} Outside a mounted tree.
 *
 * @example Toggle with a shortcut
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { mount, signal, useKeys } from "@neonbyte/tui/reactive";
 *
 * const terminal = new VirtualTerminal(20, 3);
 * const tui = new TUI(terminal);
 * const open = signal(false);
 *
 * function App() {
 *   useKeys({ "ctrl+o": () => open.update((value) => !value) });
 *
 *   return null;
 * }
 *
 * mount(<App />, tui);
 * terminal.send("\x0f");
 * tui.stop();
 *
 * assertEquals(open(), true);
 * ```
 *
 * @category Composables
 */
export function useKeys(
  bindings: Readonly<Record<string, (key: Key) => unknown>>,
): void {
  const entries = Object.entries(bindings);

  useInput((event) => {
    if (event.type !== "key") {
      return;
    }

    for (const [spec, handler] of entries) {
      if (matchesKey(event.key, spec)) {
        return handler(event.key) !== false;
      }
    }
  });
}

/**
 * Call `fn` every `ms` milliseconds for as long as the current owner lives.
 *
 * @param fn Called on every tick.
 * @param ms Interval in milliseconds.
 *
 * @example Tick until disposed
 * ```ts no-assert
 * import { root, signal, useInterval } from "@neonbyte/tui/reactive";
 *
 * const ticks = signal(0);
 *
 * root((dispose) => {
 *   useInterval(() => ticks.update((n) => n + 1), 1000);
 *   dispose(); // clears the timer
 * });
 * ```
 *
 * @category Composables
 */
export function useInterval(fn: () => void, ms: number): void {
  const timer = setInterval(fn, ms);

  onCleanup(() => clearInterval(timer));
}

/**
 * Size of the terminal in cells, as columns and rows.
 *
 * @category Composables
 */
export interface TerminalSize {
  /** Width in cells. */
  readonly columns: number;
  /** Height in rows. */
  readonly rows: number;
}

/**
 * The terminal's size, updated on every resize for as long as the current
 * owner lives.
 *
 * @returns An accessor of the current size.
 * @throws {Error} Outside a mounted tree.
 *
 * @example Show the width
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { mount, useTerminalSize } from "@neonbyte/tui/reactive";
 *
 * const terminal = new VirtualTerminal(30, 3);
 * const tui = new TUI(terminal);
 *
 * function Width() {
 *   const size = useTerminalSize();
 *
 *   return () => `${size().columns} columns`;
 * }
 *
 * mount(<Width />, tui);
 * terminal.resize(25, 3);
 * tui.renderNow();
 *
 * assertEquals(terminal.viewport()[0], "25 columns");
 * tui.stop();
 * ```
 *
 * @category Composables
 */
export function useTerminalSize(): Accessor<TerminalSize> {
  const tui = useTUI();
  const measure = (): TerminalSize => ({
    columns: tui.terminal.columns,
    rows: tui.terminal.rows,
  });
  const size: Signal<TerminalSize> = signal(measure(), {
    equals: (a, b) => a.columns === b.columns && a.rows === b.rows,
  });

  onCleanup(tui.addResizeListener(() => size.set(measure())));

  return size;
}

/**
 * A {@linkcode Toaster} on the mounted TUI whose toasts are dismissed when
 * the current owner is disposed.
 *
 * @param options Placement, size, timing and theme of the toasts.
 * @returns The toaster; call `show` on it.
 * @throws {Error} Outside a mounted tree.
 *
 * @example Show a toast
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { mount, useToaster } from "@neonbyte/tui/reactive";
 *
 * const tui = new TUI(new VirtualTerminal(40, 8));
 * let count = 0;
 *
 * function App() {
 *   const toaster = useToaster({ anchor: "top-right" });
 *
 *   toaster.show("Saved", { kind: "success" });
 *   count = toaster.count;
 *
 *   return null;
 * }
 *
 * const dispose = mount(<App />, tui);
 *
 * dispose();
 * tui.stop();
 * assertEquals(count, 1);
 * ```
 *
 * @category Composables
 */
export function useToaster(options?: ToasterOptions): Toaster {
  const toaster = new Toaster(useTUI(), options);

  onCleanup(() => toaster.dismissAll());

  return toaster;
}
