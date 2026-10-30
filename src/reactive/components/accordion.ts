import {
  Accordion as AccordionComponent,
  type AccordionAction,
  type AccordionGlyphs,
  type AccordionTheme,
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
 * One section of an {@linkcode Accordion}: a header row and the content shown
 * below it while it is open.
 *
 * @category Layout
 */
export interface SectionProps {
  /** Text of the header row; reactive. */
  title: MaybeAccessor<string>;
  /** Shown below the header while the section is open. */
  content?: Child;
  /**
   * Whether the section is open; reactive. Opening a section in single mode
   * closes the others. Bind it to a signal updated in `onToggle` for two-way
   * binding. Default false.
   */
  open?: MaybeAccessor<boolean>;
}

/**
 * Props of {@linkcode Accordion}. Reactive props follow signals; the others
 * are read once.
 *
 * @category Layout
 */
export interface AccordionProps
  extends RefProps<AccordionComponent>, FocusProps {
  /** The sections, top to bottom. The list is read once; each title and `open` follows its own signal. */
  sections: readonly SectionProps[];
  /** The selected header; reactive. Changes move the selection (clamped). Default 0. */
  selected?: MaybeAccessor<number>;
  /** Paints for the headers, each replacing its default; reactive. */
  theme?: MaybeAccessor<AccordionTheme>;
  /** Whether several sections can be open at once. When false, opening a section closes the others. Default false. */
  multiple?: boolean;
  /** The open and closed markers. Default `ACCORDION_GLYPHS.triangle`. */
  glyphs?: Partial<AccordionGlyphs>;
  /** Cells the content is indented below its header. Default 2. */
  indent?: number;
  /** Cells between the marker and the title. Default 1. */
  gap?: number;
  /** Replaces the end of a title that does not fit. Default `…`. */
  ellipsis?: string;
  /** Key specs per action; an entry replaces that action's default list. */
  keys?: Partial<Record<AccordionAction, readonly string[]>>;
  /** Called after the user opens or closes a section, with its index and new state; not when `open` changes. In single mode, opening a section reports the sections it closed first. */
  onToggle?: (index: number, open: boolean) => void;
}

/**
 * Collapsible sections: the JSX form of the class component `Accordion`. The
 * titles, open states, selection and theme follow signals.
 *
 * @param props The sections, selection and look.
 * @returns The accordion component.
 *
 * @example Open a section from a signal
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { root, signal, toComponent } from "@neonbyte/tui/reactive";
 * import { Accordion, Text } from "@neonbyte/tui/reactive/components";
 *
 * const open = signal(false);
 * const title = signal("Advanced");
 *
 * root(() => {
 *   const accordion = toComponent(
 *     <Accordion
 *       theme={{ header: {}, open: {}, focused: {}, hover: {} }}
 *       sections={[
 *         { title: "General", content: <Text>hello</Text> },
 *         { title, content: <Text>secret</Text>, open },
 *       ]}
 *     />,
 *   );
 *
 *   assertEquals(accordion.render(20), ["▸ General", "▸ Advanced"]);
 *
 *   open.set(true);
 *   title.set("More");
 *   assertEquals(accordion.render(20), ["▸ General", "▾ More", "  secret"]);
 * });
 * ```
 *
 * @category Layout
 */
export function Accordion(props: AccordionProps): AccordionComponent {
  const accordion = new AccordionComponent({
    sections: props.sections.map((section) => ({
      title: initial(section.title),
      content: toComponent(section.content),
      open: initial(section.open),
    })),
    multiple: props.multiple,
    theme: initial(props.theme),
    glyphs: props.glyphs,
    indent: props.indent,
    gap: props.gap,
    ellipsis: props.ellipsis,
    keys: props.keys,
  });
  const selected = initial(props.selected);

  if (selected !== undefined) {
    accordion.select(selected);
  }

  accordion.onToggle = props.onToggle;

  props.sections.forEach((section, index) => {
    watch(section.title, (title) => accordion.setTitle(index, title));
    watch(section.open, (open) => {
      if (open) {
        accordion.open(index);
      } else {
        accordion.close(index);
      }
    });
  });
  watch(props.selected, (index) => accordion.select(index));
  watch(props.theme, (theme) => accordion.setTheme(theme));

  return setup(accordion, props);
}
