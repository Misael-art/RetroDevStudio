/**
 * Estado vazio padrao do shell (fatia 1 v2 do estudo de UI):
 * todo painel vazio explica o que e e oferece no maximo UMA acao seguinte real.
 */
export default function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  testId,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-4 py-6 text-center"
    >
      <p className="text-xs font-semibold text-[var(--rds-text-primary)]">{title}</p>
      <p className="max-w-64 text-[11px] leading-5 text-[var(--rds-text-muted)]">
        {description}
      </p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-1 rounded border border-[var(--rds-surface-control-hover)] bg-[var(--rds-surface-control)] px-3 py-1.5 text-[11px] font-semibold text-[var(--rds-text-secondary)] transition-colors hover:bg-[var(--rds-surface-control-hover)] hover:text-[var(--rds-text-primary)]"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
