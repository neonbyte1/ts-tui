import { type Component, Container } from "../../mod.ts";
import { useHost } from "./host.ts";
import { type Child, stack, toComponent } from "./jsx.ts";
import {
  type Accessor,
  batch,
  computed,
  type Context,
  createOwner,
  disposeOwner,
  effect,
  getOwner,
  type MaybeAccessor,
  type Owner,
  read,
  runWithOwner,
  type Signal,
  signal,
  untrack,
} from "./signal.ts";

/**
 * Props of {@linkcode Column}.
 *
 * @category Layout
 */
export interface ColumnProps {
  /** Shown one below the other. */
  children?: Child;
}

/**
 * Stack children vertically: the JSX form of {@linkcode Container}.
 *
 * @param props The children.
 * @returns A container with the children.
 *
 * @example Stack text and components
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { toComponent } from "@neonbyte/tui/reactive";
 * import { Column, Text } from "@neonbyte/tui/reactive/components";
 *
 * const column = toComponent(
 *   <Column>
 *     <Text>one</Text>
 *     two
 *   </Column>,
 * );
 *
 * assertEquals(column.render(10), ["one", "two"]);
 * ```
 *
 * @category Layout
 */
export function Column(props: ColumnProps): Component {
  const children = props.children;

  return stack(Array.isArray(children) ? children : [children as Child]);
}

/**
 * Props of {@linkcode Show}.
 *
 * @typeParam T Type of the condition.
 *
 * @category Layout
 */
export interface ShowProps<T> {
  /** Shows the children while truthy, the fallback otherwise. */
  when: MaybeAccessor<T>;
  /** Shown while `when` is falsy. */
  fallback?: Child;
  /**
   * Shown while `when` is truthy; created each time it turns truthy and
   * disposed when it turns falsy. A function receives an accessor of the
   * (truthy) value.
   */
  children?: Child | ((value: Accessor<NonNullable<T>>) => Child);
}

/** Shows `create()` in `container` whenever `key` changes, disposing the previous one. */
function swap<K>(key: Accessor<K>, create: (key: K) => Child): Component {
  const host = useHost();
  const container = new Container();

  effect(() => {
    const value = key();

    container.children = [untrack(() => toComponent(create(value)))];

    host.requestRender();
  });

  return container;
}

/**
 * Show the children while a condition holds, else the fallback. Only a
 * change of truthiness re-creates them; use accessor props inside to follow
 * the value itself.
 *
 * @typeParam T Type of the condition.
 * @param props Condition, children and fallback.
 * @returns A component showing one or the other.
 *
 * @example Toggle a status line
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { Show } from "@neonbyte/tui/reactive/components";
 *
 * const busy = signal(false);
 *
 * root(() => {
 *   const status = toComponent(
 *     <Show when={busy} fallback="idle">
 *       working
 *     </Show>,
 *   );
 *
 *   assertEquals(status.render(10), ["idle"]);
 *   busy.set(true);
 *   assertEquals(status.render(10), ["working"]);
 * });
 * ```
 *
 * @category Layout
 */
export function Show<T>(props: ShowProps<T>): Component {
  const shown = computed(() => Boolean(read(props.when)));
  const value = () => read(props.when) as NonNullable<T>;

  return swap(shown, (truthy) => {
    if (!truthy) {
      return props.fallback;
    }

    const children = props.children;

    // A function child is a reactive region; it gets the value accessor.
    return typeof children === "function"
      ? () => (children as (value: Accessor<NonNullable<T>>) => Child)(value)
      : children;
  });
}

/**
 * Props of {@linkcode For}.
 *
 * @typeParam T Type of the items.
 *
 * @category Layout
 */
export interface ForProps<T> {
  /** The items, in order. */
  each: MaybeAccessor<readonly T[]>;
  /** Shown while there are no items. */
  fallback?: Child;
  /**
   * Shows one item; called once per item (by identity) while it stays in the
   * list, with an accessor of its current index.
   */
  children: (item: T, index: Accessor<number>) => Child;
}

