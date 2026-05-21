export const UI_LAYOUT_ORACLE_RESOLUTIONS = [
  { width: 1366, height: 768, tag: "1366x768" },
  { width: 1600, height: 900, tag: "1600x900" },
  { width: 1920, height: 1080, tag: "1920x1080" },
  { width: 2560, height: 1080, tag: "2560x1080" },
];

export const UI_LAYOUT_ORACLE_TARGETS = [
  { id: "import-wizard", label: "Import Wizard", workspaceId: null, visualKind: "wizard" },
  { id: "scene", label: "Scene", workspaceId: "scene", visualKind: "scene" },
  { id: "art", label: "Art", workspaceId: "artstudio", visualKind: "art" },
  { id: "logic", label: "Logic", workspaceId: "logic", visualKind: "nodegraph" },
  { id: "nodegraph", label: "NodeGraph", workspaceId: "logic", visualKind: "nodegraph" },
  { id: "game", label: "Game", workspaceId: "game", visualKind: "game" },
  { id: "debug", label: "Debug", workspaceId: "debug", visualKind: "debug" },
  { id: "runtime-setup", label: "Runtime Setup", workspaceId: "debug", visualKind: "runtime" },
];

const SHELL_EXPECTATIONS = {
  scene: { showLeft: true, showRight: true },
  artstudio: { showLeft: false, showRight: false },
  logic: { showLeft: false, showRight: false },
  game: { showLeft: false, showRight: false },
  debug: { showLeft: false, showRight: true },
  explorer: { showLeft: false, showRight: true },
  retrofx: { showLeft: false, showRight: false },
};

const CENTER_MIN_WIDTH_BY_RESOLUTION = {
  "1366x768": 520,
  "1600x900": 640,
  "1920x1080": 720,
  "2560x1080": 900,
};

const CENTER_MIN_HEIGHT_BY_RESOLUTION = {
  "1366x768": 280,
  "1600x900": 340,
  "1920x1080": 380,
  "2560x1080": 380,
};

const VISUAL_MINIMUMS = {
  scene: { width: 320, height: 224 },
  game: { width: 320, height: 224 },
  art: { width: 420, height: 280 },
  nodegraph: { width: 520, height: 300 },
  runtime: { width: 300, height: 220 },
  wizard: { width: 520, height: 360 },
  debug: { width: 320, height: 220 },
};

function roundMetric(value) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function normalizeRect(rect) {
  if (!rect) return null;
  const left = Number(rect.left ?? 0);
  const top = Number(rect.top ?? 0);
  const width = Number(rect.width ?? Math.max(0, Number(rect.right ?? 0) - left));
  const height = Number(rect.height ?? Math.max(0, Number(rect.bottom ?? 0) - top));
  return {
    left,
    top,
    right: Number(rect.right ?? left + width),
    bottom: Number(rect.bottom ?? top + height),
    width,
    height,
  };
}

function isVisible(item) {
  const rect = normalizeRect(item?.rect);
  return Boolean(item?.visible ?? true) && Boolean(rect) && rect.width > 2 && rect.height > 2;
}

function rectsOverlap(a, b, threshold = 2) {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  return right - left > threshold && bottom - top > threshold;
}

function overlapRatio(a, b) {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  const overlapArea = Math.max(0, right - left) * Math.max(0, bottom - top);
  const smallerArea = Math.max(1, Math.min(a.width * a.height, b.width * b.height));
  return overlapArea / smallerArea;
}

function rectOutsideViewport(rect, viewport) {
  return (
    rect.left < -1 ||
    rect.top < -1 ||
    rect.right > Number(viewport.width ?? 0) + 1 ||
    rect.bottom > Number(viewport.height ?? 0) + 1
  );
}

function rectOutsideViewportHorizontally(rect, viewport) {
  return rect.left < -1 || rect.right > Number(viewport.width ?? 0) + 1;
}

function isScrollableVerticalOverflow(item, rect, viewport) {
  return (
    Boolean(item?.insideVerticalScrollRegion) &&
    !rectOutsideViewportHorizontally(rect, viewport) &&
    (rect.top < -1 || rect.bottom > Number(viewport.height ?? 0) + 1)
  );
}

function isAllowedHorizontalOverflow(item, rect, viewport) {
  return (
    Boolean(item?.insideAllowedHorizontalScrollRegion) &&
    !(
      rect.top < -1 ||
      rect.bottom > Number(viewport.height ?? 0) + 1
    ) &&
    rectOutsideViewportHorizontally(rect, viewport)
  );
}

