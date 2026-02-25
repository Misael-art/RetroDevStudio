import React from "react";

interface PanelProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  headerActions?: React.ReactNode;
}

export default function Panel({ title, children, className = "", headerActions }: PanelProps) {
  return (
    <div className={`flex flex-col bg-[#1e1e2e] border border-[#313244] overflow-hidden ${className}`}>
      {/* Panel header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#181825] border-b border-[#313244] shrink-0">
        <span className="text-xs font-semibold text-[#cdd6f4] uppercase tracking-wider select-none">
          {title}
        </span>
        {headerActions && (
          <div className="flex items-center gap-1">{headerActions}</div>
        )}
      </div>
      {/* Panel content */}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
