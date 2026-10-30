import { assertEquals } from "@std/assert";
import { Loader } from "../src/components/loader.ts";

Deno.test("Loader paints spinner and message and joins them with the separator", () => {
  let renders = 0;
  const host = {
    requestRender: () => {
      renders++;
    },
  };
  const loader = new Loader(host, "wait", {
    frames: ["*"],
    separator: " - ",
    theme: { spinner: { fg: "red" }, message: { dim: true } },
  });

  assertEquals(loader.render(20), ["\x1b[31m*\x1b[39m - \x1b[2mwait\x1b[22m"]);

  loader.setTheme({ spinner: { fg: "green" } });

  assertEquals(renders, 1);
  assertEquals(loader.render(20), ["\x1b[32m*\x1b[39m - \x1b[2mwait\x1b[22m"]);
});
