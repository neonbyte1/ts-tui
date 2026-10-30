import { escapeSequenceLength } from "./ansi.ts";
import type { Terminal } from "./terminal.ts";
import { graphemeWidth } from "./width.ts";

const segmenter = new Intl.Segmenter();
/** DEC private modes that enable mouse reporting or its SGR encoding. */
const MOUSE_MODES: Record<string, true> = {
  "1000": true,
  "1002": true,
  "1003": true,
  "1006": true,
};

/**
 * An inline image drawn on the virtual screen. `row` is a screen row; images
 * scrolled off the top are dropped.
 *
 * @category Testing
 */
export interface VirtualImage {
  /** Screen row of the image's first row, 0-based. */
  row: number;
  /** Screen column of the image's left edge, 0-based. */
  col: number;
  /** Graphics protocol that drew it. */
  protocol: "kitty" | "iterm2";
  /** Kitty image id; unset for iTerm2 images. */
  id?: number;
}

/**
 * In-memory terminal for tests. Interprets the subset of VT sequences the TUI
 * emits (cursor movement and save/restore, erase, autowrap, scrolling into
 * scrollback, kitty/iTerm2 image placement) and exposes the resulting screen
 * as plain text. Styling is discarded. Kitty placements survive line erases
 * and are removed by `a=d` or a full-screen erase; iTerm2 images are removed
 * when their first row is erased.
 *
 * Pass it to a {@linkcode TUI}, call `renderNow()`, and read the screen with
 * {@linkcode VirtualTerminal.viewport}. Simulate typing with
 * {@linkcode VirtualTerminal.send}.
 *
 * @category Testing
 *
 * @example Render a component and read the screen
 * ```ts
 * import { Text, TUI, VirtualTerminal } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * const terminal = new VirtualTerminal(20, 4);
 * const tui = new TUI(terminal);
 *
 * tui.addChild(new Text("hello"));
 * tui.start();
 * tui.renderNow();
 *
 * assertEquals(terminal.viewport(), ["hello", "", "", ""]);
 *
 * tui.stop();
 * ```
 */
export class VirtualTerminal implements Terminal {
  private columnCount: number;
  private rowCount: number;
  private grid: string[][];
  private scrollbackRows: string[] = [];
  private x = 0;
  private y = 0;
  private pendingWrap = false;
  private autowrap = true;
  private cursorVisible = true;
  private saved = { x: 0, y: 0 };
  private placedImages: VirtualImage[] = [];
  private onInput: ((data: string) => void) | undefined;
  private onResize: (() => void) | undefined;
  private readonly enabledMouseModes = new Set<number>();
  /** Every string passed to `write`, in order. */
  public readonly writes: string[] = [];

  /**
   * Creates a blank screen.
   *
   * @param columns Width in cells. Default 80.
   * @param rows Height in rows. Default 24.
   */
  public constructor(columns = 80, rows = 24) {
    this.columnCount = columns;
    this.rowCount = rows;
    this.grid = Array.from({ length: rows }, () => this.blankRow());
  }

  /** Width in cells. */
  public get columns(): number {
    return this.columnCount;
  }

  /** Height in rows. */
  public get rows(): number {
    return this.rowCount;
  }

  /** Cursor position (0-based) and whether it is shown. */
  public get cursor(): { x: number; y: number; visible: boolean } {
    return { x: this.x, y: this.y, visible: this.cursorVisible };
  }

  /** Mouse reporting modes currently enabled (1000, 1002, 1003, 1006), ascending. */
  public get mouseModes(): readonly number[] {
    return [...this.enabledMouseModes].sort((a, b) => a - b);
  }

  /**
   * Images currently on screen, top to bottom.
   *
   * @returns Copies of the placed images, ordered by row.
   *
   * @example List the images drawn by an iTerm2-style write
   * ```ts
   * import { VirtualTerminal } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal(10, 3);
   *
   * terminal.write("\r\n\x1b]1337;File=inline=1:AAAA\x07");
   *
   * assertEquals(terminal.images(), [{ row: 1, col: 0, protocol: "iterm2" }]);
   * ```
   */
  public images(): VirtualImage[] {
    return this.placedImages.map((image) => ({ ...image })).sort((a, b) =>
      a.row - b.row
    );
  }

