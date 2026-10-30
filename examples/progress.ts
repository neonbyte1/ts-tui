// Gallery of progress styles: every glyph set, themes (fore- and background
// for fill and track, painted caps, labels, markers, zones), colour schemes,
// a stacked test run, an indeterminate bar, a download with shimmer, speed
// and time left, a failure, an inline mini bar, and a throughput sparkline.
// Everything loops every 10 s; Ctrl+C quits.
// Run: deno task tui:progress
import process from "node:process";
import {
  BAR_GLYPHS,
  formatBytes,
  formatCount,
  formatDuration,
  gradient,
  matchesKey,
  paint,
  ProcessTerminal,
  ProgressBar,
  type ProgressTheme,
  renderBar,
  Shimmer,
  Spacer,
  Sparkline,
  Text,
  Thinking,
  thresholds,
  TUI,
} from "../mod.ts";

const ORANGE = 208;
const GREY = 240;
const DARK = 236;
const heading = (text: string) => new Text(paint(text, { bold: true }));

const CYCLE_MS = 10_000;
/** Label column width; fits the "✘ " prefix of a failed download. */
const LABEL = 14;
const tui = new TUI(new ProcessTerminal());

const percent = (value: number, total: number) =>
  `${Math.floor((value / total) * 100)}%`;

// Glyph sets, all with the same theme: cyan fill, grey track (as background
// for `blocks`, whose empty cells are spaces).
const glyphBars = Object.entries(BAR_GLYPHS).map(([name, glyphs]) =>
  new ProgressBar({
    label: name.padEnd(LABEL),
    glyphs,
    barWidth: name === "segments" ? 12 : 40,
    total: 12,
    format: name === "segments"
      ? (value) => `${Math.floor(value)}/12 steps`
      : undefined,
    theme: {
      fill: { fg: name === "rail" ? ORANGE : "cyan" },
      track: glyphs.empty === " " ? { bg: 238 } : { fg: GREY },
    },
  })
);

// Themes.
const context = new ProgressBar({
  label: "context".padEnd(LABEL),
  total: 1_000_000,
  glyphs: BAR_GLYPHS.rail,
  theme: {
    fill: { fg: ORANGE },
    track: { fg: GREY },
    left: { fg: ORANGE },
    right: { fg: GREY },
    edgeLabel: { fg: ORANGE, bold: true },
    endLabel: { fg: GREY },
    marker: { fg: GREY },
  },
  markers: [{ at: 0.8, glyph: "╎" }, {
    at: 0.85,
    glyph: "┃",
    paint: { fg: ORANGE },
  }],
  edgeLabel: percent,
  endLabel: (_, total) => `${formatCount(total)} `, // gap before the ◀ cap
  format: () => "",
});

// Fill and track as backgrounds; the partial edge cell blends the two.
const twoTone = new ProgressBar({
  label: "two-tone".padEnd(LABEL),
  barWidth: 40,
  glyphs: { ...BAR_GLYPHS.blocks, full: " " },
  theme: {
    fill: { bg: ORANGE },
    track: { bg: DARK },
    edgeLabel: { fg: ORANGE, bold: true },
    endLabel: { fg: GREY },
  },
  edgeLabel: (value, total) => ` ${percent(value, total)}`,
  endLabel: (_, __, stats) => `${formatDuration(stats.eta)} left `,
  format: () => "",
});

// Zones: the fill and the track change colour past 60% and 85%.
const zoneTheme: ProgressTheme = {
  track: { fg: GREY },
  left: { fg: "green" },
  right: { fg: "red" },
  sections: [
    { until: 0.6, fill: { fg: "green" } },
    { until: 0.85, fill: { fg: "yellow" }, track: { fg: 58 } },
    { until: 1, fill: { fg: "red" }, track: { fg: 52 }, empty: "┄" },
  ],
  text: { fg: GREY },
};
const zones = new ProgressBar({
  label: "zones".padEnd(LABEL),
  barWidth: 40,
  glyphs: { ...BAR_GLYPHS.thin, left: "◀", right: "▶" },
  theme: zoneTheme,
});

