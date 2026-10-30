import { type Component, Container, Text } from "../../mod.ts";
import { useHost } from "./host.ts";
import { type Accessor, effect, untrack } from "./signal.ts";

/**
 * What a JSX expression evaluates to: a description of a component, created
 * only when it is placed (by a parent, {@linkcode mount} or
 * {@linkcode toComponent}). Placing the same element twice creates two
 * independent components.
 *
 * @category JSX
 */
export interface Element {
  /** The function component to call. */
  readonly type: FunctionComponent<never>;
  /** The props to call it with, `children` included. */
  readonly props: object;
}

/**
 * Anything that can appear as a JSX child or be returned by a function
 * component:
 *
 * - an {@linkcode Element} or any {@linkcode Component} instance;
 * - a string or number, shown as text;
 * - `null`, `undefined` or a boolean, shown as nothing;
 * - an array of children, stacked;
 * - a function returning a child: a reactive region, re-created whenever a
 *   signal the function read changes. Text updates in place.
 *
 * @category JSX
 */
export type Child =
  | Element
  | Component
  | string
  | number
  | boolean
  | null
  | undefined
  | (() => Child)
  | readonly Child[];

/**
 * A component written as a function: it runs once, when the element is
 * placed, and returns what to show. Reactive props are read through
 * accessors, so the function never re-runs.
 *
 * @typeParam P The props.
 *
 * @category JSX
 */
export type FunctionComponent<P> = (props: P) => Child;

const elements = new WeakSet<object>();

/**
 * Create an element; what the JSX compiler emits for `<Type {...props} />`.
 *
 * @typeParam P The component's props.
 * @param type The function component.
 * @param props Its props, `children` included.
 * @returns The element, not yet created.
 *
 * @example Create an element without JSX
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Container } from "@neonbyte/tui";
 * import { h, toComponent } from "@neonbyte/tui/reactive";
 *
 * const Greeting = (props: { name: string }) => `Hello, ${props.name}`;
 * const component = toComponent(h(Greeting, { name: "Ada" }));
 *
 * assertEquals(component.render(20), ["Hello, Ada"]);
 * assertEquals(component instanceof Container, false);
 * ```
 *
 * @category JSX
 */
export function h<P extends object>(
  type: FunctionComponent<P>,
  props: P,
): Element {
  const element: Element = { type: type as FunctionComponent<never>, props };

  elements.add(element);

  return element;
}

/**
 * Whether `value` is an {@linkcode Element}.
 *
 * @param value Any value.
 * @returns `true` for elements made by JSX or {@linkcode h}.
 *
 * @example Tell elements from components
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Text } from "@neonbyte/tui";
 * import { h, isElement } from "@neonbyte/tui/reactive";
 *
 * assertEquals(isElement(h(() => "hi", {})), true);
 * assertEquals(isElement(new Text("hi")), false);
 * ```
 *
 * @category JSX
 */
export function isElement(value: unknown): value is Element {
  return typeof value === "object" && value !== null && elements.has(value);
}

function isComponent(value: object): value is Component {
  return typeof (value as Partial<Component>).render === "function";
}

/** Children of an array child, nested arrays flattened. */
function flatten(children: readonly Child[], into: Child[] = []): Child[] {
  for (const child of children) {
    if (Array.isArray(child)) {
      flatten(child, into);
    } else {
      into.push(child as Child);
    }
  }

  return into;
}

/** A container showing `children` one below the other. */
export function stack(children: readonly Child[]): Container {
  const container = new Container();

  container.children = flatten(children).map(toComponent);

  return container;
}

/** A region showing what `accessor` returns, re-created when it changes. */
function region(accessor: Accessor<Child>): Component {
  const host = useHost();
  const container = new Container();
  let text: Text | undefined;

  effect(() => {
    const child = accessor();

    untrack(() => {
      if (typeof child === "string" || typeof child === "number") {
        if (text === undefined) {
          text = new Text(String(child));
          container.children = [text];
        } else {
          text.setText(String(child));
        }
      } else {
        text = undefined;
        container.children = [toComponent(child)];
      }
    });
    host.requestRender();
  });

  return container;
}

/**
 * Create the component a child describes (see {@linkcode Child}), calling
 * function components in the current owner. Use it to hand JSX to imperative
 * APIs such as `tui.showOverlay`.
 *
 * @param child What to create.
 * @returns The component; an empty one for nothing.
 *
 * @example Turn JSX into a component
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { toComponent } from "@neonbyte/tui/reactive";
 * import { Column } from "@neonbyte/tui/reactive/components";
 *
 * const component = toComponent(
 *   <Column>
 *     {"first"}
 *     {["second", 3]}
 *   </Column>,
 * );
 *
 * assertEquals(component.render(20), ["first", "second", "3"]);
 * ```
 *
 * @category JSX
 */
export function toComponent(child: Child): Component {
  if (child === null || child === undefined || typeof child === "boolean") {
    return new Container();
  }

  if (typeof child === "string" || typeof child === "number") {
    return new Text(String(child));
  }

  if (typeof child === "function") {
    return region(child);
  }

  if (Array.isArray(child)) {
    const children = flatten(child);

    return children.length === 1 ? toComponent(children[0]) : stack(children);
  }

  if (isElement(child)) {
    const { type, props } = child;

    return toComponent(untrack(() => type(props as never)));
  }

  if (isComponent(child as object)) {
    return child as Component;
  }

  throw new TypeError(`Not a JSX child: ${String(child)}`);
}
