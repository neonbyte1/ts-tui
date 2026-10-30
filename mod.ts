/**
 * Inline terminal UI for Deno, Node and Bun. Components render to rows of ANSI
 * text, and the {@linkcode TUI} repaints only the rows that changed. Output
 * stays in the terminal's normal screen, so finished rows scroll into its
 * native scrollback like any other command's output.
 *
 * Included:
 * - **Text and editing:** {@linkcode Text}, {@linkcode Markdown},
 *   {@linkcode TextField} (with password mask) and a multi-line
 *   {@linkcode Editor}.
 * - **Layout:** {@linkcode Container}, {@linkcode Box}, {@linkcode Panes}
 *   (resizable), {@linkcode ScrollView}, {@linkcode Tabs},
 *   {@linkcode Accordion}.
 * - **Controls and overlays:** {@linkcode Button}, {@linkcode Link},
 *   {@linkcode Overlay}, {@linkcode Modal}, {@linkcode Toaster}.
 * - **Progress and status:** {@linkcode ProgressBar}, {@linkcode Spinner},
 *   {@linkcode Checklist}, {@linkcode Thinking}, {@linkcode Duration},
 *   {@linkcode Sparkline}.
 * - **Terminal features:** inline {@linkcode Image}s (kitty graphics, iTerm2),
 *   the kitty keyboard protocol, a hardware cursor that follows the focused
 *   caret, and opt-in mouse input.
 *
 * Every component takes a `theme` of {@linkcode Paint}s for its colours, and
 * most take glyph sets, text labels and `keys` bindings, so the look and keys
 * can be changed without subclassing.
 *
 * Prefer declarative UI? `@neonbyte/tui/reactive` adds signals, effects and
 * composables, and `@neonbyte/tui/reactive/components` a JSX component for each
 * class component here: state lives in signals and the components follow it.
 *
 * ## Getting started
 *
 * ```sh
 * deno add jsr:@neonbyte/tui      # Deno
 * npx jsr add @neonbyte/tui       # Node
 * bunx jsr add @neonbyte/tui      # Bun
 * ```
 *
 * A minimal app: replies collect above a prompt, and Ctrl+C quits. It needs a
 * real terminal and no permissions.
 *
 * ```ts ignore
 * import process from "node:process";
 * import {
 *   Container,
 *   matchesKey,
 *   ProcessTerminal,
 *   Text,
 *   TextField,
 *   TUI,
 * } from "@neonbyte/tui";
 *
 * const tui = new TUI(new ProcessTerminal());
 * const messages = new Container();
 * const field = new TextField({ prompt: "> ", placeholder: "say something" });
 *
 * field.onSubmit = (value) => {
 *   messages.addChild(new Text(`you said: ${value}`));
 *   field.setValue("");
 * };
 *
 * tui.addChild(new Text("Hello from @neonbyte/tui"));
 * tui.addChild(messages);
 * tui.addChild(field);
 * tui.setFocus(field);
 * tui.addInputListener((event) => {
 *   if (event.type === "key" && matchesKey(event.key, "ctrl+c")) {
 *     tui.stop();
 *     process.exit(0);
 *   }
 * });
 * tui.start();
 * ```
 *
 * ## How rendering works
 *
 * A {@linkcode Component} returns one string per screen row from
 * `render(width)`, each at most `width` cells wide. The TUI compares the rows
 * with the previous frame and rewrites only those that changed, in one write
 * wrapped in synchronized-output escapes. Components return the same array
 * while nothing changed, which lets {@linkcode Container}s skip work. Call
 * `tui.requestRender()` after changing state; renders are batched and capped
 * at about 60 frames per second.
 *
 * @example Render components into an in-memory terminal
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { ProgressBar, Text, TUI, VirtualTerminal } from "@neonbyte/tui";
 *
 * const terminal = new VirtualTerminal(24, 4);
 * const tui = new TUI(terminal);
 * const bar = new ProgressBar({ barWidth: 10, theme: { fill: {}, track: {} } });
 *
 * tui.addChild(new Text("Downloading"));
 * tui.addChild(bar);
 * tui.start();
 * bar.setProgress(0.5);
 * tui.renderNow();
 *
 * assertEquals(terminal.viewport().slice(0, 2), [
 *   "Downloading",
 *   "█████       50%",
 * ]);
 * tui.stop();
 * ```
 *
 * @example Write your own component
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { type Component, TUI, VirtualTerminal } from "@neonbyte/tui";
 *
 * class Counter implements Component {
 *   public count = 0;
 *
 *   public render(width: number): readonly string[] {
 *     return [`count: ${this.count}`.slice(0, width)];
 *   }
 * }
 *
 * const terminal = new VirtualTerminal(20, 2);
 * const tui = new TUI(terminal);
 * const counter = new Counter();
 *
 * tui.addChild(counter);
 * tui.start();
 * counter.count = 3;
 * tui.renderNow();
 *
 * assertEquals(terminal.viewport()[0], "count: 3");
 * tui.stop();
 * ```
 *
 * ## Input, focus and mouse
 *
 * Keys and pastes go to listeners added with `tui.addInputListener()`, then
 * to the focused component (`tui.setFocus()`). Mouse reporting is off by
 * default because while it is on the terminal stops scrolling its scrollback
 * with the wheel and selecting text on drag. Turn it on with
 * `new TUI(terminal, { mouse: "click" })` or `tui.setMouse("drag")`; see
 * {@linkcode MouseMode}. Components receive mouse events through
 * `handleMouse` in their own cell coordinates.
 *
 * ## Testing
 *
 * {@linkcode VirtualTerminal} interprets the escape sequences the TUI emits
 * into a grid of plain text. Send it input with `terminal.send()` (and
 * {@linkcode encodeMouse} for mouse reports) and read the screen with
 * `terminal.viewport()`.
 *
 * ## Permissions
 *
 * Rendering needs none. {@linkcode openUrl} needs `--allow-run` for the
 * platform's URL opener; loading image files is up to you.
 *
 * @module
 */
