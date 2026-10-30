import {
  Sparkline as SparklineComponent,
  type SparklineTheme,
} from "../../../mod.ts";
import type { MaybeAccessor } from "../signal.ts";
import { initial, type RefProps, setup, watch } from "./props.ts";

/**
 * Props of {@linkcode Sparkline}. Reactive props follow signals; the others
 * are read once.
 *
 * @category Progress & status
 */
export interface SparklineProps extends RefProps<SparklineComponent> {
  /**
   * The samples, oldest first; reactive. Each change replaces all kept
   * samples, so bind it to a signal holding the series.
   */
  values?: MaybeAccessor<readonly number[]>;
  /** Text left of the graph; reactive. */
  label?: MaybeAccessor<string>;
  /** Paints for the graph, label and suffix; reactive, each change replacing only the paints it names. */
  theme?: MaybeAccessor<SparklineTheme>;
  /** Samples kept; older ones are dropped. Default 256. */
  capacity?: number;
  /** Height steps, lowest first; the largest sample gets the last one. Default `SPARKLINE_LEVELS.blocks`. */
  levels?: readonly string[];
  /** Style for the graph, applied before `theme.graph`; must not change its width. */
  style?: (graph: string) => string;
  /** Text right of the graph, e.g. the latest value; `max` is the largest kept sample. */
  format?: (latest: number, max: number) => string;
  /** Cells between label, graph and suffix. Default 1. */
  gap?: number;
  /** Ends a label or suffix that is cut to fit the row. Default `…`. */
  ellipsis?: string;
}

/**
 * A one-row graph of recent samples: the JSX form of the class component
 * `Sparkline`. The graph follows the signal given as `values`.
 *
 * @param props Samples, label, formatting and appearance.
 * @returns The sparkline.
 *
 * @example Graph a throughput
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { Sparkline } from "@neonbyte/tui/reactive/components";
 *
 * const samples = signal([1, 4]);
 *
 * root(() => {
 *   const graph = toComponent(
 *     <Sparkline
 *       label="net"
 *       values={samples}
 *       format={(latest) => `${latest} MB/s`}
 *     />,
 *   );
 *
 *   samples.set([1, 4, 8]);
 *   assertEquals(graph.render(30), ["net ▂▅█ 8 MB/s"]);
 * });
 * ```
 *
 * @category Progress & status
 */
export function Sparkline(props: SparklineProps): SparklineComponent {
  const graph = new SparklineComponent({
    label: initial(props.label),
    capacity: props.capacity,
    levels: props.levels,
    theme: initial(props.theme),
    style: props.style,
    format: props.format,
    gap: props.gap,
    ellipsis: props.ellipsis,
  });

  if (props.values !== undefined) {
    graph.setValues(initial(props.values));
  }

  watch(props.values, (values) => graph.setValues(values));
  watch(props.label, (label) => graph.setLabel(label));
  watch(props.theme, (theme) => graph.setTheme(theme));

  return setup(graph, props);
}
