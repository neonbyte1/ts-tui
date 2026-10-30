/** Escape sequences emitted by the renderer and helpers. */
export const ESC = "\x1b";
export const RESET = "\x1b[0m";
export const INVERSE = "\x1b[7m";
export const INVERSE_OFF = "\x1b[27m";
export const ERASE_LINE = "\x1b[2K";
export const ERASE_BELOW = "\x1b[J";
/** ED2 before ED3: tmux moves an ED2-cleared screen into history, so history must be erased last. */
export const CLEAR_ALL = "\x1b[2J\x1b[3J\x1b[H";
export const CURSOR_HIDE = "\x1b[?25l";
export const CURSOR_SHOW = "\x1b[?25h";
export const AUTOWRAP_OFF = "\x1b[?7l";
export const AUTOWRAP_ON = "\x1b[?7h";
/** DEC mode 2026: the terminal holds output until the end marker, so a frame appears atomically. */
export const SYNC_BEGIN = "\x1b[?2026h";
export const SYNC_END = "\x1b[?2026l";
export const BRACKETED_PASTE_ON = "\x1b[?2004h";
export const BRACKETED_PASTE_OFF = "\x1b[?2004l";
export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";
export const HYPERLINK_CLOSE = "\x1b]8;;\x07";
/**
 * Zero-width marker a focused component places immediately before its cursor
 * cell. The renderer strips it and moves the terminal cursor there, so IME
 * candidate windows follow the caret. It is an APC sequence, so width helpers
 * treat it as an escape (zero cells).
 *
 * @category Core
 *
 * @example Mark the caret of a custom focusable component
 * ```ts
 * import { CURSOR_MARKER, visibleWidth } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * const row = "ab" + CURSOR_MARKER + "c";
 *
 * assertEquals(visibleWidth(row), 3);
 * ```
 */
export const CURSOR_MARKER = "\x1b_flow:cursor\x1b\\";
/**
 * Row content for rows 2..n of an n-row inline image. The image's first row
 * holds the drawing sequence; the renderer leaves reserved rows blank and
 * draws the image over them once they exist on screen.
 *
 * @category Images
 *
 * @example Fill the rows below an image's first row
 * ```ts
 * import { IMAGE_RESERVED, visibleWidth } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * // A three-row image: the first row would hold the drawing sequence.
 * const rows = ["<drawing>", IMAGE_RESERVED, IMAGE_RESERVED];
 *
 * assertEquals(visibleWidth(IMAGE_RESERVED), 0);
 * assertEquals(rows.length, 3);
 * ```
 */
export const IMAGE_RESERVED = "\x1b_flow:image\x1b\\";

/**
 * Length of the escape sequence starting at `start` (which must be ESC), or -1
 * when the input ends before the sequence is complete.
 *
 * Covers CSI (`ESC [`), SS3 (`ESC O`), string sequences terminated by BEL or ST
 * (OSC `ESC ]`, DCS `ESC P`, APC `ESC _`, PM `ESC ^`, SOS `ESC X`), and two-byte
 * escapes.
 */
export function escapeSequenceLength(s: string, start = 0): number {
  if (start + 1 >= s.length) {
    return -1;
  }

  const kind = s.charCodeAt(start + 1);

  if (kind === 0x5b /* [ */) {
    return csiLength(s, start);
  }

  if (kind === 0x4f /* O */) {
    return start + 2 < s.length ? 3 : -1;
  }

  if (isStringSequenceKind(kind)) {
    return stringSequenceLength(s, start);
  }

  return 2;
}

/** CSI (`ESC [`): parameter/intermediate bytes up to a final byte; -1 when unterminated. */
function csiLength(s: string, start: number): number {
  let i = start + 2;

  while (i < s.length) {
    const c = s.charCodeAt(i);

    if (c >= 0x40 && c <= 0x7e) {
      return i + 1 - start;
    }

    if (c < 0x20 || c > 0x3f) {
      return i - start;
    } // malformed: stop before the stray byte

    i++;
  }

  return -1;
}

/** Whether the byte after ESC introduces an OSC, DCS, APC, PM or SOS string sequence. */
function isStringSequenceKind(kind: number): boolean {
  switch (kind) {
    case 0x5d: // ]
    case 0x50: // P
    case 0x5f: // _
    case 0x5e: // ^
    case 0x58: // X
      return true;
    default:
      return false;
  }
}

/** String sequence terminated by BEL or ST (`ESC \`); -1 when unterminated. */
function stringSequenceLength(s: string, start: number): number {
  for (let i = start + 2; i < s.length; i++) {
    const c = s.charCodeAt(i);

    if (c === 0x07) {
      return i + 1 - start;
    }

    if (c === 0x1b) {
      if (i + 1 >= s.length) {
        return -1;
      }

      if (s.charCodeAt(i + 1) === 0x5c /* \ */) {
        return i + 2 - start;
      }
    }
  }

  return -1;
}

/** Number of extra parameters following a semicolon-form 38/48/58 given its mode parameter. */
function semicolonColorArgCount(mode: string | undefined): number {
  if (mode === "5") {
    return 2;
  }

  if (mode === "2") {
    return 4;
  }

  return 0;
}

/** Tracks SGR attributes and an open OSC 8 hyperlink so wrapped lines can close and reopen them. */
export class StyleState {
  private bold = false;
  private dim = false;
  private italic = "";
  private underline = "";
  private blink = "";
  private inverse = "";
  private hidden = "";
  private strike = "";
  private overline = "";
  private fg = "";
  private bg = "";
  private underlineColor = "";
  private link = "";

