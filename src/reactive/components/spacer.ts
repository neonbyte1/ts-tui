import { Spacer as SpacerComponent } from "../../../mod.ts";
import type { MaybeAccessor } from "../signal.ts";
import { initial, type RefProps, setup, watch } from "./props.ts";

/**
 * Props of {@linkcode Spacer}.
 *
 * @category Layout
 */
export interface SpacerProps extends RefProps<SpacerComponent> {
  /** Number of blank rows; reactive. Default 1. */
  rows?: MaybeAccessor<number>;
}

/**
 * Blank rows for vertical gaps: the JSX form of the class component
 * `Spacer`.
 *
 * @param props The number of rows.
 * @returns The spacer.
 *
 * @example Leave a gap that grows
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { Spacer } from "@neonbyte/tui/reactive/components";
 *
 * const rows = signal(1);
 *
 * root(() => {
 *   const gap = toComponent(<Spacer rows={rows} />);
 *
 *   rows.set(3);
 *   assertEquals(gap.render(10).length, 3);
 * });
 * ```
 *
 * @category Layout
 */
export function Spacer(props: SpacerProps): SpacerComponent {
  const spacer = new SpacerComponent(initial(props.rows ?? 1));

  watch(props.rows, (value) => spacer.setRows(value));

  return setup(spacer, props);
}
