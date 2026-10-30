import {
  ScrollView as ScrollViewComponent,
  type ScrollViewAction,
  type ScrollbarGlyphs,
  type ScrollbarTheme,
} from "../../../mod.ts";
import { type Child, toComponent } from "../jsx.ts";
import type { MaybeAccessor } from "../signal.ts";
import {
  type FocusProps,
  initial,
  type RefProps,
  setup,
  watch,
} from "./props.ts";

/**
 * Props of {@linkcode ScrollView}. Reactive props follow signals; the others
 * are read once.
 *
 * @category Layout
 */
export interface ScrollViewProps
  extends RefProps<ScrollViewComponent>, FocusProps {
  /** The content shown in the window. */
  children?: Child;
  /**
   * The first visible row of the content; reactive. Changes scroll the view
   * (kept within the content). Bind it to a signal updated in `onScroll` for
   * two-way binding.
   */
  scrollTop?: MaybeAccessor<number>;
  /** Paints for the scrollbar track and thumb, each replacing its default; reactive. */
  theme?: MaybeAccessor<ScrollbarTheme>;
  /** Rows shown when the parent passes no height. Default: every row of the content (nothing scrolls). */
  height?: number;
  /**
   * `"auto"` (default) draws the bar only while the content overflows,
   * `"always"` draws the track even when everything fits, `"never"` gives
   * the content the full width.
   */
  scrollbar?: "auto" | "always" | "never";
  /** Stay at the bottom while the view is at the bottom, so appended rows scroll into view (logs, chat). Default false. */
  follow?: boolean;
  /** Rows per wheel notch. Default 3. */
  wheelStep?: number;
  /** Scrollbar glyphs. Default `SCROLLBAR_GLYPHS.vertical`. */
  glyphs?: ScrollbarGlyphs;
  /** Rows a page step keeps from the previous page. Default 1. */
  pageOverlap?: number;
  /** Key specs per action; an entry replaces that action's default list. */
  keys?: Partial<Record<ScrollViewAction, readonly string[]>>;
  /** Called with the new offset after the user scrolls (keys, wheel, scrollbar) or `ref` calls `scrollTo`/`scrollBy`. */
  onScroll?: (offset: number) => void;
}

/**
 * A window onto content taller than the space it is given: the JSX form of
 * the class component `ScrollView`.
 *
 * @param props The content, scroll position and look.
 * @returns The scroll view component.
 *
 * @example Scroll a tall text from a signal
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { ScrollView, Text } from "@neonbyte/tui/reactive/components";
 *
 * const rows = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n");
 * const top = signal(0);
 *
 * root(() => {
 *   const view = toComponent(
 *     <ScrollView height={3} scrollTop={top} theme={{ track: {}, thumb: {} }}>
 *       <Text>{rows}</Text>
 *     </ScrollView>,
 *   );
 *
 *   assertEquals(view.render(10), ["line 0   ┃", "line 1   │", "line 2   │"]);
 *
 *   top.set(2);
 *   assertEquals(view.render(10), ["line 2   │", "line 3   ┃", "line 4   │"]);
 * });
 * ```
 *
 * @category Layout
 */
export function ScrollView(props: ScrollViewProps): ScrollViewComponent {
  const view = new ScrollViewComponent(toComponent(props.children), {
    height: props.height,
    scrollbar: props.scrollbar,
    follow: props.follow,
    wheelStep: props.wheelStep,
    glyphs: props.glyphs,
    theme: initial(props.theme),
    pageOverlap: props.pageOverlap,
    keys: props.keys,
  });
  const top = initial(props.scrollTop);

  if (top !== undefined) {
    view.scrollTo(top);
  }

  view.onScroll = props.onScroll;

  watch(props.scrollTop, (row) => view.scrollTo(row));
  watch(props.theme, (theme) => view.setTheme(theme));

  return setup(view, props);
}
