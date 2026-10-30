import {
  TextField as TextFieldComponent,
  type TextFieldAction,
  type TextFieldGlyphs,
  type TextFieldTheme,
} from "../../../mod.ts";
import type { MaybeAccessor } from "../signal.ts";
import {
  type FocusProps,
  initial,
  type RefProps,
  setup,
  watch,
} from "./props.ts";

/**
 * Props of {@linkcode TextField}. Reactive props follow signals; the others
 * are read once.
 *
 * @category Text
 */
export interface TextFieldProps
  extends RefProps<TextFieldComponent>, FocusProps {
  /**
   * The value; reactive. When it changes to something other than the current
   * value, the field's value is replaced (the caret moves to the end). Bind it
   * to a signal updated in `onChange` for two-way binding.
   */
  value?: MaybeAccessor<string>;
  /** Shown before the value, e.g. `"> "`; reactive. May contain styling. */
  prompt?: MaybeAccessor<string>;
  /** Shown (dimmed) while the value is empty; reactive. */
  placeholder?: MaybeAccessor<string>;
  /** Password mode: draw every grapheme as the mask character; reactive. Default false. */
  masked?: MaybeAccessor<boolean>;
  /** The one-cell character drawn in password mode. Default `•`. */
  mask?: string;
  /** Longest value in graphemes; typing, paste and the `value` prop are cut to fit. Default unlimited. */
  maxLength?: number;
  /** Paints per element, each replacing its default; reactive. */
  theme?: MaybeAccessor<TextFieldTheme>;
  /** Decoration characters, each replacing its default. */
  glyphs?: Partial<TextFieldGlyphs>;
  /** Key specs per action; an entry replaces the default list for that action. */
  keys?: Partial<Record<TextFieldAction, readonly string[]>>;
  /** Called with the value when Enter (or another `submit` key) is pressed. */
  onSubmit?: (value: string) => void;
  /** Called with the new value after every edit the user makes. */
  onChange?: (value: string) => void;
}

/**
 * A single-line text field: the JSX form of the class component
 * `TextField`.
 *
 * @param props Value, prompt, placeholder, masking, focus, callbacks and appearance.
 * @returns The text field.
 *
 * @example Bind a field to a signal and submit it
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { mount, signal } from "@neonbyte/tui/reactive";
 * import { TextField } from "@neonbyte/tui/reactive/components";
 *
 * const terminal = new VirtualTerminal(30, 3);
 * const tui = new TUI(terminal);
 * const name = signal("");
 * const sent: string[] = [];
 *
 * mount(
 *   <TextField
 *     focus
 *     prompt="> "
 *     value={name}
 *     onChange={name.set}
 *     onSubmit={(value) => sent.push(value)}
 *   />,
 *   tui,
 * );
 *
 * terminal.send("hi");
 * assertEquals(name(), "hi");
 *
 * terminal.send("\r");
 * assertEquals(sent, ["hi"]);
 * tui.stop();
 * ```
 *
 * @category Text
 */
export function TextField(props: TextFieldProps): TextFieldComponent {
  const field = new TextFieldComponent({
    prompt: initial(props.prompt),
    placeholder: initial(props.placeholder),
    mask: props.mask,
    maxLength: props.maxLength,
    theme: initial(props.theme),
    glyphs: props.glyphs,
    keys: props.keys,
  });

  field.setMasked(initial(props.masked ?? false));

  if (props.value !== undefined) {
    field.setValue(initial(props.value));
  }

  field.onSubmit = props.onSubmit;
  field.onChange = props.onChange;

  watch(props.value, (value) => {
    if (value !== field.value) {
      field.setValue(value);
    }
  });
  watch(props.prompt, (value) => field.setPrompt(value));
  watch(props.placeholder, (value) => field.setPlaceholder(value));
  watch(props.masked, (value) => field.setMasked(value));
  watch(props.theme, (value) => field.setTheme(value));

  return setup(field, props);
}
