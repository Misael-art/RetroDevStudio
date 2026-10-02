import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Execute the real Node harness. Vite's browser transform cannot load its
// shebang or Node-only modules; no copy of the gate is used by this probe.
function isCurrentBuildFrame(frame, sha, previous) {
  const source = `const { isCurrentBuildFrame } = await import(${JSON.stringify(pathToFileURL(path.resolve("scripts/e2e-tauri-build-run.mjs")).href)});
    console.log(JSON.stringify(isCurrentBuildFrame(${JSON.stringify(frame)}, ${JSON.stringify(sha)}, ${JSON.stringify(previous)})));`;
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8" }));
}

const expectedSha = "a".repeat(64);
const previousSession = "joypad-session-1";
const ready = {
  non_black_pixels: 71680,
  rom_sha256: expectedSha,
  rendered_frames: 10,
  input_session_id: "joypad-session-2",
  input_hold: false,
};

describe("Build & Run framebuffer identity", () => {
  it("rejects the previous non-black ROM even after the build completion log", () => {
    const stale = { ...ready, rom_sha256: "b".repeat(64), input_session_id: previousSession, rendered_frames: 400 };
    // This is the old collector's complete acceptance condition.
    expect(stale.non_black_pixels > 0).toBe(true);
    expect(isCurrentBuildFrame(stale, expectedSha, previousSession)).toBe(false);
  });

  it("requires a new load even when the rebuilt ROM has the same hash", () => {
    expect(isCurrentBuildFrame({ ...ready, input_session_id: previousSession }, expectedSha, previousSession)).toBe(false);
    expect(isCurrentBuildFrame(ready, expectedSha, previousSession)).toBe(true);
  });

  it("accepts only after load and boot have finished, without depending on elapsed time", () => {
    const observations = [
      { ...ready, input_session_id: previousSession, rendered_frames: 400 },
      { ...ready, input_hold: true, rendered_frames: 400 },
      { ...ready, non_black_pixels: 689, rendered_frames: 0 },
      { ...ready, rendered_frames: 9 },
      ready,
    ];
    expect(observations.map((frame) => isCurrentBuildFrame(frame, expectedSha, previousSession)))
      .toEqual([false, false, false, false, true]);
  });

  it("refuses missing identity and a black frame", () => {
    for (const frame of [null, { ...ready, rom_sha256: "" }, { ...ready, input_session_id: null },
      { ...ready, rendered_frames: Number.NaN }, { ...ready, non_black_pixels: 0 }]) {
      expect(isCurrentBuildFrame(frame, expectedSha, previousSession)).toBe(false);
    }
  });
});
