import { useEditorStore, HwStatus } from "../../core/store/editorStore";

// ── Sub-components ────────────────────────────────────────────────────────────

interface GaugeRowProps {
  label: string;
  used: number;
  limit: number;
  unit?: string;
}

function GaugeRow({ label, used, limit, unit = "" }: GaugeRowProps) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const exceeded = used > limit;
  const warning = !exceeded && pct >= 80;

  const barColor = exceeded
    ? "bg-[#f38ba8]"
    : warning
    ? "bg-[#fab387]"
    : "bg-[#a6e3a1]";

  const textColor = exceeded
    ? "text-[#f38ba8]"
    : warning
    ? "text-[#fab387]"
    : "text-[#cdd6f4]";

  const usedLabel = unit === "KB" ? `${(used / 1024).toFixed(1)} KB` : `${used}`;
  const limitLabel = unit === "KB" ? `${(limit / 1024).toFixed(0)} KB` : `${limit}`;

  return (
    <div className="px-3 py-1.5">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-[#7f849c]">{label}</span>
        <span className={`font-mono ${textColor}`}>
          {usedLabel} / {limitLabel}
          {exceeded && <span className="ml-1 font-bold">!</span>}
        </span>
      </div>
      <div className="h-1.5 w-full bg-[#1e1e2e] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function HardwareLimitsPanel() {
  const { hwStatus } = useEditorStore();

  const status: HwStatus = hwStatus ?? {
    vram_used: 0,
    vram_limit: 65536,
    sprite_count: 0,
    sprite_limit: 80,
    bg_layers: 0,
    bg_layers_limit: 3,
    errors: [],
    warnings: [],
  };

  const hasErrors = status.errors.length > 0;
  const hasWarnings = status.warnings.length > 0;

  return (
    <div className="flex flex-col gap-0">
      {/* Header */}
      <div
        className={`flex items-center justify-between px-3 py-1.5 text-xs font-semibold select-none border-b ${
          hasErrors
            ? "text-[#f38ba8] border-[#f38ba8]/30 bg-[#f38ba8]/5"
            : hasWarnings
            ? "text-[#fab387] border-[#fab387]/30 bg-[#fab387]/5"
            : "text-[#a6e3a1] border-[#313244] bg-transparent"
        }`}
      >
        <span>Hardware Limits</span>
        {hasErrors && (
          <span className="text-[10px] bg-[#f38ba8] text-[#1e1e2e] px-1.5 py-0.5 rounded font-bold">
            OVERFLOW
          </span>
        )}
        {!hasErrors && hasWarnings && (
          <span className="text-[10px] bg-[#fab387] text-[#1e1e2e] px-1.5 py-0.5 rounded font-bold">
            WARN
          </span>
        )}
        {!hasErrors && !hasWarnings && (
          <span className="text-[10px] text-[#45475a]">OK</span>
        )}
      </div>

      {/* Gauges */}
      <GaugeRow
        label="VRAM (sprites)"
        used={status.vram_used}
        limit={status.vram_limit}
        unit="KB"
      />
      <GaugeRow
        label="Sprites / tela"
        used={status.sprite_count}
        limit={status.sprite_limit}
      />
      <GaugeRow
        label="BG Layers"
        used={status.bg_layers}
        limit={status.bg_layers_limit}
      />

      {/* Error / warning messages */}
      {(hasErrors || hasWarnings) && (
        <div className="px-3 pt-1 pb-2 flex flex-col gap-1">
          {status.errors.map((msg, i) => (
            <p key={`e${i}`} className="text-[10px] text-[#f38ba8] leading-tight">
              ✕ {msg}
            </p>
          ))}
          {status.warnings.map((msg, i) => (
            <p key={`w${i}`} className="text-[10px] text-[#fab387] leading-tight">
              ⚠ {msg}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
