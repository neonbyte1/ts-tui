import { assertEquals } from "@std/assert";
import {
  bindKeys,
  encodeMouse,
  InputParser,
  matchesKey,
  type ParsedInput,
  parseKey,
} from "../mod.ts";

type ParsedEvent = ParsedInput;

function collect(): { events: ParsedEvent[]; parser: InputParser } {
  const events: ParsedEvent[] = [];

  return { events, parser: new InputParser((e) => events.push(e)) };
}

function names(events: ParsedEvent[]): string[] {
  return events.map((e) => {
    if (e.type === "paste") {
      return `paste:${e.text}`;
    }

    if (e.type === "report") {
      return `report:${JSON.stringify(e.sequence)}`;
    }

    if (e.type === "mouse") {
      const mods = [e.ctrl && "ctrl", e.alt && "alt", e.shift && "shift"]
        .filter(Boolean).map((m) => `+${m}`).join("");

      return `mouse:${e.action}:${
        e.direction ?? e.button
      }@${e.x},${e.y}${mods}`;
    }

    const mods = [
      e.key.ctrl && "ctrl",
      e.key.alt && "alt",
      e.key.shift && "shift",
    ].filter(Boolean);

    return [...mods, e.key.name].join("+");
  });
}

Deno.test("parseKey decodes control, CSI, SS3, modifier, and alt sequences", () => {
  const cases: [string, string][] = [
    ["\r", "enter"],
    ["\x03", "ctrl+c"],
    ["\x7f", "backspace"],
    ["\x1b\x7f", "alt+backspace"],
    ["\x1b[A", "up"],
    ["\x1bOB", "down"],
    ["\x1b[1;5C", "ctrl+right"],
    ["\x1b[1;3D", "alt+left"],
    ["\x1b[3~", "delete"],
    ["\x1b[5;2~", "shift+pageup"],
    ["\x1b[Z", "shift+tab"],
    ["\x1b[13;2u", "shift+enter"],
    ["\x1b[27;5;13~", "ctrl+enter"],
    ["\x1bf", "alt+f"],
    // kitty keyboard protocol: CSI codepoint[:alternates] ; modifiers[:event] u
    ["\x1b[99;5u", "ctrl+c"],
    ["\x1b[27u", "escape"],
    ["\x1b[97:65;2u", "shift+a"],
    ["\x1b[13;2:1u", "shift+enter"],
    ["\x1b[57414u", "enter"],
    ["\x1b[99;133u", "ctrl+c"], // ctrl with num lock: lock bits are ignored
  ];

  for (const [sequence, spec] of cases) {
    assertEquals(
      matchesKey(parseKey(sequence), spec),
      true,
      `${JSON.stringify(sequence)} → ${spec}`,
    );
  }

  assertEquals(parseKey("é").text, "é");
  assertEquals(parseKey("\x1bf").text, undefined);
  assertEquals(parseKey("\x1b[97:65;2u").text, "A");
  assertEquals(parseKey("\x1b[57401u").text, "2", "keypad digit inserts text");
  assertEquals(
    parseKey("\x1b[57441u").text,
    undefined,
    "bare modifier key inserts nothing",
  );
});

Deno.test("InputParser splits a chunk holding several keys and multi-byte text", () => {
  const { events, parser } = collect();

  parser.feed("a\x1b[A😀\x03\x1b[1;5D");
  assertEquals(names(events), ["a", "up", "😀", "ctrl+c", "ctrl+left"]);
});

Deno.test("InputParser holds a sequence split across chunks", () => {
  const { events, parser } = collect();

  parser.feed("\x1b[1;");
  assertEquals(events.length, 0);
  assertEquals(parser.pending, true);
  parser.feed("5C");
  assertEquals(names(events), ["ctrl+right"]);
  assertEquals(parser.pending, false);
});

