import type { Component } from "../../../mod.ts";
import { TUIContext, useHost } from "../host.ts";
import {
  type Accessor,
  effect,
  type MaybeAccessor,
  onCleanup,
  read,
  untrack,
  useContext,
} from "../signal.ts";

/**
 * Props every component accepts.
 *
 * @typeParam C The class component it creates.
 *
 * @category Core
 */
export interface RefProps<C> {
  /** Receives the created class component, for imperative calls (e.g. `addToHistory`). */
  ref?: (component: C) => void;
}

/**
 * Props of components that can hold the keyboard focus.
 *
 * @category Core
 */
export interface FocusProps {
  /**
   * Focus the component while true; when it turns false the component gives
   * up the focus (if it still has it). A component also gives it up when it
   * is disposed. Needs a mounted tree.
   */
  focus?: MaybeAccessor<boolean>;
}

/** `value` read once, without subscribing: what the class component is created with. */
export function initial<T>(value: MaybeAccessor<T>): T {
  return untrack(() => read(value));
}

/**
 * Re-apply an accessor prop on every change after the first (the class
 * component was created with the first value), then schedule a redraw.
 * Plain values are not watched.
 */
export function watch<T>(
  value: MaybeAccessor<T> | undefined,
  apply: (value: T) => void,
): void {
  if (typeof value !== "function") {
    return;
  }

  const host = useHost();
  let first = true;

  effect(() => {
    const next = (value as Accessor<T>)();

    if (first) {
      first = false;

      return;
    }

    untrack(() => apply(next));
    host.requestRender();
  });
}

/** Hand the component to `ref` and follow the `focus` prop; returns the component. */
export function setup<C extends Component>(
  component: C,
  props: RefProps<C> & FocusProps,
): C {
  const tui = useContext(TUIContext);
  const focus = props.focus;

  if (tui !== undefined && focus !== undefined) {
    effect(() => {
      if (read(focus)) {
        tui.setFocus(component);
      } else if (untrack(() => tui.focused) === component) {
        tui.setFocus(null);
      }
    });
    onCleanup(() => {
      if (tui.focused === component) {
        tui.setFocus(null);
      }
    });
  }

  props.ref?.(component);

  return component;
}

/** Start an animated component now and stop it when its owner is disposed. */
export function animate(component: { start(): void; stop(): void }): void {
  component.start();
  onCleanup(() => component.stop());
}
