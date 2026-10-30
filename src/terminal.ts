import { writeSync } from "node:fs";
import process from "node:process";
import { BRACKETED_PASTE_OFF, BRACKETED_PASTE_ON } from "./ansi.ts";

/**
 * Byte-level terminal the {@linkcode TUI} renders into. {@linkcode ProcessTerminal}
 * drives the real one and {@linkcode VirtualTerminal} an in-memory screen for
 * tests; implement this interface to render somewhere else, such as a pty or a
 * socket.
 *
 * @category Terminal
 *
 * @example Record what the TUI writes
 * ```ts
 * import { Text, TUI, type Terminal } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * const written: string[] = [];
 * const terminal: Terminal = {
 *   columns: 20,
 *   rows: 5,
 *   start() {},
 *   stop() {},
 *   write(data) {
 *     written.push(data);
 *   },
 * };
 * const tui = new TUI(terminal);
 *
 * tui.addChild(new Text("hello"));
 * tui.start();
 * tui.renderNow();
 * tui.stop();
 *
 * assertEquals(written.join("").includes("hello"), true);
 * ```
 */
export interface Terminal {
  /**
   * Begins delivering raw input and resize notifications.
   *
   * @param onInput Called with raw input as text, in arbitrary chunks.
   * @param onResize Called when the terminal size changed.
   */
  start(onInput: (data: string) => void, onResize: () => void): void;
  /** Stops input delivery and restores the terminal's previous modes. */
  stop(): void;
  /**
   * Writes text and escape sequences to the terminal.
   *
   * @param data What to write.
   */
  write(data: string): void;
  /** Width in cells. */
  readonly columns: number;
  /** Height in rows. */
  readonly rows: number;
}

const WINDOWS_RESIZE_POLL_MS = 250;

/**
 * Terminal backed by the process's stdin/stdout. Requires stdin to be a TTY.
 *
 * Input and output go through `node:process` and `node:fs`, which Deno, Node
 * and Bun all implement. Pausing stdin releases the event loop, so the process
 * can exit after `stop()` or hand the terminal to `$EDITOR` and `start()`
 * again later.
 *
 * Starting puts stdin in raw mode and enables bracketed paste; `stop()`
 * undoes both. Resizes arrive through `SIGWINCH` (polling on Windows). The
 * size falls back to 80×24 when it cannot be read.
 *
 * @category Terminal
 *
 * @example Swap the real terminal for a virtual one in tests
 * ```ts
 * import {
 *   ProcessTerminal,
 *   Text,
 *   type Terminal,
 *   TUI,
 *   VirtualTerminal,
 * } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * function createApp(terminal: Terminal): TUI {
 *   const tui = new TUI(terminal);
 *
 *   tui.addChild(new Text("hello"));
 *
 *   return tui;
 * }
 *
 * // Production would pass `new ProcessTerminal()`; tests pass a virtual screen.
 * const real = new ProcessTerminal();
 * const terminal = new VirtualTerminal(20, 3);
 * const app = createApp(terminal);
 *
 * app.start();
 * app.renderNow();
 * app.stop();
 *
 * assertEquals(real.columns > 0 && real.rows > 0, true);
 * assertEquals(terminal.viewport()[0], "hello");
 * ```
 *
 * @example Run an app in the real terminal
 * ```ts ignore
 * import process from "node:process";
 * import { matchesKey, ProcessTerminal, Text, TUI } from "@neonbyte/tui";
 *
 * const tui = new TUI(new ProcessTerminal());
 *
 * tui.addChild(new Text("Press ctrl+c to quit"));
 * tui.addInputListener((event) => {
 *   if (event.type === "key" && matchesKey(event.key, "ctrl+c")) {
 *     tui.stop();
 *     process.exit(0);
 *   }
 * });
 * tui.start();
 * ```
 */
export class ProcessTerminal implements Terminal {
  private readonly encoder = new TextEncoder();
  private active = false;
  private onResize: (() => void) | undefined;
  private onData: ((chunk: Uint8Array) => void) | undefined;
  private resizePoll: ReturnType<typeof setInterval> | undefined;

  /** Width of the terminal in cells; 80 when it cannot be read. */
  public get columns(): number {
    return this.size().columns;
  }

