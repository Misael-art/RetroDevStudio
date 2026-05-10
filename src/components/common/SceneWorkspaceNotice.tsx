import type { ReactNode } from "react";

import type { SceneWorkspaceContext } from "../../core/sceneWorkspaceContext";

const NOTICE_TONE = {
  info: "border-[#89b4fa]/30 bg-[#89b4fa]/8 text-[#89b4fa]",
  warn: "border-[#fab387]/30 bg-[#fab387]/8 text-[#fab387]",
  success: "border-[#a6e3a1]/30 bg-[#a6e3a1]/8 text-[#a6e3a1]",
} as const;

type SceneWorkspaceNoticeProps = {
  context: SceneWorkspaceContext;
  testId?: string;
  actions?: ReactNode;
};

export default function SceneWorkspaceNotice({
  context,
  testId,
  actions,
}: SceneWorkspaceNoticeProps) {
  return (
    <section
      data-testid={testId}
      className={`rounded-xl border px-3 py-2 ${NOTICE_TONE[context.tone]}`}
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em]">
            {context.eyebrow}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-[#e2e8f0]">
            {context.title}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-[#cbd5e1]">
            {context.summary}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full border border-white/10 bg-black/15 px-2 py-0.5 text-[9px] font-semibold text-[#e5e7eb]">
              {context.sourceBadgeLabel}
            </span>
            <span className="rounded-full border border-white/10 bg-black/15 px-2 py-0.5 text-[9px] text-[#bac2de]">
              {context.activeSceneLabel}
            </span>
            {context.checkpoints.map((checkpoint) => (
              <span
                key={checkpoint}
                className="rounded-full border border-white/10 bg-black/15 px-2 py-0.5 text-[9px] text-[#bac2de]"
              >
                {checkpoint}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-[#94a3b8]">
            {context.detail}
          </p>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </section>
  );
}
