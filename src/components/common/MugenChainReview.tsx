import type { MugenChainReport } from "../../core/mugenReview";

const CLASS_LABEL: Record<string, string> = {
  converted: "Convertido da fonte",
  approximate: "Aproximado",
  authored: "Autoral RetroDev",
  unconverted: "Nao convertido",
};
const CLASS_STYLE: Record<string, string> = {
  converted: "border-[#a6e3a1]/40 bg-[#a6e3a1]/15 text-[#a6e3a1]",
  approximate: "border-[#f9e2af]/40 bg-[#f9e2af]/15 text-[#f9e2af]",
  authored: "border-[#89b4fa]/40 bg-[#89b4fa]/15 text-[#89b4fa]",
  unconverted: "border-[#f38ba8]/40 bg-[#f38ba8]/15 text-[#f38ba8]",
};
const ORDER = ["converted", "approximate", "authored", "unconverted"] as const;

/** Origem do comportamento: o que veio do CMD/CNS, o que foi aproximado, o que e autoral e o que ficou de fora. */
export default function MugenChainReview({ chain }: { chain: MugenChainReport }) {
  const operations = chain.operations ?? [];
  const unconverted = chain.unconverted_controllers ?? [];
  const count = (c: string) =>
    c === "unconverted" ? (chain.summary?.unconverted ?? 0) : (chain.summary as Record<string, number> | undefined)?.[c] ?? 0;
  return (
    <section data-testid="mugen-chain-review" data-status={chain.status} className="space-y-2 rounded border border-[#45475a] bg-[#181825] p-2 text-[11px]">
      <p className="font-semibold text-[#cdd6f4]">Origem do comportamento · cadeia original (Experimental)</p>
      {chain.notice && <p className="text-[#f9e2af]">{chain.notice}</p>}
      <div className="flex flex-wrap gap-1">
        {ORDER.map((c) => (
          <span key={c} data-testid={`mugen-chain-count-${c}`} data-count={count(c)} className={`rounded border px-1.5 py-0.5 text-[10px] ${CLASS_STYLE[c]}`}>
            {CLASS_LABEL[c]}: {count(c)}
          </span>
        ))}
      </div>
      {(chain.dependencies ?? []).map((d, i) => (
        <p key={i} data-testid="mugen-chain-dependency" data-status={d.status} className="text-[#a6adc8]">
          Dependencia <span className="font-mono">{d.name ?? "(nenhuma)"}</span> declarada em {d.declared_in ?? "-"}: <b>{d.status === "missing" ? "ausente do pacote" : d.status}</b>
          {d.sha256 ? ` · sha256 ${d.sha256.slice(0, 12)}…` : ""}. {d.consequence}
        </p>
      ))}
      {(chain.state_status ?? []).map((st) => (
        <p key={st.state} data-testid={`mugen-chain-state-${st.state}`} data-verdict={st.verdict} className="text-[#a6adc8]">
          Estado <span className="font-mono">{st.state}</span>: <b>{st.verdict}</b>
          {st.origin === "stand_in" ? " (stand-in RetroDev, nao e o estado original)" : ` — ${st.converted} itens convertidos, ${st.unconverted} nao convertidos`}
        </p>
      ))}
      {chain.program_sha256 && <p className="font-mono text-[10px] text-[#7f849c]">programa sha256 {chain.program_sha256}</p>}
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.1em] text-[#7f849c]">
            <th className="py-1 pr-2">Classe</th>
            <th className="py-1 pr-2">Origem (arquivo:linha)</th>
            <th className="py-1 pr-2">Texto original</th>
            <th className="py-1 pr-2">Implementacao</th>
            <th className="py-1">Limite</th>
          </tr>
        </thead>
        <tbody>
          {operations.map((o) => (
            <tr key={o.id} data-testid={`mugen-chain-op-${o.id}`} data-class={o.class} className="border-t border-[#313244] align-top">
              <td className="py-1 pr-2"><span className={`rounded border px-1 py-0.5 text-[10px] ${CLASS_STYLE[o.class] ?? ""}`}>{CLASS_LABEL[o.class] ?? o.class}</span></td>
              <td className="py-1 pr-2 font-mono text-[10px] text-[#a6adc8]">{o.source ? `${o.source.file}:${o.source.line}` : "RetroDev (sem fonte)"}</td>
              <td className="py-1 pr-2 font-mono text-[10px] text-[#cdd6f4]">{o.source?.text ?? ""}</td>
              <td className="py-1 pr-2 text-[#cdd6f4]">{o.implementation}</td>
              <td className="py-1 text-[#a6adc8]">{o.limit}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {unconverted.length > 0 && (
        <details data-testid="mugen-chain-unconverted">
          <summary className="cursor-pointer text-[#f38ba8]">{unconverted.length} controladores fora do subconjunto (estados -1/-2 e da cadeia), nenhum ignorado em silencio</summary>
          <ul className="mt-1 space-y-0.5 text-[10px] text-[#a6adc8]">
            {unconverted.map((u, i) => (
              <li key={i}><span className="font-mono">{u.source.file}:{u.source.line}</span> — {u.reason}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
