import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";
import MugenVisualComparison from "./MugenVisualComparison";
import { analyzeMugenSource, visualReviewOf, type MugenReviewOptions, type MugenSourceAnalysis } from "../../core/mugenReview";

export default function MugenSourceReviewPanel({ sourcePath, onCancel, onImport }: {
  sourcePath: string; onCancel: () => void; onImport: (options?: MugenReviewOptions) => Promise<void>;
}) {
  const [analysis,setAnalysis]=useState<MugenSourceAnalysis|null>(null);
  const [options,setOptions]=useState<MugenReviewOptions|null>(null);
  const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  const generation=useRef(0);
  const analyze=async (choice?:MugenReviewOptions) => {
    const gen=++generation.current; setBusy(true);setError("");setAnalysis(null);
    try {const a=await analyzeMugenSource(sourcePath,choice); if(gen!==generation.current)return;
      setAnalysis(a);setOptions(a.options ?? choice ?? {def_file:a.selected_def ?? "",actions:[],palette_file:null,authored_demo:false,source_sha256:a.source_sha256});
    } catch(e){if(gen===generation.current)setError(String(e));}
    finally {if(gen===generation.current)setBusy(false);}
  };
  useEffect(()=>{void analyze();return()=>{generation.current+=1;};},[sourcePath]);
  const edit=(patch:Partial<MugenReviewOptions>)=>{if(options){setOptions({...options,...patch,source_sha256:null});setAnalysis((a)=>a?{...a,report:null}:null);}};
  const visual=analysis?.report ? visualReviewOf(analysis.report) : null;
  const canImport=!!analysis?.report && !busy && options?.source_sha256===analysis.source_sha256 && !analysis.diagnostics.some((d)=>d.severity==="error");
  return <Dialog open title="Revisar personagem MUGEN · Experimental" onClose={onCancel} className="w-[980px] max-w-[95vw] max-h-[90vh] overflow-auto rounded border border-[#45475a] bg-[#1e1e2e] p-4">
    <div data-testid="mugen-source-review" className="space-y-3 text-xs text-[#cdd6f4]">
      <p>Confira os pixels e as perdas antes de criar o projeto. O pacote original será preservado.</p>
      <p className="break-all text-[#a6adc8]">{sourcePath}</p>
      {analysis?.format && <p>{analysis.format.format} {analysis.format.version.join(".")} · {analysis.sprites?.length ?? 0} sprites disponíveis · {analysis.actions.length} ações</p>}
      {options && !analysis?.legacy_kind && <>
        <label className="block">DEF de personagem <select data-testid="mugen-source-def" value={options.def_file} onChange={(e)=>void analyze({...options,def_file:e.target.value,actions:[],palette_file:null,source_sha256:null})} className="ml-2 bg-[#313244] p-1">
          <option value="">Escolha explicitamente…</option>{analysis?.defs.map((d)=><option key={d.file} value={d.file}>{d.name} · {d.file}</option>)}
        </select></label>
        <label className="block">Paleta <select data-testid="mugen-source-palette" value={options.palette_file ?? ""} onChange={(e)=>edit({palette_file:e.target.value || null})} className="ml-2 bg-[#313244] p-1">
          <option value="">Embutida no SFF</option>{analysis?.palettes.map((p)=><option key={p} value={p}>{p} · ACT declarada no DEF</option>)}
        </select></label>
        <fieldset className="rounded border border-[#45475a] p-2"><legend>Ações incluídas (vazio = todas)</legend>
          <div className="flex max-h-24 flex-wrap gap-3 overflow-auto">{analysis?.actions.map((a)=><label key={a.number}><input data-testid={`mugen-source-action-${a.number}`} type="checkbox" checked={options.actions.includes(a.number)} onChange={(e)=>edit({actions:e.target.checked?[...options.actions,a.number].sort((a,b)=>a-b):options.actions.filter((n)=>n!==a.number)})} /> {a.number} ({a.frames} quadros)</label>)}</div>
        </fieldset>
        <label className="block"><input data-testid="mugen-source-authored-demo" type="checkbox" checked={options.authored_demo} onChange={(e)=>edit({authored_demo:e.target.checked})} /> Comportamento autoral para demonstrar arte (ações 0, 20, 21 e 200)</label>
        <p className="text-[#f9e2af]">A demonstração autoral usa →/← e botão A, facing fixo à direita e velocidades 2,5/−1,75 px por tick editáveis. Isso não converte o CNS original, colisão ou dano. Controllers originais ficam como referência.</p>
        <button data-testid="mugen-source-analyze" disabled={busy} onClick={()=>void analyze(options)} className="rounded bg-[#45475a] px-3 py-2">{busy?"Analisando…":"Analisar escolhas"}</button>
      </>}
      {busy && <p>Verificando arquivos, paleta, animações e transformações…</p>}
      {error && <p role="alert" className="text-[#f38ba8]">{error}</p>}
      <ul>{analysis?.diagnostics.map((d,i)=><li key={i} className={d.severity==="error"?"text-[#f38ba8]":"text-[#f9e2af]"}>{d.source}: {d.message}</li>)}</ul>
      {visual && <MugenVisualComparison visual={visual} />}
      {analysis?.report?.metrics && <p>Custo estimado: {analysis.report.metrics.filter((m)=>["cell_width","cell_height","tiles_per_frame","palette_colors","merged_pixels"].includes(m.name)).map((m)=>`${({cell_width:"Largura",cell_height:"Altura",tiles_per_frame:"Blocos por quadro",palette_colors:"Cores",merged_pixels:"Pixels com cores fundidas"} as Record<string,string>)[m.name]}: ${m.value ?? "não medido"} ${m.unit}`).join(" · ")}. CPU, transferências e sprites compilados ainda não medidos.</p>}
      <details><summary>Arquivos e dependências</summary><ul>{analysis?.references.map((r,i)=><li key={i}>{r.key}: {r.requested} — {r.status}</li>)}</ul></details>
      <div className="flex justify-end gap-3"><button data-testid="mugen-source-cancel" onClick={onCancel}>Cancelar</button><button data-testid="mugen-source-import" disabled={analysis?.legacy_kind ? busy : !canImport} onClick={()=>{if(options){setBusy(true);void onImport(analysis?.legacy_kind ? undefined : options).finally(()=>setBusy(false));}}} className="rounded bg-[#89b4fa] px-3 py-2 text-[#11111b] disabled:opacity-40">{analysis?.legacy_kind ? "Importar cenário/screenpack" : "Importar escolhas revisadas"}</button></div>
    </div>
  </Dialog>;
}
