import {
  type BorderGlyphs,
  Box as BoxComponent,
  type BoxTheme,
} from "../../../mod.ts";
import { type Child, toComponent } from "../jsx.ts";
import type { MaybeAccessor } from "../signal.ts";
import { initial, type RefProps, setup, watch } from "./props.ts";

/**
 * Props of {@linkcode Box}. Reactive props follow signals; the others are
 * read once.
 *
 * @category Layout
 */
export interface BoxProps extends RefProps<BoxComponent> {
  /** The content inside the frame. */
  children?: Child;
  /** Text in the top edge, cut to fit; reactive. `undefined` removes it. */
  title?: MaybeAccessor<string | undefined>;
  /** Text in the bottom edge, right-aligned; reactive. `undefined` removes it. */
  footer?: MaybeAccessor<string | undefined>;
  /** Paints for the frame, title and footer, each replacing its default; reactive. */
  theme?: MaybeAccessor<BoxTheme>;
  /** Frame glyphs. Default `BORDERS.rounded`. */
  border?: BorderGlyphs;
  /** Cells between the border and the content: `[vertical, horizontal]` or one value for both. Default `[0, 1]`. */
  padding?: number | readonly [number, number];
  /** Mark at the end of a title or footer cut to fit. Default `"…"`. */
  ellipsis?: string;
}

/**
 * A border around one child, with an optional title and footer: the JSX form
 * of the class component `Box`. The title, footer and theme follow signals.
 *
 * @param props The content, title, footer and look.
 * @returns The box component.
 *
 * @example Frame some text under a live title
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { Box, Text } from "@neonbyte/tui/reactive/components";
 *
 * const title = signal("Greeting");
 *
 * root(() => {
 *   const box = toComponent(
 *     <Box title={title} theme={{ border: {}, title: {} }}>
 *       <Text>hi</Text>
 *     </Box>,
 *   );
 *
 *   assertEquals(box.render(14), [
 *     "╭─ Greeting ─╮",
 *     "│ hi         │",
 *     "╰────────────╯",
 *   ]);
 *
 *   title.set("Hi");
 *   assertEquals(box.render(10)[0], "╭─ Hi ───╮");
 * });
 * ```
 *
 * @category Layout
 */
export function Box(props: BoxProps): BoxComponent {
  const box = new BoxComponent(toComponent(props.children), {
    border: props.border,
    title: initial(props.title),
    footer: initial(props.footer),
    theme: initial(props.theme),
    padding: props.padding,
    ellipsis: props.ellipsis,
  });

  watch(props.title, (title) => box.setTitle(title));
  watch(props.footer, (footer) => box.setOptions({ footer }));
  watch(props.theme, (theme) => box.setTheme(theme));

  return setup(box, props);
}
