/**
 * JSX runtime of `@neonbyte/tui/reactive`, loaded by the compiler. Enable it in
 * `deno.json`:
 *
 * ```json
 * {
 *   "compilerOptions": {
 *     "jsx": "react-jsx",
 *     "jsxImportSource": "@neonbyte/tui/reactive"
 *   }
 * }
 * ```
 *
 * Every tag is a function component (there are no lowercase tags), and a JSX
 * expression is an element: a description that is created when it is placed.
 *
 * @example Compile JSX to elements
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { isElement, toComponent } from "@neonbyte/tui/reactive";
 *
 * const Hello = (props: { name: string }) => `Hello, ${props.name}`;
 * const element = <Hello name="Ada" />;
 *
 * assertEquals(isElement(element), true);
 * assertEquals(toComponent(element).render(20), ["Hello, Ada"]);
 * ```
 *
 * @module
 */

import {
  type Child,
  type Element as FlowElement,
  type FunctionComponent,
  h,
} from "../src/reactive/jsx.ts";

/**
 * Create an element with at most one child; emitted by the compiler.
 *
 * @typeParam P The component's props.
 * @param type The function component.
 * @param props Its props, `children` included.
 * @returns The element.
 *
 * @example Call the runtime directly
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { jsx } from "@neonbyte/tui/reactive/jsx-runtime";
 *
 * const Hello = (props: { name: string }) => `Hello, ${props.name}`;
 *
 * assertEquals(jsx(Hello, { name: "Ada" }).props, { name: "Ada" });
 * ```
 *
 * @category JSX
 */
export function jsx<P extends object>(
  type: FunctionComponent<P>,
  props: P,
): FlowElement {
  return h(type, props);
}

/**
 * Create an element with several children; emitted by the compiler.
 *
 * @typeParam P The component's props.
 * @param type The function component.
 * @param props Its props; `children` is an array.
 * @returns The element.
 *
 * @example Call the runtime directly
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { Fragment, jsxs } from "@neonbyte/tui/reactive/jsx-runtime";
 *
 * const element = jsxs(Fragment, { children: ["a", "b"] });
 *
 * assertEquals(element.props, { children: ["a", "b"] });
 * ```
 *
 * @category JSX
 */
export function jsxs<P extends object>(
  type: FunctionComponent<P>,
  props: P,
): FlowElement {
  return h(type, props);
}

/**
 * The children of `<>…</>`, stacked one below the other.
 *
 * @param props The children.
 * @returns The children as they are.
 *
 * @example Group without a wrapper component
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { toComponent } from "@neonbyte/tui/reactive";
 *
 * const component = toComponent(
 *   <>
 *     {"a"}
 *     {"b"}
 *   </>,
 * );
 *
 * assertEquals(component.render(5), ["a", "b"]);
 * ```
 *
 * @category JSX
 */
export function Fragment(props: { children?: Child }): Child {
  return props.children;
}

/**
 * Types the compiler checks JSX against.
 *
 * @category JSX
 */
export declare namespace JSX {
  /** What a JSX expression evaluates to. */
  export type Element = FlowElement;
  /** What may be used as a tag: function components only. */
  export type ElementType = FunctionComponent<never>;

  /** There are no lowercase tags; every tag is a component. */
  // deno-lint-ignore no-empty-interface
  export interface IntrinsicElements {}

  /** The prop that receives the children. */
  export interface ElementChildrenAttribute {
    /** Children of the element. */
    children: unknown;
  }
}
