import { assert, assertEquals } from "@std/assert";
import { Markdown, MARKDOWN_GLYPHS } from "../src/components/markdown.ts";
import { tokenize, visibleWidth } from "../src/width.ts";

function strip(row: string): string {
  return tokenize(row).map((t) => t.kind === "text" ? t.value : "").join("");
}

function render(text: string, width: number): string[] {
  return new Markdown(text).render(width).map(strip);
}

Deno.test("heading and paragraph wrapping", () => {
  assertEquals(
    render("## Title\n\nthe quick brown fox jumps over the lazy dog", 16),
    ["## Title", "", "the quick brown", "fox jumps over", "the lazy dog"],
  );
});

Deno.test("distinct heading levels", () => {
  const [h1, , h2] = new Markdown("# One\n\n## Two").render(40);

  assert(h1 !== h2);
  assertEquals(strip(h1), "# One");
  assertEquals(strip(h2), "## Two");
});

Deno.test("code block keeps indentation, blank lines and hard-wraps", () => {
  const code =
    "```ts\nfunction f() {\n    return 1;\n\n}\nconst long = 'abcdefghijklmnop';\n```";

  assertEquals(render(code, 12), [
    "┌─ ts",
    "│ function f",
    "│ () {",
    "│     return",
    "│  1;",
    "│ ",
    "│ }",
    "│ const long",
    "│  = 'abcdef",
    "│ ghijklmnop",
    "│ ';",
    "└─",
  ]);
});

Deno.test("highlightCode output is used per line", () => {
  const md = new Markdown("```js\nlet a\nlet b\n```", {
    highlightCode: (code) =>
      code.split("\n").map((l) => `\x1b[35m${l}\x1b[39m`),
  });
  const rows = md.render(20);

  assert(rows[1].includes("\x1b[35mlet a"));
  assertEquals(rows.map(strip), ["┌─ js", "│ let a", "│ let b", "└─"]);
});

Deno.test("nested lists align continuation rows under item text", () => {
  const text =
    "- first item is rather long indeed\n  - nested one that wraps too\n- [x] done\n- [ ] todo\n\n3. three\n4. four";

  assertEquals(render(text, 20), [
    "• first item is",
    "  rather long indeed",
    "  • nested one that",
    "    wraps too",
    "• [x] done",
    "• [ ] todo",
    "",
    "3. three",
    "4. four",
  ]);
});

Deno.test("loose task items show one checkbox", () => {
  assertEquals(render("- [ ] x\n\n  more\n\n- [x] y", 20), [
    "• [ ] x",
    "",
    "      more",
    "",
    "• [x] y",
  ]);
});

Deno.test("ordered list continuation aligns under text", () => {
  assertEquals(
    render("9. alpha beta gamma\n10. delta epsilon zeta", 14),
    [" 9. alpha beta", "    gamma", "10. delta", "    epsilon", "    zeta"],
  );
});

Deno.test("blockquote prefixes every wrapped row and nests blocks", () => {
  assertEquals(
    render("> alpha beta gamma delta\n>\n> - item\n>\n> > inner", 12),
    ["│ alpha beta", "│ gamma", "│ delta", "│ ", "│ • item", "│ ", "│ │ inner"],
  );
});

Deno.test("table fits narrow width and honors alignment", () => {
  const text = "| name | qty |\n|:--|--:|\n| apple pie | 3 |\n| fig | 12 |";

  assertEquals(render(text, 40), [
    "┌───────────┬─────┐",
    "│ name      │ qty │",
    "├───────────┼─────┤",
    "│ apple pie │   3 │",
    "│ fig       │  12 │",
    "└───────────┴─────┘",
  ]);
  assertEquals(render(text, 16), [
    "┌────────┬─────┐",
    "│ name   │ qty │",
    "├────────┼─────┤",
    "│ apple  │   3 │",
    "│ pie    │     │",
    "│ fig    │  12 │",
    "└────────┴─────┘",
  ]);
});

Deno.test("link emits OSC 8 and appends the url when text differs", () => {
  const [row] = new Markdown("see [docs](https://x.dev/a) now").render(60);

  assert(row.includes("\x1b]8;;https://x.dev/a\x07"));
  assert(row.includes("\x1b]8;;\x07"));
  assertEquals(strip(row), "see docs (https://x.dev/a) now");

  const [bare] = new Markdown("[https://x.dev](https://x.dev)").render(60);

  assertEquals(strip(bare), "https://x.dev");
});

