import { describe, expect, it } from "vitest";
import type { AnimationDef } from "./ipc/sceneService";
import { describeTicks, isMugenAnimation, parseTicks, withFrameDuration } from "./mugenAnimationTiming";

const mugen: AnimationDef = {
  frames: [0, 1],
  fps: 4,
  loop: true,
  frame_durations: [5, 9],
  loop_start: 0,
  mugen_frames: [
    { group: 0, image: 0, duration: 5 },
    { group: 0, image: 1, duration: 9 },
  ],
};

describe("mugenAnimationTiming", () => {
  it("accepts -1 and 1..255 and refuses everything else with a reason", () => {
    expect(parseTicks("20")).toEqual({ ok: true, value: 20 });
    expect(parseTicks(" -1 ")).toEqual({ ok: true, value: -1 });
    expect(parseTicks("255")).toEqual({ ok: true, value: 255 });
    for (const bad of ["", "0", "256", "-2", "1.5", "abc", "1e2"]) {
      const parsed = parseTicks(bad);
      expect(parsed.ok, bad).toBe(false);
      if (!parsed.ok) expect(parsed.message.length).toBeGreaterThan(10);
    }
  });

  it("changes one frame in both model fields and leaves the others untouched", () => {
    const edited = withFrameDuration(mugen, 0, 20);
    expect(edited.frame_durations).toEqual([20, 9]);
    expect(edited.mugen_frames?.map((f) => f.duration)).toEqual([20, 9]);
    expect(mugen.frame_durations).toEqual([5, 9]);
    expect(edited.fps).toBe(4);
  });

  it("tells MUGEN animations from native ones", () => {
    expect(isMugenAnimation(mugen)).toBe(true);
    expect(isMugenAnimation({ frames: [0, 1], fps: 8, loop: true })).toBe(false);
    expect(isMugenAnimation({ ...mugen, frame_durations: [5] })).toBe(false);
  });

  it("states the unit when describing a duration", () => {
    expect(describeTicks(30)).toBe("30 ticks = 0,500 s");
    expect(describeTicks(1)).toBe("1 tick = 0,017 s");
    expect(describeTicks(-1)).toContain("parado");
  });
});