  public clone(): StyleState {
    const copy = new StyleState();

    copy.bold = this.bold;
    copy.dim = this.dim;
    copy.italic = this.italic;
    copy.underline = this.underline;
    copy.blink = this.blink;
    copy.inverse = this.inverse;
    copy.hidden = this.hidden;
    copy.strike = this.strike;
    copy.overline = this.overline;
    copy.fg = this.fg;
    copy.bg = this.bg;
    copy.underlineColor = this.underlineColor;
    copy.link = this.link;

    return copy;
  }

  /** Apply one escape sequence; anything other than SGR or OSC 8 is ignored. */
  public apply(sequence: string): void {
    if (sequence.startsWith("\x1b]8;")) {
      this.applyHyperlink(sequence);

      return;
    }

    if (!sequence.startsWith("\x1b[") || !sequence.endsWith("m")) {
      return;
    }

    const body = sequence.slice(2, -1);

    if (!/^[0-9;:]*$/.test(body)) {
      return;
    }

    const params = body === "" ? ["0"] : body.split(";");
    let i = 0;

    while (i < params.length) {
      const param = params[i];
      const code = Number.parseInt(param, 10) || 0;

      if (code === 38 || code === 48 || code === 58) {
        // Extended colours consume their arguments; continue after the last one.
        i = this.applyExtendedColor(code, params, i);
      } else {
        this.applySgrCode(code, param);
      }

      i++;
    }
  }

  /** Track an OSC 8 sequence: an empty URI closes the link, anything else opens it. */
  private applyHyperlink(sequence: string): void {
    const uriStart = sequence.indexOf(";", 4) + 1;
    const terminatorLength = sequence.endsWith("\x07") ? 1 : 2;
    const uri = sequence.slice(uriStart, sequence.length - terminatorLength);

    this.link = uri === "" ? "" : sequence;
  }

  /** Apply a 38/48/58 colour at `params[index]`; returns the index of its last consumed parameter. */
  private applyExtendedColor(
    code: number,
    params: string[],
    index: number,
  ): number {
    const param = params[index];
    let value = param;
    let last = index;

    if (!param.includes(":")) {
      // Semicolon form: 38;5;N or 38;2;R;G;B
      const take = semicolonColorArgCount(params[index + 1]);

      value = params.slice(index, index + 1 + take).join(";");
      last += take;
    }

    if (code === 38) {
      this.fg = value;
    } else if (code === 48) {
      this.bg = value;
    } else {
      this.underlineColor = value;
    }

    return last;
  }

  /** Clear every SGR attribute (SGR 0); the hyperlink is unaffected. */
  private resetAttributes(): void {
    this.bold = this.dim = false;
    this.italic =
      this.underline =
      this.blink =
      this.inverse =
        "";
    this.hidden = this.strike = this.overline = "";
    this.fg = this.bg = this.underlineColor = "";
  }

  /** Apply one non-extended-colour SGR code; `param` is its original text. */
  private applySgrCode(code: number, param: string): void {
    switch (code) {
      case 0:
        this.resetAttributes();

        break;
      case 1:
        this.bold = true;

        break;
      case 2:
        this.dim = true;

        break;
      case 22:
        this.bold = this.dim = false;

        break;
      case 3:
        this.italic = param;

        break;
      case 23:
        this.italic = "";

        break;
      case 4:
      case 21:
        this.underline = param;

        break;
      case 24:
        this.underline = "";

        break;
      case 5:
      case 6:
        this.blink = param;

        break;
      case 25:
        this.blink = "";

        break;
      case 7:
        this.inverse = param;

        break;
      case 27:
        this.inverse = "";

        break;
      case 8:
        this.hidden = param;

        break;
      case 28:
        this.hidden = "";

        break;
      case 9:
        this.strike = param;

        break;
      case 29:
        this.strike = "";

        break;
      case 53:
        this.overline = param;

        break;
      case 55:
        this.overline = "";

        break;
      case 39:
        this.fg = "";

        break;
      case 49:
        this.bg = "";

        break;
      case 59:
        this.underlineColor = "";

        break;
      default:
        this.applyBasicColor(code, param);
    }
  }

  /** Apply a 30-37/90-97 foreground or 40-47/100-107 background colour; other codes are ignored. */
  private applyBasicColor(code: number, param: string): void {
    if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      this.fg = param;
    } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
      this.bg = param;
    }
  }

  /** Sequence that re-establishes this state from a reset terminal. */
  public open(): string {
    const codes: string[] = [];

    if (this.bold) {
      codes.push("1");
    }

    if (this.dim) {
      codes.push("2");
    }

    for (
      const value of [
        this.italic,
        this.underline,
        this.blink,
        this.inverse,
        this.hidden,
        this.strike,
        this.overline,
        this.fg,
        this.bg,
        this.underlineColor,
      ]
    ) {
      if (value !== "") {
        codes.push(value);
      }
    }

    const sgr = codes.length > 0 ? `\x1b[${codes.join(";")}m` : "";

    return sgr + this.link;
  }

  /** Sequence that closes everything `open()` would emit. */
  public close(): string {
    const sgrActive = this.bold || this.dim || this.italic !== "" ||
      this.underline !== "" ||
      this.blink !== "" || this.inverse !== "" || this.hidden !== "" ||
      this.strike !== "" ||
      this.overline !== "" || this.fg !== "" || this.bg !== "" ||
      this.underlineColor !== "";

    return (sgrActive ? RESET : "") +
      (this.link !== "" ? HYPERLINK_CLOSE : "");
  }
}
