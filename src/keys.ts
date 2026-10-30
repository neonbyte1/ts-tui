import { escapeSequenceLength, PASTE_END, PASTE_START } from "./ansi.ts";

/**
 * A decoded key press. Named keys use lowercase names (`enter`, `up`, `f5`);
 * printable keys use the character.
 *
 * @category Input
 */
export interface Key {
  /** Key name: `enter`, `escape`, `tab`, `up`, `f5`, … or the printable character. */
  readonly name: string;
  /** Whether ctrl was held. */
  readonly ctrl: boolean;
  /** Whether alt (meta) was held. */
  readonly alt: boolean;
  /** Whether shift was held. */
  readonly shift: boolean;
  /** Raw bytes as received from the terminal. */
  readonly sequence: string;
  /** Text to insert for printable keys without ctrl/alt. */
  readonly text?: string;
}

/**
 * Input a focused component receives: a key press, or text pasted with
 * bracketed paste (delivered whole, newlines included).
 *
 * @category Input
 */
export type InputEvent =
  | { readonly type: "key"; readonly key: Key }
  | { readonly type: "paste"; readonly text: string };

/**
 * A reply from the terminal to a query (device attributes, kitty keyboard or
 * graphics support, cell size, version). Never delivered to components.
 *
 * @category Input
 */
export interface TerminalReport {
  /** Discriminates the event kind. */
  readonly type: "report";
  /** The reply as received, escape sequence included. */
  readonly sequence: string;
}

/**
 * What a mouse report describes. `leave` is synthesized by the TUI when the
 * pointer stops hovering a component.
 *
 * @category Input
 */
export type MouseAction =
  | "press"
  | "release"
  | "drag"
  | "move"
  | "wheel"
  | "leave";

/**
 * Mouse button of a report.
 *
 * @category Input
 */
export type MouseButton = "left" | "middle" | "right" | "none";

/**
 * A mouse report. `x`/`y` are 0-based cells relative to the component
 * receiving the event (the parser reports 0-based screen cells). During a
 * drag they may fall outside the component, even negative.
 *
 * @category Input
 */
export interface MouseInput {
  /** Discriminates the event kind. */
  readonly type: "mouse";
  /** What happened: press, release, drag, move, wheel or leave. */
  readonly action: MouseAction;
  /** Button pressed, released or held during a drag; `"none"` for move, wheel and leave. */
  readonly button: MouseButton;
  /** Wheel direction, only for `action: "wheel"`. */
  readonly direction?: "up" | "down" | "left" | "right";
  /** Column of the pointer, 0-based. */
  readonly x: number;
  /** Row of the pointer, 0-based. */
  readonly y: number;
  /** Whether shift was held. */
  readonly shift: boolean;
  /** Whether alt (meta) was held. */
  readonly alt: boolean;
  /** Whether ctrl was held. */
  readonly ctrl: boolean;
}

/**
 * Everything {@linkcode InputParser} emits.
 *
 * @category Input
 */
export type ParsedInput = InputEvent | TerminalReport | MouseInput;

const BUTTONS: readonly MouseButton[] = ["left", "middle", "right", "none"];
const WHEEL = ["up", "down", "left", "right"] as const;

/** Decode an xterm mouse button code with 0-based screen coordinates; `release` marks SGR `m` reports. */
function mouseFromCode(
  code: number,
  x: number,
  y: number,
  release: boolean,
): MouseInput {
  const mods = {
    shift: (code & 4) !== 0,
    alt: (code & 8) !== 0,
    ctrl: (code & 16) !== 0,
  };
  const low = code & 3;

  if ((code & 64) !== 0 && (code & 128) === 0) {
    return {
      type: "mouse",
      action: "wheel",
      button: "none",
      direction: WHEEL[low],
      x,
      y,
      ...mods,
    };
  }

  // Buttons 8-11 (code & 128) are reported as "none".
  const button = (code & 128) === 0 ? BUTTONS[low] : "none";
  let action: MouseAction;

  if ((code & 32) !== 0) {
    action = button === "none" ? "move" : "drag";
  } else if (release || button === "none") {
    action = "release";
  } else {
    action = "press";
  }

  return { type: "mouse", action, button, x, y, ...mods };
}