export {
  type BorderGlyphs,
  BORDERS,
  Box,
  type BoxOptions,
  type BoxTheme,
} from "./src/components/box.ts";
export {
  type Component,
  Container,
  type Focusable,
  forwardMouse,
  type InputListener,
  isFocusable,
  type MouseMode,
  type OverlayAnchor,
  type OverlayHandle,
  type OverlayOptions,
  type OverlaySize,
  TUI,
  type TUIOptions,
} from "./src/tui.ts";
export { CURSOR_MARKER, IMAGE_RESERVED } from "./src/ansi.ts";
export {
  type ImageProtocol,
  type TerminalInfo,
  terminalInfo,
} from "./src/capabilities.ts";
export { ProcessTerminal, type Terminal } from "./src/terminal.ts";
export { type VirtualImage, VirtualTerminal } from "./src/virtual-terminal.ts";
export {
  bindKeys,
  encodeMouse,
  type InputEvent,
  InputParser,
  type Key,
  matchesKey,
  type MouseAction,
  type MouseButton,
  type MouseInput,
  type ParsedInput,
  parseKey,
  type TerminalReport,
} from "./src/keys.ts";
export {
  graphemeWidth,
  padToWidth,
  sliceColumns,
  type Token,
  tokenize,
  truncateToWidth,
  visibleWidth,
  wrapText,
} from "./src/width.ts";
export {
  type ImageFormat,
  type ImageInfo,
  readImageInfo,
} from "./src/image-format.ts";
export { type LineStyle, Text } from "./src/components/text.ts";
export { Spacer } from "./src/components/spacer.ts";
export {
  DEFAULT_TEXT_FIELD_KEYS,
  TextField,
  type TextFieldAction,
  type TextFieldGlyphs,
  type TextFieldOptions,
  type TextFieldTheme,
} from "./src/components/text-field.ts";
export {
  DEFAULT_EDITOR_KEYS,
  Editor,
  EDITOR_GLYPHS,
  type EditorAction,
  type EditorGlyphs,
  type EditorLabels,
  type EditorOptions,
  type EditorTheme,
} from "./src/components/editor.ts";
export {
  Markdown,
  MARKDOWN_GLYPHS,
  type MarkdownGlyphs,
  type MarkdownLabels,
  type MarkdownOptions,
  type MarkdownTableGlyphs,
  type MarkdownTheme,
} from "./src/components/markdown.ts";
export {
  Image,
  type ImageLabels,
  type ImageOptions,
  type ImageTheme,
} from "./src/components/image.ts";
export {
  Loader,
  type LoaderOptions,
  type LoaderTheme,
} from "./src/components/loader.ts";
export {
  ProgressBar,
  type ProgressBarOptions,
  type ProgressBarStyle,
  type ProgressStats,
  type ProgressText,
  type ProgressTheme,
} from "./src/components/progress.ts";
export {
  Sparkline,
  SPARKLINE_LEVELS,
  type SparklineOptions,
  type SparklineTheme,
} from "./src/components/sparkline.ts";
export {
  Duration,
  type DurationOptions,
  type DurationTheme,
  type DurationUnit,
  ROLL_GLYPHS,
  type RollGlyphs,
} from "./src/components/duration.ts";
export {
  BAR_GLYPHS,
  type BarCell,
  type BarCellKind,
  type BarGlyphs,
  type BarMarker,
  type BarRenderOptions,
  type BarSection,
  type BarTheme,
  capsWidth,
  type CellPaint,
  filledCells,
  gradient,
  renderBar,
  thresholds,
} from "./src/bar.ts";
export {
  type Color,
  hexToRgb,
  mergePaint,
  mixColors,
  type NamedColor,
  type Paint,
  paint,
  paintTransition,
} from "./src/style.ts";
export { formatBytes, formatCount, formatDuration } from "./src/format.ts";
export {
  Shimmer,
  shimmerCentre,
  type ShimmerOptions,
  shimmerText,
  type ShimmerTheme,
} from "./src/components/shimmer.ts";
export {
  Thinking,
  type ThinkingOptions,
  type ThinkingTheme,
} from "./src/components/thinking.ts";
export { Spinner, type SpinnerOptions } from "./src/components/spinner.ts";
export {
  Checklist,
  type ChecklistAction,
  type ChecklistItem,
  type ChecklistOptions,
  type ChecklistTheme,
  DEFAULT_CHECKLIST_KEYS,
} from "./src/components/checklist.ts";
export {
  STATUS_GLYPHS,
  type StatusGlyphs,
  type StatusPaints,
  type StatusTheme,
  type TaskState,
} from "./src/status.ts";
export {
  Button,
  BUTTON_GLYPHS,
  type ButtonAction,
  type ButtonGlyphs,
  type ButtonOptions,
  ButtonRow,
  type ButtonRowAction,
  type ButtonRowGlyphs,
  type ButtonRowOptions,
  type ButtonRowTheme,
  type ButtonTheme,
  type ButtonVariant,
  DEFAULT_BUTTON_KEYS,
  DEFAULT_BUTTON_ROW_KEYS,
} from "./src/components/button.ts";
export {
  DEFAULT_MODAL_KEYS,
  Modal,
  type ModalAction,
  type ModalButton,
  type ModalCloseReason,
  type ModalOptions,
  type ModalTheme,
} from "./src/components/modal.ts";
export {
  DEFAULT_OVERLAY_KEYS,
  Overlay,
  type OverlayAction,
  type OverlayPanelOptions,
  type OverlayTheme,
} from "./src/components/overlay.ts";
export {
  TOAST_GLYPHS,
  Toaster,
  type ToasterOptions,
  type ToasterTheme,
  type ToastGlyphs,
  type ToastHandle,
  type ToastKind,
  type ToastOptions,
} from "./src/components/toast.ts";
export {
  DEFAULT_LINK_KEYS,
  hyperlink,
  Link,
  type LinkAction,
  type LinkOptions,
  type LinkTheme,
  openUrl,
} from "./src/components/link.ts";
export {
  DEFAULT_TABS_KEYS,
  type TabItem,
  Tabs,
  TABS_GLYPHS,
  type TabsAction,
  type TabsGlyphs,
  type TabsOptions,
  type TabsStyle,
  type TabsTheme,
} from "./src/components/tabs.ts";
export {
  Accordion,
  ACCORDION_GLYPHS,
  type AccordionAction,
  type AccordionGlyphs,
  type AccordionOptions,
  type AccordionSection,
  type AccordionTheme,
  DEFAULT_ACCORDION_KEYS,
} from "./src/components/accordion.ts";
export {
  renderScrollbar,
  SCROLLBAR_GLYPHS,
  type ScrollbarGlyphs,
  scrollbarOffset,
  type ScrollbarOptions,
  type ScrollbarTheme,
  type ScrollbarThumb,
  scrollbarThumb,
} from "./src/scrollbar.ts";
export {
  DEFAULT_SCROLL_VIEW_KEYS,
  ScrollView,
  type ScrollViewAction,
  type ScrollViewOptions,
} from "./src/components/scroll-view.ts";
export {
  Panes,
  PANES_GLYPHS,
  type PanesGlyphs,
  type PaneSize,
  type PanesOptions,
  type PaneSpec,
  type PanesTheme,
} from "./src/components/panes.ts";