// Rounded caps from a Nerd Font; each cap takes its neighbour's colour.
const pill = new ProgressBar({
  label: "pill".padEnd(LABEL),
  barWidth: 40,
  glyphs: {
    ...BAR_GLYPHS.blocks,
    full: " ",
    left: "\ue0b6",
    right: "\ue0b4",
  },
  theme: {
    fill: { bg: "#5f87d7" },
    track: { bg: DARK },
    left: { fg: "#5f87d7" },
    right: { fg: DARK },
    edgeLabel: { fg: "brightWhite", bold: true },
  },
  edgeLabel: (value, total) => ` ${percent(value, total)}`,
  format: () => "",
});

// Colour schemes as per-cell paint.
const byPosition = new ProgressBar({
  label: "gradient".padEnd(LABEL),
  barWidth: 40,
  cellPaint: gradient(["#e05050", "#e0c050", "#50c050"]),
});
const byProgress = new ProgressBar({
  label: "by progress".padEnd(LABEL),
  barWidth: 40,
  glyphs: BAR_GLYPHS.thin,
  cellPaint: gradient(["#e05050", "#e0c050", "#50c050"], { by: "progress" }),
});
const budget = new ProgressBar({
  label: "thresholds".padEnd(LABEL),
  barWidth: 40,
  glyphs: BAR_GLYPHS.dots,
  cellPaint: thresholds([
    [0.7, { fg: "green" }],
    [0.9, { fg: "yellow" }],
    [1, { fg: "red", bold: true }],
  ]),
});

// Stacked: passed, failed, skipped.
const counts = { ok: 0, failed: 0, skipped: 0 };
const tests = new ProgressBar({
  label: "tests".padEnd(LABEL),
  total: 40,
  barWidth: 40,
  glyphs: BAR_GLYPHS.shade,
  theme: {
    track: { fg: GREY },
    parts: [{ fg: "green" }, { fg: "red" }, { fg: "yellow" }],
  },
  format: () =>
    [
      paint(`${counts.ok} ok`, { fg: "green" }),
      paint(`${counts.failed} failed`, { fg: "red" }),
      paint(`${counts.skipped} skipped`, { fg: "yellow" }),
    ].join(" · "),
});

// Indeterminate.
const resolving = new ProgressBar({
  label: "resolving".padEnd(LABEL),
  barWidth: 40,
  glyphs: BAR_GLYPHS.thin,
  theme: { fill: { fg: ORANGE }, track: { fg: GREY }, text: { fg: GREY } },
  indeterminate: true,
  format: (_, __, stats) => `${stats.elapsed.toFixed(1)}s`,
  host: tui,
});

// Download with shimmer, speed, and time left; its speed feeds the sparkline.
const cyanBlocks: ProgressTheme = { fill: { fg: "cyan" }, track: { bg: 238 } };
const download = new ProgressBar({
  label: "model.bin".padEnd(LABEL),
  total: 4.2e9,
  barWidth: 40,
  theme: cyanBlocks,
  shimmer: true,
  host: tui,
  format: (value, total, stats) =>
    `${formatBytes(value)}/${formatBytes(total)} · ${
      formatBytes(stats.rate)
    }/s · ${formatDuration(stats.eta)} left`,
});
const throughput = new Sparkline({
  label: "throughput".padEnd(LABEL),
  style: (graph) => paint(graph, { fg: "cyan" }),
  format: (latest, max) =>
    paint(`${formatBytes(latest)}/s, peak ${formatBytes(max)}/s`, { fg: GREY }),
});

// A download that fails at 60%: the bar turns red and keeps its position.
const failedTheme: ProgressTheme = {
  fill: { fg: "red" },
  track: { bg: 52 },
  label: { fg: "red" },
  text: { fg: "red" },
};
let shardFailed = false;
const shard = new ProgressBar({
  label: "shard-3.bin".padEnd(LABEL),
  barWidth: 40,
  theme: cyanBlocks,
  format: (value, total) =>
    shardFailed
      ? "failed: connection reset"
      : percent(value, total).padStart(4),
});

// A bar inside an ordinary line of text.
const inline = new Text("");

tui.addChild(
  new Text(`${paint("progress gallery", { bold: true })}  Ctrl+C quits`),
);
tui.addChild(new Spacer());
tui.addChild(heading("glyph sets"));

for (const bar of glyphBars) {
  tui.addChild(bar);
}

tui.addChild(new Spacer());
tui.addChild(heading("themes"));

