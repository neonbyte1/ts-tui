import {
  Markdown as MarkdownComponent,
  type MarkdownGlyphs,
  type MarkdownLabels,
  type MarkdownTheme,
} from "../../../mod.ts";
import type { MaybeAccessor } from "../signal.ts";
import { initial, type RefProps, setup, watch } from "./props.ts";

/**
 * Props of {@linkcode Markdown}. Reactive props follow signals; the others are
 * read once.
 *
 * @category Text
 */
export interface MarkdownProps extends RefProps<MarkdownComponent> {
  /** The markdown source; reactive. Takes precedence over the children. */
  text?: MaybeAccessor<string>;
  /** The markdown source as a child, e.g. `<Markdown>{reply}</Markdown>`; reactive. */
  children?: MaybeAccessor<string>;
  /** Paints per element; reactive. */
  theme?: MaybeAccessor<MarkdownTheme>;
  /** Columns of blank margin on each side. Default 0. */
  paddingX?: number;
  /** Spaces inside each side of a table cell; dropped on very narrow widths. Default 1. */
  tablePadding?: number;
  /** Spaces between a list marker and the item. Default 1. */
  listGap?: number;
  /** Blank rows between blocks and between the items of a loose list. Default 1. */
  blockGap?: number;
  /** Decoration characters, each replacing its default. */
  glyphs?: Partial<MarkdownGlyphs>;
  /** Fixed texts, each replacing its default. */
  labels?: Partial<MarkdownLabels>;
  /**
   * Styles a code block: returns one styled line per source line. Must not
   * change the visible width of any line.
   */
  highlightCode?: (code: string, lang: string | undefined) => string[];
}

/**
 * Markdown rendered to styled terminal rows: the JSX form of the class
 * component `Markdown`. The source follows signals read in the `text` prop or
 * the child, so a streamed reply can be shown as it grows.
 *
 * @param props Source, paints, spacing and code highlighting.
 * @returns The markdown view.
 *
 * @example Show a streamed reply
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { Markdown } from "@neonbyte/tui/reactive/components";
 *
 * const reply = signal("Hello **wor");
 *
 * root(() => {
 *   const markdown = toComponent(<Markdown>{reply}</Markdown>);
 *
 *   reply.set("Hello **world**");
 *
 *   const plain = markdown.render(20).map((row) =>
 *     row.replace(/\x1b\[[0-9;]*m/g, "")
 *   );
 *
 *   assertEquals(plain, ["Hello world"]);
 * });
 * ```
 *
 * @category Text
 */
export function Markdown(props: MarkdownProps): MarkdownComponent {
  const source = props.text ?? props.children ?? "";
  const markdown = new MarkdownComponent(initial(source), {
    paddingX: props.paddingX,
    tablePadding: props.tablePadding,
    listGap: props.listGap,
    blockGap: props.blockGap,
    theme: initial(props.theme),
    glyphs: props.glyphs,
    labels: props.labels,
    highlightCode: props.highlightCode,
  });

  watch(source, (value) => markdown.setText(value));
  watch(props.theme, (value) => markdown.setTheme(value));

  return setup(markdown, props);
}
