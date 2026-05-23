import { useEffect, useMemo, useState } from "react";

import { inspectRuntimeContracts } from "../../core/ipc/projectCapabilityService";
import { capabilityStatusLabel, capabilityTone, type RuntimeContractsReport } from "../../core/projectCapability";
import { useEditorStore } from "../../core/store/editorStore";

interface RuntimeContractsPanelProps {
  report?: RuntimeContractsReport | null;
  compact?: boolean;
}

const TONE_CLASS = {
  ok: "border-[#a6e3a1]/35 bg-[#a6e3a1]/10 text-[#a6e3a1]",
  warn: "border-[#f9e2af]/35 bg-[#f9e2af]/10 text-[#f9e2af]",
  block: "border-[#f38ba8]/35 bg-[#f38ba8]/10 text-[#f38ba8]",
  muted: "border-[#45475a] bg-[#11111b] text-[#7f849c]",
} as const;

export default function RuntimeContractsPanel({ report: injectedReport, compact = false }: RuntimeContractsPanelProps) {
  const activeProjectDir = useEditorStore((state) => state.activeProjectDir);
  const logMessage = useEditorStore((state) => state.logMessage);
  const [report, setReport] = useState<RuntimeContractsReport | null>(injectedReport ?? null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setReport(injectedReport ?? null);
  }, [injectedReport]);

  async function refresh() {
    if (!activeProjectDir) {
      logMessage("warn", "[Contracts] Abra um projeto antes de inspecionar contratos runtime.");
      return;
    }
    setLoading(true);
    try {
      setReport(await inspectRuntimeContracts(activeProjectDir));
      logMessage("info", "[Contracts] Contratos runtime atualizados.");
    } catch (error) {
      logMessage("error", `[Contracts] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  const contracts = useMemo(() => Object.values(report?.contracts ?? {}), [report]);

  return (
    <div className="rounded border border-[#313244] bg-[#11111b] p-3" data-testid="runtime-contracts-panel">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa]">Runtime Contracts</p>
          <p className="truncate font-mono text-[9px] text-[#45475a]">{report?.project_dir ?? (activeProjectDir || "(sem projeto)")}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || !activeProjectDir}
          className="rounded border border-[#89b4fa]/35 bg-[#89b4fa]/10 px-2 py-1 text-[9px] font-semibold text-[#89b4fa] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "..." : "Atualizar"}
        </button>
      </div>

      {contracts.length === 0 ? (
        <p className="mt-2 text-[10px] text-[#7f849c]" data-testid="runtime-contracts-empty">
          Sem snapshot de contratos.
        </p>
      ) : (
        <div className={compact ? "mt-2 grid grid-cols-2 gap-1" : "mt-3 grid grid-cols-2 gap-2"}>
          {contracts.map((contract) => {
            const tone = capabilityTone(contract.state);
            return (
              <div key={contract.id} className="rounded border border-[#313244] bg-[#181825] p-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[10px] text-[#cdd6f4]">{contract.title}</span>
                  <span className={`rounded border px-1.5 py-0.5 text-[8px] font-semibold uppercase ${TONE_CLASS[tone]}`}>
                    {capabilityStatusLabel(contract.state)}
                  </span>
                </div>
                {contract.experimental ? (
                  <span className="mt-1 inline-flex rounded border border-[#cba6f7]/35 bg-[#cba6f7]/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase text-[#cba6f7]">
                    Experimental
                  </span>
                ) : null}
                {!compact && contract.next_actions[0] ? (
                  <p className="mt-1 line-clamp-2 text-[9px] leading-snug text-[#7f849c]">{contract.next_actions[0]}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
