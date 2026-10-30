import { assertEquals } from "@std/assert";
import { visibleWidth } from "../mod.ts";
import {
  renderScrollbar,
  SCROLLBAR_GLYPHS,
  scrollbarOffset,
  scrollbarThumb,
} from "../src/scrollbar.ts";

// deno-lint-ignore no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;:]*m/g, "");

Deno.test("the thumb fills the track when everything fits", () => {
  assertEquals(scrollbarThumb(10, 10, 0), { start: 0, size: 10 });
  assertEquals(scrollbarThumb(10, 4, 0), { start: 0, size: 10 });
  assertEquals(scrollbarThumb(0, 50, 0), { start: 0, size: 0 });
});

Deno.test("the thumb is proportional to the visible share and at least one cell", () => {
  assertEquals(scrollbarThumb(10, 20, 0).size, 5);
  assertEquals(scrollbarThumb(10, 40, 0).size, 3);
  assertEquals(scrollbarThumb(10, 10_000, 0).size, 1);
  assertEquals(scrollbarThumb(1, 50, 0).size, 1);
});

Deno.test("the thumb is never as long as a scrollable track, so it can always move", () => {
  assertEquals(scrollbarThumb(10, 11, 0), { start: 0, size: 9 });
  assertEquals(scrollbarThumb(10, 11, 1), { start: 1, size: 9 });
});

Deno.test("the thumb touches the start only at offset 0 and the end only at the last offset", () => {
  const length = 10;
  const total = 100;
  const last = total - length;

  assertEquals(scrollbarThumb(length, total, 0).start, 0);
  assertEquals(scrollbarThumb(length, total, 1).start, 1);
  assertEquals(scrollbarThumb(length, total, last).start, length - 1);
  assertEquals(scrollbarThumb(length, total, last - 1).start, length - 2);

  for (let offset = 0; offset <= last; offset++) {
    const { start, size } = scrollbarThumb(length, total, offset);

    assertEquals(start + size <= length, true);
    assertEquals(start >= 0, true);
    assertEquals(start + size === length, offset === last);
  }
});

Deno.test("the thumb start grows with the offset and offsets outside the content are clamped", () => {
  let previous = -1;

  for (let offset = 0; offset <= 40; offset++) {
    const { start } = scrollbarThumb(10, 50, offset);

    assertEquals(start >= previous, true);

    previous = start;
  }

  assertEquals(scrollbarThumb(10, 50, -5), scrollbarThumb(10, 50, 0));
  assertEquals(scrollbarThumb(10, 50, 999), scrollbarThumb(10, 50, 40));
});

Deno.test("scrollbarOffset maps thumb positions back to offsets, clamped to the ends", () => {
  assertEquals(scrollbarOffset(10, 100, 0), 0);
  assertEquals(scrollbarOffset(10, 100, 9), 90);
  assertEquals(scrollbarOffset(10, 100, -4), 0);
  assertEquals(scrollbarOffset(10, 100, 50), 90);
  assertEquals(scrollbarOffset(10, 100, 4), 40);
  assertEquals(scrollbarOffset(10, 10, 3), 0);
  assertEquals(scrollbarOffset(1, 10, 0), 0);
});

Deno.test("renderScrollbar draws one cell per position with the thumb at its place", () => {
  const cells = (offset: number) =>
    renderScrollbar(5, 10, offset).map(strip).join("");

  assertEquals(cells(0), "┃┃┃││");
  assertEquals(cells(5), "││┃┃┃");
  assertEquals(renderScrollbar(5, 10, 0).length, 5);
});

Deno.test("renderScrollbar draws only the track when nothing scrolls, and nothing for no length", () => {
  assertEquals(renderScrollbar(4, 3, 0).map(strip).join(""), "││││");
  assertEquals(renderScrollbar(0, 30, 0), []);
});

Deno.test("renderScrollbar glyph sets work for either orientation, ASCII included", () => {
  const horizontal = renderScrollbar(8, 16, 4, {
    glyphs: SCROLLBAR_GLYPHS.horizontal,
  }).map(strip).join("");
  const ascii = renderScrollbar(6, 12, 0, { glyphs: SCROLLBAR_GLYPHS.ascii })
    .map(strip).join("");
  const block = renderScrollbar(4, 8, 4, { glyphs: SCROLLBAR_GLYPHS.block })
    .map(strip).join("");

  assertEquals(horizontal, "──━━━━──");
  assertEquals(ascii, "###|||");
  assertEquals(block, "░░██");
  assertEquals(visibleWidth(horizontal), 8);
});

Deno.test("renderScrollbar paints track and thumb, and the active thumb on top of its paint", () => {
  const theme = {
    track: { fg: "#101010" as const },
    thumb: { fg: "#ff0000" as const },
    thumbActive: { fg: "#00ff00" as const, bold: true },
  };
  const plain = renderScrollbar(3, 9, 0, { theme });
  const active = renderScrollbar(3, 9, 0, { theme, active: true });

  assertEquals(plain[0].includes("38;2;255;0;0"), true);
  assertEquals(plain[2].includes("38;2;16;16;16"), true);
  assertEquals(active[0].includes("38;2;0;255;0"), true);
  assertEquals(active[0].includes("38;2;255;0;0"), false);
  assertEquals(active[2], plain[2]);
});

Deno.test("renderScrollbar keeps the default paint of every theme key that is not set", () => {
  const bar = renderScrollbar(3, 9, 0, { theme: { thumb: { fg: "#ff0000" } } });

  assertEquals(bar[0].includes("38;2;255;0;0"), true);
  assertEquals(bar[2].includes("38;2;92;99;112"), true);
});
