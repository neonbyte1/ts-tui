import { assertEquals, assertThrows } from "@std/assert";
import { mergePaint, paint, paintTransition } from "../mod.ts";

Deno.test("paint encodes every colour form on both layers", () => {
  assertEquals(paint("x", { fg: "red" }), "\x1b[31mx\x1b[39m");
  assertEquals(paint("x", { fg: "gray" }), "\x1b[90mx\x1b[39m");
  assertEquals(paint("x", { bg: "brightWhite" }), "\x1b[107mx\x1b[49m");
  assertEquals(paint("x", { fg: 208 }), "\x1b[38;5;208mx\x1b[39m");
  assertEquals(paint("x", { bg: "#0a0B0c" }), "\x1b[48;2;10;11;12mx\x1b[49m");
  assertEquals(paint("x", { fg: "default" }), "\x1b[39mx\x1b[39m");
  assertEquals(paint("x", undefined), "x");
  assertThrows(() => paint("x", { fg: 256 }), Error, "0-255");
  assertThrows(() => paint("x", { fg: "#abc" }), Error, "#rrggbb");
});

Deno.test("paintTransition emits only changes, re-applying bold/dim after their shared off code", () => {
  assertEquals(paintTransition({ fg: "red" }, { fg: "red" }), "");
  assertEquals(
    paintTransition({ fg: "red", underline: true }, { fg: "red" }),
    "\x1b[24m",
  );
  assertEquals(paintTransition({ bold: true }, { dim: true }), "\x1b[22;2m");
  assertEquals(
    paintTransition({ bold: true, dim: true }, { bold: true }),
    "\x1b[22;1m",
  );
  assertEquals(
    paintTransition({}, { italic: true, inverse: true, strikethrough: true }),
    "\x1b[3;7;9m",
  );
});

Deno.test("mergePaint lets later paints override, except with undefined", () => {
  assertEquals(
    mergePaint({ fg: "red", bg: "blue" }, undefined, {
      fg: undefined,
      bold: true,
    }, {
      bg: 238,
    }),
    { fg: "red", bg: 238, bold: true },
  );
});
