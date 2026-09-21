import { useMemo, useRef, useEffect, useState } from "react";
import { useEditorStore, ConsoleEntry } from "../../core/store/editorStore";
import {
  DIAGNOSTIC_AREA_LABELS,
  DIAGNOSTIC_SEVERITY_LABELS,
  diagnosticCopyText,
  type DiagnosticArea,
  type DiagnosticSeverity,
} from "../../core/diagnostics";
import Icon from "./Icon";

const LEVEL_STYLES: Record<ConsoleEntry["level"], string> = {
  info: "text-[var(--rds-status-info)]",
  warn: "text-[var(--rds-status-warning)]",
  error: "text-[var(--rds-status-error)]",
  success: "text-[var(--rds-status-success)]",
};

const LEVEL_PREFIX: Record<ConsoleEntry["level"], string> = {
  info: "[INFO]",
  warn: "[WARN]",
  error: "[ERROR]",
  success: "[OK]",
};

type ConsoleProps = {
  variant?: "inline" | "drawer";
};

export default function Console({ variant = "drawer" }: ConsoleProps) {
  const { consoleEntries, clearConsole, consoleVisible, toggleConsole } = useEditorStore();
  const bottomRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef<HTMLDivElement>(null);
  const previousEntryCountRef = useRef(consoleEntries.length);
  const [severityFilter, setSeverityFilter] = useState<DiagnosticSeverity | "all">("all");
  const [areaFilter, setAreaFilter] = useState<DiagnosticArea | "all">("all");
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [following, setFollowing] = useState(true);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const [drawerHeight, setDrawerHeight] = useState(() => {
    const saved = Number(localStorage.getItem("retrodev-console-height"));
    return Number.isFinite(saved) && saved >= 160 ? saved : 300;
  });
  const [detailsWidth, setDetailsWidth] = useState(() => {
    const saved = Number(localStorage.getItem("retrodev-console-details-width"));
    return Number.isFinite(saved) && saved >= 260 ? saved : 330;
  });

  useEffect(() => {
    const added = Math.max(0, consoleEntries.length - previousEntryCountRef.current);
    previousEntryCountRef.current = consoleEntries.length;
    if (consoleVisible && following) {
      bottomRef.current?.scrollIntoView?.({ behavior: "smooth" });
      setNewMessageCount(0);
    } else if (consoleVisible && added > 0) {
      setNewMessageCount((current) => current + added);
    }
  }, [consoleEntries, consoleVisible, following]);

  function clampDrawerHeight(value: number) {
    return Math.max(160, Math.min(Math.round(window.innerHeight * 0.65), Math.round(value)));
  }

  function updateDrawerHeight(value: number) {
    const next = clampDrawerHeight(value);
    setDrawerHeight(next);
    localStorage.setItem("retrodev-console-height", String(next));
  }

  function updateDetailsWidth(value: number) {
    const next = Math.max(260, Math.min(520, Math.round(value)));
    setDetailsWidth(next);
    localStorage.setItem("retrodev-console-details-width", String(next));
  }

  function jumpToLatest() {
    setFollowing(true);
    setNewMessageCount(0);
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }

  const diagnosticEntries = useMemo(
    () => consoleEntries.filter((entry) => entry.diagnostic),
    [consoleEntries]
  );
  const severityOptions = useMemo(
    () =>
      Array.from(
        new Set(
          diagnosticEntries
            .map((entry) => entry.diagnostic?.severity)
            .filter((severity): severity is DiagnosticSeverity => Boolean(severity))
        )
      ),
    [diagnosticEntries]
  );
  const areaOptions = useMemo(
    () =>
      Array.from(
        new Set(
          diagnosticEntries
            .map((entry) => entry.diagnostic?.area)
            .filter((area): area is DiagnosticArea => Boolean(area))
        )
      ),
    [diagnosticEntries]
  );
  const filteredEntries = useMemo(
    () => {
      const hasActiveFilter = severityFilter !== "all" || areaFilter !== "all";
      return consoleEntries.filter((entry) => {
        if (!entry.diagnostic) {
          return !hasActiveFilter;
        }
        return (
          (severityFilter === "all" || entry.diagnostic.severity === severityFilter) &&
          (areaFilter === "all" || entry.diagnostic.area === areaFilter)
        );
      });
    },
    [areaFilter, consoleEntries, severityFilter]
  );
  const selectedEntry = useMemo(
    () =>
      filteredEntries.find((entry) => entry.id === selectedEntryId) ??
      filteredEntries.find((entry) => entry.diagnostic) ??
      null,
    [filteredEntries, selectedEntryId]
  );

  if (variant === "drawer" && !consoleVisible) {
    return null;
  }

  const drawerShell =
    variant === "drawer"
      ? "pointer-events-auto fixed bottom-7 left-[56px] right-0 z-40 flex flex-col border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] shadow-[var(--rds-shadow-elevated)]"
      : "flex flex-col border-t border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)]";

  const selectedDiagnostic = selectedEntry?.diagnostic;

  async function copySelectedDiagnostic() {
    if (!selectedDiagnostic) {
      return;
    }
    await navigator.clipboard?.writeText(diagnosticCopyText(selectedDiagnostic));
  }

  async function copyEvidencePath() {
    if (selectedDiagnostic?.evidence_path) {
      await navigator.clipboard?.writeText(selectedDiagnostic.evidence_path);
    }
  }

  return (
    <div
      data-testid="console-drawer"
      data-visible={consoleVisible ? "true" : "false"}
      className={drawerShell}
      style={
        variant === "inline"
          ? { height: consoleVisible ? "160px" : "28px" }
          : { height: drawerHeight }
      }
    >
      {variant === "drawer" ? (
        <button
          type="button"
          role="separator"
          aria-label="Redimensionar Console"
          aria-orientation="horizontal"
          aria-valuemin={160}
          aria-valuemax={Math.round(window.innerHeight * 0.65)}
          aria-valuenow={drawerHeight}
          title="Arraste para redimensionar. Setas: 8 px; Shift + setas: 32 px; Enter: ajuste automatico."
          className="group absolute -top-1 left-0 right-0 z-10 flex h-2 cursor-row-resize items-center justify-center"
          onDoubleClick={() => updateDrawerHeight(300)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 32 : 8;
            if (event.key === "ArrowUp") updateDrawerHeight(drawerHeight + step);
            else if (event.key === "ArrowDown") updateDrawerHeight(drawerHeight - step);
            else if (event.key === "Home") updateDrawerHeight(160);
            else if (event.key === "End") updateDrawerHeight(window.innerHeight * 0.65);
            else if (event.key === "Enter") updateDrawerHeight(300);
            else return;
            event.preventDefault();
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            updateDrawerHeight(window.innerHeight - event.clientY - 28);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              updateDrawerHeight(window.innerHeight - event.clientY - 28);
            }
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
          }}
        >
          <span className="h-px w-12 bg-[var(--rds-border-strong)] transition-colors group-hover:bg-[var(--rds-action-primary)]" />
        </button>
      ) : null}
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel)] px-3">
        <button
          type="button"
          onClick={toggleConsole}
          className="flex min-h-6 select-none items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--rds-text-primary)] transition-colors hover:text-[var(--rds-text-inverse)]"
          aria-expanded={consoleVisible}
        >
          <Icon name="terminal" size={15} />
          Console
          {consoleEntries.length > 0 && (
            <span className="ml-1 text-[var(--rds-text-muted)]">({consoleEntries.length})</span>
          )}
        </button>
        {consoleVisible && (
          <div className="flex items-center gap-2">
          {newMessageCount > 0 ? (
            <button
              type="button"
              data-testid="console-jump-latest"
              onClick={jumpToLatest}
              className="min-h-6 rounded border border-[var(--rds-status-info)] px-2 text-[10px] text-[var(--rds-status-info)]"
            >
              {newMessageCount} nova(s) · Ir ao fim
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setSelectedEntryId(null);
              clearConsole();
            }}
            className="min-h-6 select-none text-xs text-[var(--rds-text-muted)] transition-colors hover:text-[var(--rds-status-error)]"
            title="Limpar console"
          >
            Limpar
          </button>
          </div>
        )}
      </div>

      {consoleVisible && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {diagnosticEntries.length > 0 ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--rds-border-subtle)] px-3 py-2 text-[10px]">
              <span className="font-semibold uppercase text-[var(--rds-text-muted)]">Severidade</span>
              <button
                type="button"
                data-testid="console-filter-severity-all"
                onClick={() => setSeverityFilter("all")}
                className={`min-h-6 rounded border px-2 py-1 ${severityFilter === "all" ? "border-[var(--rds-action-primary)] text-[var(--rds-text-primary)]" : "border-[var(--rds-border-subtle)] text-[var(--rds-text-muted)]"}`}
              >
                Todos
              </button>
              {severityOptions.map((severity) => (
                <button
                  key={severity}
                  type="button"
                  data-testid={`console-filter-severity-${severity}`}
                  onClick={() => setSeverityFilter(severity)}
                  className={`min-h-6 rounded border px-2 py-1 ${severityFilter === severity ? "border-[var(--rds-action-primary)] text-[var(--rds-text-primary)]" : "border-[var(--rds-border-subtle)] text-[var(--rds-text-muted)]"}`}
                >
                  {DIAGNOSTIC_SEVERITY_LABELS[severity]}
                </button>
              ))}
              <span className="ml-2 font-semibold uppercase text-[var(--rds-text-muted)]">Area</span>
              <button
                type="button"
                data-testid="console-filter-area-all"
                onClick={() => setAreaFilter("all")}
                className={`min-h-6 rounded border px-2 py-1 ${areaFilter === "all" ? "border-[var(--rds-action-primary)] text-[var(--rds-text-primary)]" : "border-[var(--rds-border-subtle)] text-[var(--rds-text-muted)]"}`}
              >
                Todas
              </button>
              {areaOptions.map((area) => (
                <button
                  key={area}
                  type="button"
                  data-testid={`console-filter-area-${area}`}
                  onClick={() => setAreaFilter(area)}
                  className={`min-h-6 rounded border px-2 py-1 ${areaFilter === area ? "border-[var(--rds-action-primary)] text-[var(--rds-text-primary)]" : "border-[var(--rds-border-subtle)] text-[var(--rds-text-muted)]"}`}
                >
                  {DIAGNOSTIC_AREA_LABELS[area]}
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1">
            <div
              ref={entriesRef}
              className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-1 font-mono text-xs"
              onScroll={(event) => {
                const element = event.currentTarget;
                const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
                setFollowing(atEnd);
                if (atEnd) setNewMessageCount(0);
              }}
            >
              {filteredEntries.length === 0 ? (
                <span className="italic text-[var(--rds-text-muted)]">Nenhuma saida para os filtros.</span>
              ) : (
                filteredEntries.map((entry, index) => {
                  const entryContent = (
                    <>
                      <span className="shrink-0 text-[var(--rds-text-muted)]">{entry.timestamp}</span>
                      <span className={`shrink-0 font-bold ${LEVEL_STYLES[entry.level]}`}>
                        {LEVEL_PREFIX[entry.level]}
                      </span>
                      <span className="min-w-0 break-all text-left text-[var(--rds-text-primary)]">
                        {entry.message}
                      </span>
                    </>
                  );
                  return entry.diagnostic ? (
                    <button
                      key={entry.id}
                      type="button"
                      data-testid={`console-entry-${index + 1}`}
                      onClick={() => setSelectedEntryId(entry.id)}
                      className={`flex min-h-6 w-full gap-2 rounded px-1 leading-5 text-left ${selectedEntry?.id === entry.id ? "bg-[var(--rds-surface-active)]" : "hover:bg-[var(--rds-surface-hover)]"}`}
                    >
                      {entryContent}
                    </button>
                  ) : (
                    <div key={entry.id} className="flex gap-2 px-1 leading-5">
                      {entryContent}
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            <button
              type="button"
              role="separator"
              aria-label="Redimensionar detalhes do Console"
              aria-orientation="vertical"
              aria-valuemin={260}
              aria-valuemax={520}
              aria-valuenow={detailsWidth}
              title="Arraste para redimensionar. Setas: 8 px; Shift + setas: 32 px; Enter: ajuste automatico."
              className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
              onDoubleClick={() => updateDetailsWidth(330)}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 32 : 8;
                if (event.key === "ArrowLeft") updateDetailsWidth(detailsWidth + step);
                else if (event.key === "ArrowRight") updateDetailsWidth(detailsWidth - step);
                else if (event.key === "Home") updateDetailsWidth(260);
                else if (event.key === "End") updateDetailsWidth(520);
                else if (event.key === "Enter") updateDetailsWidth(330);
                else return;
                event.preventDefault();
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                const parentRect = event.currentTarget.parentElement?.getBoundingClientRect();
                if (parentRect) updateDetailsWidth(parentRect.right - event.clientX);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
            >
              <span className="h-10 w-px bg-[var(--rds-border-subtle)] transition-colors group-hover:bg-[var(--rds-action-primary)]" />
            </button>

            <aside
              data-testid="console-details"
              className="min-h-0 shrink-0 overflow-y-auto border-l border-[var(--rds-border-subtle)] bg-[var(--rds-surface-overlay)] p-3 text-xs text-[var(--rds-text-primary)]"
              style={{ width: detailsWidth }}
            >
              {selectedDiagnostic ? (
                <div className="grid gap-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase text-[var(--rds-status-info)]">
                      Detalhes
                    </div>
                    <div className="mt-1 font-semibold text-[var(--rds-text-primary)]">
                      {selectedDiagnostic.user_message}
                    </div>
                  </div>
                  <div className="grid gap-1 text-[var(--rds-text-secondary)]">
                    <span>Area: {DIAGNOSTIC_AREA_LABELS[selectedDiagnostic.area]}</span>
                    <span>Severidade: {DIAGNOSTIC_SEVERITY_LABELS[selectedDiagnostic.severity]}</span>
                    {selectedDiagnostic.source_path ? (
                      <span className="break-all">
                        Arquivo: {selectedDiagnostic.source_path}
                        {selectedDiagnostic.line ? `:${selectedDiagnostic.line}` : ""}
                        {selectedDiagnostic.column ? `:${selectedDiagnostic.column}` : ""}
                      </span>
                    ) : null}
                    {selectedDiagnostic.evidence_path ? (
                      <button
                        type="button"
                        data-testid="console-evidence-link"
                        onClick={copyEvidencePath}
                        className="min-h-6 break-all text-left text-[var(--rds-status-info)] underline underline-offset-2"
                        title={selectedDiagnostic.evidence_path}
                      >
                        Copiar caminho do artefato: {selectedDiagnostic.evidence_path}
                      </button>
                    ) : null}
                  </div>
                  <div className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-input)] p-2">
                    <div className="text-[10px] font-semibold uppercase text-[var(--rds-status-success)]">
                      Acao Recomendada
                    </div>
                    <p className="mt-1 leading-relaxed text-[var(--rds-text-secondary)]">
                      {selectedDiagnostic.suggested_action}
                    </p>
                  </div>
                  <details
                    data-testid="console-details-technical"
                    className="rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] p-2"
                  >
                    <summary className="cursor-pointer text-[10px] font-semibold uppercase text-[var(--rds-status-warning)]">
                      Detalhe tecnico / rastreamento
                    </summary>
                    <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--rds-text-secondary)]">
                      {selectedDiagnostic.technical_detail}
                    </pre>
                  </details>
                  <button
                    type="button"
                    data-testid="console-copy-diagnostic"
                    onClick={copySelectedDiagnostic}
                    className="min-h-7 rounded border border-[var(--rds-border-default)] bg-[var(--rds-surface-input)] px-3 py-2 text-left text-[11px] font-semibold uppercase text-[var(--rds-text-secondary)] transition-colors hover:border-[var(--rds-action-primary)] hover:text-[var(--rds-text-inverse)]"
                  >
                    Copiar erro
                  </button>
                </div>
              ) : (
                <span className="italic text-[var(--rds-text-muted)]">
                  Selecione um diagnostico para ver detalhe tecnico e acao.
                </span>
              )}
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
