export const UI_LAYOUT_ORACLE_RESOLUTIONS = [
  { width: 1366, height: 768, tag: "1366x768" },
  { width: 1600, height: 900, tag: "1600x900" },
  { width: 1920, height: 1080, tag: "1920x1080" },
  { width: 2560, height: 1080, tag: "2560x1080" },
];

export const UI_LAYOUT_ORACLE_SURFACES = [
  { id: "design-system", label: "Design system / primitives", targetIds: ["shell-primitives"] },
  { id: "wizard", label: "Wizard de primeiro uso", targetIds: ["import-wizard"] },
  { id: "scene-shell", label: "Scene shell", targetIds: ["scene"] },
  { id: "game", label: "Game", targetIds: ["game"] },
  { id: "explorer-assets", label: "Explorer / Asset Browser", targetIds: ["explorer"] },
  { id: "logic-nodegraph", label: "Logic / NodeGraph", targetIds: ["logic", "nodegraph"] },
  { id: "art-fx", label: "Art + FX (Experimental)", targetIds: ["art", "retrofx"] },
  { id: "debug-tools", label: "Debug / Tools", targetIds: ["debug"] },
  { id: "runtime-setup", label: "Runtime Setup", targetIds: ["runtime-setup"] },
  { id: "console-states", label: "Console + estados globais", targetIds: ["console"] },
  { id: "command-dialog", label: "Command Palette + Dialog", targetIds: ["command-palette"] },
  {
    id: "reverse-evidence",
    label: "Reverse + Laboratorio de Evidencias (Experimental)",
    targetIds: ["reverse-evidence"],
  },
];

export const UI_LAYOUT_ORACLE_TARGETS = [
  {
    id: "shell-primitives",
    surfaceId: "design-system",
    label: "Shell / Primitives",
    workspaceId: "scene",
    visualKind: null,
    requiredElements: ["topbar", "buildButton"],
  },
  {
    id: "import-wizard",
    surfaceId: "wizard",
    label: "Import Wizard",
    workspaceId: null,
    visualKind: "wizard",
    requiredElements: ["importWizard"],
  },
  { id: "scene", surfaceId: "scene-shell", label: "Scene", workspaceId: "scene", visualKind: "scene" },
  { id: "art", surfaceId: "art-fx", label: "Art", workspaceId: "artstudio", visualKind: "art" },
  { id: "logic", surfaceId: "logic-nodegraph", label: "Logic", workspaceId: "logic", visualKind: "nodegraph" },
  {
    id: "nodegraph",
    surfaceId: "logic-nodegraph",
    label: "NodeGraph",
    workspaceId: "logic",
    visualKind: "nodegraph",
  },
  { id: "game", surfaceId: "game", label: "Game", workspaceId: "game", visualKind: "game" },
  { id: "debug", surfaceId: "debug-tools", label: "Debug", workspaceId: "debug", visualKind: "debug" },
  {
    id: "runtime-setup",
    surfaceId: "runtime-setup",
    label: "Runtime Setup",
    workspaceId: "debug",
    visualKind: "runtime",
    requiredElements: ["runtimeSetup"],
  },
  {
    id: "explorer",
    surfaceId: "explorer-assets",
    label: "Explorer / Asset Browser",
    workspaceId: "explorer",
    visualKind: null,
  },
  {
    id: "retrofx",
    surfaceId: "art-fx",
    label: "RetroFX (Experimental)",
    workspaceId: "retrofx",
    visualKind: null,
  },
  {
    id: "console",
    surfaceId: "console-states",
    label: "Console + estados globais",
    workspaceId: "scene",
    visualKind: null,
    requiredElements: ["consoleDrawer"],
  },
  {
    id: "command-palette",
    surfaceId: "command-dialog",
    label: "Command Palette + Dialog",
    workspaceId: "scene",
    visualKind: null,
    requiredElements: ["commandPalette"],
  },
  {
    id: "reverse-evidence",
    surfaceId: "reverse-evidence",
    label: "Reverse + Laboratorio de Evidencias (Experimental)",
    workspaceId: "debug",
    visualKind: null,
    requiredElements: ["reverseWorkspace"],
  },
];

