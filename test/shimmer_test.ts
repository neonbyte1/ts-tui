import { assertEquals } from "@std/assert";
import { mixColors, Shimmer, shimmerText } from "../mod.ts";

const style = { base: "#000000", peak: "#ffffff", band: 4 } as const;
const fg = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  return `\x1b[38;2;${r};${g};${b}m`;
};

Deno.test("shimmerText peaks at the centre and fades out by half the band", () => {
  // Centre on cell 2 (x = 2.5): distances 2, 1, 0, 1, 2 with half-width 2.
  assertEquals(
    shimmerText("abcde", 2.5, style),
    `${fg("#000000")}a${fg("#808080")}b${fg("#ffffff")}c${fg("#808080")}d${
      fg("#000000")
    }e\x1b[39m`,
  );
  // Far away: one run in the base colour.
  assertEquals(
    shimmerText("abc", -100, style),
    `${fg("#000000")}abc\x1b[39m`,
  );
});

Deno.test("shimmerText measures wide characters in cells and adds peakPaint at half strength", () => {
  // "中" covers cells 0-1 (centre 1); "x" is 1.5 cells away: (1 + cos 0.75π) / 2 ≈ 0.146.
  assertEquals(
    shimmerText("中x", 1, { ...style, peakPaint: { bold: true } }),
    "\x1b[38;2;255;255;255;1m中\x1b[38;2;37;37;37;22mx\x1b[39m",
  );
});

Deno.test("mixColors interpolates per channel and clamps t", () => {
  assertEquals(mixColors("#000000", "#ff8000", 0.5), "#804000");
  assertEquals(mixColors("#102030", "#ffffff", -1), "#102030");
  assertEquals(mixColors("#102030", "#ffffff", 2), "#ffffff");
});

Deno.test("Shimmer draws the base colour while stopped and truncates to the width", () => {
  const shimmer = new Shimmer({ requestRender() {} }, "Rewriting tests", {
    theme: style,
  });

  assertEquals(shimmer.render(9), [`${fg("#000000")}Rewritin…\x1b[39m`]);
});

Deno.test("Shimmer.setTheme merges over the current theme, redraws, and the ellipsis is configurable", () => {
  let renders = 0;
  const shimmer = new Shimmer({ requestRender: () => renders++ }, "abcdef", {
    theme: style,
    ellipsis: "~",
  });

  assertEquals(shimmer.render(4), [`${fg("#000000")}abc~\x1b[39m`]);

  shimmer.setTheme({ base: "#102030", paint: { italic: true } });

  assertEquals(renders, 1);
  assertEquals(shimmer.render(4), [
    `\x1b[38;2;16;32;48;3mabc~\x1b[39;23m`,
  ]);
});
