import { describe, expect, it } from "vitest";

import {
  UI_LAYOUT_ORACLE_REQUIRED_CELL_COUNT,
  UI_LAYOUT_ORACLE_RESOLUTIONS,
  UI_LAYOUT_ORACLE_SURFACES,
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
      "shell-primitives",
      "import-wizard",
      "scene",
      "art",
      "logic",
      "nodegraph",
      "game",
      "debug",
      "runtime-setup",
      "explorer",
      "retrofx",
      "console",
      "command-palette",
      "reverse-evidence",
    ]);

    expect(UI_LAYOUT_ORACLE_SURFACES.map((item) => item.id)).toEqual([
      "design-system",
      "wizard",
      "scene-shell",
      "game",
      "explorer-assets",
      "logic-nodegraph",
      "art-fx",
      "debug-tools",
      "runtime-setup",
      "console-states",
      "command-dialog",
      "reverse-evidence",
    ]);
    expect(UI_LAYOUT_ORACLE_REQUIRED_CELL_COUNT).toBe(48);
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

  it("detects target-size, focus, ARIA, contrast and adaptive-panel regressions", () => {
    const result = evaluateUiLayoutOracleSnapshot({
      targetId: "shell-primitives",
      workspaceId: "scene",
      resolutionTag: "1366x768",
      layoutProfile: "wide",
      viewport: { width: 1366, height: 768 },
      document: { clientWidth: 1366, scrollWidth: 1366 },
      elements: {
        topbar: { rect: rect(0, 0, 1366, 48), visible: true },
        buildButton: { rect: rect(600, 8, 96, 32), visible: true },
        centerPanel: { rect: rect(250, 60, 800, 620), visible: true },
        leftPanel: { rect: rect(0, 60, 230, 620), visible: true },
        rightPanel: { rect: rect(1070, 60, 296, 620), visible: true },
      },
      clickables: [
        {
          key: "icon-only",
          tag: "button",
          text: "",
          rect: rect(10, 10, 18, 18),
          visible: true,
        },
      ],
      semanticNodes: [
        { key: "dialog", role: "dialog", text: "", ariaModal: false, visible: true },
        {
          key: "tab",
          role: "tab",
          text: "Resumo",
          parentRole: "toolbar",
          visible: true,
        },
        { key: "search", role: "combobox", ariaLabel: "Buscar", visible: true },
      ],
      focusChecks: [
        {
          key: "icon-only",
          rect: rect(10, 10, 18, 18),
          focusVisible: false,
          obscured: true,
          obscuredBy: "topbar",
        },
      ],
      contrastSamples: [
        { key: "body-copy", ratio: 3.2, largeText: false, visible: true },
        { key: "focus-ring", ratio: 2.2, nonText: true, visible: true },
      ],
      adjustableRegions: [
        {
          key: "workspace-guide",
          informationBox: true,
          requiresManualResize: true,
          requiresAutomaticResize: true,
          manualResize: false,
          automaticResize: false,
          movable: false,
          autoHide: false,
        },
        { key: "build-blocker", critical: true, autoHidden: true },
      ],
      criticalTexts: [],
      horizontalScrolls: [],
      mainVisuals: [],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "unexpected-layout-profile",
        "interactive-target-too-small",
        "interactive-accessible-name-missing",
        "aria-name-missing",
        "dialog-aria-modal-missing",
        "tab-aria-selected-missing",
        "tab-aria-controls-missing",
        "tab-outside-tablist",
        "combobox-aria-expanded-missing",
        "combobox-aria-controls-missing",
        "focus-indicator-not-visible",
        "focus-indicator-obscured",
        "text-contrast-too-low",
        "non-text-contrast-too-low",
        "manual-resize-missing",
        "automatic-resize-missing",
        "information-box-move-missing",
        "information-box-auto-hide-missing",
        "critical-region-auto-hidden",
      ])
    );
  });

  it("accepts complete accessibility and adaptive-layout evidence", () => {
    const result = evaluateUiLayoutOracleSnapshot({
      targetId: "command-palette",
      workspaceId: "scene",
      resolutionTag: "1366x768",
      layoutProfile: "compact",
      requireA11yEvidence: true,
      requireAdaptiveEvidence: true,
      viewport: { width: 1366, height: 768 },
      document: { clientWidth: 1366, scrollWidth: 1366 },
      surfaceRoot: {
        rect: rect(310, 120, 746, 500),
        visible: true,
        clientWidth: 746,
        scrollWidth: 746,
      },
      elements: {
        commandPalette: { rect: rect(310, 120, 746, 500), visible: true },
        centerPanel: { rect: rect(250, 60, 800, 620), visible: true },
        leftPanel: { rect: rect(0, 60, 230, 620), visible: true },
        rightPanel: { rect: rect(1070, 60, 296, 620), visible: true },
      },
      clickables: [
        {
          key: "close-dialog",
          tag: "button",
          ariaLabel: "Fechar paleta",
          rect: rect(1010, 132, 32, 32),
          visible: true,
        },
      ],
      semanticNodes: [
        {
          key: "palette-dialog",
          role: "dialog",
          ariaLabel: "Paleta de Comandos",
          ariaModal: true,
          visible: true,
        },
        {
          key: "palette-search",
          role: "combobox",
          ariaLabel: "Buscar comandos",
          ariaExpanded: true,
          ariaControls: "palette-results",
          visible: true,
        },
        {
          key: "palette-option",
          role: "option",
          text: "Abrir projeto",
          ariaSelected: true,
          visible: true,
        },
      ],
      focusChecks: [
        {
          key: "palette-search",
          rect: rect(338, 180, 690, 40),
          focusVisible: true,
          obscured: false,
        },
      ],
      contrastSamples: [
        { key: "dialog-title", ratio: 7.1, largeText: false, visible: true },
        { key: "focus-ring", ratio: 3.4, nonText: true, visible: true },
      ],
      adjustableRegions: [
        {
          key: "inspector",
          requiresManualResize: true,
          requiresAutomaticResize: true,
          manualResize: true,
          automaticResize: true,
        },
        {
          key: "workspace-guide",
          informationBox: true,
          movable: true,
          autoHide: true,
        },
        { key: "build-blocker", critical: true, autoHidden: false },
      ],
      criticalTexts: [],
      horizontalScrolls: [],
      mainVisuals: [],
    });

    expect(result.ok).toBe(true);
    expect(result.limitations).toEqual([]);
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
    expect(report.coverage.status).toBe("incomplete");
  });

  it("enforces all 12 approved surfaces at all four resolutions in strict reports", () => {
    const completeRecords = UI_LAYOUT_ORACLE_TARGETS.flatMap((target) =>
      UI_LAYOUT_ORACLE_RESOLUTIONS.map((resolution) => ({
        targetId: target.id,
        surfaceId: target.surfaceId,
        workspaceId: target.workspaceId,
        resolutionTag: resolution.tag,
        ok: true,
        issues: [],
        limitations: [],
        metrics: {},
      }))
    );

    const complete = buildUiLayoutOracleReport({
      artifactPrefix: "qa-rc-complete",
      records: completeRecords,
      requireCompleteMatrix: true,
    });
    expect(complete.status).toBe("passed");
    expect(complete.coverage).toMatchObject({
      status: "complete",
      requiredSurfaceCells: 48,
      coveredSurfaceCells: 48,
      passedSurfaceCells: 48,
      failedSurfaceCells: 0,
    });
    expect(complete.coverage.missingSurfaceCells).toEqual([]);

    const missing = buildUiLayoutOracleReport({
      artifactPrefix: "qa-rc-missing",
      records: completeRecords.filter(
        (record) => !(record.targetId === "retrofx" && record.resolutionTag === "2560x1080")
      ),
      requireCompleteMatrix: true,
    });
    expect(missing.status).toBe("failed");
    expect(missing.coverage.status).toBe("incomplete");
    expect(missing.surfaces["art-fx"]["2560x1080"]).toMatchObject({
      status: "missing",
      missingTargetIds: ["retrofx"],
    });
  });
});