Deno.test("image renders alt text and url", () => {
  assertEquals(render("![logo](a.png)", 40), ["logo (a.png)"]);
});

Deno.test("styles survive wrapping", () => {
  const rows = new Markdown("**bold words that wrap around**").render(10);

  assertEquals(rows.map(strip), ["bold words", "that wrap", "around"]);

  for (const row of rows) {
    assert(row.startsWith("\x1b[1m"), row);
  }
});

Deno.test("unclosed fence and half-written table render", () => {
  assertEquals(render("intro\n\n```py\nprint(1)", 20), [
    "intro",
    "",
    "┌─ py",
    "│ print(1)",
    "└─",
  ]);
  assertEquals(render("| a | b |\n|--", 20), ["| a | b | |--"]);
});

Deno.test("blocks are separated by exactly one blank row", () => {
  assertEquals(render("\n\n# a\n\n\n\npara\n\n---\n\n", 5), [
    "# a",
    "",
    "para",
    "",
    "─────",
  ]);
});

Deno.test("html and entities render as text", () => {
  assertEquals(render("<div>hi</div>\n\nx &amp; y <b>z</b>", 30), [
    "<div>hi</div>",
    "",
    "x & y <b>z</b>",
  ]);
});

Deno.test("same rows are returned until text or width changes", () => {
  const md = new Markdown("hello");
  const first = md.render(20);

  assert(md.render(20) === first);
  md.setText("hello");
  assert(md.render(20) === first);
  md.setText("hello world");
  assert(md.render(20) !== first);
  assert(md.render(10) !== md.render(20));
});

Deno.test("paddingX indents rows and narrows the content", () => {
  assertEquals(
    new Markdown("aaa bbb", { paddingX: 2 }).render(9).map(strip),
    ["  aaa", "  bbb"],
  );
});

const MIXED = `# Heading *one*

## Heading **two** \`code\`

A paragraph with **bold**, *italic*, ~~strike~~, \`inline code\`, a [link](https://example.com/a/very/long/path),
an ![image](https://example.com/i.png), a hard break  
next line and an escaped \\* star &amp; html <span>tag</span>.

> quote line one that is long enough to wrap
> > nested quote

- item one with enough text to wrap around
  - nested item with more words here
    1. deep ordered
- [x] done task
- [ ] open task

1. first

   second paragraph in item
2. second

\`\`\`ts
const veryLongIdentifierName = "a string that is far longer than the width";
\treturn 1;
\`\`\`

    indented code

---

| Name | Description | Value |
|:-----|:-----------:|------:|
| alpha | a fairly long description cell | 1 |
| 日本語 | wide characters | 22 |

<div>raw html block</div>

\`\`\`
unclosed fence`;

Deno.test("every row fits the width for all widths", () => {
  for (let width = 1; width <= 80; width++) {
    const rows = new Markdown(MIXED, { paddingX: 1 }).render(width);

    assert(rows.length > 0);

    for (const row of rows) {
      assert(visibleWidth(row) <= width, `width ${width}: ${strip(row)}`);
      assert(!/[\n\r\t]/.test(row), `width ${width}: control character`);
    }
  }
});

Deno.test("glyphs, labels and block gap replace the defaults", () => {
  const md = new Markdown("# T\n\n- a\n\n> q\n\n---\n\n[x](https://a.b)", {
    glyphs: MARKDOWN_GLYPHS.ascii,
    labels: { linkUrl: (href) => ` <${href}>` },
    blockGap: 0,
  });

  assertEquals(md.render(40).map(strip), [
    "# T",
    "* a",
    "| q",
    "-".repeat(40),
    "x <https://a.b>",
  ]);
});

Deno.test("theme paints reach the output and setTheme changes the next render", () => {
  const md = new Markdown("- a", { theme: { listBullet: { fg: "red" } } });

  assert(md.render(20)[0].startsWith("\x1b[31m•\x1b[39m"), md.render(20)[0]);

  md.setTheme({ listBullet: { fg: "green" } });

  assert(md.render(20)[0].startsWith("\x1b[32m•\x1b[39m"), md.render(20)[0]);
});
