import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { visibleWidth } from "../mod.ts";
import { IMAGE_RESERVED } from "../src/ansi.ts";
import { terminalInfo } from "../src/capabilities.ts";
import { Image } from "../src/components/image.ts";
import { readImageInfo } from "../src/image-format.ts";

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

function u32be(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

function u16be(n: number): number[] {
  return [(n >>> 8) & 255, n & 255];
}

function u16le(n: number): number[] {
  return [n & 255, (n >>> 8) & 255];
}

function u24le(n: number): number[] {
  return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255];
}

function u32le(n: number): number[] {
  return [...u24le(n), (n >>> 24) & 255];
}

function png(w: number, h: number, padding = 0): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...u32be(13),
    ...ascii("IHDR"),
    ...u32be(w),
    ...u32be(h),
    8,
    6,
    0,
    0,
    0,
    ...Array.from({ length: padding }, (_, i) => i & 255),
  ]);
}

function jpeg(w: number, h: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    ...u16be(6),
    0x4a,
    0x46,
    0x49,
    0x46, // APP0 payload (4 bytes)
    0xff,
    0xff, // fill bytes before the next marker
    0xff,
    0xc4,
    ...u16be(4),
    0,
    0, // DHT must be skipped, not read as SOF
    0xff,
    0xc0,
    ...u16be(11),
    8,
    ...u16be(h),
    ...u16be(w),
    1,
    1,
    0x11,
    0,
  ]);
}

function gif(w: number, h: number): Uint8Array {
  return new Uint8Array([
    ...ascii("GIF89a"),
    ...u16le(w),
    ...u16le(h),
    0,
    0,
    0,
  ]);
}

function webp(chunk: "VP8 " | "VP8L" | "VP8X", w: number, h: number) {
  let payload: number[];

  if (chunk === "VP8 ") {
    payload = [0, 0, 0, 0x9d, 0x01, 0x2a, ...u16le(w), ...u16le(h)];
  } else if (chunk === "VP8L") {
    payload = [0x2f, ...u32le(((w - 1) | ((h - 1) << 14)) >>> 0)];
  } else {
    payload = [0, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1)];
  }

  return new Uint8Array([
    ...ascii("RIFF"),
    ...u32le(4 + 8 + payload.length),
    ...ascii("WEBP"),
    ...ascii(chunk),
    ...u32le(payload.length),
    ...payload,
  ]);
}

async function withTerminal(
  info: Partial<typeof terminalInfo>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const saved = { ...terminalInfo };

  Object.assign(terminalInfo, { cellWidthPx: 10, cellHeightPx: 20 }, info);

  try {
    await fn();
  } finally {
    Object.assign(terminalInfo, saved);
  }
}

interface KittyChunk {
  control: string;
  payload: string;
}

function kittyChunks(row: string): KittyChunk[] {
  return row.split("\x1b\\").filter((part) => part !== "").map((part) => {
    assert(part.startsWith("\x1b_G"), "kitty APC prefix");

    const body = part.slice(3);
    const semicolon = body.indexOf(";");

    return {
      control: body.slice(0, semicolon),
      payload: body.slice(semicolon + 1),
    };
  });
}

Deno.test("readImageInfo reads PNG, JPEG, GIF and WebP dimensions", () => {
  assertEquals(readImageInfo(png(640, 480)), {
    format: "png",
    widthPx: 640,
    heightPx: 480,
  });
  assertEquals(readImageInfo(jpeg(321, 123)), {
    format: "jpeg",
    widthPx: 321,
    heightPx: 123,
  });
  assertEquals(readImageInfo(gif(50, 70)), {
    format: "gif",
    widthPx: 50,
    heightPx: 70,
  });

  for (const chunk of ["VP8 ", "VP8L", "VP8X"] as const) {
    assertEquals(readImageInfo(webp(chunk, 1234, 567)), {
      format: "webp",
      widthPx: 1234,
      heightPx: 567,
    }, chunk);
  }
});

