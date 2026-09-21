import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import Icon from "./Icon";

export interface UnifiedTopBarAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  accent?: "default" | "primary" | "success" | "danger";
  title?: string;
  shortcut?: string;
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
    return "border-[var(--rds-action-primary)] text-[var(--rds-status-info)] hover:bg-[color-mix(in_srgb,var(--rds-action-primary)_12%,transparent)]";
  }
  if (accent === "success") {
    return "border-[var(--rds-status-success)] text-[var(--rds-status-success)] hover:bg-[color-mix(in_srgb,var(--rds-status-success)_12%,transparent)]";
  }
  if (accent === "danger") {
    return "border-[var(--rds-status-error)] text-[var(--rds-status-error)] hover:bg-[color-mix(in_srgb,var(--rds-status-error)_12%,transparent)]";
  }
  return "border-transparent text-[var(--rds-text-secondary)] hover:border-[var(--rds-border-default)] hover:bg-[var(--rds-surface-hover)]";
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

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuRef.current?.querySelector<HTMLButtonElement>("[data-menu-trigger]")?.focus();
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen) {
      window.requestAnimationFrame(() => {
        menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
      });
    }
  }, [menuOpen]);

  function handleMenuNavigation(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") {
      return;
    }
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? []
    );
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1 + items.length) % items.length
          : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  return (
    <header
      data-testid="unified-topbar"
      className="relative z-20 flex min-h-[42px] shrink-0 items-center gap-2 overflow-hidden border-b border-[var(--rds-border-subtle)] bg-[var(--rds-surface-base)] px-2 py-1"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            data-menu-trigger
            data-testid="unified-topbar-menu-trigger"
            aria-label="Menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-controls="unified-topbar-menu"
            onClick={() => setMenuOpen((current) => !current)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setMenuOpen(true);
              }
            }}
            className="flex h-8 items-center justify-center rounded border border-[var(--rds-border-default)] bg-[var(--rds-surface-input)] px-2 text-[10px] font-semibold uppercase text-[var(--rds-text-primary)] transition-colors hover:border-[var(--rds-action-primary)] hover:bg-[var(--rds-surface-hover)]"
          >
            <Icon name="menu" size={17} />
            <span className="sr-only">Menu</span>
          </button>

          {menuOpen && (
            <div
              id="unified-topbar-menu"
              role="menu"
              aria-label="Menu principal"
              onKeyDown={handleMenuNavigation}
              className="absolute left-0 top-[calc(100%+8px)] w-72 overflow-hidden rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-overlay)] shadow-[var(--rds-shadow-elevated)]"
            >
              {menuSections.map((section, sectionIndex) => (
                <div
                  key={`${section.title ?? "section"}-${sectionIndex}`}
                  className={sectionIndex > 0 ? "border-t border-[var(--rds-border-subtle)]" : undefined}
                >
                  {section.title && (
                    <div className="px-3 py-2 text-[10px] font-semibold uppercase text-[var(--rds-status-info)]">
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
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          action.onClick();
                        }}
                        className={`flex items-center justify-between rounded border px-3 py-2 text-left text-[12px] font-medium transition-colors ${menuActionTone(action.accent)} disabled:cursor-not-allowed disabled:opacity-40`}
                      >
                        <span>{action.label}</span>
                        {action.shortcut ? (
                          <kbd className="ml-3 rounded border border-[var(--rds-border-default)] bg-[var(--rds-surface-panel-strong)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--rds-text-muted)]">
                            {action.shortcut}
                          </kbd>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase text-[var(--rds-status-info)]">
            {appName}
          </div>
          {appTagline ? (
            <div className="sr-only">{appTagline}</div>
          ) : null}
        </div>

        <nav
          aria-label="Breadcrumb"
          data-testid="unified-topbar-breadcrumbs"
          className="min-w-0 flex-1 overflow-hidden rounded border border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] px-2 py-1"
        >
          <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-[11px] text-[var(--rds-text-muted)]">
            {breadcrumbs.map((crumb, index) => (
              <div key={`${crumb}-${index}`} className="flex min-w-0 items-center gap-2">
                {index > 0 ? <span className="text-[var(--rds-border-strong)]">&gt;</span> : null}
                <span
                  className={index === breadcrumbs.length - 1 ? "truncate text-[var(--rds-text-primary)]" : "truncate"}
                  title={crumb}
                >
                  {crumb}
                </span>
              </div>
            ))}
          </div>
        </nav>
      </div>

      <div
        data-testid="unified-topbar-center"
        className="flex min-w-0 flex-[0_1_520px] items-center justify-center overflow-x-auto overflow-y-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="relative z-[5] flex min-w-0 flex-nowrap items-center justify-center gap-1.5 px-0.5">
          {centerContent}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end overflow-hidden">
        <div className="flex min-w-0 items-center justify-end gap-2 overflow-hidden">{rightContent}</div>
      </div>
    </header>
  );
}
