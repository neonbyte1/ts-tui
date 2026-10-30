const BYTE_UNITS = [" B", " kB", " MB", " GB", " TB", " PB"];
const COUNT_UNITS = ["", "k", "M", "G", "T"];

/** Scale `value` by `base` into `units`: one decimal below 10, none above (`1.2 GB`, `42 MB`, `1 kB`). */
function scaled(value: number, base: number, units: readonly string[]): string {
  let n = Math.max(0, value);
  let unit = 0;

  while (n >= base && unit < units.length - 1) {
    n /= base;
    unit++;
  }

  // Rounding can reach the base (999.7 kB -> "1000 kB"); step up instead.
  if (unit < units.length - 1 && Math.round(n) >= base) {
    n /= base;
    unit++;
  }

  const digits = unit > 0 && n < 10 ? 1 : 0;

  return n.toFixed(digits).replace(/\.0$/, "") + units[unit];
}

/**
 * Formats a byte size with decimal (SI) units: one decimal below 10, none
 * above (`512 B`, `1.2 kB`, `340 MB`). Negative sizes count as zero.
 *
 * @param bytes Size in bytes.
 * @returns The size with its unit, e.g. `1.2 kB`.
 * @category Text utilities
 *
 * @example Format a download size
 * ```ts
 * import { formatBytes } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * assertEquals(formatBytes(512), "512 B");
 * assertEquals(formatBytes(1_200), "1.2 kB");
 * assertEquals(formatBytes(340_000_000), "340 MB");
 * ```
 */
export function formatBytes(bytes: number): string {
  return scaled(bytes, 1000, BYTE_UNITS);
}

/**
 * Formats a count compactly, as in token budgets (`950`, `12k`, `1.5M`).
 * Negative counts count as zero.
 *
 * @param count Number to format.
 * @returns The count with a `k`, `M`, `G` or `T` suffix once it reaches 1000.
 * @category Text utilities
 *
 * @example Format a token count
 * ```ts
 * import { formatCount } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * assertEquals(formatCount(950), "950");
 * assertEquals(formatCount(12_000), "12k");
 * assertEquals(formatCount(1_500_000), "1.5M");
 * ```
 */
export function formatCount(count: number): string {
  return scaled(count, 1000, COUNT_UNITS);
}

/**
 * Formats seconds as `m:ss`, or `h:mm:ss` from one hour on. Fractions are
 * dropped; unknown, negative or non-finite values give `--:--`.
 *
 * @param seconds Elapsed or remaining seconds, or `undefined` when unknown.
 * @returns The formatted time, e.g. `1:15`.
 * @category Text utilities
 *
 * @example Format an ETA
 * ```ts
 * import { formatDuration } from "@neonbyte/tui";
 * import { assertEquals } from "@std/assert";
 *
 * assertEquals(formatDuration(75), "1:15");
 * assertEquals(formatDuration(3_725), "1:02:05");
 * assertEquals(formatDuration(undefined), "--:--");
 * ```
 */
export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "--:--";
  }

  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");

  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