const SGR_MOUSE = /^\[<(\d+);(\d+);(\d+)([Mm])$/;

/** Decode an SGR (`CSI < b;x;y M`) or X10 (`CSI M bxy`) mouse report, if `unit` is one. */
function parseMouse(unit: string): MouseInput | undefined {
  const sgr = unit.startsWith("\x1b") ? SGR_MOUSE.exec(unit.slice(1)) : null;

  if (sgr) {
    return mouseFromCode(
      Number(sgr[1]),
      Number(sgr[2]) - 1,
      Number(sgr[3]) - 1,
      sgr[4] === "m",
    );
  }

  if (unit.length === 6 && unit.startsWith("\x1b[M")) {
    return mouseFromCode(
      unit.charCodeAt(3) - 32,
      unit.charCodeAt(4) - 33,
      unit.charCodeAt(5) - 33,
      false,
    );
  }

  return undefined;
}

/**
 * Encodes the SGR mouse report a terminal would send for `event` at 0-based
 * screen cell `x`,`y`. Meant for tests (`terminal.send(encodeMouse(...))`);
 * `leave` has no encoding.
 *
 * @param event What happened and where. `button` defaults to `"left"` (`"none"`
 * for `move`), `direction` to `"down"` for `wheel`; modifiers default to off.
 * @returns The escape sequence to feed to the input of a terminal or parser.
 * @category Testing
 *
 * @example Simulate a click and a wheel turn
 * ```ts
 * import { encodeMouse, InputParser, type ParsedInput } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * const events: ParsedInput[] = [];
 * const parser = new InputParser((event) => events.push(event));
 *
 * parser.feed(encodeMouse({ action: "press", x: 3, y: 1 }));
 * parser.feed(encodeMouse({ action: "wheel", x: 0, y: 0, direction: "up" }));
 *
 * assertEquals(encodeMouse({ action: "press", x: 3, y: 1 }), "\x1b[<0;4;2M");
 * assertEquals(events.length, 2);
 * assertEquals(events[0].type === "mouse" && events[0].button, "left");
 * assertEquals(events[1].type === "mouse" && events[1].direction, "up");
 * ```
 */
export function encodeMouse(
  event: Pick<MouseInput, "action" | "x" | "y"> & Partial<MouseInput>,
): string {
  const button = event.button ?? (event.action === "move" ? "none" : "left");
  let code = event.action === "wheel"
    ? 64 + WHEEL.indexOf(event.direction ?? "down")
    : BUTTONS.indexOf(button);

  if (event.action === "drag" || event.action === "move") {
    code += 32;
  }

  code += (event.shift ? 4 : 0) + (event.alt ? 8 : 0) + (event.ctrl ? 16 : 0);

  const final = event.action === "release" ? "m" : "M";

  return `\x1b[<${code};${event.x + 1};${event.y + 1}${final}`;
}

/** Kitty keyboard protocol private-use code points for keypad keys. */
const KITTY_KEYPAD: Partial<Record<number, string>> = {
  57399: "0",
  57400: "1",
  57401: "2",
  57402: "3",
  57403: "4",
  57404: "5",
  57405: "6",
  57406: "7",
  57407: "8",
  57408: "9",
  57409: ".",
  57410: "/",
  57411: "*",
  57412: "-",
  57413: "+",
  57415: "=",
};

interface Modifiers {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

function key(
  name: string,
  sequence: string,
  mods: Modifiers = {},
  text?: string,
): Key {
  return {
    name,
    sequence,
    ctrl: mods.ctrl ?? false,
    alt: mods.alt ?? false,
    shift: mods.shift ?? false,
    text,
  };
}

/** xterm modifier parameter: 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0). */
function decodeModifier(param: string | undefined): Modifiers {
  const bits = (Number.parseInt(param ?? "1", 10) || 1) - 1;

  return {
    shift: (bits & 1) !== 0,
    alt: (bits & 2) !== 0,
    ctrl: (bits & 4) !== 0,
  };
}

const CSI_LETTER_KEYS: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
  P: "f1",
  Q: "f2",
  R: "f3",
  S: "f4",
};

const CSI_TILDE_KEYS: Record<string, string> = {
  "1": "home",
  "2": "insert",
  "3": "delete",
  "4": "end",
  "5": "pageup",
  "6": "pagedown",
  "7": "home",
  "8": "end",
  "11": "f1",
  "12": "f2",
  "13": "f3",
  "14": "f4",
  "15": "f5",
  "17": "f6",
  "18": "f7",
  "19": "f8",
  "20": "f9",
  "21": "f10",
  "23": "f11",
  "24": "f12",
};

/** Key for a Unicode code point reported by CSI u / modifyOtherKeys encodings. */
function keyForCodePoint(code: number, sequence: string, mods: Modifiers): Key {
  switch (code) {
    case 13:
    case 57414: // keypad enter
      return key("enter", sequence, mods);
    case 9:
      return key("tab", sequence, mods);
    case 27:
      return key("escape", sequence, mods);
    case 127:
    case 8:
      return key("backspace", sequence, mods);
    case 32:
      return key(
        "space",
        sequence,
        mods,
        mods.ctrl || mods.alt ? undefined : " ",
      );
  }

  const keypad = KITTY_KEYPAD[code];

  // Other private-use code points are kitty functional keys (lock keys, media keys, bare modifiers).
  if (keypad === undefined && code >= 0xe000 && code <= 0xf8ff) {
    return key("unknown", sequence, mods);
  }

  const char = keypad ?? String.fromCodePoint(code);

  return key(char, sequence, mods, mods.ctrl || mods.alt ? undefined : char);
}

/** Keys for single control bytes and the fixed sequences `\x1b`, `\x1b[Z`. */
function parseControlKey(sequence: string): Key | undefined {
  switch (sequence) {
    case "\r":
      return key("enter", sequence);
    case "\t":
      return key("tab", sequence);
    case "\x7f":
    case "\x08":
      return key("backspace", sequence);
    case "\x1b":
      return key("escape", sequence);
    case "\x00":
      return key("space", sequence, { ctrl: true });
    case " ":
      return key("space", sequence, {}, " ");
    case "\x1b[Z":
      return key("tab", sequence, { shift: true });
  }

  if (sequence.length === 1) {
    const code = sequence.charCodeAt(0);

    if (code >= 0x01 && code <= 0x1a) {
      return key(String.fromCharCode(code + 0x60), sequence, { ctrl: true });
    }

    if (code >= 0x1c && code <= 0x1f) {
      return key("\\]^_"[code - 0x1c], sequence, { ctrl: true });
    }
  }

  return undefined;
}

/** `CSI ... ~` keys, including modifyOtherKeys (`CSI 27 ; mod ; code ~`). */
function parseCsiTilde(params: string[], sequence: string): Key | undefined {
  if (params[0] === "27" && params.length === 3) {
    return keyForCodePoint(
      Number(params[2]),
      sequence,
      decodeModifier(params[1]),
    );
  }

  const name = CSI_TILDE_KEYS[params[0] ?? ""];

  if (name) {
    return key(name, sequence, decodeModifier(params[1]));
  }

  return undefined;
}

/** Kitty `CSI code[:shifted] ; mods u` keys; `paramText` is the raw parameter string. */
function parseCsiU(
  params: string[],
  paramText: string,
  sequence: string,
): Key | undefined {
  if (params.length === 0) {
    return undefined;
  }

  const mods = decodeModifier(params[1]);
  const parsed = keyForCodePoint(Number(params[0]), sequence, mods);
  // Kitty's first parameter is `code:shifted-code`; shifted text comes from the latter.
  const shifted = paramText.split(";")[0].split(":")[1];

  if (mods.shift && shifted && parsed.text !== undefined) {
    return { ...parsed, text: String.fromCodePoint(Number(shifted)) };
  }

  return parsed;
}

/** Decode a `\x1b[` sequence; anything unrecognised is an `unknown` key. */
function parseCsiKey(sequence: string): Key {
  // Kitty adds colon sub-parameters (alternate keys, event type); only the first value of each is used.
  const csi = /^([0-9;:]*)([A-Za-z~])$/.exec(sequence.slice(2));

  if (!csi) {
    return key("unknown", sequence);
  }

  const params = csi[1] === ""
    ? []
    : csi[1].split(";").map((p) => p.split(":")[0]);
  const final = csi[2];
  let parsed: Key | undefined;

  if (final === "~") {
    parsed = parseCsiTilde(params, sequence);
  } else if (final === "u") {
    parsed = parseCsiU(params, csi[1], sequence);
  } else {
    const name = CSI_LETTER_KEYS[final];

    if (name) {
      parsed = key(name, sequence, decodeModifier(params[1]));
    }
  }

  return parsed ?? key("unknown", sequence);
}

/**
 * Decodes one complete input sequence (as produced by {@linkcode InputParser})
 * into a key.
 *
 * @param sequence One key's raw bytes, e.g. `"\x03"` or `"\x1b[A"`.
 * @returns The key; named `"unknown"` when the sequence is not recognised.
 * @category Input
 *
 * @example Decode ctrl+c and an arrow key
 * ```ts
 * import { parseKey } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * const interrupt = parseKey("\x03");
 * const up = parseKey("\x1b[1;2A");
 *
 * assertEquals([interrupt.name, interrupt.ctrl], ["c", true]);
 * assertEquals([up.name, up.shift], ["up", true]);
 * ```
 */
export function parseKey(sequence: string): Key {
  const control = parseControlKey(sequence);

  if (control) {
    return control;
  }

  if (sequence.startsWith("\x1b[")) {
    return parseCsiKey(sequence);
  }

  if (sequence.length === 3 && sequence.startsWith("\x1bO")) {
    const name = CSI_LETTER_KEYS[sequence[2]];

    return key(name ?? "unknown", sequence);
  }

  if (sequence.startsWith("\x1b") && sequence.length > 1) {
    const inner = parseKey(sequence.slice(1));

    return { ...inner, alt: true, sequence, text: undefined };
  }

  return key(sequence, sequence, {}, sequence);
}

/**
 * Whether `k` matches a spec such as `"ctrl+c"`, `"shift+tab"`,
 * `"alt+backspace"`, `"enter"`, or `"x"`. Modifiers must match exactly; the
 * key name is the last `+`-separated part.
 *
 * @param k The key to test, e.g. from an {@linkcode InputEvent}.
 * @param spec Modifiers and key name joined with `+`.
 * @returns `true` when the name and all three modifiers match.
 * @category Input
 *
 * @example Quit on ctrl+c
 * ```ts
 * import { matchesKey, parseKey } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * const key = parseKey("\x03");
 *
 * assertEquals(matchesKey(key, "ctrl+c"), true);
 * assertEquals(matchesKey(key, "c"), false);
 * ```
 */
export function matchesKey(k: Key, spec: string): boolean {
  const parts = spec.split("+");
  const name = parts.pop();
  const mods = new Set(parts.map((p) => p.toLowerCase()));

  return k.name === name && k.ctrl === mods.has("ctrl") &&
    k.alt === mods.has("alt") &&
    k.shift === mods.has("shift");
}

/**
 * Merge user key bindings over a component's defaults. Each entry of
 * `overrides` replaces the default list for its action, so
 * `{ submit: ["ctrl+enter"] }` unbinds plain Enter; `undefined` entries keep
 * the default. Components call this with their `DEFAULT_*_KEYS`; use it for
 * your own components' `keys` option.
 *
 * @typeParam A The action names, e.g. `"submit" | "cancel"`.
 * @param defaults Bindings used for every action `overrides` does not set.
 * @param overrides User bindings as {@linkcode matchesKey} specs, per action.
 * @returns A new binding table; neither argument is changed.
 *
 * @example Replace one action's keys, keep the rest
 * ```ts
 * import { assertEquals } from "@std/assert";
 * import { bindKeys } from "@neonbyte/tui";
 *
 * const keys = bindKeys(
 *   { submit: ["enter"], cancel: ["escape"] },
 *   { submit: ["ctrl+enter"] },
 * );
 *
 * assertEquals(keys, { submit: ["ctrl+enter"], cancel: ["escape"] });
 * ```
 *
 * @category Input
 */
export function bindKeys<A extends string>(
  defaults: Readonly<Record<A, readonly string[]>>,
  overrides: Partial<Record<A, readonly string[]>> | undefined,
): Record<A, readonly string[]> {
  const keys: Record<A, readonly string[]> = { ...defaults };

  for (const action in overrides) {
    const list = overrides[action];

    if (list !== undefined) {
      keys[action] = list;
    }
  }

  return keys;
}

/** Second bytes that start a full escape sequence: `[` CSI, `O` SS3, `]` OSC, `P` DCS, `_` APC. */
const SEQUENCE_INTRODUCERS: Record<number, true> = {
  0x5b: true,
  0x4f: true,
  0x5d: true,
  0x50: true,
  0x5f: true,
};

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Length of one input unit at the start of `s`: an escape sequence, alt+key, or one code point. -1 if incomplete. */
function inputUnitLength(s: string): number {
  if (s.charCodeAt(0) !== 0x1b) {
    if (isHighSurrogate(s.charCodeAt(0))) {
      return s.length >= 2 ? 2 : -1;
    }

    return 1;
  }

  return s.length === 1 ? -1 : escapeUnitLength(s);
}

/** `inputUnitLength` for `s` starting with ESC and at least one more character. */
function escapeUnitLength(s: string): number {
  const next = s.charCodeAt(1);

  // ESC ESC: report the first as a bare escape.
  if (next === 0x1b) {
    return 1;
  }

  // X10 mouse report: CSI M followed by three raw bytes.
  if (s.startsWith("\x1b[M")) {
    return s.length >= 6 ? 6 : -1;
  }

  if (SEQUENCE_INTRODUCERS[next]) {
    return escapeSequenceLength(s, 0);
  }

  // ESC + key: alt-modified character.
  if (isHighSurrogate(next)) {
    return s.length >= 3 ? 3 : -1;
  }

  return 2;
}

/**
 * Splits raw terminal input into key, paste, mouse, and terminal-report events.
 *
 * Input arrives in arbitrary chunks, so sequences may be split across calls to
 * {@linkcode InputParser.feed}. An incomplete trailing sequence is held until
 * more data arrives or {@linkcode InputParser.flush} is called (the caller
 * flushes after a short delay so a lone Escape key press is delivered). The
 * {@linkcode TUI} does this for you; use the parser directly to decode input
 * outside a TUI.
 *
 * @category Input
 *
 * @example Decode input that arrives in pieces
 * ```ts
 * import { InputParser, type ParsedInput } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * const events: ParsedInput[] = [];
 * const parser = new InputParser((event) => events.push(event));
 *
 * parser.feed("a\x1b[");
 * parser.feed("B");
 *
 * assertEquals(
 *   events.map((e) => e.type === "key" ? e.key.name : e.type),
 *   ["a", "down"],
 * );
 * ```
 */
export class InputParser {
  private buffer = "";
  private pasting = false;
  private paste = "";
  private readonly onEvent: (event: ParsedInput) => void;

  /**
   * Creates a parser.
   *
   * @param onEvent Called once per decoded event, in input order.
   */
  public constructor(onEvent: (event: ParsedInput) => void) {
    this.onEvent = onEvent;
  }

  /** True when bytes are held waiting for the rest of a sequence. */
  public get pending(): boolean {
    return this.buffer.length > 0 && !this.pasting;
  }

  /**
   * Decodes `data` and emits the events it completes. A trailing incomplete
   * sequence is held until the next call; a bracketed paste is emitted as one
   * `paste` event once its end marker arrives.
   *
   * @param data Raw bytes (as text) from the terminal, in any chunking.
   *
   * @example Receive a bracketed paste as one event
   * ```ts
   * import { InputParser, type ParsedInput } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const events: ParsedInput[] = [];
   * const parser = new InputParser((event) => events.push(event));
   *
   * parser.feed("\x1b[200~hi\nthere\x1b[201~");
   *
   * assertEquals(events, [{ type: "paste", text: "hi\nthere" }]);
   * ```
   */
  public feed(data: string): void {
    this.buffer += data;

    while (this.buffer.length > 0) {
      if (this.pasting) {
        const end = this.buffer.indexOf(PASTE_END);

        if (end === -1) {
          // Keep a tail that could be the start of the end marker.
          const keep = Math.min(this.buffer.length, PASTE_END.length - 1);

          this.paste += this.buffer.slice(0, this.buffer.length - keep);
          this.buffer = this.buffer.slice(this.buffer.length - keep);

          return;
        }

        const text = this.paste + this.buffer.slice(0, end);

        this.buffer = this.buffer.slice(end + PASTE_END.length);
        this.pasting = false;
        this.paste = "";

        this.onEvent({ type: "paste", text });

        continue;
      }

      const length = inputUnitLength(this.buffer);

      if (length === -1) {
        return;
      }

      this.emitUnit(length);
    }
  }

  /**
   * Delivers held bytes as keys (e.g. a lone Escape press). Does nothing
   * during a paste.
   *
   * @example Deliver a lone Escape press
   * ```ts
   * import { InputParser, type ParsedInput } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const events: ParsedInput[] = [];
   * const parser = new InputParser((event) => events.push(event));
   *
   * parser.feed("\x1b");
   *
   * assertEquals(parser.pending, true);
   *
   * parser.flush();
   *
   * assertEquals(parser.pending, false);
   * assertEquals(events[0].type === "key" && events[0].key.name, "escape");
   * ```
   */
  public flush(): void {
    if (this.pasting) {
      return;
    }

    while (this.buffer.length > 0) {
      const length = inputUnitLength(this.buffer);

      this.emitUnit(length === -1 ? this.buffer.length : length);
    }
  }

  /** Removes the first `length` characters of the buffer and emits them as one event. */
  private emitUnit(length: number): void {
    const unit = this.buffer.slice(0, length);

    this.buffer = this.buffer.slice(length);

    if (unit === PASTE_START) {
      this.pasting = true;

      return;
    }

    const mouse = parseMouse(unit);

    if (mouse) {
      this.onEvent(mouse);

      return;
    }

    if (isReport(unit)) {
      this.onEvent({ type: "report", sequence: unit });

      return;
    }

    this.onEvent({ type: "key", key: parseKey(unit) });
  }
}

/**
 * Whether an input unit is a terminal reply rather than a key: string
 * sequences (APC, DCS, OSC), private CSI replies ending in `u` or `c`
 * (kitty keyboard flags, device attributes), and window reports ending in `t`.
 */
function isReport(unit: string): boolean {
  if (unit.length < 3 || unit.charCodeAt(0) !== 0x1b) {
    return false;
  }

  const kind = unit[1];

  if (kind === "_" || kind === "P" || kind === "]") {
    return true;
  }

  if (kind !== "[") {
    return false;
  }

  const final = unit[unit.length - 1];

  return (unit[2] === "?" && (final === "u" || final === "c")) ||
    (final === "t" && /^[0-9;]+$/.test(unit.slice(2, -1)));
}
