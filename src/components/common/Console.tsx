import { useRef, useEffect } from "react";
import { useEditorStore, ConsoleEntry } from "../../core/store/editorStore";

const LEVEL_STYLES: Record<ConsoleEntry["level"], string> = {
  info:    "text-[#89b4fa]",
  warn:    "text-[#f9e2af]",
  error:   "text-[#f38ba8]",
  success: "text-[#a6e3a1]",
};

const LEVEL_PREFIX: Record<ConsoleEntry["level"], string> = {
  info:    "[INFO]",
  warn:    "[WARN]",
  error:   "[ERROR]",
  success: "[OK]",
};

export default function Console() {
  const { consoleEntries, clearConsole, consoleVisible, toggleConsole } = useEditorStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (consoleVisible) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [consoleEntries, consoleVisible]);

  return (
    <div
      className="flex flex-col border-t border-[#313244] bg-[#11111b]"
      style={{ height: consoleVisible ? "160px" : "28px" }}
    >
      {/* Console header / toggle bar */}
      <div className="flex items-center justify-between px-3 bg-[#181825] border-b border-[#313244] shrink-0 h-7">
        <button
          onClick={toggleConsole}
          className="flex items-center gap-2 text-xs font-semibold text-[#cdd6f4] uppercase tracking-wider select-none hover:text-white transition-colors"
        >
          <span className={`transition-transform ${consoleVisible ? "rotate-90" : ""}`}>▶</span>
          Console
          {consoleEntries.length > 0 && (
            <span className="ml-1 text-[#6c7086]">({consoleEntries.length})</span>
          )}
        </button>
        {consoleVisible && (
          <button
            onClick={clearConsole}
            className="text-xs text-[#6c7086] hover:text-[#f38ba8] transition-colors select-none"
            title="Limpar console"
          >
            ✕ Limpar
          </button>
        )}
      </div>

      {/* Log entries */}
      {consoleVisible && (
        <div className="flex-1 overflow-y-auto px-3 py-1 font-mono text-xs">
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
