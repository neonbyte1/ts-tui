import {
  Checklist as ChecklistComponent,
  type ChecklistAction,
  type ChecklistItem,
  type ChecklistTheme,
  type StatusGlyphs,
} from "../../../mod.ts";
import { useHost } from "../host.ts";
import { type MaybeAccessor, onCleanup } from "../signal.ts";
import {
  type FocusProps,
  initial,
  type RefProps,
  setup,
  watch,
} from "./props.ts";

/**
 * Props of {@linkcode Checklist}. Reactive props follow signals; the others
 * are read once.
 *
 * @category Progress & status
 */
export interface ChecklistProps
  extends RefProps<ChecklistComponent>, FocusProps {
  /**
   * The items; reactive. Later changes are applied item by item (matched by
   * position) so a step that finishes plays its settle animation; see
   * {@linkcode Checklist}.
   */
  items?: MaybeAccessor<readonly ChecklistItem[]>;
  /** Paints for glyphs, labels, notes and the pointer, each replacing its default; reactive. */
  theme?: MaybeAccessor<ChecklistTheme>;
  /** Called after the user toggles an item, with its index and the item as toggled. */
  onToggle?: (index: number, item: ChecklistItem) => void;
  /** Respond to keys and the mouse: ↑/↓ select, Space/Enter toggle done. Adds a pointer column. Default false. */
  interactive?: boolean;
  /** Default `STATUS_GLYPHS.checkbox`. */
  glyphs?: StatusGlyphs;
  /** Keyboard control while focused, replacing the default keys of each action given. Default `DEFAULT_CHECKLIST_KEYS`. */
  keys?: Partial<Record<ChecklistAction, readonly string[]>>;
  /** Pointer at the selected item while focused, painted with `theme.pointer`. Default `❯`. */
  pointer?: string;
  /** Cells between the glyph and the label. Default 1. */
  gap?: number;
  /** Cells between the pointer and the glyph. Default 1. */
  pointerGap?: number;
  /** Between a label and its note. Default `" "`. */
  noteSeparator?: string;
  /** Frame interval of spinners and settle animations. Default 80 ms. */
  intervalMs?: number;
  /** Millisecond clock the animation follows. Default `performance.now`. */
  clock?: () => number;
}

/**
 * Bring `list` to `items` without resetting what did not change: items are
 * matched by position, only differing ones are updated (so a state that
 * changed plays its settle animation), extra items are appended and surplus
 * ones removed from the end.
 */
function applyItems(
  list: ChecklistComponent,
  items: readonly ChecklistItem[],
): void {
  const current = list.items;
  const shared = Math.min(current.length, items.length);

  for (let i = 0; i < shared; i++) {
    const now = current[i];
    const item = items[i];

    if (
      item.label !== now.label || item.note !== now.note ||
      item.state !== now.state
    ) {
      list.update(i, { label: item.label, state: item.state, note: item.note });
    }
  }

  for (let i = shared; i < items.length; i++) {
    list.add(items[i].label, items[i].state, items[i].note);
  }

  for (let i = current.length - 1; i >= items.length; i--) {
    list.remove(i);
  }
}

/**
 * A to-do list: the JSX form of the class component `Checklist`.
 *
 * When `items` is an accessor, each change is applied to the list item by
 * item, matched by position: only the items that differ are updated, so an
 * item whose `state` turns `done`, `failed` or `skipped` plays its settle
 * animation, and a running spinner keeps spinning. Items added at the end
 * appear in their state without a settle animation, and surplus items are
 * removed from the end. (The class's `setItems` would instead replace every
 * item and reset all animations; it is only used when the component is
 * disposed, which also stops the animation timer.)
 *
 * The signal is the source of truth: an item toggled by the user keeps its
 * new state until `items` changes, then follows `items` again. Update the
 * signal from `onToggle` to keep both in step.
 *
 * @param props Items, focus, toggling, appearance and timing.
 * @returns The checklist.
 *
 * @example Finish a step
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import type { ChecklistItem } from "@neonbyte/tui";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { Checklist } from "@neonbyte/tui/reactive/components";
 *
 * let now = 0;
 * const items = signal<readonly ChecklistItem[]>([
 *   { label: "Compile", state: "running" },
 *   { label: "Test", state: "pending" },
 * ]);
 *
 * root((dispose) => {
 *   const list = toComponent(<Checklist items={items} clock={() => now} />);
 *
 *   items.set([
 *     { label: "Compile", state: "done", note: "1.2s" },
 *     { label: "Test", state: "pending" },
 *   ]);
 *   now = 1000; // the settle animation is over
 *
 *   const rows = list.render(30).map((row) =>
 *     row.replace(/\x1b\[[0-9;]*m/g, "")
 *   );
 *
 *   assertEquals(rows, ["☑ Compile 1.2s", "☐ Test"]);
 *   dispose();
 * });
 * ```
 *
 * @example Toggle items with the keyboard
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { type ChecklistItem, TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { mount, signal } from "@neonbyte/tui/reactive";
 * import { Checklist } from "@neonbyte/tui/reactive/components";
 *
 * const terminal = new VirtualTerminal(30, 5);
 * const tui = new TUI(terminal);
 * const items = signal<readonly ChecklistItem[]>([
 *   { label: "Compile", state: "pending" },
 *   { label: "Test", state: "pending" },
 * ]);
 *
 * const dispose = mount(
 *   <Checklist
 *     interactive
 *     focus
 *     items={items}
 *     onToggle={(index, item) =>
 *       items.set(items().map((it, i) => i === index ? item : it))}
 *   />,
 *   tui,
 * );
 *
 * terminal.send("j");
 * terminal.send(" ");
 * assertEquals(items()[1].state, "done");
 * dispose();
 * tui.stop();
 * ```
 *
 * @category Progress & status
 */
export function Checklist(props: ChecklistProps): ChecklistComponent {
  const list = new ChecklistComponent(useHost(), {
    items: initial(props.items ?? []),
    glyphs: props.glyphs,
    theme: initial(props.theme),
    keys: props.keys,
    interactive: props.interactive,
    pointer: props.pointer,
    gap: props.gap,
    pointerGap: props.pointerGap,
    noteSeparator: props.noteSeparator,
    intervalMs: props.intervalMs,
    clock: props.clock,
  });

  list.onToggle = props.onToggle;

  watch(props.items, (items) => applyItems(list, items));
  watch(props.theme, (theme) => list.setTheme(theme));
  onCleanup(() => list.setItems([]));

  return setup(list, props);
}
