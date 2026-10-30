import {
  Tabs as TabsComponent,
  type TabsAction,
  type TabsGlyphs,
  type TabsStyle,
  type TabsTheme,
} from "../../../mod.ts";
import { type Child, toComponent } from "../jsx.ts";
import type { MaybeAccessor } from "../signal.ts";
import {
  type FocusProps,
  initial,
  type RefProps,
  setup,
  watch,
} from "./props.ts";

/**
 * One tab of a {@linkcode Tabs}: the label in the bar and the content shown
 * while it is selected.
 *
 * @category Layout
 */
export interface TabProps {
  /** Text in the bar; reactive. */
  label: MaybeAccessor<string>;
  /** Shown below the bar while the tab is selected. */
  content?: Child;
}

/**
 * Props of {@linkcode Tabs}. Reactive props follow signals; the others are
 * read once.
 *
 * @category Layout
 */
export interface TabsProps extends RefProps<TabsComponent>, FocusProps {
  /** The tabs, in order. The list is read once; each label follows its own signal. */
  tabs: readonly TabProps[];
  /**
   * Index of the selected tab; reactive. Changes select that tab (clamped).
   * Bind it to a signal updated in `onChange` for two-way binding.
   */
  selected?: MaybeAccessor<number>;
  /** Paints for the parts of the bar, each replacing its default; reactive. */
  theme?: MaybeAccessor<TabsTheme>;
  /** `"line"` (default) or `"boxed"`. */
  style?: TabsStyle;
  /** Characters of the rule, indicator, box and scroll markers; unset ones keep `TABS_GLYPHS.unicode`. */
  glyphs?: Partial<TabsGlyphs>;
  /** Cells either side of a label, inside any border. Default 1. */
  padding?: number;
  /** Drawn between neighbouring tabs on the label row. Default none. */
  separator?: string;
  /** Replaces the end of a label that does not fit. Default `…`. */
  ellipsis?: string;
  /** Key specs per action; an entry replaces that action's default list. */
  keys?: Partial<Record<TabsAction, readonly string[]>>;
  /** Called with the new index after the user switches tab (keys, click or wheel); not when `selected` changes. */
  onChange?: (index: number) => void;
}

/**
 * A tab bar over the selected tab's content: the JSX form of the class
 * component `Tabs`. The selection, the labels and the theme follow signals.
 *
 * @param props The tabs, selection and look.
 * @returns The tabs component.
 *
 * @example Select a tab from a signal
 * ```tsx
 * import { assert, assertEquals } from "@std/assert";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { Tabs, Text } from "@neonbyte/tui/reactive/components";
 *
 * const selected = signal(0);
 * const name = signal("Two");
 *
 * root(() => {
 *   const tabs = toComponent(
 *     <Tabs
 *       selected={selected}
 *       tabs={[
 *         { label: "One", content: <Text>first</Text> },
 *         { label: name, content: <Text>second</Text> },
 *       ]}
 *     />,
 *   );
 *
 *   assertEquals(tabs.render(20)[2], "first");
 *
 *   selected.set(1);
 *   assertEquals(tabs.render(20)[2], "second");
 *
 *   name.set("Other");
 *   assert(tabs.render(20)[0].includes("Other"));
 * });
 * ```
 *
 * @category Layout
 */
export function Tabs(props: TabsProps): TabsComponent {
  const tabs = new TabsComponent({
    tabs: props.tabs.map((tab) => ({
      label: initial(tab.label),
      content: toComponent(tab.content),
    })),
    selected: initial(props.selected),
    onChange: props.onChange,
    theme: initial(props.theme),
    style: props.style,
    glyphs: props.glyphs,
    padding: props.padding,
    separator: props.separator,
    ellipsis: props.ellipsis,
    keys: props.keys,
  });

  props.tabs.forEach((tab, index) => {
    watch(tab.label, (label) => tabs.setLabel(index, label));
  });
  watch(props.selected, (index) => tabs.select(index));
  watch(props.theme, (theme) => tabs.setTheme(theme));

  return setup(tabs, props);
}
