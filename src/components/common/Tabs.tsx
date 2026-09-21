import { useRef, type KeyboardEvent } from "react";

export interface TabItem {
  id: string;
  label: string;
  icon?: string;
  ariaLabel?: string;
}

interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
  className?: string;
  ariaLabel?: string;
}

export default function Tabs({ tabs, activeTab, onTabChange, className = "", ariaLabel = "Secoes" }: TabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : event.key === "ArrowRight"
          ? (index + 1) % tabs.length
          : (index - 1 + tabs.length) % tabs.length;
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    onTabChange(nextTab.id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <div role="tablist" aria-label={ariaLabel} className={`flex items-end gap-0 border-b border-[var(--rds-border-subtle)] bg-[var(--rds-surface-panel-strong)] ${className}`}>
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            ref={(element) => { tabRefs.current[index] = element; }}
            type="button"
            role="tab"
            id={`rds-tab-${tab.id}`}
            aria-label={tab.ariaLabel ?? tab.label}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={[
              "min-h-7 select-none border-x border-t border-[var(--rds-border-subtle)] px-4 py-1.5 text-xs font-medium transition-colors",
              isActive
                ? "-mb-px border-b-[var(--rds-surface-panel)] bg-[var(--rds-surface-panel)] text-[var(--rds-text-primary)]"
                : "border-b-transparent bg-[var(--rds-surface-panel-strong)] text-[var(--rds-text-muted)] hover:text-[var(--rds-text-secondary)]",
            ].join(" ")}
          >
            {tab.icon && <span className="mr-1.5">{tab.icon}</span>}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
