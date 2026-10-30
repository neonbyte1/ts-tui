import { assertEquals } from "@std/assert";
import { BAR_GLYPHS, gradient, renderBar, thresholds } from "../mod.ts";

const HASH = { full: "#", empty: "." };

Deno.test("renderBar steps partial cells by the glyph set's resolution", () => {
  const thin = { glyphs: BAR_GLYPHS.thin };

  assertEquals(renderBar(0.55, 10, thin), "━━━━━╸────"); // 5.5 cells
  assertEquals(renderBar(0.54, 10, thin), "━━━━━─────"); // rounds down
  assertEquals(renderBar(0.3, 10, thin), "━━━───────"); // no float drift

  const segments = { glyphs: BAR_GLYPHS.segments };

  assertEquals(renderBar(0.99, 4, segments), "▰▰▰▱"); // never full early
});

Deno.test("renderBar draws the head only past zero and inside the caps", () => {
  const arrow = { glyphs: BAR_GLYPHS.arrow };

  assertEquals(renderBar(0, 6, arrow), "[      ]");
  assertEquals(renderBar(0.5, 6, arrow), "[===>  ]");
  assertEquals(renderBar(1, 6, arrow), "[======]");
});

Deno.test("renderBar places markers, end label, and a moving edge label", () => {
  const rail = { glyphs: BAR_GLYPHS.rail, endLabel: "1M" };

  assertEquals(
    renderBar(0.25, 20, {
      ...rail,
      markers: [{ at: 0.8, glyph: "╎" }],
      edgeLabel: "25%",
    }),
    "▶─────25%────────╎─1M◀",
  );
  // Near the end, the edge label is pushed left of the end label.
  assertEquals(
    renderBar(1, 10, { ...rail, edgeLabel: "100%" }),
    "▶────100%1M◀",
  );
  // A marker at 1 lands on the last cell; out-of-range markers are ignored.
  assertEquals(
    renderBar(0, 4, {
      glyphs: BAR_GLYPHS.ascii,
      markers: [{ at: 1 }, { at: 1.5 }, { at: -0.1 }],
    }),
    "[...│]",
  );
});

Deno.test("partial cells carry the fill colour on the track background", () => {
  const theme = { fill: { fg: "red" }, track: { bg: "blue" } } as const;

  // 0.375 of 2 cells = 6 eighths: one partial cell, then track.
  assertEquals(
    renderBar(0.375, 2, { theme }),
    "\x1b[31;44m▊\x1b[39m \x1b[49m",
  );

  // A fill drawn as coloured background: the partial glyph takes that colour.
  const spaces = { full: " ", empty: " ", partials: ["▌"] };

  assertEquals(
    renderBar(0.75, 2, {
      glyphs: spaces,
      theme: { fill: { bg: "red" }, track: { bg: "blue" } },
    }),
    "\x1b[41m \x1b[31;44m▌\x1b[39;49m",
  );
});

Deno.test("stacked parts get their own paint and empty parts are skipped", () => {
  const theme = {
    parts: [{ fg: "red" }, { fg: "green" }, { fg: "blue" }],
  } as const;
  const ascii = { glyphs: BAR_GLYPHS.ascii, theme };

  assertEquals(
    renderBar([0.5, 0.25], 4, ascii),
    "[\x1b[31m##\x1b[32m#\x1b[39m.]",
  );
  assertEquals(
    renderBar([0.25, 0, 0.25], 4, ascii),
    "[\x1b[31m#\x1b[34m#\x1b[39m..]",
  );
  // Over-full parts are clamped at the right edge.
  assertEquals(
    renderBar([0.75, 0.75], 4, ascii),
    "[\x1b[31m###\x1b[32m#\x1b[39m]",
  );
});

Deno.test("sections override paints and glyphs by position", () => {
  const theme = {
    sections: [
      { until: 0.5, fill: { fg: "green" } },
      { until: 1, fill: { fg: "red" }, empty: "!" },
    ],
  } as const;

  assertEquals(
    renderBar(0.75, 4, { glyphs: HASH, theme }),
    "\x1b[32m##\x1b[31m#\x1b[39m!",
  );
});

Deno.test("caps, markers, and labels are painted and keep the cell's background", () => {
  assertEquals(
    renderBar(0, 1, {
      glyphs: { ...HASH, left: "<", right: ">" },
      theme: { left: { fg: "yellow" }, right: { fg: "cyan" } },
    }),
    "\x1b[33m<\x1b[39m.\x1b[36m>\x1b[39m",
  );

  const theme = {
    track: { bg: "blue" },
    marker: { fg: "red" },
    edgeLabel: { fg: "red" },
  } as const;

  assertEquals(
    renderBar(0, 3, {
      glyphs: HASH,
      theme,
      markers: [{ at: 0.5, glyph: "|" }],
    }),
    "\x1b[44m.\x1b[31m|\x1b[39m.\x1b[49m",
  );
  assertEquals(
    renderBar(0, 4, { glyphs: HASH, theme, edgeLabel: "ab" }),
    "\x1b[31;44mab\x1b[39m..\x1b[49m",
  );
  // A label with its own escapes: attributes are reset after it and re-applied.
  assertEquals(
    renderBar(0, 2, { glyphs: HASH, theme, edgeLabel: "\x1b[1mx\x1b[22m" }),
    "\x1b[31;44m\x1b[1mx\x1b[22m\x1b[39;49;22;23;24;27;29m\x1b[44m.\x1b[49m",
  );
});

Deno.test("thresholds paint by progress; highlight paints one filled cell", () => {
  const budget = thresholds([[0.7, { fg: "green" }], [1, { fg: "red" }]]);

  assertEquals(
    renderBar(0.5, 2, { glyphs: HASH, cellPaint: budget }),
    "\x1b[32m#\x1b[39m.",
  );
  assertEquals(
    renderBar(1, 2, { glyphs: HASH, cellPaint: budget }),
    "\x1b[31m##\x1b[39m",
  );
  assertEquals(
    renderBar(1, 2, { glyphs: HASH, highlight: 0 }),
    "\x1b[97;1m#\x1b[39;22m#",
  );
  // The highlight never lands on the track.
  assertEquals(renderBar(0, 2, { glyphs: HASH, highlight: 0 }), "..");
});

Deno.test("gradient interpolates across filled cells, on either layer", () => {
  assertEquals(
    renderBar(1, 3, {
      glyphs: HASH,
      cellPaint: gradient(["#ff0000", "#0000ff"]),
    }),
    "\x1b[38;2;255;0;0m#\x1b[38;2;128;0;128m#\x1b[38;2;0;0;255m#\x1b[39m",
  );
  assertEquals(
    renderBar(0.5, 2, {
      glyphs: HASH,
      cellPaint: gradient(["#000000", "#ffffff"], { by: "progress" }),
    }),
    "\x1b[38;2;128;128;128m#\x1b[39m.",
  );
  // Background layer: a partial cell takes the colour as its foreground.
  assertEquals(
    renderBar(0.75, 2, {
      glyphs: { full: " ", empty: " ", partials: ["▌"] },
      cellPaint: gradient(["#ff0000"], { layer: "bg" }),
    }),
    "\x1b[48;2;255;0;0m \x1b[38;2;255;0;0;49m▌\x1b[39m",
  );
});
