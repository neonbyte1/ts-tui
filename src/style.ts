/**
 * The 16 standard terminal colours; the terminal's theme decides how they
 * look.
 *
 * @category Styling
 */
export type NamedColor =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "gray"
  | "brightRed"
  | "brightGreen"
  | "brightYellow"
  | "brightBlue"
  | "brightMagenta"
  | "brightCyan"
  | "brightWhite";

/**
 * A colour: `#rrggbb` (24-bit), `0`–`255` (256-colour palette), a named
 * colour, or `"default"` for the terminal's own foreground/background.
 * The type cannot rule out a malformed `#...` string or a number outside
 * `0`–`255`: drawing one with {@linkcode paint}, {@linkcode paintTransition}
 * or any component throws an `Error`.
 *
 * @category Styling
 */
export type Color = `#${string}` | number | NamedColor | "default";

/**
 * Text attributes. Unset fields leave whatever the surrounding text uses.
 *
 * @category Styling
 */
export interface Paint {
  /** Foreground (text) colour. */
  readonly fg?: Color;
  /** Background colour. */
  readonly bg?: Color;
  /** Bold weight. */
  readonly bold?: boolean;
  /** Dim (faint) weight. */
  readonly dim?: boolean;
  /** Italic text. */
  readonly italic?: boolean;
  /** Underlined text. */
  readonly underline?: boolean;
  /** Swapped foreground and background. */
  readonly inverse?: boolean;
  /** Struck-through text. */
  readonly strikethrough?: boolean;
}

const NAMED: Record<NamedColor, number> = {
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  magenta: 5,
  cyan: 6,
  white: 7,
  gray: 8,
  brightRed: 9,
  brightGreen: 10,
  brightYellow: 11,
  brightBlue: 12,
  brightMagenta: 13,
  brightCyan: 14,
  brightWhite: 15,
};

/** `NAMED` as a plain string lookup: unknown strings give `undefined`. */
const NAMED_LOOKUP: Readonly<Partial<Record<string, number>>> = NAMED;

const FLAGS = [
  ["italic", "3", "23"],
  ["underline", "4", "24"],
  ["inverse", "7", "27"],
  ["strikethrough", "9", "29"],
] as const;

/**
 * Parses `#rrggbb` into its red, green and blue channels.
 *
 * @param color A six-digit hex colour with a leading `#`, in either case.
 * @returns The channels, each 0 to 255.
 * @throws {Error} When `color` is not of the form `#rrggbb`.
 * @category Styling
 *
 * @example Split a hex colour into channels
 * ```ts
 * import { hexToRgb } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * assertEquals(hexToRgb("#ff8000"), [255, 128, 0]);
 * ```
 */
export function hexToRgb(color: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);

  if (!match) {
    throw new Error(`Color "${color}" is not #rrggbb`);
  }

  return [
    parseInt(match[1], 16),
    parseInt(match[2], 16),
    parseInt(match[3], 16),
  ];
}

/**
 * Blends two colours per channel. `t` is clamped to the range 0 to 1.
 *
 * @param from Colour returned at `t = 0`.
 * @param to Colour returned at `t = 1`.
 * @param t How far to go from `from` towards `to`, 0 to 1.
 * @returns The blended colour as `#rrggbb`.
 * @throws {Error} When `from` or `to` is not of the form `#rrggbb`.
 * @category Styling
 *
 * @example Blend black and white
 * ```ts
 * import { mixColors } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * assertEquals(mixColors("#000000", "#ffffff", 0.5), "#808080");
 * assertEquals(mixColors("#ff0000", "#0000ff", 0), "#ff0000");
 * ```
 */
export function mixColors(
  from: `#${string}`,
  to: `#${string}`,
  t: number,
): `#${string}` {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const mix = Math.min(1, Math.max(0, t));
  const channels = a.map((c, i) =>
    Math.round(c + (b[i] - c) * mix).toString(16).padStart(2, "0")
  );

  return `#${channels.join("")}`;
}

/** SGR parameters selecting `color` as foreground or background. */
function colorCode(color: Color, layer: "fg" | "bg"): string {
  const base = layer === "fg" ? 30 : 40;

  if (color === "default") {
    return String(base + 9);
  }

  if (typeof color === "number") {
    if (!Number.isInteger(color) || color < 0 || color > 255) {
      throw new Error(`Color ${color} is not a palette index 0-255`);
    }

    return `${base + 8};5;${color}`;
  }

  if (color.startsWith("#")) {
    const [r, g, b] = hexToRgb(color);

    return `${base + 8};2;${r};${g};${b}`;
  }

  const index = NAMED_LOOKUP[color];

  if (index === undefined) {
    throw new Error(`Unknown color "${color}"`);
  }

  return String(index < 8 ? base + index : base + 60 + index - 8);
}