Deno.test("readImageInfo returns null for truncated or unknown input", () => {
  const samples = [
    png(10, 10),
    jpeg(10, 10),
    gif(10, 10),
    webp("VP8 ", 10, 10),
    webp("VP8L", 10, 10),
    webp("VP8X", 10, 10),
  ];

  for (const bytes of samples) {
    assert(readImageInfo(bytes) !== null);

    for (let n = 0; n < bytes.length; n++) {
      // Truncations either fail or never invent a size; they must not throw.
      const result = readImageInfo(bytes.subarray(0, n));

      assert(n >= 10 || result === null, `${n}-byte prefix`);
    }
  }

  assertEquals(readImageInfo(png(10, 10).subarray(0, 23)), null);
  assertEquals(readImageInfo(jpeg(10, 10).subarray(0, 24)), null);
  assertEquals(readImageInfo(new Uint8Array()), null);
  assertEquals(
    readImageInfo(new TextEncoder().encode("hello world, text")),
    null,
  );
  assertEquals(readImageInfo(png(0, 10)), null);
});

Deno.test("Image draws a PNG with kitty and sizes it from cell metrics", async () => {
  await withTerminal({ imageProtocol: "kitty" }, () => {
    const rows = new Image(png(200, 200)).render(80);

    assertEquals(rows.length, 10);
    assertEquals(rows.slice(1), Array(9).fill(IMAGE_RESERVED));

    const [chunk, ...rest] = kittyChunks(rows[0]);

    assertEquals(rest, []);

    const control = chunk.control.split(",");

    for (const part of ["a=T", "f=100", "t=d", "p=1", "C=1", "q=2", "m=0"]) {
      assert(control.includes(part), part);
    }

    assert(control.some((p) => /^i=\d+$/.test(p)));
    assert(control.includes("c=20"));
    assert(control.includes("r=10"));

    // Narrower terminal: columns shrink and rows follow the aspect ratio.
    const narrow = new Image(png(200, 200)).render(6);

    assertEquals(narrow.length, 3);
    assert(kittyChunks(narrow[0])[0].control.includes("c=6"));

    // maxWidth caps columns; tiny images are not upscaled.
    assert(
      kittyChunks(new Image(png(200, 200), { maxWidth: 10 }).render(80)[0])[0]
        .control.includes("c=10"),
    );

    const small = new Image(png(30, 40)).render(80);

    assertEquals(small.length, 2);
    assert(kittyChunks(small[0])[0].control.includes("c=3"));
  });
});

Deno.test("Image splits large kitty payloads into 4096-char chunks", async () => {
  await withTerminal({ imageProtocol: "kitty" }, () => {
    const bytes = png(200, 200, 6000);
    const [row] = new Image(bytes).render(80).slice(0, 1);
    const chunks = kittyChunks(row);

    assertEquals(chunks.length, 2);
    assert(chunks[0].control.startsWith("a=T,f=100,t=d,i="));
    assert(chunks[0].control.endsWith(",m=1"));
    assertEquals(chunks[1].control, "m=0");
    assertEquals(chunks[0].payload.length, 4096);
    assert(chunks[1].payload.length > 0 && chunks[1].payload.length <= 4096);
    assertEquals(chunks.map((c) => c.payload).join(""), bytes.toBase64());

    const big = png(200, 200, 12000);
    const flags = kittyChunks(new Image(big).render(80)[0]).map((c) =>
      /m=(\d)/.exec(c.control)![1]
    );

    assertEquals(flags, ["1", "1", "1", "0"]);
  });
});

Deno.test("Image instances use distinct kitty ids", async () => {
  await withTerminal({ imageProtocol: "kitty" }, () => {
    const id = (img: Image) =>
      /i=(\d+)/.exec(kittyChunks(img.render(80)[0])[0].control)![1];
    const first = id(new Image(png(10, 10)));
    const second = id(new Image(png(10, 10)));

    assertNotEquals(first, second);
  });
});

