import {
  Button as ButtonComponent,
  type ButtonAction,
  type ButtonGlyphs,
  ButtonRow as ButtonRowComponent,
  type ButtonRowAction,
  type ButtonRowGlyphs,
  type ButtonRowTheme,
  type ButtonTheme,
  type ButtonVariant,
} from "../../../mod.ts";
import { type MaybeAccessor, read } from "../signal.ts";
import {
  type FocusProps,
  initial,
  type RefProps,
  setup,
  watch,
} from "./props.ts";

/**
 * A piece of a {@linkcode Button} label: a string, a number, or an accessor
 * of one.
 *
 * @category Controls
 */
export type ButtonLabelPart = MaybeAccessor<string | number>;

/**
 * Props of {@linkcode Button}. Reactive props follow signals; the others are
 * read once.
 *
 * @category Controls
 */
export interface ButtonProps extends RefProps<ButtonComponent>, FocusProps {
  /** The text on the button; reactive. Takes precedence over the children. */
  label?: MaybeAccessor<string>;
  /** The label as parts joined together, e.g. `Save {count}`; reactive. */
  children?: ButtonLabelPart | readonly ButtonLabelPart[];
  /** A disabled button ignores the keyboard and the mouse; reactive. Default false. */
  disabled?: MaybeAccessor<boolean>;
  /** Paints replacing the variant's defaults per state; reactive. */
  theme?: MaybeAccessor<ButtonTheme>;
  /** Colour family of the button. Default `"default"`. */
  variant?: ButtonVariant;
  /** Minimum width in cells, frame glyphs included; the label is centred. */
  width?: number;
  /** Characters around and inside the label, each replacing its default. */
  glyphs?: Partial<ButtonGlyphs>;
  /** Key specs per action; an entry replaces the default list for that action. */
  keys?: Partial<Record<ButtonAction, readonly string[]>>;
  /** Called when the button is pressed. */
  onPress?: () => void;
}

/** The label a button shows: the `label` prop, else the children joined. */
function labelOf(props: ButtonProps): MaybeAccessor<string> {
  if (props.label !== undefined) {
    return props.label;
  }

  const children = props.children;
  const parts = Array.isArray(children)
    ? children as readonly ButtonLabelPart[]
    : children === undefined
    ? []
    : [children as ButtonLabelPart];

  return parts.some((part) => typeof part === "function")
    ? () => parts.map((part) => String(read(part))).join("")
    : parts.join("");
}

/**
 * A one-row push button: the JSX form of the class component `Button`. The
 * label is the `label` prop or the children.
 *
 * @param props Label, state, callback and appearance.
 * @returns The button.
 *
 * @example Count presses on the button
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { mount, signal } from "@neonbyte/tui/reactive";
 * import { Button } from "@neonbyte/tui/reactive/components";
 *
 * const terminal = new VirtualTerminal(30, 3);
 * const tui = new TUI(terminal);
 * const count = signal(0);
 * let button: unknown;
 *
 * mount(
 *   <Button
 *     focus
 *     ref={(b) => button = b}
 *     onPress={() => count.set(count() + 1)}
 *   >
 *     Pressed {count}
 *   </Button>,
 *   tui,
 * );
 *
 * terminal.send("\r");
 * assertEquals(count(), 1);
 * assertEquals((button as { label: string }).label, "Pressed 1");
 * tui.stop();
 * ```
 *
 * @category Controls
 */
export function Button(props: ButtonProps): ButtonComponent {
  const label = labelOf(props);
  const button = new ButtonComponent(initial(label), {
    onPress: props.onPress,
    variant: props.variant,
    disabled: initial(props.disabled ?? false),
    width: props.width,
    theme: initial(props.theme),
    glyphs: props.glyphs,
    keys: props.keys,
  });

  watch(label, (value) => button.setLabel(value));
  watch(props.disabled, (value) => {
    button.disabled = value;
  });
  watch(props.theme, (value) => button.setTheme(value));

  return setup(button, props);
}

/**
 * One button of a {@linkcode ButtonRow}: the props of a {@linkcode Button}
 * except `focus`, which the row manages.
 *
 * @category Controls
 */
export type ButtonRowItem = Omit<ButtonProps, "focus">;

/**
 * Props of {@linkcode ButtonRow}. Reactive props follow signals; the others
 * are read once.
 *
 * @category Controls
 */
export interface ButtonRowProps
  extends RefProps<ButtonRowComponent>, FocusProps {
  /** The buttons, left to right; each is created like a {@linkcode Button}. */
  buttons: readonly ButtonRowItem[];
  /** Index of the selected button; reactive. */
  selected?: MaybeAccessor<number>;
  /** Paints for the row's own elements; reactive. */
  theme?: MaybeAccessor<ButtonRowTheme>;
  /** Cells between buttons. Default 2. */
  gap?: number;
  /** Where the buttons sit in the row. Default `"left"`. */
  align?: "left" | "center" | "right";
  /** Characters the row draws, each replacing its default. */
  glyphs?: Partial<ButtonRowGlyphs>;
  /** Key specs per action; an entry replaces the default list for that action. */
  keys?: Partial<Record<ButtonRowAction, readonly string[]>>;
}

/**
 * Buttons side by side on one row: the JSX form of the class component
 * `ButtonRow`. While the row has focus the arrow keys and Tab move the
 * selected button and Enter or Space presses it.
 *
 * @param props The buttons, selection, focus and appearance.
 * @returns The button row.
 *
 * @example Choose the second button
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { mount } from "@neonbyte/tui/reactive";
 * import { ButtonRow } from "@neonbyte/tui/reactive/components";
 *
 * const terminal = new VirtualTerminal(30, 3);
 * const tui = new TUI(terminal);
 * const log: string[] = [];
 *
 * mount(
 *   <ButtonRow
 *     focus
 *     buttons={[
 *       { label: "OK", onPress: () => log.push("ok") },
 *       { label: "Cancel", onPress: () => log.push("cancel") },
 *     ]}
 *   />,
 *   tui,
 * );
 *
 * terminal.send("\x1b[C");
 * terminal.send("\r");
 * assertEquals(log, ["cancel"]);
 * tui.stop();
 * ```
 *
 * @category Controls
 */
export function ButtonRow(props: ButtonRowProps): ButtonRowComponent {
  const row = new ButtonRowComponent(
    props.buttons.map((item) => Button(item)),
    {
      gap: props.gap,
      align: props.align,
      glyphs: props.glyphs,
      theme: initial(props.theme),
      keys: props.keys,
    },
  );

  if (props.selected !== undefined) {
    row.select(initial(props.selected));
  }

  watch(props.selected, (value) => row.select(value));
  watch(props.theme, (value) => row.setTheme(value));

  return setup(row, props);
}
