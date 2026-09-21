import React from "react";

interface PanelProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  headerActions?: React.ReactNode;
}

export default function Panel({ title, children, className = "", headerActions }: PanelProps) {
  return (
    <div className={`flex flex-col overflow-hidden border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel)] ${className}`}>
      {/* Panel header */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] px-3 py-1">
        <span className="select-none text-xs font-semibold uppercase tracking-wider text-[var(--rds-text-primary)]">
          {title}
        </span>
        {headerActions && (
          <div className="flex items-center gap-1">{headerActions}</div>
        )}
      </div>
      {/* Panel content */}
      <div className="scrollbar-thin flex-1 overflow-auto overflow-x-hidden">{children}</div>
    </div>
  );
}