/**
 * Shortest SGR sequence that changes the attributes `from` sets into the
 * ones `to` sets. Attributes `to` leaves unset are switched off (back to the
 * terminal default), not restored to an outer style.
 *
 * @param from Attributes currently in effect.
 * @param to Attributes to switch to.
 * @returns An SGR escape sequence, or an empty string when nothing changes.
 * @throws {Error} When a colour in `from` or `to` is a number outside the integer range 0 to 255, a `#...` string that is not `#rrggbb`, or an unknown colour name.
 * @category Styling
 *
 * @example Switch from red to underlined green
 * ```ts
 * import { paintTransition } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * assertEquals(
 *   paintTransition({ fg: "red" }, { fg: "green", underline: true }),
 *   "\x1b[32;4m",
 * );
 * assertEquals(paintTransition({ bold: true }, { bold: true }), "");
 * ```
 */
export function paintTransition(from: Paint, to: Paint): string {
  const codes: string[] = [];

  if (from.fg !== to.fg) {
    codes.push(to.fg === undefined ? "39" : colorCode(to.fg, "fg"));
  }

  if (from.bg !== to.bg) {
    codes.push(to.bg === undefined ? "49" : colorCode(to.bg, "bg"));
  }

  pushWeightCodes(codes, from, to);

  for (const [flag, on, off] of FLAGS) {
    if (Boolean(from[flag]) !== Boolean(to[flag])) {
      codes.push(to[flag] ? on : off);
    }
  }

  return codes.length > 0 ? `\x1b[${codes.join(";")}m` : "";
}

/** Bold and dim share one "off" code, so turning either off re-applies the other. */
function pushWeightCodes(codes: string[], from: Paint, to: Paint): void {
  if ((from.bold && !to.bold) || (from.dim && !to.dim)) {
    codes.push("22");

    if (to.bold) {
      codes.push("1");
    }

    if (to.dim) {
      codes.push("2");
    }

    return;
  }

  if (to.bold && !from.bold) {
    codes.push("1");
  }

  if (to.dim && !from.dim) {
    codes.push("2");
  }
}

/**
 * Draws `text` with `p`; the attributes it sets are switched off afterwards.
 *
 * @param text Text to draw.
 * @param p Attributes to apply, or `undefined` to return `text` unchanged.
 * @returns `text` wrapped in escape sequences that set and then reset `p`.
 * @throws {Error} When a colour in `p` is a number outside the integer range 0 to 255, a `#...` string that is not `#rrggbb`, or an unknown colour name.
 * @category Styling
 *
 * @example Colour a word
 * ```ts
 * import { paint } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * assertEquals(
 *   paint("hi", { fg: "red", bold: true }),
 *   "\x1b[31;1mhi\x1b[39;22m",
 * );
 * assertEquals(paint("hi", undefined), "hi");
 * ```
 */
export function paint(text: string, p: Paint | undefined): string {
  if (p === undefined) {
    return text;
  }

  return paintTransition({}, p) + text + paintTransition(p, {});
}

/**
 * Combines paints: later ones override earlier ones field by field, and
 * fields left `undefined` do not override.
 *
 * @param paints Paints in increasing priority; `undefined` entries are skipped.
 * @returns One paint with every field set by any of `paints`.
 * @category Styling
 *
 * @example Layer a highlight over a base style
 * ```ts
 * import { mergePaint } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * const merged = mergePaint({ fg: "red", bold: true }, undefined, {
 *   fg: "green",
 * });
 *
 * assertEquals(merged, { fg: "green", bold: true });
 * ```
 */
export function mergePaint(...paints: (Paint | undefined)[]): Paint {
  const out: Record<string, unknown> = {};

  for (const p of paints) {
    if (p === undefined) {
      continue;
    }

    for (const [key, value] of Object.entries(p)) {
      if (value !== undefined) {
        out[key] = value;
      }
    }
  }

  // Only keys copied from Paint values were written, so `out` is a Paint.
  return out as Paint;
}
