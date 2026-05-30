import { describe, expect, it } from "vitest";

import {
  UI_LAYOUT_ORACLE_RESOLUTIONS,
  UI_LAYOUT_ORACLE_TARGETS,
  buildUiLayoutOracleReport,
  evaluateUiLayoutOracleSnapshot,
} from "./ui-layout-oracle.mjs";

function rect(left, top, width, height) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

describe("ui layout oracle", () => {
  it("covers the required QA resolutions and reusable visual targets", () => {
    expect(UI_LAYOUT_ORACLE_RESOLUTIONS.map((item) => item.tag)).toEqual([
      "1366x768",
      "1600x900",
      "1920x1080",
      "2560x1080",
    ]);

    expect(UI_LAYOUT_ORACLE_TARGETS.map((item) => item.id)).toEqual([
      "import-wizard",
      "scene",
      "art",
      "logic",
      "nodegraph",
      "game",
      "debug",
      "runtime-setup",
    ]);
  });

  it("detects overlap, offscreen clickables, clipped text, bad canvas space and forbidden horizontal scroll", () => {
    const result = evaluateUiLayoutOracleSnapshot({
      targetId: "nodegraph",
      workspaceId: "logic",
      resolutionTag: "1366x768",
      viewport: { width: 1366, height: 768 },
      document: { clientWidth: 1366, scrollWidth: 1410 },
      elements: {
        centerPanel: { rect: rect(80, 60, 480, 250), visible: true },
        leftPanel: { rect: rect(0, 0, 0, 0), visible: false },
        rightPanel: { rect: rect(0, 0, 0, 0), visible: false },
        nodegraphRail: { rect: rect(500, 80, 220, 500), visible: true },
        nodegraphCanvas: { rect: rect(70, 80, 460, 250), visible: true },
      },
      clickables: [
        { key: "build", tag: "button", text: "Build", rect: rect(100, 20, 80, 32), visible: true },
        { key: "play", tag: "button", text: "Play", rect: rect(145, 20, 80, 32), visible: true },
        { key: "hidden-action", tag: "button", text: "Hidden", rect: rect(1300, 20, 120, 32), visible: true },
      ],
      criticalTexts: [
        {
          key: "workspace-title",
          text: "Long technical workspace title",
          rect: rect(40, 90, 80, 20),
          clientWidth: 80,
          scrollWidth: 190,
          clientHeight: 20,
          scrollHeight: 20,
          visible: true,
        },
      ],
      mainVisuals: [
        {
          key: "nodegraph-canvas",
          kind: "nodegraph",
          rect: rect(70, 80, 460, 250),
          containerRect: rect(60, 70, 500, 280),
          visible: true,
        },
      ],
      horizontalScrolls: [
        {
          key: "workspace-root",
          rect: rect(0, 60, 1366, 650),
          clientWidth: 1366,
          scrollWidth: 1500,
          allowed: false,
          visible: true,
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "document-horizontal-scroll",
        "clickable-overlap",
        "clickable-outside-viewport",
        "critical-text-truncated-no-tooltip",
        "main-canvas-too-small",
        "nodegraph-rail-overlaps-canvas",
        "forbidden-horizontal-scroll",
      ])
    );
  });

  it("fails when NodeGraph context panels overlap the canvas work area", () => {
    const result = evaluateUiLayoutOracleSnapshot({
      targetId: "nodegraph",
      workspaceId: "logic",
      resolutionTag: "1366x768",
      viewport: { width: 1366, height: 768 },
      document: { clientWidth: 1366, scrollWidth: 1366 },
      elements: {
        centerPanel: { rect: rect(0, 50, 1366, 650), visible: true },
        leftPanel: { rect: rect(0, 0, 0, 0), visible: false },
        rightPanel: { rect: rect(0, 0, 0, 0), visible: false },
        nodegraphRail: { rect: rect(0, 50, 160, 650), visible: true },
        nodegraphCanvas: { rect: rect(160, 50, 918, 650), visible: true },
        nodegraphContextRail: { rect: rect(1040, 50, 286, 650), visible: true },
        nodegraphOverview: { rect: rect(220, 80, 300, 360), visible: true },
      },
      clickables: [],
      criticalTexts: [],
      mainVisuals: [
        {
          key: "nodegraph-canvas",
          kind: "nodegraph",
          rect: rect(160, 50, 918, 650),
          containerRect: rect(0, 50, 1366, 650),
          visible: true,
        },
      ],
      horizontalScrolls: [],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      "nodegraph-context-overlaps-canvas"
    );
  });

  it("builds a pass/fail report grouped by visual target", () => {
    const passing = evaluateUiLayoutOracleSnapshot({
      targetId: "scene",
      workspaceId: "scene",
      resolutionTag: "1600x900",
      viewport: { width: 1600, height: 900 },
      document: { clientWidth: 1600, scrollWidth: 1600 },
      elements: {
        centerPanel: { rect: rect(260, 60, 930, 690), visible: true },
        leftPanel: { rect: rect(0, 60, 240, 690), visible: true },
        rightPanel: { rect: rect(1200, 60, 360, 690), visible: true },
      },
      clickables: [{ key: "build", tag: "button", text: "Build", rect: rect(720, 10, 90, 30), visible: true }],
      criticalTexts: [],
      mainVisuals: [
        {
          key: "scene-canvas",
          kind: "scene",
          rect: rect(310, 160, 640, 448),
          containerRect: rect(290, 140, 760, 520),
          visible: true,
        },
      ],
      horizontalScrolls: [],
    });

    const report = buildUiLayoutOracleReport({
      artifactPrefix: "qa-rc-demo",
      records: [passing],
    });

    expect(report.status).toBe("passed");
    expect(report.targets.scene["1600x900"].status).toBe("passed");
    expect(report.summary.total).toBe(1);
    expect(report.summary.failed).toBe(0);
  });
});
