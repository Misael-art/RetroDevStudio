import {
  useEditorStore,
  type HwStatus,
  type HwValidationState,
} from "../../core/store/editorStore";

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
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-[#7f849c]">{label}</span>
        <span className={`font-mono ${textColor}`}>
          {usedLabel} / {limitLabel}
          {exceeded && <span className="ml-1 font-bold">!</span>}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1e1e2e]">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function getValidationBadge(state: HwValidationState) {
  switch (state) {
    case "pending":
      return { label: "ANALISANDO", className: "font-semibold text-[#89b4fa]" };
    case "fresh":
      return { label: "LIVE", className: "font-semibold text-[#a6e3a1]" };
    case "stale":
      return { label: "DESATUAL.", className: "font-semibold text-[#fab387]" };
    case "error":
      return { label: "ERRO", className: "font-semibold text-[#f38ba8]" };
    default:
      return { label: "IDLE", className: "font-semibold text-[#45475a]" };
  }
}

function getValidationMessage({
  hwValidationError,
  hwValidatedRevision,
  hwValidationState,
  sceneRevision,
}: {
  hwValidationError: string | null;
  hwValidatedRevision: number;
  hwValidationState: HwValidationState;
  sceneRevision: number;
}) {
  if (hwValidationState === "error" && hwValidationError) {
    return hwValidationError;
  }

  if (hwValidationState === "fresh") {
    return `Preview sincronizado na revisao ${hwValidatedRevision}.`;
  }

  if (hwValidationState === "stale") {
    return `Draft mudou para revisao ${sceneRevision}.`;
  }

  if (hwValidationState === "pending") {
    return `Validando revisao ${sceneRevision}...`;
  }

  return "Sem preview ativo.";
}

export default function HardwareLimitsPanel() {
  const {
    hwStatus,
    hwValidationError,
    hwValidationState,
    hwValidatedRevision,
    sceneRevision,
  } = useEditorStore();

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
  const liveBadge = getValidationBadge(hwValidationState);
  const liveMessage = getValidationMessage({
    hwValidationError,
    hwValidatedRevision,
    hwValidationState,
    sceneRevision,
  });

  return (
    <div className="flex flex-col gap-0">
      <div
        className={`flex items-center justify-between border-b px-3 py-1.5 text-xs font-semibold select-none ${
          hasErrors
            ? "border-[#f38ba8]/30 bg-[#f38ba8]/5 text-[#f38ba8]"
            : hasWarnings
              ? "border-[#fab387]/30 bg-[#fab387]/5 text-[#fab387]"
              : "border-[#313244] bg-transparent text-[#a6e3a1]"
        }`}
      >
        <span>Hardware Limits</span>
        {hasErrors && (
          <span
            data-testid="hardware-limits-severity"
            className="rounded bg-[#f38ba8] px-1.5 py-0.5 text-[10px] font-bold text-[#1e1e2e]"
          >
            OVERFLOW
          </span>
        )}
        {!hasErrors && hasWarnings && (
          <span
            data-testid="hardware-limits-severity"
            className="rounded bg-[#fab387] px-1.5 py-0.5 text-[10px] font-bold text-[#1e1e2e]"
          >
            WARN
          </span>
        )}
        {!hasErrors && !hasWarnings && (
          <span data-testid="hardware-limits-severity" className="text-[10px] text-[#45475a]">
            OK
          </span>
        )}
      </div>

      <div className="flex items-center justify-between border-b border-[#313244] px-3 py-1 text-[10px]">
        <span data-testid="hardware-validation-state" className={liveBadge.className}>
          {liveBadge.label}
        </span>
        <span className="max-w-[11rem] truncate text-right text-[#7f849c]" title={liveMessage}>
          {liveMessage}
        </span>
      </div>

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

      {(hasErrors || hasWarnings) && (
        <div className="flex flex-col gap-1 px-3 pb-2 pt-1">
          {status.errors.map((message, index) => (
            <p
              key={`e${index}`}
              data-testid={`hardware-error-${index}`}
              className="text-[10px] leading-tight text-[#f38ba8]"
            >
              x {message}
            </p>
          ))}
          {status.warnings.map((message, index) => (
            <p
              key={`w${index}`}
              data-testid={`hardware-warning-${index}`}
              className="text-[10px] leading-tight text-[#fab387]"
            >
              ! {message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