Deno.test("Image clamps to maxHeight preserving aspect ratio", async () => {
  await withTerminal({ imageProtocol: "kitty" }, () => {
    const rows = new Image(png(200, 200), { maxHeight: 4 }).render(80);

    assertEquals(rows.length, 4);

    const control = kittyChunks(rows[0])[0].control;

    assert(control.includes("c=8"), control);
    assert(control.includes("r=4"), control);

    const wide = new Image(png(400, 100), { maxHeight: 50 }).render(80);

    assertEquals(wide.length, 5); // 40 cols x 5 rows is under the cap: unchanged
  });
});

Deno.test("Image uses iTerm2 inline images for any format", async () => {
  await withTerminal({ imageProtocol: "iterm2" }, () => {
    for (
      const bytes of [png(200, 200), jpeg(200, 200), webp("VP8X", 200, 200)]
    ) {
      const rows = new Image(bytes).render(80);

      assertEquals(rows.length, 10);
      assertEquals(rows.slice(1), Array(9).fill(IMAGE_RESERVED));
      assertEquals(
        rows[0],
        `\x1b]1337;File=inline=1;size=${bytes.byteLength};width=20;height=10;preserveAspectRatio=0:${bytes.toBase64()}\x07`,
      );
    }
  });
});

Deno.test("Image falls back to a text row when it cannot draw", async () => {
  await withTerminal({ imageProtocol: "kitty" }, () => {
    assertEquals(new Image(jpeg(640, 480)).render(80), [
      "\x1b[2m[image: jpeg 640x480]\x1b[22m",
    ]);
    assertEquals(
      new Image(jpeg(640, 480), {
        alt: "cat",
        theme: { fallback: { fg: "red" } },
      }).render(80),
      ["\x1b[31m[image: cat 640x480]\x1b[39m"],
    );
    assertEquals(
      new Image(jpeg(640, 480), {
        labels: {
          described: (alt, info) => `<${alt} ${info.widthPx}>`,
        },
        theme: { fallback: {} },
      }).render(80),
      ["<jpeg 640>"],
    );
  });
  await withTerminal({ imageProtocol: null }, () => {
    assertEquals(
      new Image(png(10, 20), { theme: { fallback: {} } }).render(80),
      [
        "[image: png 10x20]",
      ],
    );
    assertEquals(
      new Image(new Uint8Array([1, 2, 3]), {
        theme: { fallback: {} },
        labels: { unknown: "[?]" },
      })
        .render(80),
      ["[?]"],
    );
    assertEquals(
      new Image(png(10, 20), { alt: "a\nb", theme: { fallback: {} } }).render(
        80,
      ),
      ["[image: a b 10x20]"],
    );
  });
  await withTerminal({ imageProtocol: "iterm2" }, () => {
    assertEquals(
      new Image(new Uint8Array([1, 2, 3]), { theme: { fallback: {} } })
        .render(80),
      ["[image]"],
    );
  });
});

Deno.test("Image rows never exceed the render width", async () => {
  for (const protocol of ["kitty", "iterm2", null] as const) {
    await withTerminal({ imageProtocol: protocol }, () => {
      for (const bytes of [png(500, 300, 5000), jpeg(500, 300)]) {
        for (const width of [1, 3, 10, 80]) {
          const rows = new Image(bytes, { alt: "a long alternative text" })
            .render(width);

          for (const row of rows) {
            assert(visibleWidth(row) <= width);
          }
        }
      }
    });
  }
});

Deno.test("Image caches rows until width, protocol or cell size change", async () => {
  await withTerminal({ imageProtocol: "kitty" }, () => {
    const image = new Image(png(200, 200));
    const first = image.render(80);

    assert(image.render(80) === first);
    assert(image.render(40) !== first);

    const again = image.render(80);

    terminalInfo.cellWidthPx = 20;

    const resized = image.render(80);

    assert(resized !== again);
    assert(kittyChunks(resized[0])[0].control.includes("c=10"));

    terminalInfo.imageProtocol = null;

    assertEquals(image.render(80).length, 1);
  });
});