  /**
   * Registers the input and resize callbacks, as {@linkcode TUI.start} does.
   * Feed input with {@linkcode VirtualTerminal.send} and trigger resizes with
   * {@linkcode VirtualTerminal.resize}.
   *
   * @param onInput Called with the text passed to `send`.
   * @param onResize Called after `resize`.
   *
   * @example Receive simulated input
   * ```ts
   * import { VirtualTerminal } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal();
   * const received: string[] = [];
   *
   * terminal.start((data) => received.push(data), () => {});
   * terminal.send("ab");
   *
   * assertEquals(received, ["ab"]);
   * ```
   */
  public start(onInput: (data: string) => void, onResize: () => void): void {
    this.onInput = onInput;
    this.onResize = onResize;
  }

  /**
   * Drops the callbacks; input and resizes are ignored until `start` is
   * called again.
   *
   * @example Ignore input after stopping
   * ```ts
   * import { VirtualTerminal } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal();
   * const received: string[] = [];
   *
   * terminal.start((data) => received.push(data), () => {});
   * terminal.stop();
   * terminal.send("x");
   *
   * assertEquals(received, []);
   * ```
   */
  public stop(): void {
    this.onInput = undefined;
    this.onResize = undefined;
  }

  /**
   * Simulates the user typing or pasting raw bytes. Does nothing unless
   * started.
   *
   * @param data Raw input as the terminal would send it, e.g. `"a"`,
   * `"\x03"` for ctrl+c or `"\x1b[A"` for the up arrow.
   *
   * @example Type into a focused component
   * ```ts
   * import { type InputEvent, TUI, VirtualTerminal } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal();
   * const tui = new TUI(terminal);
   * const keys: string[] = [];
   * const component = {
   *   render: () => ["press a key"],
   *   handleInput(event: InputEvent) {
   *     keys.push(event.type === "key" ? event.key.name : event.type);
   *   },
   * };
   *
   * tui.addChild(component);
   * tui.setFocus(component);
   * tui.start();
   * terminal.send("a\x1b[A");
   * tui.stop();
   *
   * assertEquals(keys, ["a", "up"]);
   * ```
   */
  public send(data: string): void {
    this.onInput?.(data);
  }

  /**
   * Resizes the screen (no reflow: rows are cut or padded) and notifies the
   * TUI, which then repaints in full.
   *
   * @param columns New width in cells.
   * @param rows New height in rows.
   *
   * @example Resize the screen
   * ```ts
   * import { VirtualTerminal } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal(10, 3);
   *
   * terminal.resize(20, 4);
   *
   * assertEquals([terminal.columns, terminal.rows], [20, 4]);
   * ```
   */
  public resize(columns: number, rows: number): void {
    while (this.grid.length > rows && this.y > 0) {
      this.scrollbackRows.push(this.rowText(this.grid.shift()!));

      this.y--;
    }

    this.grid.length = Math.min(this.grid.length, rows);

    while (this.grid.length < rows) {
      this.grid.push([]);
    }

    this.columnCount = columns;
    this.rowCount = rows;
    this.grid = this.grid.map((row) => {
      const resized = row.slice(0, columns);

      while (resized.length < columns) {
        resized.push(" ");
      }

      return resized;
    });
    this.x = Math.min(this.x, columns - 1);
    this.y = Math.min(this.y, rows - 1);
    this.pendingWrap = false;

    this.onResize?.();
  }

  /**
   * Visible screen rows with trailing spaces removed.
   *
   * @returns One string per screen row, `rows` in total.
   *
   * @example Read the screen after writing
   * ```ts
   * import { VirtualTerminal } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal(10, 3);
   *
   * terminal.write("hello\r\nworld");
   *
   * assertEquals(terminal.viewport(), ["hello", "world", ""]);
   * ```
   */
  public viewport(): string[] {
    return this.grid.map((row) => this.rowText(row));
  }

  /**
   * Rows that scrolled off the top, oldest first.
   *
   * @returns The scrolled-off rows with trailing spaces removed.
   *
   * @example Scroll a row off the screen
   * ```ts
   * import { VirtualTerminal } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal(10, 2);
   *
   * terminal.write("one\r\ntwo\r\nthree");
   *
   * assertEquals(terminal.scrollback(), ["one"]);
   * assertEquals(terminal.viewport(), ["two", "three"]);
   * ```
   */
  public scrollback(): string[] {
    return [...this.scrollbackRows];
  }

  /**
   * Interprets text and escape sequences as a terminal would, and records
   * them in {@linkcode VirtualTerminal.writes}.
   *
   * @param data Text and escape sequences to draw.
   *
   * @example Draw with escape sequences
   * ```ts
   * import { VirtualTerminal } from "@neonbyte/tui";
   * import { assertEquals } from "@std/assert";
   *
   * const terminal = new VirtualTerminal(10, 2);
   *
   * terminal.write("hello\x1b[3D\x1b[K");
   *
   * assertEquals(terminal.viewport(), ["he", ""]);
   * assertEquals(terminal.writes.length, 1);
   * ```
   */
  public write(data: string): void {
    this.writes.push(data);

    let i = 0;

    while (i < data.length) {
      i = this.writeUnit(data, i);
    }
  }

