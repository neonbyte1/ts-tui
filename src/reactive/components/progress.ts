import {
  type BarGlyphs,
  type BarMarker,
  type CellPaint,
  ProgressBar as ProgressBarComponent,
  type ProgressText,
  type ProgressTheme,
} from "../../../mod.ts";
import { useHost } from "../host.ts";
import { effect, type MaybeAccessor, onCleanup, read } from "../signal.ts";
import { initial, type RefProps, setup, watch } from "./props.ts";

/**
 * Props of {@linkcode ProgressBar}. Reactive props follow signals; the others
 * are read once.
 *
 * @category Progress & status
 */
export interface ProgressBarProps extends RefProps<ProgressBarComponent> {
  /**
   * The current value, clamped to `[0, total]`; reactive. Update it regularly:
   * the rate and the time left are measured between updates.
   */
  value?: MaybeAccessor<number>;
  /** One value per part of a stacked bar, drawn left to right; reactive. Takes precedence over `value`. */
  parts?: MaybeAccessor<readonly number[]>;
  /** Value that counts as complete; reactive. Default 1. */
  total?: MaybeAccessor<number>;
  /** Text left of the bar; reactive. Truncated or dropped when the row is narrow. */
  label?: MaybeAccessor<string>;
  /** Total unknown: while true, a segment slides back and forth; reactive. */
  indeterminate?: MaybeAccessor<boolean>;
  /** Glyphs of the caps, fill and track; reactive. Default `BAR_GLYPHS.blocks`. */
  glyphs?: MaybeAccessor<BarGlyphs>;
  /** Fixed indicators, like a limit or a target; reactive. */
  markers?: MaybeAccessor<readonly BarMarker[]>;
  /** Per-cell paint merged over the theme, e.g. `gradient` or `thresholds`. */
  cellPaint?: CellPaint;
  /**
   * Paints for fill, track, caps, labels, sections and parts; reactive, each
   * change replacing only the paints it names. With none, the track is grey.
   */
  theme?: MaybeAccessor<ProgressTheme>;
  /** Maximum number of bar cells, caps excluded. Default: fill the row. */
  barWidth?: number;
  /** Text right of the bar. Default: whole percent; nothing while indeterminate. */
  format?: ProgressText;
  /** Text over the track just past the fill edge, moving with it. */
  edgeLabel?: ProgressText;
  /** Text over the right end of the bar, inside the caps. */
  endLabel?: ProgressText;
  /** Cells between the label, the bar and the text after it. Default 1. */
  gap?: number;
  /** The bar is dropped below this many cells rather than drawn uselessly short. Default 4. */
  minBar?: number;
  /** Ends a label or text that is cut to fit the row. Default `…`. */
  ellipsis?: string;
  /** A bright cell runs over the filled part while the bar is placed. Default false. */
  shimmer?: boolean;
  /** Animation frame interval. Default 80 ms. */
  intervalMs?: number;
  /** Millisecond clock for rate, time left, and elapsed. Default `performance.now`. */
  clock?: () => number;
}

/** The measured state a bar is set to. */
interface Measured {
  readonly values: readonly number[];
  readonly total: number | undefined;
}

/**
 * A one-row progress bar: the JSX form of the class component `ProgressBar`.
 * Determinate (`value`), stacked (`parts`) or indeterminate. The animation
 * (`shimmer`, or `indeterminate` while true) runs while the bar is placed
 * and stops when it is disposed.
 *
 * @param props Value, total, label, look and animation.
 * @returns The progress bar.
 *
 * @example Show a download
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { ProgressBar } from "@neonbyte/tui/reactive/components";
 *
 * const done = signal(0);
 *
 * root(() => {
 *   const bar = toComponent(
 *     <ProgressBar
 *       label="Download"
 *       total={100}
 *       value={done}
 *       barWidth={10}
 *       theme={{}}
 *     />,
 *   );
 *
 *   done.set(50);
 *   assertEquals(bar.render(30), ["Download █████       50%"]);
 * });
 * ```
 *
 * @category Progress & status
 */
export function ProgressBar(props: ProgressBarProps): ProgressBarComponent {
  const bar = new ProgressBarComponent({
    total: initial(props.total),
    label: initial(props.label),
    barWidth: props.barWidth,
    format: props.format,
    edgeLabel: props.edgeLabel,
    endLabel: props.endLabel,
    gap: props.gap,
    minBar: props.minBar,
    ellipsis: props.ellipsis,
    indeterminate: initial(props.indeterminate),
    shimmer: props.shimmer,
    host: useHost(),
    intervalMs: props.intervalMs,
    clock: props.clock,
    glyphs: initial(props.glyphs),
    markers: initial(props.markers),
    cellPaint: props.cellPaint,
    theme: initial(props.theme),
  });
  const measure = (): Measured => ({
    values: props.parts !== undefined
      ? read(props.parts)
      : [props.value === undefined ? bar.progress : read(props.value)],
    total: read(props.total),
  });

  if (props.value !== undefined || props.parts !== undefined) {
    const measured = initial(measure);

    bar.setParts(measured.values, measured.total);
  }

  watch(measure, (measured) => bar.setParts(measured.values, measured.total));
  watch(props.label, (value) => bar.setLabel(value));
  watch(props.indeterminate, (value) => bar.setIndeterminate(value));
  watch(props.glyphs, (glyphs) => bar.setStyle({ glyphs }));
  watch(props.markers, (markers) => bar.setStyle({ markers }));
  watch(props.theme, (value) => bar.setTheme(value));

  if (props.shimmer || props.indeterminate !== undefined) {
    effect(() => {
      if (props.shimmer || read(props.indeterminate ?? false)) {
        bar.start();
      } else {
        bar.stop();
      }
    });
    onCleanup(() => bar.stop());
  }

  return setup(bar, props);
}
