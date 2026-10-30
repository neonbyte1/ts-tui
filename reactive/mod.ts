/**
 * Signals, effects and composables for `@neonbyte/tui`: describe the UI once and
 * let it follow your state, instead of calling setters and
 * `tui.requestRender()` by hand.
 *
 * - {@linkcode signal}, {@linkcode computed}, {@linkcode effect},
 *   {@linkcode batch}, {@linkcode untrack}, {@linkcode onCleanup} and
 *   {@linkcode root}: fine-grained reactivity. Effects re-run exactly when
 *   what they read changes.
 * - {@linkcode mount} creates a JSX tree on a {@linkcode TUI}; components
 *   from `@neonbyte/tui/reactive/components` turn reactive props into setter
 *   calls and redraws.
 * - Composables ({@linkcode useKeys}, {@linkcode useInput},
 *   {@linkcode useInterval}, {@linkcode useTerminalSize},
 *   {@linkcode useToaster}, {@linkcode useTUI}) are plain functions:
 *   components run once, so there are no rules about where to call them.
 * - {@linkcode bind} drives the class components of `@neonbyte/tui` from signals
 *   without JSX.
 *
 * JSX needs `"jsx": "react-jsx"` and `"jsxImportSource": "@neonbyte/tui/reactive"`
 * in `compilerOptions`. There is no compiler transform, so pass signals
 * themselves (`text={count}`) or accessors (`text={() => count() * 2}`) where
 * a prop should follow them; `text={count()}` reads the value once.
 *
 * @example A counter driven by a key
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { mount, signal, useKeys } from "@neonbyte/tui/reactive";
 * import { Text } from "@neonbyte/tui/reactive/components";
 *
 * function Counter() {
 *   const count = signal(0);
 *
 *   useKeys({ up: () => count.update((n) => n + 1) });
 *
 *   return <Text>Count: {count}</Text>;
 * }
 *
 * const terminal = new VirtualTerminal(20, 3);
 * const tui = new TUI(terminal);
 *
 * mount(<Counter />, tui);
 * terminal.send("\x1b[A");
 * tui.renderNow();
 *
 * assertEquals(terminal.viewport()[0], "Count: 1");
 * tui.stop();
 * ```
 *
 * @example Drive a class component without JSX
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Text } from "@neonbyte/tui";
 * import { bind, signal } from "@neonbyte/tui/reactive";
 *
 * const tokens = signal(0);
 * const status = new Text();
 *
 * bind(status, "text", () => `${tokens()} tokens`);
 * tokens.set(42);
 *
 * assertEquals(status.text, "42 tokens");
 * ```
 *
 * @module
 */

export {
  type Accessor,
  batch,
  computed,
  type Context,
  createContext,
  effect,
  type MaybeAccessor,
  onCleanup,
  provide,
  read,
  root,
  type Signal,
  signal,
  type SignalOptions,
  untrack,
  useContext,
} from "../src/reactive/signal.ts";
export {
  type Child,
  type Element,
  type FunctionComponent,
  h,
  isElement,
  toComponent,
} from "../src/reactive/jsx.ts";
export { bind, type Bindable, mount } from "../src/reactive/mount.ts";
export {
  type TerminalSize,
  useInput,
  useInterval,
  useKeys,
  useTerminalSize,
  useToaster,
  useTUI,
} from "../src/reactive/composables.ts";