for (const bar of [context, twoTone, zones, pill]) {
  tui.addChild(bar);
}

tui.addChild(new Spacer());
tui.addChild(heading("per-cell paint"));

for (const bar of [byPosition, byProgress, budget]) {
  tui.addChild(bar);
}

tui.addChild(new Spacer());
tui.addChild(heading("stacked, indeterminate, live"));

for (const c of [tests, resolving, download, throughput, shard, inline]) {
  tui.addChild(c);
}

tui.addChild(new Spacer());
tui.addChild(heading("text shimmer and thinking"));

const shimmers = [
  new Shimmer(tui, "Rewriting renderBar tests for themes"),
  new Shimmer(tui, "Thinking about the context window…", {
    theme: {
      base: "#5c6370",
      peak: "#56b6c2",
      band: 6,
      peakPaint: { bold: true },
      paint: { italic: true },
    },
    direction: "left",
  }),
  new Thinking(tui, "Thinking…", {
    detail: (s) => `(${Math.floor(s)}s · esc to interrupt)`,
  }),
  new Thinking(tui, "", {
    frames: ["◐", "◓", "◑", "◒"],
    glyphEvery: 2,
    theme: {
      glyph: { fg: "#ff9f1a" },
      text: { base: "#8a8f98", peak: "#ff9f1a", band: 6 },
    },
    messages: ["Reading files…", "Planning edits…", "Running tests…"],
    rotateMs: 2000,
  }),
];

for (const shimmer of shimmers) {
  tui.addChild(shimmer);
}

let cycleStart = performance.now();
let last = cycleStart;
let speed = 0;
const timer = setInterval(() => {
  const now = performance.now();
  const dt = (now - last) / 1000;

  last = now;

  if (now - cycleStart >= CYCLE_MS) {
    cycleStart = now;

    download.setProgress(0);
    twoTone.setProgress(0);

    shardFailed = false;

    shard.setStyle({ theme: cyanBlocks });
    shard.setLabel("shard-3.bin".padEnd(LABEL));
  }

  const p = Math.min(1, (now - cycleStart) / (CYCLE_MS * 0.8));

  for (const bar of glyphBars) {
    bar.setProgress(p * 12);
  }

  for (const bar of [twoTone, zones, pill, byPosition, byProgress, budget]) {
    bar.setProgress(p);
  }

  context.setProgress(p * 900_000);

  counts.ok = Math.floor(p * 34);
  counts.failed = Math.floor(p * 4);
  counts.skipped = Math.floor(p * 2);

  tests.setParts([counts.ok, counts.failed, counts.skipped]);

  // Average speed finishes the download in ~8 s; two out-of-step sine waves
  // (0 to 1, mean 0.5) make the rate wobble without randomness.
  const average = 4.2e9 / (CYCLE_MS * 0.8 / 1000);
  const wobble = (Math.sin(now / 170) + Math.sin(now / 53) + 2) / 4;

  speed = 0.7 * speed + 0.3 * average * (0.3 + 1.4 * wobble);

  if (!download.complete) {
    download.setProgress(download.progress + speed * dt);
    throughput.push(speed);
  } else {
    throughput.push(0);
  }

  if (!shardFailed) {
    shard.setProgress(Math.min(p, 0.6));

    if (p >= 0.6) {
      shardFailed = true;

      shard.setLabel("✘ shard-3.bin".padEnd(LABEL));
      shard.setStyle({ theme: failedTheme });
    }
  }

  inline.setText(
    `${paint("tool", { fg: GREY })} list_files ${
      renderBar(p, 8, {
        glyphs: { ...BAR_GLYPHS.blocks, left: "▕", right: "▏" },
        theme: { fill: { fg: "cyan" } },
      })
    } ${Math.floor(p * 8)}/8 dirs`,
  );
  tui.requestRender();
}, 50);

tui.addInputListener((event) => {
  if (event.type === "key" && matchesKey(event.key, "ctrl+c")) {
    clearInterval(timer);
    resolving.stop();
    download.stop();

    for (const shimmer of shimmers) {
      shimmer.stop();
    }

    tui.stop();
    process.exit(0);
  }
});

resolving.setProgress(0); // starts its elapsed clock
resolving.start();
download.start();

for (const shimmer of shimmers) {
  shimmer.start();
}

tui.start();
