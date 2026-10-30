import {
  Thinking as ThinkingComponent,
  type ThinkingTheme,
} from "../../../mod.ts";
import { useHost } from "../host.ts";
import type { MaybeAccessor } from "../signal.ts";
import { animate, initial, type RefProps, setup, watch } from "./props.ts";

/**
 * Props of {@linkcode Thinking}. Reactive props follow signals; the others
 * are read once.
 *
 * @category Progress & status
 */
export interface ThinkingProps extends RefProps<ThinkingComponent> {
  /** The message, without escape sequences; reactive. Ignored while `messages` is set. Default `Thinking…`. */
  text?: MaybeAccessor<string>;
  /** Paints for the glyph, the message and the detail, each replacing its default; reactive. */
  theme?: MaybeAccessor<ThinkingTheme>;
  /** Glyphs the indicator steps through, forward then back. Default `· ✢ ✳ ✶ ✻ ✽`. */
  frames?: readonly string[];
  /** Animation frames per glyph step. Default 3 (150 ms at the default interval). */
  glyphEvery?: number;
  /** Sweep a band across the text. Default true; false draws it in `theme.text.base`. */
  shimmer?: boolean;
  /** Cycle through these texts, one every `rotateMs`, instead of `text`. */
  messages?: readonly string[];
  /** Default 3000 ms. */
  rotateMs?: number;
  /** Text after the message, from the seconds since the component was placed, e.g. `(12s · esc to interrupt)`. Dropped when it would make the message not fit. */
  detail?: (elapsed: number) => string;
  /** Cells between the glyph and the message, and between the message and the detail. Default 1. */
  gap?: number;
  /** Ends a message that is cut to fit the row. Default `…`. */
  ellipsis?: string;
  /** Animation frame interval. Default 50 ms. */
  intervalMs?: number;
  /** Millisecond clock for elapsed time and message rotation. Default `performance.now`. */
  clock?: () => number;
}

/**
 * A "thinking" line: the JSX form of the class component `Thinking`. It
 * animates and counts the elapsed time while it is placed and stops when it
 * is disposed.
 *
 * @param props Message, detail, appearance and timing.
 * @returns The thinking line.
 *
 * @example Show the elapsed time
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { FakeTime } from "@std/testing/time";
 * import { root, toComponent } from "@neonbyte/tui/reactive";
 * import { Thinking } from "@neonbyte/tui/reactive/components";
 *
 * using time = new FakeTime();
 *
 * root((dispose) => {
 *   const thinking = toComponent(
 *     <Thinking
 *       clock={() => time.now}
 *       detail={(seconds) => `(${Math.floor(seconds)}s)`}
 *     />,
 *   );
 *
 *   time.tick(4000);
 *
 *   const row = thinking.render(40)[0].replace(/\x1b\[[0-9;]*m/g, "");
 *
 *   assertEquals(row, "✻ Thinking… (4s)");
 *   dispose(); // stops the animation
 * });
 * ```
 *
 * @category Progress & status
 */
export function Thinking(props: ThinkingProps): ThinkingComponent {
  const thinking = new ThinkingComponent(useHost(), initial(props.text), {
    frames: props.frames,
    glyphEvery: props.glyphEvery,
    theme: initial(props.theme),
    shimmer: props.shimmer,
    messages: props.messages,
    rotateMs: props.rotateMs,
    detail: props.detail,
    gap: props.gap,
    ellipsis: props.ellipsis,
    intervalMs: props.intervalMs,
    clock: props.clock,
  });

  watch(props.text, (value) => thinking.setText(value));
  watch(props.theme, (value) => thinking.setTheme(value));
  animate(thinking);

  return setup(thinking, props);
}
