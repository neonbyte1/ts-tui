import {
  Duration as DurationComponent,
  type DurationTheme,
  type DurationUnit,
  type RollGlyphs,
} from "../../../mod.ts";
import { useHost } from "../host.ts";
import { effect, type MaybeAccessor, onCleanup, read } from "../signal.ts";
import { initial, type RefProps, setup, watch } from "./props.ts";

/**
 * Props of {@linkcode Duration}. Reactive props follow signals; the others
 * are read once.
 *
 * @category Progress & status
 */
export interface DurationProps extends RefProps<DurationComponent> {
  /** Whether time is running; reactive. Default false (paused). */
  running?: MaybeAccessor<boolean>;
  /**
   * The milliseconds shown (elapsed, or time left for a countdown); reactive.
   * Each change sets the display, rolling the digits that change; time keeps
   * running from there if it was.
   */
  value?: MaybeAccessor<number>;
  /** The frames a changing digit plays; reactive. Default `ROLL_GLYPHS.up`. */
  roll?: MaybeAccessor<RollGlyphs>;
  /** Paints per element; reactive, each change replacing only the paints it names. */
  theme?: MaybeAccessor<DurationTheme>;
  /** Count down from this many milliseconds instead of up from zero; stops at zero and calls `onDone`. */
  countdown?: number;
  /** Called once when a countdown reaches zero. */
  onDone?: () => void;
  /** Units to split into, largest first; the last is the resolution. Default `["h", "m", "s"]`. */
  units?: readonly DurationUnit[];
  /** Labels after each part. Default `d h m s`. */
  labels?: Partial<Record<DurationUnit, string>>;
  /** Between parts. Default `" "`. */
  separator?: string;
  /** Parts shown even when their leading units are zero: 1 gives `5s`, 2 gives `0m 05s`. Default 1. */
  minParts?: number;
  /** Pad the leading part to two digits too (`09m 02s`). Default false. */
  padLeading?: boolean;
  /** Duration of one roll frame. Default 70 ms. */
  frameMs?: number;
  /** Ends a display that is cut to fit the row. Default `…`. */
  ellipsis?: string;
  /** Millisecond clock time follows. Default `performance.now`. */
  clock?: () => number;
}

/**
 * An elapsed-time or countdown display like `9m 02s` whose digits roll when
 * they change: the JSX form of the class component `Duration`. It runs while
 * `running` is true; when the component is disposed it is paused.
 *
 * @param props Running state, value, countdown, units and appearance.
 * @returns The duration display.
 *
 * @example Run a stopwatch
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { FakeTime } from "@std/testing/time";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { Duration } from "@neonbyte/tui/reactive/components";
 *
 * using time = new FakeTime();
 * const running = signal(true);
 *
 * root((dispose) => {
 *   const timer = toComponent(
 *     <Duration running={running} clock={() => time.now} />,
 *   );
 *
 *   time.tick(65_300); // the digits have settled
 *   assertEquals(timer.render(20), ["1m 05s"]);
 *
 *   running.set(false);
 *   time.tick(5000);
 *   assertEquals(timer.render(20), ["1m 05s"]);
 *   dispose();
 * });
 * ```
 *
 * @category Progress & status
 */
export function Duration(props: DurationProps): DurationComponent {
  const timer = new DurationComponent(useHost(), {
    countdown: props.countdown,
    onDone: props.onDone,
    units: props.units,
    labels: props.labels,
    separator: props.separator,
    minParts: props.minParts,
    padLeading: props.padLeading,
    roll: initial(props.roll),
    frameMs: props.frameMs,
    theme: initial(props.theme),
    ellipsis: props.ellipsis,
    clock: props.clock,
  });

  if (props.value !== undefined) {
    timer.setValue(initial(props.value));
  }

  watch(props.value, (value) => timer.setValue(value));
  watch(props.roll, (roll) => timer.setRoll(roll));
  watch(props.theme, (theme) => timer.setTheme(theme));

  if (props.running !== undefined) {
    effect(() => {
      if (read(props.running)) {
        timer.start();
      } else {
        timer.pause();
      }
    });
  }

  onCleanup(() => timer.pause());

  return setup(timer, props);
}