  /** Height of the terminal in rows; 24 when it cannot be read. */
  public get rows(): number {
    return this.size().rows;
  }

  /**
   * Puts stdin in raw mode, enables bracketed paste and starts delivering
   * input and resize notifications. Does nothing when already started.
   *
   * @param onInput Called with decoded input text, in arbitrary chunks.
   * @param onResize Called when the terminal size changed.
   * @throws {Error} When stdin is not a terminal.
   *
   * @example Echo what the user types
   * ```ts ignore
   * import { ProcessTerminal } from "@neonbyte/tui";
   *
   * const terminal = new ProcessTerminal();
   *
   * terminal.start(
   *   (data) => {
   *     terminal.write(JSON.stringify(data) + "\r\n");
   *
   *     if (data === "q") {
   *       terminal.stop();
   *     }
   *   },
   *   () => terminal.write(`${terminal.columns}x${terminal.rows}\r\n`),
   * );
   * ```
   */
  public start(onInput: (data: string) => void, onResize: () => void): void {
    if (this.active) {
      return;
    }

    if (process.stdin.isTTY !== true) {
      throw new Error("ProcessTerminal requires stdin to be a terminal");
    }

    process.stdin.setRawMode(true);

    this.active = true;

    this.write(BRACKETED_PASTE_ON);

    this.onResize = onResize;

    if (process.platform === "win32") {
      // Windows has no SIGWINCH; poll the console size instead.
      let { columns, rows } = this.size();

      this.resizePoll = setInterval(() => {
        const size = this.size();

        if (size.columns === columns && size.rows === rows) {
          return;
        }

        ({ columns, rows } = size);

        onResize();
      }, WINDOWS_RESIZE_POLL_MS);
    } else {
      process.on("SIGWINCH", onResize);
    }

    const decoder = new TextDecoder();

    this.onData = (chunk) => {
      const text = decoder.decode(chunk, { stream: true });

      if (text.length > 0) {
        onInput(text);
      }
    };

    process.stdin.on("data", this.onData);
    process.stdin.resume();
  }

  /**
   * Stops input delivery, disables bracketed paste and leaves raw mode, so the
   * process can exit or hand the terminal to another program. Does nothing
   * when not started; `start()` may be called again afterwards.
   *
   * @example Hand the terminal to another program
   * ```ts ignore
   * import { spawnSync } from "node:child_process";
   * import { ProcessTerminal } from "@neonbyte/tui";
   *
   * const terminal = new ProcessTerminal();
   *
   * terminal.start(() => {}, () => {});
   * terminal.stop();
   *
   * spawnSync("vim", ["notes.txt"], { stdio: "inherit" });
   * ```
   */
  public stop(): void {
    if (!this.active) {
      return;
    }

    this.active = false;

    clearInterval(this.resizePoll);

    this.resizePoll = undefined;

    if (this.onResize && process.platform !== "win32") {
      process.off("SIGWINCH", this.onResize);
    }

    this.onResize = undefined;

    if (this.onData) {
      process.stdin.off("data", this.onData);
    }

    this.onData = undefined;

    process.stdin.pause();
    this.write(BRACKETED_PASTE_OFF);
    process.stdin.setRawMode(false);
  }

  /**
   * Writes text and escape sequences to stdout, synchronously.
   *
   * @param data What to write; encoded as UTF-8.
   *
   * @example Write a line
   * ```ts ignore
   * import { ProcessTerminal } from "@neonbyte/tui";
   *
   * new ProcessTerminal().write("\x1b[1mbold\x1b[22m\r\n");
   * ```
   */
  public write(data: string): void {
    const bytes = this.encoder.encode(data);
    let offset = 0;

    while (offset < bytes.length) {
      try {
        offset += writeSync(1, bytes.subarray(offset));
      } catch (error) {
        // A non-blocking TTY can refuse a large frame; retry the same slice.
        if (
          !(error instanceof Error && "code" in error &&
            error.code === "EAGAIN")
        ) {
          throw error;
        }
      }
    }
  }

  /** Terminal size from stdout, or 80×24 when stdout is not a terminal. */
  private size(): { columns: number; rows: number } {
    return {
      columns: process.stdout.columns ?? 80,
      rows: process.stdout.rows ?? 24,
    };
  }
}
