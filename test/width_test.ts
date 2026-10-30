import { assertEquals } from "@std/assert";
import { truncateToWidth, visibleWidth, wrapText } from "../mod.ts";

Deno.test("visibleWidth ignores escapes and counts wide graphemes as two cells", () => {
  assertEquals(visibleWidth("\x1b[31mred\x1b[0m"), 3);
  assertEquals(visibleWidth("中文"), 4);
  assertEquals(visibleWidth("👨‍👩‍👧"), 2);
  assertEquals(visibleWidth("e\u0301"), 1);
  assertEquals(visibleWidth("\x1b]8;;https://x.dev\x07link\x1b]8;;\x07"), 4);
});

Deno.test("pictographs are wide only with emoji presentation", () => {
  // Text-style by default: one cell, as terminals draw them.
  assertEquals(visibleWidth("✳✻❤☀"), 4);
  // VS16 or default emoji presentation: two cells.
  assertEquals(visibleWidth("✳\uFE0F"), 2);
  assertEquals(visibleWidth("❤️"), 2);
  assertEquals(visibleWidth("🙂"), 2);
  assertEquals(visibleWidth("🇩🇪"), 2);
});

Deno.test("truncateToWidth fits wide characters and closes open styles", () => {
  assertEquals(truncateToWidth("hello world", 8), "hello w…");
  assertEquals(truncateToWidth("short", 8), "short");
  // A wide character that would straddle the limit is dropped, not split.
  assertEquals(truncateToWidth("ab中文", 4, ""), "ab中");
  assertEquals(truncateToWidth("abc中", 4, ""), "abc");
  assertEquals(
    truncateToWidth("\x1b[31mhello world", 6),
    "\x1b[31mhello\x1b[0m…",
  );
});

Deno.test("wrapText breaks at spaces, hard-breaks long words, keeps indentation", () => {
  assertEquals(wrapText("the quick brown fox", 10), ["the quick", "brown fox"]);
  assertEquals(wrapText("abcdefghij", 4), ["abcd", "efgh", "ij"]);
  assertEquals(wrapText("a\n\n  b", 10), ["a", "", "  b"]);
  assertEquals(wrapText("one    two", 4), ["one", "two"]);
  assertEquals(wrapText("a\tb", 10), ["a    b"]);
});

Deno.test("wrapText reopens styles and hyperlinks on continuation lines", () => {
  assertEquals(wrapText("\x1b[1;31maaa bbb\x1b[0m ccc", 4), [
    "\x1b[1;31maaa\x1b[0m",
    "\x1b[1;31mbbb\x1b[0m",
    "ccc",
  ]);

  const link = "\x1b]8;;https://x.dev\x07";

  assertEquals(wrapText(`${link}aaa bbb\x1b]8;;\x07`, 3), [
    `${link}aaa\x1b]8;;\x07`,
    `${link}bbb\x1b]8;;\x07`,
  ]);

  for (const line of wrapText("\x1b[32m" + "word ".repeat(20), 7)) {
    assertEquals(visibleWidth(line) <= 7, true);
  }
});
