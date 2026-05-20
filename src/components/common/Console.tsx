import { useRef, useEffect } from "react";
import { useEditorStore, ConsoleEntry } from "../../core/store/editorStore";

const LEVEL_STYLES: Record<ConsoleEntry["level"], string> = {
  info: "text-[#89b4fa]",
  warn: "text-[#f9e2af]",
  error: "text-[#f38ba8]",
  success: "text-[#a6e3a1]",
};

const LEVEL_PREFIX: Record<ConsoleEntry["level"], string> = {
  info: "[INFO]",
  warn: "[WARN]",
  error: "[ERROR]",
  success: "[OK]",
};

type ConsoleProps = {
  variant?: "inline" | "drawer";
};

export default function Console({ variant = "drawer" }: ConsoleProps) {
  const { consoleEntries, clearConsole, consoleVisible, toggleConsole } = useEditorStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (consoleVisible) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [consoleEntries, consoleVisible]);

  if (variant === "drawer" && !consoleVisible) {
    return null;
  }

  const drawerShell =
    variant === "drawer"
      ? "pointer-events-auto fixed bottom-7 left-[56px] right-0 z-40 flex max-h-[min(40vh,320px)] flex-col border border-[#313244] bg-[#11111b]/98 shadow-[0_-12px_40px_rgba(0,0,0,0.45)] backdrop-blur-sm"
      : "flex flex-col border-t border-[#313244] bg-[#11111b]";

  return (
    <div
      data-testid="console-drawer"
      data-visible={consoleVisible ? "true" : "false"}
      className={drawerShell}
      style={variant === "inline" ? { height: consoleVisible ? "160px" : "28px" } : undefined}
    >
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-[#313244] bg-[#181825] px-3">
        <button
          type="button"
          onClick={toggleConsole}
          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#cdd6f4] transition-colors hover:text-white select-none"
          aria-expanded={consoleVisible}
        >
          <span className={`transition-transform ${consoleVisible ? "rotate-90" : ""}`}>▶</span>
          Console
          {consoleEntries.length > 0 && (
            <span className="ml-1 text-[#6c7086]">({consoleEntries.length})</span>
          )}
        </button>
        {consoleVisible && (
          <button
            type="button"
            onClick={clearConsole}
            className="text-xs text-[#6c7086] transition-colors hover:text-[#f38ba8] select-none"
            title="Limpar console"
          >
            ✕ Limpar
          </button>
        )}
      </div>

      {consoleVisible && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1 font-mono text-xs">
          {consoleEntries.length === 0 ? (
            <span className="text-[#45475a] italic">Nenhuma saída.</span>
          ) : (
            consoleEntries.map((entry) => (
              <div key={entry.id} className="flex gap-2 leading-5">
                <span className="text-[#45475a] shrink-0">{entry.timestamp}</span>
                <span className={`shrink-0 font-bold ${LEVEL_STYLES[entry.level]}`}>
                  {LEVEL_PREFIX[entry.level]}
                </span>
                <span className="text-[#cdd6f4] break-all">{entry.message}</span>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
