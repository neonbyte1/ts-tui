import {
  Shimmer as ShimmerComponent,
  type ShimmerTheme,
} from "../../../mod.ts";
import { useHost } from "../host.ts";
import type { MaybeAccessor } from "../signal.ts";
import { animate, initial, type RefProps, setup, watch } from "./props.ts";

/**
 * Props of {@linkcode Shimmer}. Reactive props follow signals; the others are
 * read once.
 *
 * @category Progress & status
 */
export interface ShimmerProps extends RefProps<ShimmerComponent> {
  /** The text to draw, without escape sequences; reactive. */
  text: MaybeAccessor<string>;
  /** Colours, band width and attributes, each replacing its default; reactive. */
  theme?: MaybeAccessor<ShimmerTheme>;
  /** Cells the band travels beyond the text before the next pass: the pause between passes. Default 12. */
  gap?: number;
  /** `right` sweeps left to right. Default `right`. */
  direction?: "right" | "left";
  /** Ends text that is cut to fit the row. Default `…`. */
  ellipsis?: string;
  /** Frame interval; the band moves one cell per frame. Default 50 ms. */
  intervalMs?: number;
}

/**
 * One row of text with a highlight sweeping across it: the JSX form of the
 * class component `Shimmer`. It sweeps while it is placed and stops when it
 * is disposed.
 *
 * @param props Text, appearance and speed.
 * @returns The shimmer.
 *
 * @example Show what is being worked on
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { Shimmer } from "@neonbyte/tui/reactive/components";
 *
 * const text = signal("Reading");
 *
 * root((dispose) => {
 *   const shimmer = toComponent(<Shimmer text={text} />);
 *
 *   text.set("Writing");
 *
 *   const row = shimmer.render(30)[0].replace(/\x1b\[[0-9;]*m/g, "");
 *
 *   assertEquals(row, "Writing");
 *   dispose(); // stops the sweep
 * });
 * ```
 *
 * @category Progress & status
 */
export function Shimmer(props: ShimmerProps): ShimmerComponent {
  const shimmer = new ShimmerComponent(useHost(), initial(props.text), {
    theme: initial(props.theme),
    gap: props.gap,
    direction: props.direction,
    ellipsis: props.ellipsis,
    intervalMs: props.intervalMs,
  });

  watch(props.text, (value) => shimmer.setText(value));
  watch(props.theme, (value) => shimmer.setTheme(value));
  animate(shimmer);

  return setup(shimmer, props);
}