Deno.test("InputParser delivers a lone Escape only on flush", () => {
  const { events, parser } = collect();

  parser.feed("\x1b");
  assertEquals(events.length, 0);
  parser.flush();
  assertEquals(names(events), ["escape"]);
});

Deno.test("InputParser emits bracketed paste as one event, even when the end marker is split", () => {
  const { events, parser } = collect();

  parser.feed("x\x1b[200~line 1\nline \x1b[A2\x1b[20");
  assertEquals(names(events), ["x"]);
  parser.feed("1~y");
  assertEquals(names(events), ["x", "paste:line 1\nline \x1b[A2", "y"]);
});

Deno.test("InputParser routes terminal replies to reports, not keys", () => {
  const { events, parser } = collect();

  parser.feed("a\x1b[?1u\x1b_Gi=31;OK\x1b\\\x1bP>|kitty(0.40)\x1b\\");
  parser.feed("\x1b[6;20;10t\x1b[?62;22c\x1b[1;5C");
  assertEquals(names(events), [
    "a",
    'report:"\\u001b[?1u"',
    'report:"\\u001b_Gi=31;OK\\u001b\\\\"',
    'report:"\\u001bP>|kitty(0.40)\\u001b\\\\"',
    'report:"\\u001b[6;20;10t"',
    'report:"\\u001b[?62;22c"',
    "ctrl+right",
  ]);
});

Deno.test("InputParser decodes SGR mouse reports, split or not, and keeps keys around them", () => {
  const { events, parser } = collect();

  parser.feed("a\x1b[<0;10;5M\x1b[<32;11;5M\x1b[<0;11;5m\x1b[<");
  parser.feed("2;1;1M\x1b[<35;4;2M\x1b[<65;3;2M\x1b[<70;3;2M\x1b[<18;1;1Mb");
  assertEquals(names(events), [
    "a",
    "mouse:press:left@9,4",
    "mouse:drag:left@10,4",
    "mouse:release:left@10,4",
    "mouse:press:right@0,0",
    "mouse:move:none@3,1",
    "mouse:wheel:down@2,1",
    "mouse:wheel:left@2,1+shift",
    "mouse:press:right@0,0+ctrl",
    "b",
  ]);
});

Deno.test("InputParser decodes X10 mouse reports without leaking their bytes as text", () => {
  const { events, parser } = collect();

  // Button 0 at column 1, row 1 is " !!"; release is button 3 ("#").
  parser.feed("\x1b[M !!\x1b[M#*");
  assertEquals(names(events), ["mouse:press:left@0,0"]);
  parser.feed("+");
  assertEquals(names(events), [
    "mouse:press:left@0,0",
    "mouse:release:none@9,10",
  ]);
});

Deno.test("encodeMouse produces reports the parser decodes back", () => {
  const { events, parser } = collect();

  parser.feed(encodeMouse({ action: "press", x: 4, y: 2, alt: true }));
  parser.feed(encodeMouse({ action: "drag", button: "middle", x: 5, y: 2 }));
  parser.feed(encodeMouse({ action: "release", x: 5, y: 2 }));
  parser.feed(encodeMouse({ action: "move", x: 0, y: 0 }));
  parser.feed(encodeMouse({ action: "wheel", direction: "up", x: 1, y: 1 }));
  assertEquals(names(events), [
    "mouse:press:left@4,2+alt",
    "mouse:drag:middle@5,2",
    "mouse:release:left@5,2",
    "mouse:move:none@0,0",
    "mouse:wheel:up@1,1",
  ]);
});

Deno.test("bindKeys replaces the default list per action and keeps it for undefined entries", () => {
  const defaults = { submit: ["enter"], cancel: ["escape"], next: ["tab"] };

  assertEquals(
    bindKeys(defaults, { submit: ["ctrl+enter"], cancel: undefined, next: [] }),
    { submit: ["ctrl+enter"], cancel: ["escape"], next: [] },
  );
  assertEquals(bindKeys(defaults, undefined), defaults);
});
