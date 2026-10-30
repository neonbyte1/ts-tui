import {
  Container,
  Modal as ModalComponent,
  type ModalCloseReason,
  type ModalOptions,
  type ModalTheme,
} from "../../../mod.ts";
import { useTUI } from "../composables.ts";
import { type Child, toComponent } from "../jsx.ts";
import { type MaybeAccessor, onCleanup } from "../signal.ts";
import { initial, type RefProps, watch } from "./props.ts";

/**
 * Props of {@linkcode Modal}. Reactive props follow signals; the others are
 * read once, when the dialog is created, and so are the options inherited
 * from `ModalOptions` (`footer`, `buttons`, `width`, `closeOnEscape`, …).
 *
 * @category Overlays
 */
export interface ModalProps
  extends
    RefProps<ModalComponent>,
    Omit<ModalOptions, "body" | "title" | "theme" | "onClose"> {
  /** The body: any JSX; focusable content (e.g. an `Editor`) starts focused. */
  children?: Child;
  /** Text in the top edge of the frame; reactive. `undefined` removes it. */
  title?: MaybeAccessor<string | undefined>;
  /** Paints for the frame, the backdrop and the buttons; reactive. Merged over the current ones. */
  theme?: MaybeAccessor<ModalTheme>;
  /**
   * Called after the user closed the dialog, with what closed it (`"escape"`,
   * `"backdrop"` or `"button"`). Not called when the dialog is closed because
   * the component was disposed, so it can safely reset the state that shows it.
   */
  onClose?: (reason: ModalCloseReason) => void;
}

/**
 * A blocking dialog shown over the TUI: the JSX form of the class component
 * `Modal`. It opens when created and closes when disposed, so wrap it in a
 * {@linkcode Show} to open and close it with a signal; `onClose` lets the
 * user's own close (Escape, a button) reset that signal. It takes no room in
 * the layout: it renders an empty placeholder where it is placed. Needs a
 * mounted tree.
 *
 * @param props Title, body, buttons, look and behaviour.
 * @returns An empty placeholder; the dialog itself floats over the screen.
 *
 * @example Confirm with a button
 * ```tsx
 * import { assert, assertEquals } from "@std/assert";
 * import { TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { mount, signal } from "@neonbyte/tui/reactive";
 * import { Modal, Show } from "@neonbyte/tui/reactive/components";
 *
 * const terminal = new VirtualTerminal(30, 10);
 * const tui = new TUI(terminal);
 * const open = signal(true);
 * let reason = "";
 *
 * mount(
 *   <Show when={open}>
 *     <Modal
 *       title="Save"
 *       buttons={[{ label: "Yes", variant: "primary" }, { label: "No" }]}
 *       onClose={(why) => {
 *         reason = why;
 *         open.set(false);
 *       }}
 *     >
 *       Save changes?
 *     </Modal>
 *   </Show>,
 *   tui,
 * );
 * tui.renderNow();
 * assert(terminal.viewport().some((row) => row.includes("Save changes?")));
 *
 * terminal.send("\r"); // Enter presses the focused primary button
 * tui.renderNow();
 * assertEquals(reason, "button");
 * assertEquals(open(), false);
 * assert(!terminal.viewport().some((row) => row.includes("Save changes?")));
 *
 * // Closing from code does not call onClose.
 * open.set(true);
 * tui.renderNow();
 * assert(terminal.viewport().some((row) => row.includes("Save changes?")));
 *
 * open.set(false);
 * tui.renderNow();
 * assertEquals(reason, "button");
 * tui.stop();
 * ```
 *
 * @category Overlays
 */
export function Modal(props: ModalProps): Container {
  const { children, title, theme, onClose, ref, ...options } = props;
  const tui = useTUI();
  let disposed = false;
  const modal = new ModalComponent(tui, {
    ...options,
    body: children === undefined ? undefined : toComponent(children),
    title: initial(title),
    theme: initial(theme),
    onClose: (reason) => {
      if (!disposed) {
        onClose?.(reason);
      }
    },
  });

  watch(title, (value) => modal.setTitle(value));
  watch(theme, (value) => modal.setTheme(value));
  onCleanup(() => {
    disposed = true;

    modal.close();
  });
  modal.open();
  ref?.(modal);

  return new Container();
}