function isAllowedScrollableOverflow(item, rect, viewport) {
  return isScrollableVerticalOverflow(item, rect, viewport) || isAllowedHorizontalOverflow(item, rect, viewport);
}

function hasTooltip(item) {
  return Boolean(
    String(item?.title ?? "").trim() ||
      String(item?.ariaLabel ?? "").trim() ||
      String(item?.ariaDescribedBy ?? "").trim() ||
      item?.hasTooltip
  );
}

function pushIssue(issues, code, message, details = {}) {
  issues.push({ code, message, details });
}

function findTarget(targetId) {
  return UI_LAYOUT_ORACLE_TARGETS.find((target) => target.id === targetId) ?? {
    id: targetId,
    label: targetId,
    workspaceId: targetId,
    visualKind: targetId,
  };
}

function findMainVisual(snapshot, visualKind) {
  return (snapshot.mainVisuals ?? []).find(
    (visual) => visual.kind === visualKind && isVisible(visual)
  );
}

export function evaluateUiLayoutOracleSnapshot(snapshot) {
  const target = findTarget(snapshot.targetId);
  const viewport = snapshot.viewport ?? { width: 0, height: 0 };
  const issues = [];
  const metrics = {};
  const elements = snapshot.elements ?? {};
  const workspaceId = snapshot.workspaceId ?? target.workspaceId;

  if (snapshot.document) {
    metrics.documentClientWidth = roundMetric(snapshot.document.clientWidth);
    metrics.documentScrollWidth = roundMetric(snapshot.document.scrollWidth);
    if (Number(snapshot.document.scrollWidth ?? 0) > Number(snapshot.document.clientWidth ?? 0) + 2) {
      pushIssue(issues, "document-horizontal-scroll", "documento com scroll horizontal indevido", {
        scrollWidth: snapshot.document.scrollWidth,
        clientWidth: snapshot.document.clientWidth,
      });
    }
  }

  const topbar = elements.topbar;
  if (isVisible(topbar)) {
    metrics.topbarHeight = roundMetric(topbar.rect.height);
    if (Number(topbar.scrollWidth ?? 0) > Number(topbar.clientWidth ?? 0) + 2) {
      pushIssue(issues, "topbar-horizontal-scroll", "topbar raiz com overflow horizontal", {
        scrollWidth: topbar.scrollWidth,
        clientWidth: topbar.clientWidth,
      });
    }
  }

  const topbarColumns = [elements.topbarLeft, elements.topbarCenter, elements.topbarRight].filter(isVisible);
  if (topbarColumns.length === 3) {
    const [leftColumn, centerColumn, rightColumn] = topbarColumns.map((item) => normalizeRect(item.rect));
    if (centerColumn.left < leftColumn.right - 2) {
      pushIssue(issues, "topbar-column-overlap", "topbar central invade a coluna esquerda", {
        centerLeft: roundMetric(centerColumn.left),
        leftRight: roundMetric(leftColumn.right),
      });
    }
    if (centerColumn.right > rightColumn.left + 2) {
      pushIssue(issues, "topbar-column-overlap", "topbar central invade a coluna direita", {
        centerRight: roundMetric(centerColumn.right),
        rightLeft: roundMetric(rightColumn.left),
      });
    }
  }

  const buildButton = elements.buildButton;
  if (isVisible(buildButton) && isVisible(topbar)) {
    metrics.buildButtonHeight = roundMetric(buildButton.rect.height);
    if (buildButton.rect.height > topbar.rect.height + 2) {
      pushIssue(issues, "build-button-too-tall", "botao Build maior que a topbar", {
        buildButtonHeight: roundMetric(buildButton.rect.height),
        topbarHeight: roundMetric(topbar.rect.height),
      });
    }
    if (Number(buildButton.scrollHeight ?? 0) > Number(buildButton.clientHeight ?? 0) + 2) {
      pushIssue(issues, "build-button-wrapped", "botao Build truncado ou quebrando linha", {
        scrollHeight: buildButton.scrollHeight,
        clientHeight: buildButton.clientHeight,
      });
    }
  }

  const centerPanel = elements.centerPanel;
  if (isVisible(centerPanel)) {
    const minWidth = CENTER_MIN_WIDTH_BY_RESOLUTION[snapshot.resolutionTag] ?? 520;
    const minHeight = CENTER_MIN_HEIGHT_BY_RESOLUTION[snapshot.resolutionTag] ?? 280;
    metrics.centerWidth = roundMetric(centerPanel.rect.width);
    metrics.centerHeight = roundMetric(centerPanel.rect.height);
    if (centerPanel.rect.width < minWidth) {
      pushIssue(issues, "center-panel-too-narrow", "painel central estreito demais", {
        width: roundMetric(centerPanel.rect.width),
        minWidth,
      });
    }
    if (centerPanel.rect.height < minHeight) {
      pushIssue(issues, "center-panel-too-short", "painel central baixo demais", {
        height: roundMetric(centerPanel.rect.height),
        minHeight,
      });
    }
  } else if (target.id !== "import-wizard") {
    pushIssue(issues, "center-panel-missing", "painel central nao encontrado");
  }

  const expectedShell = workspaceId ? SHELL_EXPECTATIONS[workspaceId] : null;
  if (expectedShell) {
    const leftPanelVisible = isVisible(elements.leftPanel);
    const rightPanelVisible = isVisible(elements.rightPanel);
    if (!expectedShell.showLeft && leftPanelVisible) {
      pushIssue(issues, "unexpected-left-panel", "painel esquerdo visivel para workspace full-width");
    }
    if (!expectedShell.showRight && rightPanelVisible) {
      pushIssue(issues, "unexpected-right-panel", "painel direito visivel para workspace full-width");
    }
    if (expectedShell.showLeft && !leftPanelVisible) {
      pushIssue(issues, "expected-left-panel-missing", "painel esquerdo esperado nao esta visivel");
    }
    if (expectedShell.showRight && !rightPanelVisible) {
      pushIssue(issues, "expected-right-panel-missing", "painel direito esperado nao esta visivel");
    }
  }

  const guide = elements.workspaceGuide;
  if (isVisible(guide)) {
    metrics.guideHeight = roundMetric(guide.rect.height);
    const maxGuideHeight = Number(viewport.height ?? 0) * 0.16;
    if (guide.rect.height > maxGuideHeight) {
      pushIssue(issues, "workspace-guide-too-tall", "workspace guide alto demais", {
        height: roundMetric(guide.rect.height),
        maxHeight: roundMetric(maxGuideHeight),
      });
    }
  }

  const consoleDrawer = elements.consoleDrawer;
  if (consoleDrawer?.dataVisible === "true") {
    pushIssue(issues, "console-open-by-default", "console drawer aberto durante QA visual");
    if (isVisible(consoleDrawer) && isVisible(elements.statusBar)) {
      if (consoleDrawer.rect.bottom > elements.statusBar.rect.top + 1) {
        pushIssue(issues, "console-overlaps-status-bar", "console drawer cobre a status bar");
      }
    }
  }

  const visibleClickables = (snapshot.clickables ?? []).filter((item) => isVisible(item) && !item.disabled);
  for (const clickable of visibleClickables) {
    const rect = normalizeRect(clickable.rect);
    if (rectOutsideViewport(rect, viewport)) {
      if (isAllowedScrollableOverflow(clickable, rect, viewport)) continue;
      pushIssue(issues, "clickable-outside-viewport", "elemento clicavel fora da viewport", {
        key: clickable.key,
        text: clickable.text,
        rect: {
          left: roundMetric(rect.left),
          top: roundMetric(rect.top),
          right: roundMetric(rect.right),
          bottom: roundMetric(rect.bottom),
        },
      });
    }
  }

  for (let index = 0; index < visibleClickables.length; index += 1) {
    for (let other = index + 1; other < visibleClickables.length; other += 1) {
      const first = normalizeRect(visibleClickables[index].rect);
      const second = normalizeRect(visibleClickables[other].rect);
      if (
        isAllowedScrollableOverflow(visibleClickables[index], first, viewport) ||
        isAllowedScrollableOverflow(visibleClickables[other], second, viewport) ||
        visibleClickables[index].hitTestVisible === false ||
        visibleClickables[other].hitTestVisible === false
      ) {
        continue;
      }
      if (rectsOverlap(first, second, 6) && overlapRatio(first, second) > 0.12) {
        pushIssue(issues, "clickable-overlap", "botoes/controles clicaveis sobrepostos", {
          first: visibleClickables[index].key,
          second: visibleClickables[other].key,
        });
        index = visibleClickables.length;
        break;
      }
    }
  }

  for (const textItem of (snapshot.criticalTexts ?? []).filter(isVisible)) {
    const truncated =
      Number(textItem.scrollWidth ?? 0) > Number(textItem.clientWidth ?? 0) + 2 ||
      Number(textItem.scrollHeight ?? 0) > Number(textItem.clientHeight ?? 0) + 2;
    if (truncated && !hasTooltip(textItem)) {
      pushIssue(issues, "critical-text-truncated-no-tooltip", "texto critico truncado sem tooltip", {
        key: textItem.key,
        text: String(textItem.text ?? "").slice(0, 120),
      });
    }
  }

  for (const scrollItem of (snapshot.horizontalScrolls ?? []).filter(isVisible)) {
    if (
      Number(scrollItem.scrollWidth ?? 0) > Number(scrollItem.clientWidth ?? 0) + 2 &&
      !scrollItem.allowed
    ) {
      pushIssue(issues, "forbidden-horizontal-scroll", "scrollbar horizontal fora das regioes permitidas", {
        key: scrollItem.key,
        scrollWidth: scrollItem.scrollWidth,
        clientWidth: scrollItem.clientWidth,
      });
    }
  }

  const mainVisual = findMainVisual(snapshot, target.visualKind);
  if (mainVisual) {
    const minimum = VISUAL_MINIMUMS[target.visualKind] ?? VISUAL_MINIMUMS.scene;
    metrics.mainVisualWidth = roundMetric(mainVisual.rect.width);
    metrics.mainVisualHeight = roundMetric(mainVisual.rect.height);
    if (mainVisual.rect.width < minimum.width || mainVisual.rect.height < minimum.height) {
      pushIssue(issues, "main-canvas-too-small", "canvas/area util principal menor que o limite minimo", {
        key: mainVisual.key,
        kind: mainVisual.kind,
        width: roundMetric(mainVisual.rect.width),
        height: roundMetric(mainVisual.rect.height),
        minWidth: minimum.width,
        minHeight: minimum.height,
      });
    }
    const containerRect = normalizeRect(mainVisual.containerRect);
    if (containerRect) {
      const clipped =
        mainVisual.rect.left < containerRect.left - 2 ||
        mainVisual.rect.top < containerRect.top - 2 ||
        mainVisual.rect.right > containerRect.right + 2 ||
        mainVisual.rect.bottom > containerRect.bottom + 2;
      if (clipped) {
        pushIssue(issues, "main-visual-clipped", "imagem/canvas principal cortado pelo painel", {
          key: mainVisual.key,
          kind: mainVisual.kind,
        });
      }
    }
  } else if (target.visualKind) {
    pushIssue(issues, "main-visual-missing", "area visual principal nao encontrada", {
      targetId: target.id,
      visualKind: target.visualKind,
    });
  }

  const rail = elements.nodegraphRail;
  const canvas = elements.nodegraphCanvas;
  if ((target.id === "logic" || target.id === "nodegraph") && isVisible(rail) && isVisible(canvas)) {
    if (rectsOverlap(normalizeRect(rail.rect), normalizeRect(canvas.rect), 4)) {
      pushIssue(issues, "nodegraph-rail-overlaps-canvas", "side rail do NodeGraph invade o canvas");
    }
    for (const [key, element] of [
      ["nodegraphMinimap", elements.nodegraphMinimap],
      ["nodegraphCanvasToolbar", elements.nodegraphCanvasToolbar],
    ]) {
      if (isVisible(element) && rectsOverlap(normalizeRect(rail.rect), normalizeRect(element.rect), 4)) {
        pushIssue(issues, "nodegraph-rail-overlaps-canvas", "side rail do NodeGraph cobre controles do canvas", {
          key,
        });
      }
    }
  }

  return {
    targetId: target.id,
    targetLabel: target.label,
    workspaceId,
    resolutionTag: snapshot.resolutionTag,
    ok: issues.length === 0,
    status: issues.length === 0 ? "passed" : "failed",
    issues,
    metrics,
    screenshot: snapshot.screenshot ?? null,
  };
}

export function buildUiLayoutOracleReport({ artifactPrefix, records, generatedAt = new Date().toISOString() }) {
  const targets = {};
  for (const record of records) {
    if (!targets[record.targetId]) {
      targets[record.targetId] = {};
    }
    targets[record.targetId][record.resolutionTag] = {
      status: record.ok ? "passed" : "failed",
      workspaceId: record.workspaceId ?? null,
      issues: record.issues ?? [],
      metrics: record.metrics ?? {},
      screenshot: record.screenshot ?? null,
    };
  }

  const failedRecords = records.filter((record) => !record.ok);
  return {
    generatedAt,
    artifactPrefix,
    status: failedRecords.length === 0 ? "passed" : "failed",
    summary: {
      total: records.length,
      passed: records.length - failedRecords.length,
      failed: failedRecords.length,
    },
    requiredResolutions: UI_LAYOUT_ORACLE_RESOLUTIONS.map((resolution) => resolution.tag),
    requiredTargets: UI_LAYOUT_ORACLE_TARGETS.map((target) => target.id),
    targets,
  };
}
