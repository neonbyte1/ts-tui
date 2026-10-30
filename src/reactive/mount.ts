import type { TUI } from "../../mod.ts";
import { TUIContext, useHost } from "./host.ts";
import { type Child, toComponent } from "./jsx.ts";
import { type Accessor, effect, provide, root, untrack } from "./signal.ts";

/**
 * Create `app` on `tui`: its components become a child of the TUI, the
 * composables inside it see the TUI, and the TUI is started (when it is not
 * already). Reactive updates schedule a redraw.
 *
 * @param app What to show, usually a JSX element such as `<App />`.
 * @param tui The TUI to show it on.
 * @returns A function that disposes the app and removes it from the TUI. The
 * TUI keeps running; call `tui.stop()` to restore the terminal.
 *
 * @example Mount a counter on a virtual terminal
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { mount, signal } from "@neonbyte/tui/reactive";
 * import { Text } from "@neonbyte/tui/reactive/components";
 *
 * const terminal = new VirtualTerminal(20, 3);
 * const tui = new TUI(terminal);
 * const count = signal(0);
 * const dispose = mount(<Text>Count: {count}</Text>, tui);
 *
 * tui.renderNow();
 * assertEquals(terminal.viewport()[0], "Count: 0");
 *
 * count.set(1);
 * tui.renderNow();
 * assertEquals(terminal.viewport()[0], "Count: 1");
 *
 * dispose();
 * tui.stop();
 * ```
 *
 * @category Composables
 */
export function mount(app: Child, tui: TUI): () => void {
  return root((dispose) => {
    provide(TUIContext, tui);

    const component = toComponent(app);

    tui.addChild(component);
    tui.start();

    return () => {
      dispose();
      tui.removeChild(component);
      tui.requestRender();
    };
  });
}

/**
 * Props `bind` can drive on a component of type `C`: one per `setX` method,
 * typed by its first parameter (`setText(text: string)` gives `text: string`).
 *
 * @typeParam C The component's type.
 *
 * @category Reactivity
 */
export type Bindable<C> = {
  [K in keyof C as K extends `set${infer Name}` ? Uncapitalize<Name> : never]:
    C[K] extends (value: infer V, ...rest: never[]) => unknown ? V : never;
};

/**
 * Keep a component's prop in sync with an accessor: calls its `setX` method
 * now and whenever the accessor changes, then schedules a redraw of the
 * mounted TUI. Use it to drive class components from signals; JSX components
 * do this for their reactive props.
 *
 * @typeParam C The component's type.
 * @typeParam K The prop's name.
 * @param component The component to update.
 * @param prop Which setter to call: `"text"` calls `setText`.
 * @param value The value to keep it at.
 * @returns A function that stops syncing. It also stops with the owner.
 *
 * @example Drive a status line from a signal
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Text } from "@neonbyte/tui";
 * import { bind, signal } from "@neonbyte/tui/reactive";
 *
 * const busy = signal(false);
 * const status = new Text();
 *
 * bind(status, "text", () => busy() ? "working…" : "idle");
 * assertEquals(status.text, "idle");
 *
 * busy.set(true);
 * assertEquals(status.text, "working…");
 * ```
 *
 * @category Reactivity
 */
export function bind<C extends object, K extends keyof Bindable<C> & string>(
  component: C,
  prop: K,
  value: Accessor<Bindable<C>[K]>,
): () => void {
  const name = `set${prop[0].toUpperCase()}${prop.slice(1)}`;
  const setter = (component as Record<string, unknown>)[name];

  if (typeof setter !== "function") {
    throw new TypeError(`The component has no ${name} method`);
  }

  const host = useHost();

  return effect(() => {
    const next = value();

    untrack(() => setter.call(component, next));
    host.requestRender();
  });
}
