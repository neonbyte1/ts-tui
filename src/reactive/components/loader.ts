import { Loader as LoaderComponent, type LoaderTheme } from "../../../mod.ts";
import { useHost } from "../host.ts";
import type { MaybeAccessor } from "../signal.ts";
import { animate, initial, type RefProps, setup, watch } from "./props.ts";

/**
 * Props of {@linkcode Loader}. Reactive props follow signals; the others are
 * read once.
 *
 * @category Progress & status
 */
export interface LoaderProps extends RefProps<LoaderComponent> {
  /** The text beside the spinner; reactive. Default `Working…`. */
  message?: MaybeAccessor<string>;
  /** Paints for the spinner frame and the message; reactive. Default none. */
  theme?: MaybeAccessor<LoaderTheme>;
  /** Spinner frames, each one cell wide, played in order. Default braille dots. */
  frames?: readonly string[];
  /** Animation frame interval. Default 80 ms. */
  intervalMs?: number;
  /** Between the spinner and the message. Default `" "`. */
  separator?: string;
}

/**
 * One-row spinner with a message: the JSX form of the class component
 * `Loader`. It animates while it is placed and stops when it is disposed.
 *
 * @param props Message, appearance and speed.
 * @returns The loader.
 *
 * @example Report progress while loading
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { Loader } from "@neonbyte/tui/reactive/components";
 *
 * const message = signal("Connecting…");
 *
 * root((dispose) => {
 *   const loader = toComponent(<Loader message={message} />);
 *
 *   message.set("Downloading…");
 *   assertEquals(loader.render(30), ["⠋ Downloading…"]);
 *   dispose(); // stops the animation
 * });
 * ```
 *
 * @category Progress & status
 */
export function Loader(props: LoaderProps): LoaderComponent {
  const loader = new LoaderComponent(useHost(), initial(props.message), {
    frames: props.frames,
    intervalMs: props.intervalMs,
    separator: props.separator,
    theme: initial(props.theme),
  });

  watch(props.message, (value) => loader.setMessage(value));
  watch(props.theme, (value) => loader.setTheme(value));
  animate(loader);

  return setup(loader, props);
}