  /** Process the escape sequence, control character or text run at `i`; returns the next index. */
  private writeUnit(data: string, i: number): number {
    const c = data[i];

    if (c === "\x1b") {
      const length = escapeSequenceLength(data, i);
      const end = length === -1 ? data.length : i + length;

      this.escape(data.slice(i, end));

      return end;
    }

    switch (c) {
      case "\r":
        this.x = 0;
        this.pendingWrap = false;

        return i + 1;
      case "\n":
        this.lineFeed();

        return i + 1;
      case "\b":
        this.x = Math.max(0, this.x - 1);
        this.pendingWrap = false;

        return i + 1;
    }

    if (c.charCodeAt(0) < 0x20) {
      return i + 1;
    }

    let end = i;

    while (end < data.length && data.charCodeAt(end) >= 0x20) {
      end++;
    }

    for (const { segment } of segmenter.segment(data.slice(i, end))) {
      this.print(segment);
    }

    return end;
  }

  /** A screen row of spaces at the current width. */
  private blankRow(): string[] {
    return Array.from({ length: this.columnCount }, () => " ");
  }

  /** Row text with trailing spaces removed. */
  private rowText(row: string[]): string {
    return row.join("").trimEnd();
  }

  /** Moves down one row, scrolling the top row into scrollback at the bottom. */
  private lineFeed(): void {
    this.pendingWrap = false;

    if (this.y < this.rowCount - 1) {
      this.y++;

      return;
    }

    this.scrollbackRows.push(this.rowText(this.grid.shift()!));
    this.grid.push(this.blankRow());

    for (const image of this.placedImages) {
      image.row--;
    }

    this.placedImages = this.placedImages.filter((image) => image.row >= 0);
  }

  /** Draws one grapheme at the cursor, honouring autowrap and wide characters. */
  private print(grapheme: string): void {
    const width = graphemeWidth(grapheme);

    if (width === 0) {
      return;
    }

    if (this.pendingWrap && this.autowrap) {
      this.x = 0;

      this.lineFeed();
    }

    this.pendingWrap = false;

    if (this.x + width > this.columnCount) {
      if (this.autowrap) {
        this.x = 0;

        this.lineFeed();
      } else {
        this.x = Math.max(0, this.columnCount - width);
      }
    }

    const row = this.grid[this.y];

    row[this.x] = grapheme;

    if (width === 2 && this.x + 1 < this.columnCount) {
      row[this.x + 1] = "";
    }

    this.x += width;

    if (this.x >= this.columnCount) {
      this.x = this.columnCount - 1;
      this.pendingWrap = this.autowrap;
    }
  }

  /** Blanks cells `from..to` of a row. */
  private erase(row: number, from: number, to: number): void {
    const cells = this.grid[row];

    for (let x = from; x < to; x++) {
      cells[x] = " ";
    }
  }

  /** Removes iTerm2 images whose first row is within `fromRow..toRow`. */
  private eraseITerm2Images(fromRow: number, toRow: number): void {
    this.placedImages = this.placedImages.filter((image) =>
      image.protocol !== "iterm2" || image.row < fromRow || image.row > toRow
    );
  }

  /** Records an image placement or deletion for a kitty or iTerm2 graphics sequence. */
  private graphics(sequence: string): void {
    if (sequence.startsWith("\x1b]1337;File=")) {
      this.placedImages.push({ row: this.y, col: this.x, protocol: "iterm2" });

      return;
    }

    if (!sequence.startsWith("\x1b_G")) {
      return;
    }

    const control: Partial<Record<string, string>> = {};
    const end = sequence.indexOf(";");
    const body = sequence.slice(3, end === -1 ? -2 : end);

    for (const pair of body.split(",")) {
      const [key, value] = pair.split("=");

      control[key] = value;
    }

    const id = control.i === undefined ? undefined : Number(control.i);

    if (control.a === "d") {
      this.placedImages = this.placedImages.filter((image) => image.id !== id);
    } else if (control.a === "T" || control.a === "p") {
      this.placedImages = this.placedImages.filter((image) => image.id !== id);

      this.placedImages.push({
        row: this.y,
        col: this.x,
        protocol: "kitty",
        id,
      });
    }
  }

