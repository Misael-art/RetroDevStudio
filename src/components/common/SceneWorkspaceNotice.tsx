import type { ReactNode } from "react";

import type { SceneWorkspaceContext } from "../../core/sceneWorkspaceContext";

const NOTICE_TONE = {
  info: "border-[var(--rds-status-info)] bg-[color-mix(in_srgb,var(--rds-status-info)_8%,transparent)] text-[var(--rds-status-info)]",
  warn: "border-[var(--rds-status-warning)] bg-[color-mix(in_srgb,var(--rds-status-warning)_8%,transparent)] text-[var(--rds-status-warning)]",
  success: "border-[var(--rds-status-success)] bg-[color-mix(in_srgb,var(--rds-status-success)_8%,transparent)] text-[var(--rds-status-success)]",
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
          <p className="mt-1 text-[11px] font-semibold text-[var(--rds-text-primary)]">
            {context.title}
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-[var(--rds-text-secondary)]">
            {context.summary}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-overlay)] px-2 py-0.5 text-[9px] font-semibold text-[var(--rds-text-primary)]">
              {context.sourceBadgeLabel}
            </span>
            <span className="rounded-full border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-overlay)] px-2 py-0.5 text-[9px] text-[var(--rds-text-secondary)]">
              {context.activeSceneLabel}
            </span>
            {context.checkpoints.map((checkpoint) => (
              <span
                key={checkpoint}
                className="rounded-full border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-overlay)] px-2 py-0.5 text-[9px] text-[var(--rds-text-secondary)]"
              >
                {checkpoint}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-[var(--rds-text-muted)]">
            {context.detail}
          </p>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </section>
  );
}
