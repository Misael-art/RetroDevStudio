import { useEffect, useRef, useState, type ReactNode } from "react";

export interface UnifiedTopBarAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: "default" | "primary" | "success" | "danger";
  title?: string;
  testId?: string;
}

export interface UnifiedTopBarSection {
  title?: string;
  actions: UnifiedTopBarAction[];
}

export interface UnifiedTopBarProps {
  appName: string;
  appTagline?: string;
  breadcrumbs: string[];
  menuSections: UnifiedTopBarSection[];
  centerContent?: ReactNode;
  rightContent?: ReactNode;
}

function menuActionTone(accent: UnifiedTopBarAction["accent"] = "default") {
  if (accent === "primary") {
    return "border-[#cba6f7]/30 text-[#e9d5ff] hover:border-[#cba6f7]/45 hover:bg-[#cba6f7]/12";
  }
  if (accent === "success") {
    return "border-[#a6e3a1]/30 text-[#bbf7d0] hover:border-[#a6e3a1]/45 hover:bg-[#a6e3a1]/12";
  }
  if (accent === "danger") {
    return "border-[#f38ba8]/30 text-[#fecdd3] hover:border-[#f38ba8]/45 hover:bg-[#f38ba8]/12";
  }
  return "border-transparent text-[#cbd5e1] hover:border-[#334155] hover:bg-[#111827]";
}

export default function UnifiedTopBar({
  appName,
  appTagline,
  breadcrumbs,
  menuSections,
  centerContent,
  rightContent,
}: UnifiedTopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [menuOpen]);

  return (
    <header className="relative z-20 flex shrink-0 items-stretch gap-3 border-b border-[#27272a] bg-[linear-gradient(180deg,#18181b,#0f172a)] px-3 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            data-testid="unified-topbar-menu-trigger"
            onClick={() => setMenuOpen((current) => !current)}
            className="flex h-10 items-center justify-center rounded-xl border border-[#3f3f46] bg-[#111827] px-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#e2e8f0] transition-colors hover:border-[#6366f1]/30 hover:bg-[#1f2937]"
          >
            Menu
          </button>

          {menuOpen && (
            <div className="absolute left-0 top-[calc(100%+10px)] w-72 overflow-hidden rounded-2xl border border-[#313244] bg-[#0b1120] shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
              {menuSections.map((section, sectionIndex) => (
                <div
                  key={`${section.title ?? "section"}-${sectionIndex}`}
                  className={sectionIndex > 0 ? "border-t border-[#1f2937]" : undefined}
                >
                  {section.title && (
                    <div className="px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#7dd3fc]">
                      {section.title}
                    </div>
                  )}
                  <div className="grid gap-1 px-2 py-2">
                    {section.actions.map((action) => (
                      <button
                        key={action.label}
                        type="button"
                        disabled={action.disabled}
                        title={action.title}
                        data-testid={action.testId}
                        onClick={() => {
                          setMenuOpen(false);
                          action.onClick();
                        }}
                        className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-[12px] font-medium transition-colors ${menuActionTone(action.accent)} disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        <span>{action.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#cba6f7]">
            {appName}
          </div>
          {appTagline ? (
            <div className="mt-1 text-[11px] text-[#64748b]">{appTagline}</div>
          ) : null}
        </div>

        <nav
          aria-label="Breadcrumb"
          data-testid="unified-topbar-breadcrumbs"
          className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-[#27272a] bg-[#0b1220]/80 px-3 py-2"
        >
          <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[11px] text-[#94a3b8]">
            {breadcrumbs.map((crumb, index) => (
              <div key={`${crumb}-${index}`} className="flex min-w-0 items-center gap-2">
                {index > 0 ? <span className="text-[#475569]">&gt;</span> : null}
                <span
                  className={index === breadcrumbs.length - 1 ? "truncate text-[#e2e8f0]" : "truncate"}
                  title={crumb}
                >
                  {crumb}
                </span>
              </div>
            ))}
          </div>
        </nav>
      </div>

      <div className="flex min-w-0 flex-[0_1_520px] items-center justify-center">
        <div className="flex min-w-0 items-center justify-center gap-2">{centerContent}</div>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end">
        <div className="flex min-w-0 items-center justify-end gap-2">{rightContent}</div>
      </div>
    </header>
  );
}
