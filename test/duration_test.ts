import { assertEquals, assertThrows } from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { Duration, ROLL_GLYPHS } from "../mod.ts";

// deno-lint-ignore no-control-regex
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

function counter() {
  const host = { renders: 0, requestRender: () => host.renders++ };

  return host;
}

/** The row after each of `steps` milliseconds. */
function frames(time: FakeTime, duration: Duration, steps: number[]): string[] {
  return steps.map((ms) => {
    time.tick(ms);

    return strip(duration.render(40)[0]);
  });
}

Deno.test("Duration rolls changed digits upward: the old leaves as superscript, the new arrives as subscript", () => {
  using time = new FakeTime(0);
  const duration = new Duration(counter(), { clock: () => time.now });

  duration.setValue(58_000);
  duration.start();
  time.tick(1000);

  assertEquals(strip(duration.render(40)[0]), "5⁸s");
  assertEquals(frames(time, duration, [70, 70]), ["5₉s", "59s"]);
  // 59s -> 1m 00s: the minutes roll in from nothing, both second digits roll.
  time.tick(860);
  assertEquals(strip(duration.render(40)[0]), " m ⁵⁹s");
  assertEquals(frames(time, duration, [70, 70]), ["₁m ₀₀s", "1m 00s"]);
});

Deno.test("Duration formats units, padding, labels and separators", () => {
  using time = new FakeTime(0);
  const make = (options: ConstructorParameters<typeof Duration>[1]) => {
    const duration = new Duration(counter(), {
      clock: () => time.now,
      ...options,
    });

    duration.setValue(3_723_000);

    time.tick(1000);

    return strip(duration.render(40)[0]);
  };

  assertEquals(make({}), "1h 02m 03s");
  assertEquals(make({ units: ["m", "s"] }), "62m 03s");
  assertEquals(make({ units: ["s", "h"] }), "1h 123s");
  assertEquals(
    make({
      labels: { h: " hr", m: " min", s: " sec" },
      separator: ", ",
      padLeading: true,
    }),
    "01 hr, 02 min, 03 sec",
  );
  assertEquals(make({ units: ["d", "h", "m"], minParts: 3 }), "0d 01h 02m");
  assertEquals(make({ units: ["d", "h", "m"], minParts: 2 }), "1h 02m");
  assertThrows(() => new Duration(counter(), { units: [] }));
});

Deno.test("Duration keeps zero leading parts only up to minParts", () => {
  using time = new FakeTime(0);
  const short = new Duration(counter(), { clock: () => time.now });
  const long = new Duration(counter(), { clock: () => time.now, minParts: 2 });

  assertEquals(strip(short.render(40)[0]), "0s");
  assertEquals(strip(long.render(40)[0]), "0m 00s");
});

Deno.test("Duration counts down, shows zero only at the end, calls onDone once and leaves no timer", () => {
  using time = new FakeTime(0);
  const host = counter();
  let done = 0;
  const duration = new Duration(host, {
    countdown: 2500,
    onDone: () => done++,
    roll: ROLL_GLYPHS.none,
    clock: () => time.now,
  });

  assertEquals(strip(duration.render(40)[0]), "3s");
  duration.start();
  assertEquals(frames(time, duration, [499, 2, 998, 2, 998]), [
    "3s",
    "2s",
    "2s",
    "1s",
    "1s",
  ]);
  time.tick(1);
  assertEquals(strip(duration.render(40)[0]), "0s");
  assertEquals([done, duration.running, duration.value], [1, false, 0]);

  const renders = host.renders;

  time.tick(10_000);
  duration.start();
  assertEquals([host.renders, done], [renders, 1]);
});

Deno.test("Duration pauses, resumes and resets without leaving timers", () => {
  using time = new FakeTime(0);
  const host = counter();
  const duration = new Duration(host, {
    roll: ROLL_GLYPHS.none,
    clock: () => time.now,
  });

  duration.start();
  time.tick(2500);
  duration.pause();

  const renders = host.renders;

  time.tick(60_000);
  assertEquals([host.renders, duration.value, duration.running], [
    renders,
    2500,
    false,
  ]);
  duration.start();
  time.tick(600);
  assertEquals(strip(duration.render(40)[0]), "3s");
  duration.reset();
  assertEquals([
    duration.value,
    duration.running,
    strip(duration.render(40)[0]),
  ], [0, false, "0s"]);
});

Deno.test("Duration paints digits, units and the rolling frames from its theme", () => {
  using time = new FakeTime(0);
  const duration = new Duration(counter(), {
    roll: ROLL_GLYPHS.fade,
    theme: {
      digits: { bold: true },
      units: { fg: "#5c6370" },
      leaving: { fg: "#e05050" },
      entering: { fg: "#50c050" },
    },
    clock: () => time.now,
  });

  duration.start();
  time.tick(1000);
  assertEquals(duration.render(40), [
    "\x1b[38;2;224;80;80m0\x1b[39m\x1b[38;2;92;99;112ms\x1b[39m",
  ]);
  time.tick(70);
  assertEquals(duration.render(40), [
    "\x1b[38;2;80;192;80m1\x1b[39m\x1b[38;2;92;99;112ms\x1b[39m",
  ]);
  time.tick(70);
  assertEquals(duration.render(40), [
    "\x1b[1m1\x1b[22m\x1b[38;2;92;99;112ms\x1b[39m",
  ]);
  // Narrow rows are cut, never wider than the width.
  assertEquals(strip(duration.render(1)[0]), "…");
  duration.pause();
});
