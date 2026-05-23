import { useEffect, useState } from "react";

import { listSgdkPatternTemplates } from "../../core/ipc/projectCapabilityService";
import type { SgdkPatternTemplate } from "../../core/projectCapability";

interface SgdkPatternTemplateGalleryProps {
  templates?: SgdkPatternTemplate[];
  onInsertTemplate: (template: SgdkPatternTemplate) => void;
}

export default function SgdkPatternTemplateGallery({
  templates: injectedTemplates,
  onInsertTemplate,
}: SgdkPatternTemplateGalleryProps) {
  const [templates, setTemplates] = useState<SgdkPatternTemplate[]>(injectedTemplates ?? []);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (injectedTemplates) {
      setTemplates(injectedTemplates);
    }
  }, [injectedTemplates]);

  useEffect(() => {
    if (injectedTemplates) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    listSgdkPatternTemplates()
      .then((next) => {
        if (!cancelled) {
          setTemplates(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTemplates([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [injectedTemplates]);

  return (
    <div className="border-t border-[#313244] p-2" data-testid="sgdk-pattern-template-gallery">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center justify-between rounded px-1 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-[#cba6f7] hover:bg-[#313244]"
      >
        <span>SGDK Patterns</span>
        <span>{expanded ? "\u25be" : "\u25b8"}</span>
      </button>
      {expanded ? (
        <div className="mt-2 flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
          {loading ? <p className="px-1 text-[9px] text-[#7f849c]">Carregando...</p> : null}
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              data-testid={`sgdk-pattern-${template.id}`}
              onClick={() => onInsertTemplate(template)}
              className="rounded border border-[#313244] bg-[#11111b] p-2 text-left hover:border-[#cba6f7]/50"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[10px] font-semibold text-[#cdd6f4]">{template.title}</span>
                <span className="rounded border border-[#cba6f7]/35 bg-[#cba6f7]/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase text-[#cba6f7]">
                  Experimental
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-[9px] leading-snug text-[#7f849c]">
                {template.technical_description}
              </p>
              <p className="mt-1 truncate text-[8px] text-[#f9e2af]" title={template.hardware_warnings.join(" ")}>
                {template.hardware_warnings[0]}
              </p>
              <p className="mt-1 truncate font-mono text-[8px] text-[#45475a]">
                {template.nodes_generated.map((node) => node.node_type).join(" -> ")}
              </p>
            </button>
          ))}
          {!loading && templates.length === 0 ? (
            <p className="px-1 text-[9px] text-[#7f849c]">Sem templates SGDK.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
