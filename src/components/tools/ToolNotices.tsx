export function ExperimentalNotice({
  summary,
  compact = false,
}: {
  summary: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-[#313244] bg-[#181825]/80 px-2 py-1">
        <span className="rounded border border-[#fab387] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-[#fab387]">
          Experimental
        </span>
        <span className="min-w-0 truncate text-[9px] text-[#7f849c]" title={summary}>
          {summary}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded border border-[#fab387] bg-[#181825] p-2">
      <div className="flex items-center gap-2">
        <span className="rounded border border-[#fab387] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#fab387]">
          Experimental
        </span>
        <span className="text-[10px] leading-tight text-[#7f849c]">{summary}</span>
      </div>
    </div>
  );
}

export function HeuristicNotice({ summary }: { summary: string }) {
  return (
    <div className="rounded border border-[#89b4fa] bg-[#181825] p-2 text-[10px] leading-tight text-[#89b4fa]">
      {summary}
    </div>
  );
}
