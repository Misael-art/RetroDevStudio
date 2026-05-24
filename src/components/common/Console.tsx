import { useMemo, useRef, useEffect, useState } from "react";
import { useEditorStore, ConsoleEntry } from "../../core/store/editorStore";
import {
  DIAGNOSTIC_AREA_LABELS,
  DIAGNOSTIC_SEVERITY_LABELS,
  diagnosticCopyText,
  type DiagnosticArea,
  type DiagnosticSeverity,
} from "../../core/diagnostics";

const LEVEL_STYLES: Record<ConsoleEntry["level"], string> = {
  info: "text-[#89b4fa]",
  warn: "text-[#f9e2af]",
  error: "text-[#f38ba8]",
  success: "text-[#a6e3a1]",
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
  const [severityFilter, setSeverityFilter] = useState<DiagnosticSeverity | "all">("all");
  const [areaFilter, setAreaFilter] = useState<DiagnosticArea | "all">("all");
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);

  useEffect(() => {
    if (consoleVisible) {
      bottomRef.current?.scrollIntoView?.({ behavior: "smooth" });
    }
  }, [consoleEntries, consoleVisible]);

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
    () =>
      consoleEntries.filter((entry) => {
        if (!entry.diagnostic) {
          return severityFilter === "all" && areaFilter === "all";
        }
        return (
          (severityFilter === "all" || entry.diagnostic.severity === severityFilter) &&
          (areaFilter === "all" || entry.diagnostic.area === areaFilter)
        );
      }),
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
      ? "pointer-events-auto fixed bottom-7 left-[56px] right-0 z-40 flex max-h-[min(44vh,360px)] flex-col border border-[#313244] bg-[#11111b]/98 shadow-[0_-12px_40px_rgba(0,0,0,0.45)] backdrop-blur-sm"
      : "flex flex-col border-t border-[#313244] bg-[#11111b]";

  const selectedDiagnostic = selectedEntry?.diagnostic;

  async function copySelectedDiagnostic() {
    if (!selectedDiagnostic) {
      return;
    }
    await navigator.clipboard?.writeText(diagnosticCopyText(selectedDiagnostic));
  }

  return (
    <div
      data-testid="console-drawer"
      data-visible={consoleVisible ? "true" : "false"}
      className={drawerShell}
      style={variant === "inline" ? { height: consoleVisible ? "160px" : "28px" } : undefined}
    >
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-[#313244] bg-[#181825] px-3">
        <button
          type="button"
          onClick={toggleConsole}
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#cdd6f4] transition-colors hover:text-white select-none"
          aria-expanded={consoleVisible}
        >
          <span className={`transition-transform ${consoleVisible ? "rotate-90" : ""}`}>▶</span>
          Console
          {consoleEntries.length > 0 && (
            <span className="ml-1 text-[#6c7086]">({consoleEntries.length})</span>
          )}
        </button>
        {consoleVisible && (
          <button
            type="button"
            onClick={() => {
              setSelectedEntryId(null);
              clearConsole();
            }}
            className="text-xs text-[#6c7086] transition-colors hover:text-[#f38ba8] select-none"
            title="Limpar console"
          >
            ✕ Limpar
          </button>
        )}
      </div>

      {consoleVisible && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {diagnosticEntries.length > 0 ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#1f2937] px-3 py-2 text-[10px]">
              <span className="font-semibold uppercase text-[#6c7086]">Severity</span>
              <button
                type="button"
                data-testid="console-filter-severity-all"
                onClick={() => setSeverityFilter("all")}
                className={`rounded border px-2 py-1 ${severityFilter === "all" ? "border-[#89b4fa] text-[#cdd6f4]" : "border-[#313244] text-[#7f849c]"}`}
              >
                Todos
              </button>
              {severityOptions.map((severity) => (
                <button
                  key={severity}
                  type="button"
                  data-testid={`console-filter-severity-${severity}`}
                  onClick={() => setSeverityFilter(severity)}
                  className={`rounded border px-2 py-1 ${severityFilter === severity ? "border-[#89b4fa] text-[#cdd6f4]" : "border-[#313244] text-[#7f849c]"}`}
                >
                  {DIAGNOSTIC_SEVERITY_LABELS[severity]}
                </button>
              ))}
              <span className="ml-2 font-semibold uppercase text-[#6c7086]">Area</span>
              <button
                type="button"
                data-testid="console-filter-area-all"
                onClick={() => setAreaFilter("all")}
                className={`rounded border px-2 py-1 ${areaFilter === "all" ? "border-[#89b4fa] text-[#cdd6f4]" : "border-[#313244] text-[#7f849c]"}`}
              >
                Todas
              </button>
              {areaOptions.map((area) => (
                <button
                  key={area}
                  type="button"
                  data-testid={`console-filter-area-${area}`}
                  onClick={() => setAreaFilter(area)}
                  className={`rounded border px-2 py-1 ${areaFilter === area ? "border-[#89b4fa] text-[#cdd6f4]" : "border-[#313244] text-[#7f849c]"}`}
                >
                  {DIAGNOSTIC_AREA_LABELS[area]}
                </button>
              ))}
            </div>
          ) : null}

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(260px,360px)]">
            <div className="min-h-0 overflow-y-auto px-3 py-1 font-mono text-xs">
              {filteredEntries.length === 0 ? (
                <span className="text-[#45475a] italic">Nenhuma saída para os filtros.</span>
              ) : (
                filteredEntries.map((entry, index) => {
                  const entryContent = (
                    <>
                      <span className="shrink-0 text-[#45475a]">{entry.timestamp}</span>
                      <span className={`shrink-0 font-bold ${LEVEL_STYLES[entry.level]}`}>
                        {LEVEL_PREFIX[entry.level]}
                      </span>
                      <span className="min-w-0 break-all text-left text-[#cdd6f4]">
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
                      className={`flex w-full gap-2 rounded px-1 leading-5 text-left ${selectedEntry?.id === entry.id ? "bg-[#313244]/70" : "hover:bg-[#1e1e2e]"}`}
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

            <aside
              data-testid="console-details"
              className="min-h-0 overflow-y-auto border-l border-[#313244] bg-[#0b1120]/80 p-3 text-xs text-[#cdd6f4]"
            >
              {selectedDiagnostic ? (
                <div className="grid gap-3">
                  <div>
                    <div className="text-[10px] font-semibold uppercase text-[#89b4fa]">
                      Details
                    </div>
                    <div className="mt-1 font-semibold text-[#f8fafc]">
                      {selectedDiagnostic.user_message}
                    </div>
                  </div>
                  <div className="grid gap-1 text-[#bac2de]">
                    <span>Area: {DIAGNOSTIC_AREA_LABELS[selectedDiagnostic.area]}</span>
                    <span>Severity: {DIAGNOSTIC_SEVERITY_LABELS[selectedDiagnostic.severity]}</span>
                    {selectedDiagnostic.source_path ? (
                      <span className="break-all">
                        Arquivo: {selectedDiagnostic.source_path}
                        {selectedDiagnostic.line ? `:${selectedDiagnostic.line}` : ""}
                        {selectedDiagnostic.column ? `:${selectedDiagnostic.column}` : ""}
                      </span>
                    ) : null}
                    {selectedDiagnostic.evidence_path ? (
                      <a
                        data-testid="console-evidence-link"
                        href="#"
                        onClick={(event) => event.preventDefault()}
                        className="break-all text-[#89b4fa] underline decoration-[#89b4fa]/40 underline-offset-2"
                        title={selectedDiagnostic.evidence_path}
                      >
                        Artefato/log: {selectedDiagnostic.evidence_path}
                      </a>
                    ) : null}
                  </div>
                  <div className="rounded border border-[#313244] bg-[#111827] p-2">
                    <div className="text-[10px] font-semibold uppercase text-[#a6e3a1]">
                      Acao Recomendada
                    </div>
                    <p className="mt-1 leading-relaxed text-[#d1fae5]">
                      {selectedDiagnostic.suggested_action}
                    </p>
                  </div>
                  <details
                    data-testid="console-details-technical"
                    className="rounded border border-[#313244] bg-[#0f172a] p-2"
                  >
                    <summary className="cursor-pointer text-[10px] font-semibold uppercase text-[#f9e2af]">
                      Detalhe Tecnico / Stack Trace
                    </summary>
                    <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[#cbd5e1]">
                      {selectedDiagnostic.technical_detail}
                    </pre>
                  </details>
                  <button
                    type="button"
                    data-testid="console-copy-diagnostic"
                    onClick={copySelectedDiagnostic}
                    className="rounded border border-[#334155] bg-[#111827] px-3 py-2 text-left text-[11px] font-semibold uppercase text-[#cbd5e1] transition-colors hover:border-[#89b4fa]/50 hover:text-white"
                  >
                    Copiar erro
                  </button>
                </div>
              ) : (
                <span className="text-[#45475a] italic">
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
