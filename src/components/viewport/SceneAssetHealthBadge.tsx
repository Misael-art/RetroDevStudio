import type { SceneAssetHealth } from "../../core/sceneAssetHealth";

const HEALTH_TONE = {
  info: "border-[#89b4fa]/35 bg-[#11111b]/90 text-[#89b4fa]",
  warn: "border-[#fab387]/35 bg-[#11111b]/90 text-[#fab387]",
  success: "border-[#a6e3a1]/35 bg-[#11111b]/90 text-[#a6e3a1]",
} as const;

export default function SceneAssetHealthBadge({
  health,
}: {
  health: SceneAssetHealth;
}) {
  return (
    <div
      data-testid="viewport-asset-health"
      className={`absolute left-2 top-2 z-10 max-w-[320px] rounded border px-2.5 py-2 text-[10px] ${HEALTH_TONE[health.tone]}`}
    >
      <p className="font-semibold">{health.title}</p>
      <p className="mt-1 leading-relaxed text-[#cdd6f4]">{health.detail}</p>
      <p className="mt-2 font-mono text-[#94a3b8]">
        {health.compactSummary}
        {health.loading > 0 ? ` | loading ${health.loading}` : ""}
        {health.missing > 0 ? ` | missing ${health.missing}` : ""}
        {health.failed > 0 ? ` | failed ${health.failed}` : ""}
        {health.legacyFallback > 0 ? ` | fallback ${health.legacyFallback}` : ""}
      </p>
    </div>
  );
}
