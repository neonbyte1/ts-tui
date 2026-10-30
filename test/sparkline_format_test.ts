import { assertEquals } from "@std/assert";
import {
  formatBytes,
  formatCount,
  formatDuration,
  Sparkline,
  SPARKLINE_LEVELS,
} from "../mod.ts";

Deno.test("Sparkline scales to the largest visible sample and keeps the newest", () => {
  const spark = new Sparkline({ capacity: 5 });

  for (const value of [0, 1, 2, 3, 4, 5, 6, 7]) {
    spark.push(value);
  }

  assertEquals(spark.values, [3, 4, 5, 6, 7]);
  assertEquals(spark.render(10), ["▄▅▆▇█"]);
  // Narrow: only the newest samples, rescaled to what is shown.
  assertEquals(spark.render(2), ["▇█"]);
  spark.clear();
  spark.push(0);
  spark.push(-3);
  spark.push(Number.NaN);
  assertEquals(spark.render(10), ["▁▁▁"]);
});

Deno.test("Sparkline lays out label and suffix and falls back when too narrow", () => {
  const spark = new Sparkline({
    label: "net",
    format: (latest, max) => `${latest}/${max}`,
  });

  spark.push(2);
  spark.push(4);
  assertEquals(spark.render(20), ["net ▅█ 4/4"]); // 2/4 of 7 levels = 3.5, rounds up
  assertEquals(spark.render(9), ["net █ 4/4"]); // one cell left: the newest sample
  assertEquals(spark.render(8), ["net"]); // no room for a graph
});

Deno.test("Sparkline levels, gap and theme paints shape the row; setTheme changes the next render", () => {
  const spark = new Sparkline({
    label: "net",
    levels: SPARKLINE_LEVELS.ascii,
    gap: 2,
    format: (latest) => `${latest}`,
    theme: { label: { bold: true }, suffix: { fg: "red" } },
    style: (graph) => graph.toUpperCase(),
  });

  spark.push(0);
  spark.push(5);

  assertEquals(spark.render(30), ["\x1b[1mnet\x1b[22m  _#  \x1b[31m5\x1b[39m"]);

  spark.setTheme({ graph: { italic: true } });

  assertEquals(spark.render(30), [
    "\x1b[1mnet\x1b[22m  \x1b[3m_#\x1b[23m  \x1b[31m5\x1b[39m",
  ]);
});
Deno.test("formatBytes, formatCount, formatDuration", () => {
  assertEquals(formatBytes(999), "999 B");
  assertEquals(formatBytes(1000), "1 kB");
  assertEquals(formatBytes(1_234_567), "1.2 MB");
  assertEquals(formatBytes(999_700), "1 MB"); // rounds up into the next unit
  assertEquals(formatBytes(42_000_000), "42 MB");
  assertEquals(formatCount(950), "950");
  assertEquals(formatCount(1_500), "1.5k");
  assertEquals(formatCount(12_345), "12k");
  assertEquals(formatCount(1_000_000), "1M");
  assertEquals(formatDuration(41.9), "0:41");
  assertEquals(formatDuration(3_723), "1:02:03");
  assertEquals(formatDuration(undefined), "--:--");
  assertEquals(formatDuration(Number.POSITIVE_INFINITY), "--:--");
});