interface Row {
  readonly owner: Owner;
  readonly component: Component;
  readonly index: Signal<number>;
}

/**
 * Show one component per item of a list. Items are matched by identity: an
 * item that stays in the list keeps its component (and its state, such as a
 * caret or a running animation) when others are added, removed or
 * reordered; a removed item's component is disposed.
 *
 * @typeParam T Type of the items.
 * @param props The items and how to show one.
 * @returns A component stacking the items' components.
 *
 * @example Render a growing list
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { For } from "@neonbyte/tui/reactive/components";
 *
 * const todos = signal(["write", "test"]);
 *
 * root(() => {
 *   const list = toComponent(
 *     <For each={todos} fallback="nothing to do">
 *       {(todo, index) => () => `${index() + 1}. ${todo}`}
 *     </For>,
 *   );
 *
 *   assertEquals(list.render(20), ["1. write", "2. test"]);
 *   todos.set(["ship", "write", "test"]);
 *   assertEquals(list.render(20), ["1. ship", "2. write", "3. test"]);
 *   todos.set([]);
 *   assertEquals(list.render(20), ["nothing to do"]);
 * });
 * ```
 *
 * @category Layout
 */
export function For<T>(props: ForProps<T>): Component {
  const host = useHost();
  const parent = getOwner();
  const container = new Container();
  let rows = new Map<T, Row[]>();
  let fallback: Owner | undefined;

  const create = (child: () => Child): { owner: Owner; component: Component } =>
    runWithOwner(parent, () => {
      const owner = createOwner();

      return {
        owner,
        component: runWithOwner(owner, () => toComponent(child())),
      };
    });

  effect(() => {
    const items = read(props.each);

    untrack(() =>
      batch(() => {
        const next = new Map<T, Row[]>();
        const children: Component[] = [];

        items.forEach((item, i) => {
          let row = rows.get(item)?.shift();

          if (row === undefined) {
            const index = signal(i);

            row = { ...create(() => props.children(item, index)), index };
          } else {
            row.index.set(i);
          }

          let same = next.get(item);

          if (same === undefined) {
            same = [];

            next.set(item, same);
          }

          same.push(row);
          children.push(row.component);
        });

        for (const left of rows.values()) {
          for (const row of left) {
            disposeOwner(row.owner);
          }
        }

        rows = next;

        if (children.length > 0 || props.fallback === undefined) {
          if (fallback !== undefined) {
            disposeOwner(fallback);

            fallback = undefined;
          }

          container.children = children;
        } else if (fallback === undefined) {
          const shown = create(() => props.fallback);

          fallback = shown.owner;
          container.children = [shown.component];
        }
      })
    );
    host.requestRender();
  });

  return container;
}

/**
 * Props of {@linkcode Provider}.
 *
 * @typeParam T The context's value type.
 *
 * @category Layout
 */
export interface ProviderProps<T> {
  /** The context to set. */
  context: Context<T>;
  /** Its value for the children. Pass a signal to make it reactive. */
  value: T;
  /** Created with the value in context. */
  children?: Child;
}

/**
 * Provide a context value to the children (see {@linkcode createContext}).
 *
 * @typeParam T The context's value type.
 * @param props The context, its value, and the children.
 * @returns The children's component.
 *
 * @example Theme a subtree
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { createContext, toComponent, useContext } from "@neonbyte/tui/reactive";
 * import { Provider } from "@neonbyte/tui/reactive/components";
 *
 * const Accent = createContext("plain");
 * const Label = () => `accent: ${useContext(Accent)}`;
 * const component = toComponent(
 *   <Provider context={Accent} value="cyan">
 *     <Label />
 *   </Provider>,
 * );
 *
 * assertEquals(component.render(20), ["accent: cyan"]);
 * ```
 *
 * @category Layout
 */
export function Provider<T>(props: ProviderProps<T>): Component {
  const owner = createOwner();

  (owner.context ??= new Map()).set(props.context.id, props.value);

  return runWithOwner(owner, () => toComponent(props.children));
}