export const UI_LAYOUT_ORACLE_REQUIRED_CELL_COUNT =
  UI_LAYOUT_ORACLE_SURFACES.length * UI_LAYOUT_ORACLE_RESOLUTIONS.length;

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

const LAYOUT_PROFILE_BY_RESOLUTION = {
  "1366x768": "compact",
  "1600x900": "standard",
  "1920x1080": "standard",
  "2560x1080": "wide",
};

const MIN_INTERACTIVE_TARGET_PX = 24;

const VISUAL_MINIMUMS = {
  scene: { width: 320, height: 224 },
  game: { width: 320, height: 224 },
  art: { width: 420, height: 280 },
  nodegraph: { width: 520, height: 300 },
  runtime: { width: 300, height: 220 },
  wizard: { width: 520, height: 360 },
  debug: { width: 320, height: 220 },
};

const ACCESSIBLE_NAME_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "dialog",
  "link",
  "menuitem",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);

const CONTROL_TAGS = new Set(["button", "input", "select", "summary", "textarea"]);

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
    item?.hasTooltip === true ||
      String(item?.title ?? "").trim() ||
      String(item?.ariaLabel ?? "").trim() ||
      String(item?.ariaDescribedBy ?? "").trim()
  );
}

function hasAccessibleName(item) {
  return Boolean(
    String(item?.accessibleName ?? "").trim() ||
      String(item?.ariaLabel ?? "").trim() ||
      String(item?.ariaLabelledBy ?? "").trim() ||
      String(item?.title ?? "").trim() ||
      String(item?.text ?? "").trim()
  );
}

function roleOf(item) {
  return String(item?.role ?? "").trim().toLowerCase();
}

function isControlTarget(item) {
  const role = roleOf(item);
  return CONTROL_TAGS.has(String(item?.tag ?? "").toLowerCase()) || ACCESSIBLE_NAME_ROLES.has(role);
}

function recordLimitation(limitations, code, message, details = {}) {
  if (limitations.some((limitation) => limitation.code === code)) return;
  limitations.push({ code, message, details });
}

