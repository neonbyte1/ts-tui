import { assertEquals } from "@std/assert";
import { Editor, InputParser, TextField } from "../mod.ts";

const CTRL_LEFT = "\x1b[1;5D";
const CTRL_RIGHT = "\x1b[1;5C";
const CTRL_W = "\x17";
const ALT_BACKSPACE = "\x1b\x7f";

function typer(target: TextField | Editor): (input: string) => void {
  const parser = new InputParser((event) => {
    if (event.type === "key" || event.type === "paste") {
      target.handleInput(event);
    }
  });

  return (input) => parser.feed(input);
}

for (
  const [name, create, read] of [
    [
      "TextField",
      () => new TextField(),
      (c: TextField | Editor) => (c as TextField).value,
    ],
    [
      "Editor",
      () => new Editor(),
      (c: TextField | Editor) => (c as Editor).text,
    ],
  ] as const
) {
  Deno.test(`${name}: ctrl+left/right stop at each path segment`, () => {
    const component = create();
    const type = typer(component);

    type("cd /var/www/data");
    type(`${CTRL_LEFT}|`);
    assertEquals(read(component), "cd /var/www/|data");
    type(`\x7f${CTRL_LEFT}|`);
    assertEquals(read(component), "cd /var/|www/data");
    type(`\x7f${CTRL_LEFT}|`);
    assertEquals(read(component), "cd /|var/www/data");
    type(`\x7f${CTRL_LEFT}${CTRL_LEFT}|`);
    assertEquals(read(component), "|cd /var/www/data");
    type(`\x7f${CTRL_RIGHT}${CTRL_RIGHT}|`);
    assertEquals(read(component), "cd /var|/www/data");
  });

  Deno.test(`${name}: alt+backspace deletes one segment, ctrl+w the whole path`, () => {
    const component = create();
    const type = typer(component);

    type(`ls /var/www/data${ALT_BACKSPACE}`);
    assertEquals(read(component), "ls /var/www/");
    type(CTRL_W);
    assertEquals(read(component), "ls ");
  });
}

Deno.test("word motion never splits surrogate pairs", () => {
  const input = new TextField();
  const type = typer(input);

  type(`𝒜𝒷𝒸/data${CTRL_LEFT}${CTRL_LEFT}|`);
  assertEquals(input.value, "|𝒜𝒷𝒸/data");
});
