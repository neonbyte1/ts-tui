import { assertEquals, assertThrows } from "@std/assert";
import { BAR_GLYPHS, ProgressBar, visibleWidth } from "../mod.ts";

Deno.test("ProgressBar fills in eighths of a cell", () => {
  const bar = new ProgressBar({ format: () => "", theme: {} });

  bar.setProgress(0);
  assertEquals(bar.render(4), ["    "]);
  bar.setProgress(1 / 32); // one eighth of the first of 4 cells
  assertEquals(bar.render(4), ["▏   "]);
  bar.setProgress(0.5);
  assertEquals(bar.render(4), ["██  "]);
  bar.setProgress(0.6); // 19.2 eighths -> 19
  assertEquals(bar.render(4), ["██▍ "]);
  bar.setProgress(1);
  assertEquals(bar.render(4), ["████"]);
});

Deno.test("ProgressBar reports 100% only when complete and clamps values", () => {
  const bar = new ProgressBar({ total: 200, theme: {} });

  bar.setProgress(199.9);
  assertEquals(bar.render(10)[0].endsWith(" 99%"), true);
  assertEquals(bar.complete, false);
  bar.setProgress(500);
  assertEquals(bar.progress, 200);
  assertEquals(bar.render(10), ["█████ 100%"]);
  bar.setProgress(-3);
  assertEquals(bar.render(10), ["        0%"]);
  bar.setProgress(Number.NaN, 0); // invalid total falls back to 1
  assertEquals(bar.render(10), ["        0%"]);
});

Deno.test("ProgressBar gives the bar priority over the label and never overflows", () => {
  const bar = new ProgressBar({ label: "downloading model.bin" });

  bar.setProgress(0.42);

  for (let width = 1; width <= 40; width++) {
    const [line] = bar.render(width);

    assertEquals(visibleWidth(line) <= width, true, `width ${width}`);
  }

  const unstyled = new ProgressBar({
    label: "downloading model.bin",
    theme: {},
  });

  unstyled.setProgress(0.5);
  assertEquals(unstyled.render(15), ["down… ██    50%"]);
  assertEquals(unstyled.render(10), ["██▌    50%"]); // too narrow for the label
  assertEquals(unstyled.render(4), ["50%"]); // too narrow for the bar
  assertEquals(unstyled.render(2), ["5…"]);
});

Deno.test("ProgressBar honours barWidth and a custom format", () => {
  const bar = new ProgressBar({
    label: "files",
    total: 8,
    barWidth: 8,
    theme: {},
    format: (value, total) => `${value}/${total}`,
  });

  bar.setProgress(3);
  assertEquals(bar.render(40), ["files ███      3/8"]);
});

Deno.test("ProgressBar measures rate, time left, and elapsed; a lower value restarts", () => {
  let now = 0;
  const bar = new ProgressBar({ total: 1000, clock: () => now });

  assertEquals(bar.stats, {
    rate: 0,
    eta: undefined,
    elapsed: 0,
    indeterminate: false,
  });
  bar.setProgress(0);

  now = 1000;

  bar.setProgress(100);

  now = 2000;

  assertEquals(bar.stats, {
    rate: 100,
    eta: 9,
    elapsed: 2,
    indeterminate: false,
  });

  // Samples older than the 5 s window stop counting.
  now = 10_000;

  bar.setProgress(200);

  now = 11_000;

  bar.setProgress(700);
  assertEquals(bar.stats.rate, 500);

  now = 12_000;

  bar.setProgress(50); // went backwards: a new run
  assertEquals(bar.stats.elapsed, 0);
  assertEquals(bar.stats.rate, 0);
  bar.setProgress(1000);
  assertEquals(bar.stats.eta, 0);
});

Deno.test("ProgressBar stacks parts and clamps their sum to the total", () => {
  const bar = new ProgressBar({
    total: 8,
    glyphs: BAR_GLYPHS.ascii,
    theme: { parts: [{}, { bold: true }] },
    format: () => "",
  });

  bar.setParts([4, 2]);
  assertEquals(bar.progress, 6);
  assertEquals(bar.render(10), ["[####\x1b[1m##\x1b[22m..]"]);
  bar.setParts([6, 6]);
  assertEquals(bar.progress, 8);
  assertEquals(bar.complete, true);
});

Deno.test("ProgressBar paints the label and the text beside the bar", () => {
  const bar = new ProgressBar({
    label: "dl",
    glyphs: { full: "#", empty: "." },
    theme: { label: { bold: true }, text: { fg: "red" } },
  });

  bar.setProgress(0.5);
  assertEquals(bar.render(12), [
    "\x1b[1mdl\x1b[22m ##.. \x1b[31m 50%\x1b[39m",
  ]);
});

Deno.test("ProgressBar indeterminate mode drops the percent and never completes", () => {
  const bar = new ProgressBar({
    indeterminate: true,
    glyphs: BAR_GLYPHS.segments,
    theme: {},
  });

  bar.setProgress(1);
  assertEquals(bar.complete, false);
  assertEquals(bar.stats.eta, undefined);
  assertEquals(bar.render(10), ["▰▰▱▱▱▱▱▱▱▱"]); // not started: segment at the left
  assertThrows(() => bar.start(), Error, "host");
  bar.setIndeterminate(false);
  assertEquals(bar.render(10), ["▰▰▰▰▰ 100%"]);
});

Deno.test("ProgressBar.setStyle replaces present keys, including with undefined", () => {
  const bar = new ProgressBar({
    format: () => "",
    theme: { fill: { bold: true } },
  });

  bar.setProgress(0.5);
  assertEquals(bar.render(4), ["\x1b[1m██\x1b[22m  "]);
  bar.setStyle({ glyphs: BAR_GLYPHS.ascii, theme: {} });
  assertEquals(bar.render(6), ["[##..]"]);
  bar.setStyle({ markers: [{ at: 0.75, glyph: "|" }] });
  assertEquals(bar.render(6), ["[##.|]"]);
  // Back to the default theme: a grey track, which the marker inherits.
  bar.setStyle({ theme: undefined });
  assertEquals(bar.render(6), ["[##\x1b[38;5;240m.|\x1b[39m]"]);
});

Deno.test("ProgressBar gap, minBar and ellipsis shape the row, and setTheme merges and redraws", () => {
  let renders = 0;
  const bar = new ProgressBar({
    label: "downloading",
    glyphs: { full: "#", empty: "." },
    theme: {},
    barWidth: 4,
    gap: 2,
    format: () => "ok",
    host: { requestRender: () => renders++ },
  });

  bar.setProgress(0.5);
  assertEquals(bar.render(40), ["downloading  ##..  ok"]);

  bar.setTheme({ fill: { bold: true } });

  assertEquals(renders, 1);
  assertEquals(bar.render(40), ["downloading  \x1b[1m##\x1b[22m..  ok"]);

  const narrow = new ProgressBar({
    theme: {},
    minBar: 8,
    ellipsis: "~",
    format: () => "all done",
  });

  // Fewer than minBar cells would be left: only the text, cut with the ellipsis.
  assertEquals(narrow.render(6), ["all d~"]);
});
