/**
 * JSX components of `@neonbyte/tui`: each creates the class component of the
 * same name from `@neonbyte/tui`, turns its reactive props into setter calls and
 * redraws, and disposes timers, animations and focus with the tree. Plus
 * control flow ({@linkcode Show}, {@linkcode For}), {@linkcode Column} and
 * {@linkcode Provider}.
 *
 * Props typed `MaybeAccessor<T>` are reactive: pass a signal or an accessor
 * to follow it. Other props are read once, when the component is created.
 * Pass `ref` to get the class component for imperative calls.
 *
 * Use it with `jsxImportSource: "@neonbyte/tui/reactive"`; see
 * `@neonbyte/tui/reactive` for signals, {@linkcode mount} and composables.
 *
 * @example A prompt with a live status line
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { mount, signal } from "@neonbyte/tui/reactive";
 * import { Column, Editor, For, Text } from "@neonbyte/tui/reactive/components";
 *
 * function Chat() {
 *   const messages = signal<string[]>([]);
 *
 *   return (
 *     <Column>
 *       <For each={messages}>{(message) => <Text>{message}</Text>}</For>
 *       <Editor
 *         focus
 *         border={false}
 *         onSubmit={(text) => messages.update((list) => [...list, text])}
 *       />
 *       <Text>{() => `${messages().length} sent`}</Text>
 *     </Column>
 *   );
 * }
 *
 * const terminal = new VirtualTerminal(20, 4);
 * const tui = new TUI(terminal);
 *
 * mount(<Chat />, tui);
 * terminal.send("hello\r");
 * tui.renderNow();
 *
 * assertEquals(terminal.viewport()[0], "hello");
 * assertEquals(terminal.viewport()[2], "1 sent");
 * tui.stop();
 * ```
 *
 * @module
 */

export {
  Column,
  type ColumnProps,
  For,
  type ForProps,
  Provider,
  type ProviderProps,
  Show,
  type ShowProps,
} from "../../src/reactive/control.ts";
export {
  type FocusProps,
  type RefProps,
} from "../../src/reactive/components/props.ts";
export {
  Text,
  type TextPart,
  type TextProps,
} from "../../src/reactive/components/text.ts";
export {
  Editor,
  type EditorProps,
} from "../../src/reactive/components/editor.ts";
export {
  Markdown,
  type MarkdownProps,
} from "../../src/reactive/components/markdown.ts";
export {
  Spacer,
  type SpacerProps,
} from "../../src/reactive/components/spacer.ts";
export { Link, type LinkProps } from "../../src/reactive/components/link.ts";
export { Image, type ImageProps } from "../../src/reactive/components/image.ts";
export {
  Button,
  type ButtonLabelPart,
  type ButtonProps,
  ButtonRow,
  type ButtonRowItem,
  type ButtonRowProps,
} from "../../src/reactive/components/button.ts";
export {
  TextField,
  type TextFieldProps,
} from "../../src/reactive/components/text-field.ts";
export { Modal, type ModalProps } from "../../src/reactive/components/modal.ts";
export {
  Overlay,
  type OverlayProps,
} from "../../src/reactive/components/overlay.ts";
export {
  Spinner,
  type SpinnerProps,
} from "../../src/reactive/components/spinner.ts";
export {
  Loader,
  type LoaderProps,
} from "../../src/reactive/components/loader.ts";
export {
  Shimmer,
  type ShimmerProps,
} from "../../src/reactive/components/shimmer.ts";
export {
  Thinking,
  type ThinkingProps,
} from "../../src/reactive/components/thinking.ts";
export {
  Checklist,
  type ChecklistProps,
} from "../../src/reactive/components/checklist.ts";
export { Box, type BoxProps } from "../../src/reactive/components/box.ts";
export {
  ScrollView,
  type ScrollViewProps,
} from "../../src/reactive/components/scroll-view.ts";
export {
  type PaneProps,
  Panes,
  type PanesProps,
} from "../../src/reactive/components/panes.ts";
export {
  type TabProps,
  Tabs,
  type TabsProps,
} from "../../src/reactive/components/tabs.ts";
export {
  Accordion,
  type AccordionProps,
  type SectionProps,
} from "../../src/reactive/components/accordion.ts";
export {
  ProgressBar,
  type ProgressBarProps,
} from "../../src/reactive/components/progress.ts";
export {
  Sparkline,
  type SparklineProps,
} from "../../src/reactive/components/sparkline.ts";
export {
  Duration,
  type DurationProps,
} from "../../src/reactive/components/duration.ts";
