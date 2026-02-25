export interface TabItem {
  id: string;
  label: string;
  icon?: string;
}

interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
  className?: string;
}

export default function Tabs({ tabs, activeTab, onTabChange, className = "" }: TabsProps) {
  return (
    <div className={`flex items-end gap-0 border-b border-[#313244] bg-[#181825] ${className}`}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={[
              "px-4 py-1.5 text-xs font-medium select-none transition-colors border-t border-x border-[#313244]",
              isActive
                ? "bg-[#1e1e2e] text-[#cdd6f4] border-b-[#1e1e2e] -mb-px"
                : "bg-[#11111b] text-[#6c7086] hover:text-[#a6adc8] border-b-transparent",
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
