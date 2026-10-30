import { type LineStyle, Text as TextComponent } from "../../../mod.ts";
import { type MaybeAccessor, read } from "../signal.ts";
import { initial, type RefProps, setup, watch } from "./props.ts";

/**
 * A piece of {@linkcode Text} content: a string, a number, or an accessor of
 * one.
 *
 * @category Text
 */
export type TextPart = MaybeAccessor<string | number>;

/**
 * Props of {@linkcode Text}.
 *
 * @category Text
 */
export interface TextProps extends RefProps<TextComponent> {
  /** The content; reactive. Takes precedence over the children. */
  text?: MaybeAccessor<string>;
  /** The content as parts joined together, e.g. `Count: {count}`; reactive. */
  children?: TextPart | readonly TextPart[];
  /** Columns of blank margin on each side. Default 0. */
  paddingX?: number;
  /** Blank rows above and below. Default 0. */
  paddingY?: number;
  /** Applied to each full-width row; see {@linkcode LineStyle}. */
  style?: LineStyle;
}

/**
 * Word-wrapped text: the JSX form of the class component `Text`. The
 * content follows signals read in the `text` prop or the children.
 *
 * @param props Content, padding and row style.
 * @returns The text component.
 *
 * @example Show a live count
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { Text } from "@neonbyte/tui/reactive/components";
 *
 * const count = signal(1);
 *
 * root(() => {
 *   const text = toComponent(<Text>Count: {count}</Text>);
 *
 *   count.set(2);
 *   assertEquals(text.render(20), ["Count: 2"]);
 * });
 * ```
 *
 * @category Text
 */
export function Text(props: TextProps): TextComponent {
  const children = props.children;
  const parts = Array.isArray(children)
    ? children as readonly TextPart[]
    : children === undefined
    ? []
    : [children as TextPart];
  const content: MaybeAccessor<string> = props.text ??
    (parts.some((part) => typeof part === "function")
      ? () => parts.map((part) => String(read(part))).join("")
      : parts.join(""));
  const text = new TextComponent(
    initial(content),
    props.paddingX,
    props.paddingY,
    props.style,
  );

  watch(content, (value) => text.setText(value));

  return setup(text, props);
}