function requiredTargetIdsForSurface(surface) {
  return [...surface.targetIds];
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
  const limitations = [];
  const metrics = {
    viewportWidth: roundMetric(viewport.width),
    viewportHeight: roundMetric(viewport.height),
    expectedLayoutProfile: LAYOUT_PROFILE_BY_RESOLUTION[snapshot.resolutionTag] ?? null,
  };
  const elements = snapshot.elements ?? {};
  const workspaceId = snapshot.workspaceId ?? target.workspaceId;

  if (snapshot.layoutProfile) {
    metrics.layoutProfile = snapshot.layoutProfile;
    const expectedLayoutProfile = LAYOUT_PROFILE_BY_RESOLUTION[snapshot.resolutionTag];
    if (expectedLayoutProfile && snapshot.layoutProfile !== expectedLayoutProfile) {
      pushIssue(issues, "unexpected-layout-profile", "perfil responsivo diferente do esperado", {
        actual: snapshot.layoutProfile,
        expected: expectedLayoutProfile,
      });
    }
  } else {
    recordLimitation(
      limitations,
      "layout-profile-not-observed",
      "snapshot nao informou o perfil responsivo computado"
    );
  }

  for (const elementKey of target.requiredElements ?? []) {
    if (!isVisible(elements[elementKey])) {
      pushIssue(issues, "required-surface-element-missing", "elemento obrigatorio da superficie nao encontrado", {
        elementKey,
        targetId: target.id,
      });
    }
  }

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

  if (snapshot.surfaceRoot) {
    const rootRect = normalizeRect(snapshot.surfaceRoot.rect);
    if (!isVisible(snapshot.surfaceRoot)) {
      pushIssue(issues, "surface-root-not-visible", "raiz da superficie nao esta visivel", {
        targetId: target.id,
      });
    } else {
      if (rectOutsideViewport(rootRect, viewport) && !isAllowedScrollableOverflow(snapshot.surfaceRoot, rootRect, viewport)) {
        pushIssue(issues, "surface-root-outside-viewport", "raiz da superficie ultrapassa a viewport", {
          targetId: target.id,
        });
      }
      if (
        Number(snapshot.surfaceRoot.scrollWidth ?? 0) > Number(snapshot.surfaceRoot.clientWidth ?? 0) + 2 &&
        !snapshot.surfaceRoot.horizontalScrollAllowed
      ) {
        pushIssue(issues, "surface-horizontal-overflow", "superficie com overflow horizontal indevido", {
          targetId: target.id,
          scrollWidth: snapshot.surfaceRoot.scrollWidth,
          clientWidth: snapshot.surfaceRoot.clientWidth,
        });
      }
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
  if (consoleDrawer?.dataVisible === "true" && target.id !== "console") {
    pushIssue(issues, "console-open-by-default", "console drawer aberto durante QA visual");
    if (isVisible(consoleDrawer) && isVisible(elements.statusBar)) {
      if (consoleDrawer.rect.bottom > elements.statusBar.rect.top + 1) {
        pushIssue(issues, "console-overlaps-status-bar", "console drawer cobre a status bar");
      }
    }
  }

  if (target.id === "console" && consoleDrawer?.dataVisible !== "true") {
    pushIssue(issues, "console-surface-not-open", "console nao esta aberto no alvo dedicado");
  }

  const visibleClickables = (snapshot.clickables ?? []).filter((item) => isVisible(item) && !item.disabled);
  for (const clickable of visibleClickables) {
    const rect = normalizeRect(clickable.rect);
    if (rectOutsideViewport(rect, viewport)) {
      if (clickable.hitTestVisible === false) continue;
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

    if (
      isControlTarget(clickable) &&
      !clickable.targetSizeExempt &&
      (rect.width < MIN_INTERACTIVE_TARGET_PX || rect.height < MIN_INTERACTIVE_TARGET_PX)
    ) {
      pushIssue(issues, "interactive-target-too-small", "alvo interativo menor que 24x24 px", {
        key: clickable.key,
        width: roundMetric(rect.width),
        height: roundMetric(rect.height),
        minimum: MIN_INTERACTIVE_TARGET_PX,
      });
    }

    const role = roleOf(clickable);
    const tag = String(clickable.tag ?? "").toLowerCase();
    const requiresAccessibleName =
      ACCESSIBLE_NAME_ROLES.has(role) || tag === "button" || (tag === "a" && Boolean(clickable.href));
    if (requiresAccessibleName && !hasAccessibleName(clickable)) {
      pushIssue(issues, "interactive-accessible-name-missing", "controle interativo sem nome acessivel", {
        key: clickable.key,
        role,
        tag,
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
    if (!truncated || hasTooltip(textItem)) {
      continue;
    }
    const testIdKey = String(textItem.nearestTestId || textItem.testId || textItem.key || "");
    if (
      textItem.insideAllowedHorizontalScrollRegion === true ||
      textItem.insideVerticalScrollRegion === true ||
      testIdKey.includes("unified-topbar") ||
      testIdKey.includes("workspace-guide") ||
      testIdKey.includes("workspace-rail") ||
      testIdKey.includes("sgdk-import-summary") ||
      testIdKey.includes("inspector-logic-import-truth") ||
      testIdKey.includes("nodegraph-overview")
    ) {
      continue;
    }
    pushIssue(issues, "critical-text-truncated-no-tooltip", "texto critico truncado sem tooltip", {
      key: textItem.key,
      text: String(textItem.text ?? "").slice(0, 120),
    });
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

  for (const region of (snapshot.trackedRegions ?? []).filter(isVisible)) {
    const rect = normalizeRect(region.rect);
    if (rectOutsideViewport(rect, viewport) && !isAllowedScrollableOverflow(region, rect, viewport)) {
      pushIssue(issues, "tracked-region-outside-viewport", "regiao critica ultrapassa a viewport", {
        key: region.key,
      });
    }
    if (
      Number(region.scrollWidth ?? 0) > Number(region.clientWidth ?? 0) + 2 &&
      !region.horizontalScrollAllowed
    ) {
      pushIssue(issues, "tracked-region-horizontal-overflow", "regiao critica tem overflow horizontal indevido", {
        key: region.key,
        scrollWidth: region.scrollWidth,
        clientWidth: region.clientWidth,
      });
    }
  }

  const semanticNodes = snapshot.semanticNodes ?? [];
  if (semanticNodes.length === 0) {
    recordLimitation(
      limitations,
      "aria-structure-not-observed",
      "snapshot nao trouxe a estrutura ARIA de dialogs, tabs, menus e comboboxes"
    );
    if (snapshot.requireA11yEvidence) {
      pushIssue(issues, "aria-evidence-missing", "evidencia ARIA obrigatoria nao foi coletada");
    }
  }
  for (const node of semanticNodes.filter((item) => item?.visible ?? true)) {
    const role = roleOf(node);
    if (ACCESSIBLE_NAME_ROLES.has(role) && !hasAccessibleName(node)) {
      pushIssue(issues, "aria-name-missing", "elemento ARIA sem nome acessivel", {
        key: node.key,
        role,
      });
    }
    if (role === "dialog" && node.ariaModal !== true && node.ariaModal !== "true") {
      pushIssue(issues, "dialog-aria-modal-missing", "dialog aberto sem aria-modal=true", {
        key: node.key,
      });
    }
    if (role === "tab") {
      if (node.ariaSelected !== true && node.ariaSelected !== false && node.ariaSelected !== "true" && node.ariaSelected !== "false") {
        pushIssue(issues, "tab-aria-selected-missing", "tab sem estado aria-selected", {
          key: node.key,
        });
      }
      if (!String(node.ariaControls ?? "").trim()) {
        pushIssue(issues, "tab-aria-controls-missing", "tab sem referencia aria-controls", {
          key: node.key,
        });
      }
      if (node.parentRole && node.parentRole !== "tablist") {
        pushIssue(issues, "tab-outside-tablist", "tab fora de um tablist", {
          key: node.key,
          parentRole: node.parentRole,
        });
      }
    }
    if (role === "menuitem" && node.parentRole && node.parentRole !== "menu") {
      pushIssue(issues, "menuitem-outside-menu", "menuitem fora de um menu", {
        key: node.key,
        parentRole: node.parentRole,
      });
    }
    if (role === "combobox") {
      if (node.ariaExpanded !== true && node.ariaExpanded !== false && node.ariaExpanded !== "true" && node.ariaExpanded !== "false") {
        pushIssue(issues, "combobox-aria-expanded-missing", "combobox sem estado aria-expanded", {
          key: node.key,
        });
      }
      if (!String(node.ariaControls ?? "").trim()) {
        pushIssue(issues, "combobox-aria-controls-missing", "combobox sem referencia aria-controls", {
          key: node.key,
        });
      }
    }
    if (role === "option" && node.ariaSelected == null) {
      pushIssue(issues, "option-aria-selected-missing", "option sem estado aria-selected", {
        key: node.key,
      });
    }
  }

  const focusChecks = snapshot.focusChecks ?? [];
  if (focusChecks.length === 0) {
    recordLimitation(
      limitations,
      "focus-evidence-not-observed",
      "snapshot estatico nao exercitou foco visivel e nao obscurecido"
    );
    if (snapshot.requireA11yEvidence) {
      pushIssue(issues, "focus-evidence-missing", "evidencia de foco obrigatoria nao foi coletada");
    }
  }
  for (const focusCheck of focusChecks) {
    if (focusCheck.focusVisible !== true) {
      pushIssue(issues, "focus-indicator-not-visible", "controle focado sem indicador visivel", {
        key: focusCheck.key,
      });
    }
    if (focusCheck.obscured === true) {
      pushIssue(issues, "focus-indicator-obscured", "controle focado esta obscurecido por outra regiao", {
        key: focusCheck.key,
        obscuredBy: focusCheck.obscuredBy ?? null,
      });
    }
    const focusRect = normalizeRect(focusCheck.rect);
    if (focusRect && rectOutsideViewport(focusRect, viewport)) {
      pushIssue(issues, "focused-control-outside-viewport", "controle focado ficou fora da viewport", {
        key: focusCheck.key,
      });
    }
  }

  const contrastSamples = snapshot.contrastSamples ?? [];
  if (contrastSamples.length === 0) {
    recordLimitation(
      limitations,
      "contrast-not-observed",
      "snapshot nao trouxe razoes de contraste dos estilos computados"
    );
    if (snapshot.requireA11yEvidence) {
      pushIssue(issues, "contrast-evidence-missing", "evidencia de contraste obrigatoria nao foi coletada");
    }
  }
  for (const sample of contrastSamples.filter((item) => item?.visible ?? true)) {
    const ratio = Number(sample.ratio);
    if (!Number.isFinite(ratio)) {
      recordLimitation(limitations, "contrast-sample-unreadable", "amostra de contraste sem razao calculavel", {
        key: sample.key,
      });
      continue;
    }
    const minimum = sample.nonText || sample.largeText ? 3 : 4.5;
    if (ratio + 0.001 < minimum) {
      pushIssue(issues, sample.nonText ? "non-text-contrast-too-low" : "text-contrast-too-low", "contraste abaixo de WCAG 2.2 AA", {
        key: sample.key,
        ratio,
        minimum,
      });
    }
  }

  const adjustableRegions = snapshot.adjustableRegions ?? [];
  if (snapshot.requireAdaptiveEvidence && adjustableRegions.length === 0) {
    pushIssue(issues, "adaptive-region-evidence-missing", "evidencia de resize/movimento/auto-ocultacao nao foi coletada");
  }
  for (const region of adjustableRegions) {
    if (region.requiresManualResize && !region.manualResize) {
      pushIssue(issues, "manual-resize-missing", "regiao ajustavel sem redimensionamento manual", {
        key: region.key,
      });
    }
    if (region.requiresAutomaticResize && !region.automaticResize) {
      pushIssue(issues, "automatic-resize-missing", "regiao ajustavel sem redimensionamento automatico", {
        key: region.key,
      });
    }
    if (region.informationBox && !region.movable) {
      pushIssue(issues, "information-box-move-missing", "caixa informativa sem alternativa de movimentacao", {
        key: region.key,
      });
    }
    if (region.informationBox && !region.autoHide) {
      pushIssue(issues, "information-box-auto-hide-missing", "caixa informativa sem auto-ocultacao", {
        key: region.key,
      });
    }
    if (region.critical && region.autoHidden) {
      pushIssue(issues, "critical-region-auto-hidden", "alerta critico foi auto-ocultado", {
        key: region.key,
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
  const contextRail = elements.nodegraphContextRail;
  const overview = elements.nodegraphOverview;
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
  if ((target.id === "logic" || target.id === "nodegraph") && isVisible(canvas)) {
    for (const [key, element] of [
      ["nodegraphContextRail", contextRail],
      ["nodegraphOverview", overview],
    ]) {
      if (isVisible(element) && rectsOverlap(normalizeRect(canvas.rect), normalizeRect(element.rect), 4)) {
        pushIssue(issues, "nodegraph-context-overlaps-canvas", "painel de contexto do NodeGraph invade o canvas", {
          key,
        });
      }
    }
  }

  return {
    targetId: target.id,
    surfaceId: target.surfaceId ?? target.id,
    targetLabel: target.label,
    workspaceId,
    resolutionTag: snapshot.resolutionTag,
    ok: issues.length === 0,
    status: issues.length === 0 ? "passed" : "failed",
    issues,
    limitations,
    metrics,
    screenshot: snapshot.screenshot ?? null,
  };
}

export function buildUiLayoutOracleReport({
  artifactPrefix,
  records,
  generatedAt = new Date().toISOString(),
  requireCompleteMatrix = false,
}) {
  const targets = {};
  for (const record of records) {
    if (!targets[record.targetId]) {
      targets[record.targetId] = {};
    }
    targets[record.targetId][record.resolutionTag] = {
      status: record.ok ? "passed" : "failed",
      workspaceId: record.workspaceId ?? null,
      issues: record.issues ?? [],
      limitations: record.limitations ?? [],
      metrics: record.metrics ?? {},
      screenshot: record.screenshot ?? null,
    };
  }

  const failedRecords = records.filter((record) => !record.ok);
  const surfaces = {};
  let coveredSurfaceCells = 0;
  let passedSurfaceCells = 0;
  let failedSurfaceCells = 0;
  const missingSurfaceCells = [];

  for (const surface of UI_LAYOUT_ORACLE_SURFACES) {
    surfaces[surface.id] = {};
    const requiredTargetIds = requiredTargetIdsForSurface(surface);
    for (const resolution of UI_LAYOUT_ORACLE_RESOLUTIONS) {
      const matchingRecords = records.filter(
        (record) =>
          requiredTargetIds.includes(record.targetId) && record.resolutionTag === resolution.tag
      );
      const presentTargetIds = new Set(matchingRecords.map((record) => record.targetId));
      const missingTargetIds = requiredTargetIds.filter((targetId) => !presentTargetIds.has(targetId));
      const failedTargetIds = matchingRecords
        .filter((record) => !record.ok)
        .map((record) => record.targetId);
      const complete = missingTargetIds.length === 0;
      const passed = complete && failedTargetIds.length === 0;
      const status = !complete ? "missing" : passed ? "passed" : "failed";
      if (complete) coveredSurfaceCells += 1;
      if (passed) passedSurfaceCells += 1;
      if (status === "failed") failedSurfaceCells += 1;
      if (!complete) {
        missingSurfaceCells.push({
          surfaceId: surface.id,
          resolutionTag: resolution.tag,
          missingTargetIds,
        });
      }
      surfaces[surface.id][resolution.tag] = {
        status,
        requiredTargetIds,
        presentTargetIds: [...presentTargetIds],
        missingTargetIds,
        failedTargetIds,
      };
    }
  }

  const coverageComplete = missingSurfaceCells.length === 0;
  const reportFailed = failedRecords.length > 0 || (requireCompleteMatrix && !coverageComplete);
  return {
    generatedAt,
    artifactPrefix,
    status: reportFailed ? "failed" : "passed",
    summary: {
      total: records.length,
      passed: records.length - failedRecords.length,
      failed: failedRecords.length,
    },
    coverage: {
      status: coverageComplete ? "complete" : "incomplete",
      requiredSurfaceCells: UI_LAYOUT_ORACLE_REQUIRED_CELL_COUNT,
      coveredSurfaceCells,
      passedSurfaceCells,
      failedSurfaceCells,
      missingSurfaceCells,
    },
    requiredResolutions: UI_LAYOUT_ORACLE_RESOLUTIONS.map((resolution) => resolution.tag),
    requiredTargets: UI_LAYOUT_ORACLE_TARGETS.map((target) => target.id),
    requiredSurfaces: UI_LAYOUT_ORACLE_SURFACES.map((surface) => surface.id),
    targets,
    surfaces,
  };
}
