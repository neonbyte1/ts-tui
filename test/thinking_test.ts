import { assertEquals } from "@std/assert";
import { Thinking } from "../mod.ts";

const host = { requestRender() {} };
// deno-lint-ignore no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

Deno.test("Thinking draws its first glyph and text while stopped", () => {
  const thinking = new Thinking(host);

  assertEquals(thinking.render(40).map(strip), ["· Thinking…"]);

  // Glyphs are padded to the widest frame so the text never shifts.
  const wide = new Thinking(host, "Hi", { frames: ["*", "中"] });

  assertEquals(wide.render(40).map(strip), ["*  Hi"]);
});

Deno.test("Thinking rotates messages and reports elapsed time while started", () => {
  let now = 0;
  const thinking = new Thinking(host, "unused", {
    messages: ["Thinking…", "Pondering…"],
    rotateMs: 1000,
    detail: (s) => `(${Math.floor(s)}s · esc to interrupt)`,
    clock: () => now,
  });

  thinking.start();

  try {
    assertEquals(thinking.render(60).map(strip), [
      "· Thinking… (0s · esc to interrupt)",
    ]);

    now = 1500;

    assertEquals(thinking.render(60).map(strip), [
      "· Pondering… (1s · esc to interrupt)",
    ]);

    now = 2100;

    assertEquals(
      thinking.render(60).map(strip)[0].startsWith("· Thinking…"),
      true,
    );
  } finally {
    thinking.stop();
  }

  assertEquals(thinking.elapsed, 0);
});

Deno.test("Thinking drops the detail before shortening the message", () => {
  const thinking = new Thinking(host, "Thinking hard…", {
    detail: () => "(12s)",
  });

  assertEquals(thinking.render(30).map(strip), ["· Thinking hard… (12s)"]);
  // 16 cells: the whole message fits only without the detail.
  assertEquals(thinking.render(16).map(strip), ["· Thinking hard…"]);
  assertEquals(thinking.render(8).map(strip), ["· Think…"]);
});

Deno.test("Thinking without shimmer draws the text in one base colour", () => {
  const thinking = new Thinking(host, "abc", {
    shimmer: false,
    theme: { glyph: {}, text: { base: "#102030" } },
  });

  thinking.start();

  try {
    assertEquals(thinking.render(20), ["· \x1b[38;2;16;32;48mabc\x1b[39m"]);
  } finally {
    thinking.stop();
  }
});

Deno.test("Thinking theme paints reach the output and setTheme changes the next render", () => {
  const renders: string[] = [];
  const thinking = new Thinking(
    { requestRender: () => renders.push("render") },
    "abc",
    {
      shimmer: false,
      theme: { glyph: { bold: true }, text: { base: "#102030" } },
      detail: () => "(1s)",
      gap: 2,
    },
  );

  assertEquals(thinking.render(30), [
    "\x1b[1m·\x1b[22m  \x1b[38;2;16;32;48mabc\x1b[39m  \x1b[38;2;92;99;112m(1s)\x1b[39m",
  ]);

  thinking.setTheme({ detail: { italic: true } });

  assertEquals(renders, ["render"]);
  assertEquals(thinking.render(30)[0].endsWith("\x1b[3m(1s)\x1b[23m"), true);
});

Deno.test("Thinking ends a cut message with its own ellipsis", () => {
  const thinking = new Thinking(host, "Thinking hard", { ellipsis: "~" });

  assertEquals(thinking.render(8).map(strip), ["· Think~"]);
});
