import {
  Spinner as SpinnerComponent,
  type StatusGlyphs,
  type StatusTheme,
  type TaskState,
} from "../../../mod.ts";
import { useHost } from "../host.ts";
import { type MaybeAccessor, onCleanup } from "../signal.ts";
import { initial, type RefProps, setup, watch } from "./props.ts";

/**
 * Props of {@linkcode Spinner}. Reactive props follow signals; the others are
 * read once.
 *
 * @category Progress & status
 */
export interface SpinnerProps extends RefProps<SpinnerComponent> {
  /** The text beside the glyph; reactive. Default none. */
  text?: MaybeAccessor<string>;
  /**
   * Where the task is; reactive. Entering a finished state plays the settle
   * animation. Default `running`: the spinner spins while it is placed.
   */
  state?: MaybeAccessor<TaskState>;
  /** Paints for the glyph and the text per state, each replacing that state's default; reactive. */
  theme?: MaybeAccessor<StatusTheme>;
  /** Default `STATUS_GLYPHS.dots`. */
  glyphs?: StatusGlyphs;
  /** Cells between the glyph and the text. Default 1. */
  gap?: number;
  /** Ends a line that is too long. Default `…`. */
  ellipsis?: string;
  /** Frame interval of the spinner and the settle animation. Default 80 ms. */
  intervalMs?: number;
  /** Millisecond clock the animation follows. Default `performance.now`. */
  clock?: () => number;
}

/**
 * One-row task indicator: the JSX form of the class component `Spinner`. The
 * `state` prop drives the class's state API, so it spins while `running`,
 * settles into a mark when `done`, `failed` or `skipped`, and rests when
 * `pending`. When the component is disposed its timer is stopped (the
 * spinner goes back to `pending`).
 *
 * @param props Text, state, appearance and timing.
 * @returns The spinner.
 *
 * @example Finish a task
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { Spinner } from "@neonbyte/tui/reactive/components";
 *
 * let now = 0;
 * const state = signal<"running" | "done">("running");
 * const text = signal("Installing");
 *
 * root((dispose) => {
 *   const spinner = toComponent(
 *     <Spinner text={text} state={state} clock={() => now} />,
 *   );
 *
 *   text.set("Installed");
 *   state.set("done");
 *   now = 1000; // the settle animation is over
 *
 *   const row = spinner.render(30)[0].replace(/\x1b\[[0-9;]*m/g, "");
 *
 *   assertEquals(row, "✔ Installed");
 *   dispose();
 * });
 * ```
 *
 * @category Progress & status
 */
export function Spinner(props: SpinnerProps): SpinnerComponent {
  const spinner = new SpinnerComponent(useHost(), initial(props.text), {
    glyphs: props.glyphs,
    theme: initial(props.theme),
    gap: props.gap,
    ellipsis: props.ellipsis,
    intervalMs: props.intervalMs,
    clock: props.clock,
  });

  spinner.setState(initial(props.state ?? "running"));
  onCleanup(() => spinner.reset());

  watch(props.text, (value) => spinner.setText(value));
  watch(props.state, (value) => spinner.setState(value));
  watch(props.theme, (value) => spinner.setTheme(value));

  return setup(spinner, props);
}
