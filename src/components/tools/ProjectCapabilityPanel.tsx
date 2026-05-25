import { useEffect, useMemo, useState } from "react";

import {
  CAPABILITY_AXIS_LABELS,
  capabilityStatusLabel,
  capabilityTone,
  type AudioPipelineReport,
  type CapabilityAxisReport,
  type ProjectCapabilityReport,
} from "../../core/projectCapability";
import {
  inspectAudioPipeline,
  inspectProjectCapability,
} from "../../core/ipc/projectCapabilityService";
import { useEditorStore } from "../../core/store/editorStore";

interface ProjectCapabilityPanelProps {
  report?: ProjectCapabilityReport | null;
  audioReport?: AudioPipelineReport | null;
  compact?: boolean;
}

const TONE_CLASS = {
  ok: "border-[#a6e3a1]/35 bg-[#a6e3a1]/10 text-[#a6e3a1]",
  warn: "border-[#f9e2af]/35 bg-[#f9e2af]/10 text-[#f9e2af]",
  block: "border-[#f38ba8]/35 bg-[#f38ba8]/10 text-[#f38ba8]",
  muted: "border-[#45475a] bg-[#11111b] text-[#7f849c]",
} as const;

function AxisPill({ axis }: { axis: CapabilityAxisReport }) {
  const tone = capabilityTone(axis.status);
  return (
    <span
      className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${TONE_CLASS[tone]}`}
      title={axis.status}
    >
      {capabilityStatusLabel(axis.status)}
    </span>
  );
}

function AxisCard({ label, axis }: { label: string; axis: CapabilityAxisReport }) {
  return (
    <div className="rounded border border-[#313244] bg-[#11111b] p-2" data-testid={`capability-axis-${label}`}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-[#cdd6f4]">
          {label}
        </span>
        <AxisPill axis={axis} />
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {axis.experimental ? (
          <span className="rounded border border-[#cba6f7]/35 bg-[#cba6f7]/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase text-[#cba6f7]">
            Experimental
          </span>
        ) : null}
        <span className="rounded border border-[#313244] bg-[#181825] px-1.5 py-0.5 text-[8px] uppercase text-[#7f849c]">
          {axis.maturity}
        </span>
      </div>
      {axis.blocking_statuses.length > 0 ? (
        <p className="mt-1 truncate text-[9px] text-[#f38ba8]" title={axis.blocking_statuses.join(", ")}>
          {capabilityStatusLabel(axis.blocking_statuses[0])}
        </p>
      ) : null}
      {axis.next_actions[0] ? (
        <p className="mt-1 line-clamp-2 text-[9px] leading-snug text-[#7f849c]">
          {axis.next_actions[0]}
        </p>
      ) : null}
    </div>
  );
}

function AudioSemaphore({ report }: { report: AudioPipelineReport | null }) {
  const entries = report?.entries ?? [];
  const warnings = entries.reduce((count, entry) => count + entry.warnings.length, 0);
  const clipping = entries.filter((entry) => entry.clipping.detected).length;
  const invalidRates = entries.filter((entry) => entry.sample_rate.status === "invalid").length;
  return (
    <div className="rounded border border-[#313244] bg-[#11111b] p-2" data-testid="audio-capability-panel">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-[#cdd6f4]">Audio Pipeline</span>
        <span
          className={`ml-auto rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
            warnings > 0 ? TONE_CLASS.warn : entries.length > 0 ? TONE_CLASS.ok : TONE_CLASS.muted
          }`}
        >
          {entries.length === 0 ? "not applicable" : warnings > 0 ? "warnings" : "ok"}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1 text-center">
        <div className="rounded bg-[#181825] p-1">
          <div className="text-[8px] uppercase text-[#45475a]">Assets</div>
          <div className="text-xs font-bold text-[#cdd6f4]">{entries.length}</div>
        </div>
        <div className="rounded bg-[#181825] p-1">
          <div className="text-[8px] uppercase text-[#45475a]">Clip</div>
          <div className="text-xs font-bold text-[#f38ba8]">{clipping}</div>
        </div>
        <div className="rounded bg-[#181825] p-1">
          <div className="text-[8px] uppercase text-[#45475a]">Rate</div>
          <div className="text-xs font-bold text-[#f9e2af]">{invalidRates}</div>
        </div>
      </div>
      {report?.axis.next_actions[0] ? (
        <p className="mt-2 text-[9px] leading-snug text-[#7f849c]">{report.axis.next_actions[0]}</p>
      ) : null}
    </div>
  );
}

export default function ProjectCapabilityPanel({
  report: injectedReport,
  audioReport: injectedAudioReport,
  compact = false,
}: ProjectCapabilityPanelProps) {
  const activeProjectDir = useEditorStore((state) => state.activeProjectDir);
  const logMessage = useEditorStore((state) => state.logMessage);
  const [report, setReport] = useState<ProjectCapabilityReport | null>(injectedReport ?? null);
  const [audioReport, setAudioReport] = useState<AudioPipelineReport | null>(injectedAudioReport ?? null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setReport(injectedReport ?? null);
  }, [injectedReport]);

  useEffect(() => {
    setAudioReport(injectedAudioReport ?? null);
  }, [injectedAudioReport]);

  async function refresh() {
    if (!activeProjectDir) {
      logMessage("warn", "[Capability] Abra um projeto antes de inspecionar.");
      return;
    }
    setLoading(true);
    try {
      const [capability, audio] = await Promise.all([
        inspectProjectCapability(activeProjectDir),
        inspectAudioPipeline(activeProjectDir),
      ]);
      setReport(capability);
      setAudioReport(audio);
      logMessage("info", "[Capability] Diagnosticos experimentais atualizados.");
    } catch (error) {
      logMessage("error", `[Capability] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  const axes = useMemo(() => {
    if (!report) {
      return [];
    }
    return CAPABILITY_AXIS_LABELS
      .filter(([key]) => key !== "blockers" && typeof report[key] === "object")
      .map(([key, label]) => [label, report[key] as CapabilityAxisReport] as const);
  }, [report]);

  return (
    <div className="flex flex-col gap-3" data-testid="project-capability-panel">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-[#cdd6f4]">Capability Diagnostics</p>
          <p className="truncate font-mono text-[9px] text-[#45475a]">{report?.project_dir ?? (activeProjectDir || "(sem projeto)")}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || !activeProjectDir}
          className="rounded border border-[#89b4fa]/35 bg-[#89b4fa]/10 px-2 py-1 text-[10px] font-semibold text-[#89b4fa] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? "Inspecionando..." : "Inspecionar"}
        </button>
      </div>

      {!report ? (
        <div className="rounded border border-[#313244] bg-[#11111b] p-3 text-[10px] text-[#7f849c]" data-testid="capability-empty">
          Sem snapshot de capability.
        </div>
      ) : (
        <>
          <div className={compact ? "grid grid-cols-1 gap-2" : "grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3"}>
            {axes.map(([label, axis]) => (
              <AxisCard key={label} label={label} axis={axis} />
            ))}
          </div>
          <AudioSemaphore report={audioReport} />
          {report.blockers.length > 0 ? (
            <div className="rounded border border-[#f38ba8]/30 bg-[#f38ba8]/10 p-2" data-testid="capability-blockers">
              <p className="text-[10px] font-semibold uppercase text-[#f38ba8]">{report.blockers.length} blocker(s)</p>
              {report.blockers.slice(0, 3).map((blocker, index) => (
                <p key={`${blocker.area}-${index}`} className="mt-1 text-[9px] leading-snug text-[#f5c2e7]">
                  {blocker.user_message} {blocker.suggested_action}
                </p>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
