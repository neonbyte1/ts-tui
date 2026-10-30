import {
  Link as LinkComponent,
  type LinkAction,
  type LinkTheme,
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
 * Props of {@linkcode Link}. Reactive props follow signals; the others are
 * read once.
 *
 * @category Controls
 */
export interface LinkProps extends RefProps<LinkComponent>, FocusProps {
  /** The label; reactive. Runs of whitespace collapse to one space. */
  text: MaybeAccessor<string>;
  /** The absolute URL the label points to; reactive. Changing it resets `visited`. */
  url: MaybeAccessor<string>;
  /**
   * Whether the link counts as visited; reactive. Opening the link also marks
   * it visited, so bind this to a signal only to restore or reset the state.
   */
  visited?: MaybeAccessor<boolean>;
  /** Paints per state; reactive. */
  theme?: MaybeAccessor<LinkTheme>;
  /** Mark at the end of a label cut to fit. Default `"…"`. */
  ellipsis?: string;
  /** Key specs per action; an entry replaces the default list for that action. */
  keys?: Partial<Record<LinkAction, readonly string[]>>;
  /** Called with the URL on Enter (while focused) or a left click. Without it the link is only a native terminal hyperlink. */
  onOpen?: (url: string) => void;
}

/**
 * A one-row clickable OSC 8 hyperlink: the JSX form of the class component
 * `Link`.
 *
 * @param props Label, URL, focus, callback and appearance.
 * @returns The link.
 *
 * @example Open a link with Enter
 * ```tsx
 * import { assertEquals } from "@std/assert";
 * import { TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { mount, signal } from "@neonbyte/tui/reactive";
 * import { Link } from "@neonbyte/tui/reactive/components";
 *
 * const terminal = new VirtualTerminal(30, 3);
 * const tui = new TUI(terminal);
 * const visited = signal(false);
 * const opened: string[] = [];
 *
 * mount(
 *   <Link
 *     focus
 *     text="Docs"
 *     url="https://jsr.io/@neonbyte/tui"
 *     visited={visited}
 *     onOpen={(url) => opened.push(url)}
 *   />,
 *   tui,
 * );
 *
 * terminal.send("\r");
 * assertEquals(opened, ["https://jsr.io/@neonbyte/tui"]);
 * tui.stop();
 * ```
 *
 * @category Controls
 */
export function Link(props: LinkProps): LinkComponent {
  const link = new LinkComponent(initial(props.text), initial(props.url), {
    onOpen: props.onOpen,
    theme: initial(props.theme),
    ellipsis: props.ellipsis,
    keys: props.keys,
  });

  if (props.visited !== undefined) {
    link.setVisited(initial(props.visited));
  }

  watch(props.text, (value) => link.setText(value));
  watch(props.url, (value) => link.setUrl(value));
  watch(props.visited, (value) => link.setVisited(value));
  watch(props.theme, (value) => link.setTheme(value));

  return setup(link, props);
}
