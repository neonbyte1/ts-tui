import {
  type PaneSize,
  Panes as PanesComponent,
  type PanesGlyphs,
  type PanesTheme,
} from "../../../mod.ts";
import { type Child, toComponent } from "../jsx.ts";
import type { MaybeAccessor } from "../signal.ts";
import { initial, type RefProps, setup, watch } from "./props.ts";

/**
 * One pane of a {@linkcode Panes}: its content and size limits.
 *
 * @category Layout
 */
export interface PaneProps {
  /** What the pane shows, rendered at the pane's exact width (and height). */
  content?: Child;
  /** Fixed cells or a percentage (`"25%"`). Omitted: a flexible pane that shares what the others leave equally. */
  size?: PaneSize;
  /** Smallest size in cells. Default 1. */
  min?: number;
  /** Largest size in cells. Default unbounded. */
  max?: number;
}

/**
 * Props of {@linkcode Panes}. Reactive props follow signals; the others are
 * read once.
 *
 * @category Layout
 */
export interface PanesProps extends RefProps<PanesComponent> {
  /** `"horizontal"` puts panes side by side, `"vertical"` stacks them. */
  direction: "horizontal" | "vertical";
  /** The panes, in order from left to right or top to bottom. The list is read once. */
  panes: readonly PaneProps[];
  /**
   * The size of every pane, cells or percentages, one per pane; reactive.
   * Replaces each pane's own `size`. Bind it to a signal updated in
   * `onResize` to keep dragged sizes.
   */
  sizes?: MaybeAccessor<readonly PaneSize[]>;
  /** Paints for the divider in its normal, hovered and dragged states; reactive. */
  theme?: MaybeAccessor<PanesTheme>;
  /**
   * Rows for the whole layout when the parent passes no height. A vertical
   * layout needs this or a render height; a horizontal one defaults to its
   * tallest pane.
   */
  height?: number | (() => number);
  /** The divider cell for each direction. Default `PANES_GLYPHS.line`. */
  glyphs?: Partial<PanesGlyphs>;
  /** Let the pointer drag dividers. Default true. */
  resizable?: boolean;
  /** Called with the sizes in cells whenever dragging or `resizeBy` changes them. */
  onResize?: (sizes: readonly number[]) => void;
}

/**
 * A resizable split layout: the JSX form of the class component `Panes`.
 * The pane sizes and the theme follow signals.
 *
 * @param props The direction, panes, sizes and look.
 * @returns The panes component.
 * @throws {RangeError} When a size is not a non-negative percentage such as `"25%"`, or `sizes` does not have one entry per pane.
 *
 * @example Two panes with a live size
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { Panes, Text } from "@neonbyte/tui/reactive/components";
 *
 * const sizes = signal<(number | `${number}%`)[]>([2, 4]);
 *
 * root(() => {
 *   const panes = toComponent(
 *     <Panes
 *       direction="horizontal"
 *       theme={{ divider: {} }}
 *       sizes={sizes}
 *       panes={[
 *         { content: <Text>a</Text> },
 *         { content: <Text>b</Text> },
 *       ]}
 *     />,
 *   );
 *
 *   assertEquals(panes.render(7), ["a │b   "]);
 *
 *   sizes.set([4, 2]);
 *   assertEquals(panes.render(7), ["a   │b "]);
 * });
 * ```
 *
 * @category Layout
 */
export function Panes(props: PanesProps): PanesComponent {
  const panes = new PanesComponent({
    direction: props.direction,
    panes: props.panes.map((pane) => ({
      component: toComponent(pane.content),
      size: pane.size,
      min: pane.min,
      max: pane.max,
    })),
    height: props.height,
    glyphs: props.glyphs,
    theme: initial(props.theme),
    resizable: props.resizable,
    onResize: props.onResize,
  });
  const sizes = initial(props.sizes);

  if (sizes !== undefined) {
    panes.setSizes(sizes);
  }

  watch(props.sizes, (next) => panes.setSizes(next));
  watch(props.theme, (theme) => panes.setTheme(theme));

  return setup(panes, props);
}
