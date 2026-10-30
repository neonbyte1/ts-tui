import {
  Editor as EditorComponent,
  type EditorAction,
  type EditorGlyphs,
  type EditorLabels,
  type EditorTheme,
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
 * Props of {@linkcode Editor}. Reactive props follow signals; the others are
 * read once.
 *
 * @category Controls
 */
export interface EditorProps extends RefProps<EditorComponent>, FocusProps {
  /**
   * The text; reactive. When it changes to something other than the current
   * text, the editor's text is replaced (undo and history browsing reset).
   * Bind it to a signal updated in `onChange` for two-way binding.
   */
  value?: MaybeAccessor<string>;
  /** Shown (dimmed) while the text is empty; reactive. */
  placeholder?: MaybeAccessor<string>;
  /** While true, Enter does not submit; reactive. */
  disableSubmit?: MaybeAccessor<boolean>;
  /** Paints per element, each replacing its default; reactive. */
  theme?: MaybeAccessor<EditorTheme>;
  /** Maximum number of visible text rows before the editor scrolls. Default 10. */
  maxHeight?: number;
  /** Draw a horizontal rule above and below the text. Default true. */
  border?: boolean;
  /** Decoration characters, each replacing its default. */
  glyphs?: Partial<EditorGlyphs>;
  /** Fixed texts of the rules, each replacing its default. */
  labels?: Partial<EditorLabels>;
  /** Cells of rule before a label. Default 1. */
  labelInset?: number;
  /** Key specs per action; an entry replaces the default list for that action. */
  keys?: Partial<Record<EditorAction, readonly string[]>>;
  /** Called with the text when Enter (or another `submit` key) is pressed. */
  onSubmit?: (text: string) => void;
  /** Called with the new text after every edit the user makes. */
  onChange?: (text: string) => void;
}

/**
 * A multi-line text editor: the JSX form of the class component `Editor`.
 *
 * @param props Text, placeholder, focus, callbacks and appearance.
 * @returns The editor.
 *
 * @example Submit and clear a prompt
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { mount, signal } from "@neonbyte/tui/reactive";
 * import { Editor } from "@neonbyte/tui/reactive/components";
 *
 * const terminal = new VirtualTerminal(30, 5);
 * const tui = new TUI(terminal);
 * const draft = signal("");
 * const sent: string[] = [];
 *
 * mount(
 *   <Editor
 *     focus
 *     value={draft}
 *     onChange={draft.set}
 *     onSubmit={(text) => {
 *       sent.push(text);
 *       draft.set("");
 *     }}
 *   />,
 *   tui,
 * );
 *
 * terminal.send("hi");
 * assertEquals(draft(), "hi");
 *
 * terminal.send("\r");
 * assertEquals(sent, ["hi"]);
 * assertEquals(draft(), "");
 * tui.stop();
 * ```
 *
 * @category Controls
 */
export function Editor(props: EditorProps): EditorComponent {
  const editor = new EditorComponent({
    placeholder: initial(props.placeholder),
    theme: initial(props.theme),
    maxHeight: props.maxHeight,
    border: props.border,
    glyphs: props.glyphs,
    labels: props.labels,
    labelInset: props.labelInset,
    keys: props.keys,
  });

  if (props.value !== undefined) {
    editor.setText(initial(props.value));
  }

  editor.disableSubmit = initial(props.disableSubmit ?? false);
  editor.onSubmit = props.onSubmit;
  editor.onChange = props.onChange;

  watch(props.value, (value) => {
    if (value !== editor.text) {
      editor.setText(value);
    }
  });
  watch(props.placeholder, (value) => editor.setPlaceholder(value));
  watch(props.disableSubmit, (value) => {
    editor.disableSubmit = value;
  });
  watch(props.theme, (value) => editor.setTheme(value));

  return setup(editor, props);
}
