import {
  Container,
  Overlay as OverlayComponent,
  type OverlayPanelOptions,
  type OverlayTheme,
} from "../../../mod.ts";
import { useTUI } from "../composables.ts";
import { type Child, toComponent } from "../jsx.ts";
import { type MaybeAccessor, onCleanup } from "../signal.ts";
import { initial, type RefProps, watch } from "./props.ts";

/**
 * Props of {@linkcode Overlay}. Reactive props follow signals; the others are
 * read once, when the panel is created, and so are the placement and
 * behaviour options inherited from `OverlayPanelOptions` (`footer`, `border`,
 * `anchor`, `width`, `closeOnEscape`, …).
 *
 * @category Overlays
 */
export interface OverlayProps
  extends
    RefProps<OverlayComponent>,
    Omit<OverlayPanelOptions, "title" | "theme" | "onClose"> {
  /** What the panel shows. */
  children?: Child;
  /** Text in the top edge of the frame; reactive. `undefined` removes it. */
  title?: MaybeAccessor<string | undefined>;
  /** Paints for the frame, title and footer; reactive. Merged over the current ones. */
  theme?: MaybeAccessor<OverlayTheme>;
  /**
   * Called after the user closed the panel (the close key, or a press outside
   * with `closeOnPressOutside`). Not called when the panel is hidden because
   * the component was disposed, so it can safely reset the state that shows it.
   */
  onClose?: () => void;
}

/**
 * A floating panel over the screen: the JSX form of the class component
 * `Overlay`. It is shown when created and hidden when disposed, so wrap it in
 * a {@linkcode Show} to open and close it with a signal. It takes no room in
 * the layout: it renders an empty placeholder where it is placed. Needs a
 * mounted tree.
 *
 * @param props Content, frame, placement and behaviour.
 * @returns An empty placeholder; the panel itself floats over the screen.
 *
 * @example Show a panel while a signal is set
 * ```tsx
 * import { assert, assertEquals } from "@std/assert";
 * import { TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { mount, signal } from "@neonbyte/tui/reactive";
 * import { Overlay, Show, Text } from "@neonbyte/tui/reactive/components";
 *
 * const terminal = new VirtualTerminal(30, 8);
 * const tui = new TUI(terminal);
 * const open = signal(true);
 *
 * mount(
 *   <Show when={open}>
 *     <Overlay title="Help" onClose={() => open.set(false)}>
 *       <Text>Press Esc to close</Text>
 *     </Overlay>
 *   </Show>,
 *   tui,
 * );
 * tui.renderNow();
 * assert(terminal.viewport().some((row) => row.includes("Press Esc")));
 *
 * open.set(false);
 * tui.renderNow();
 * assert(!terminal.viewport().some((row) => row.includes("Press Esc")));
 *
 * open.set(true);
 * tui.renderNow();
 * terminal.send("\x1b[27u"); // Escape closes it and calls onClose
 * assertEquals(open(), false);
 * tui.stop();
 * ```
 *
 * @category Overlays
 */
export function Overlay(props: OverlayProps): Container {
  const { children, title, theme, onClose, ref, ...options } = props;
  const tui = useTUI();
  let disposed = false;
  const overlay = new OverlayComponent(tui, toComponent(children), {
    ...options,
    title: initial(title),
    theme: initial(theme),
    onClose: () => {
      if (!disposed) {
        onClose?.();
      }
    },
  });

  watch(title, (value) => overlay.setTitle(value));
  watch(theme, (value) => overlay.setTheme(value));
  onCleanup(() => {
    disposed = true;

    overlay.hide();
  });
  overlay.show();
  ref?.(overlay);

  return new Container();
}