  /** Interprets one escape sequence: cursor save/restore, CSI, or graphics. */
  private escape(sequence: string): void {
    if (sequence === "\x1b7") {
      this.saved = { x: this.x, y: this.y };

      return;
    }

    if (sequence === "\x1b8") {
      this.x = this.saved.x;
      this.y = this.saved.y;
      this.pendingWrap = false;

      return;
    }

    if (sequence.startsWith("\x1b_G") || sequence.startsWith("\x1b]1337;")) {
      this.graphics(sequence);

      return;
    }

    if (!sequence.startsWith("\x1b[")) {
      return;
    }

    this.csi(sequence);
  }

  /** Interpret a CSI sequence: private mode set/reset, cursor movement, erase. */
  private csi(sequence: string): void {
    const final = sequence[sequence.length - 1];
    const body = sequence.slice(2, -1);

    if (body.startsWith("?")) {
      this.setPrivateModes(body.slice(1), final === "h");

      return;
    }

    const params = body.split(";").map((p) => Number.parseInt(p, 10));
    const n = Number.isNaN(params[0]) ? 0 : params[0];

    switch (final) {
      case "A":
      case "B":
      case "C":
      case "D":
      case "H":
      case "f":
      case "G":
        this.moveCursor(final, params, Math.max(1, n));

        break;
      case "J":
        this.eraseDisplay(n);

        break;
      case "K":
        this.eraseLine(n);

        break;
      case "n":
        // Cursor position report, answered like a real terminal does.
        if (n === 6) {
          this.onInput?.(`\x1b[${this.y + 1};${this.x + 1}R`);
        }

        return;
      default:
        return; // SGR and unsupported sequences do not move the cursor
    }

    this.pendingWrap = false;
  }

  /** DEC private modes (`CSI ? Pm h/l`): autowrap (7), cursor visibility (25), and mouse reporting. */
  private setPrivateModes(modes: string, enable: boolean): void {
    for (const mode of modes.split(";")) {
      if (mode === "7") {
        this.autowrap = enable;
      }

      if (mode === "25") {
        this.cursorVisible = enable;
      }

      if (MOUSE_MODES[mode]) {
        if (enable) {
          this.enabledMouseModes.add(Number(mode));
        } else {
          this.enabledMouseModes.delete(Number(mode));
        }
      }
    }
  }

  /** Cursor movement and absolute positioning (`A`, `B`, `C`, `D`, `H`, `f`, `G`). */
  private moveCursor(final: string, params: number[], count: number): void {
    switch (final) {
      case "A":
        this.y = Math.max(0, this.y - count);

        break;
      case "B":
        this.y = Math.min(this.rowCount - 1, this.y + count);

        break;
      case "C":
        this.x = Math.min(this.columnCount - 1, this.x + count);

        break;
      case "D":
        this.x = Math.max(0, this.x - count);

        break;
      case "H":
      case "f": {
        const col = Number.isNaN(params[1]) || params[1] === undefined
          ? 1
          : params[1];

        this.y = Math.min(this.rowCount - 1, Math.max(0, count - 1));
        this.x = Math.min(this.columnCount - 1, Math.max(0, col - 1));

        break;
      }
      case "G":
        this.x = Math.min(this.columnCount - 1, count - 1);

        break;
    }
  }

  /** Erase in display (`CSI n J`). */
  private eraseDisplay(n: number): void {
    switch (n) {
      case 0:
        this.erase(this.y, this.x, this.columnCount);

        for (let y = this.y + 1; y < this.rowCount; y++) {
          this.erase(y, 0, this.columnCount);
        }

        this.eraseITerm2Images(
          this.x === 0 ? this.y : this.y + 1,
          this.rowCount,
        );

        break;
      case 1:
        for (let y = 0; y < this.y; y++) {
          this.erase(y, 0, this.columnCount);
        }

        this.erase(this.y, 0, this.x + 1);

        break;
      case 2:
        for (let y = 0; y < this.rowCount; y++) {
          this.erase(y, 0, this.columnCount);
        }

        this.placedImages = [];

        break;
      case 3:
        this.scrollbackRows = [];

        break;
    }
  }

  /** Erase in line (`CSI n K`). */
  private eraseLine(n: number): void {
    switch (n) {
      case 0:
        this.erase(this.y, this.x, this.columnCount);

        break;
      case 1:
        this.erase(this.y, 0, this.x + 1);

        break;
      case 2:
        this.erase(this.y, 0, this.columnCount);
        this.eraseITerm2Images(this.y, this.y);

        break;
    }
  }
}
