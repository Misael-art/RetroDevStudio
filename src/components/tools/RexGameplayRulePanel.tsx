import { useCallback, useEffect, useRef, useState } from "react";
import {
  rexGameplayEditThreshold,
  rexGameplayRecover,
  rexGameplayScan,
  type GameplayRecoverResponse,
  type GameplayScanCandidate,
} from "../../core/ipc/toolsService";
import {
  projectGameplayGraph,
  validateGameplayRecoverForm,
  validateGameplayThreshold,
  type GameplayProjection,
} from "../../core/nodegraph/rexGameplayGraph";
import { ExperimentalNotice } from "./ToolNotices";

type LogLevel = "info" | "warn" | "error" | "success";

/** O backend devolve `InspectionError {code, message, retryable}` como objeto. */
function erroEstruturado(cause: unknown): string {
  if (cause && typeof cause === "object") {
    const e = cause as { code?: unknown; message?: unknown };
    const code = typeof e.code === "string" ? e.code : "erro";
    const message = typeof e.message === "string" ? e.message : JSON.stringify(cause);
    return `${code}: ${message}`;
  }
  return String(cause);
}

function novoRequestId(prefixo: string): string {
  return `${prefixo}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Recuperacion delimitada de unha regra de gameplay (REX, Experimental).
 *
 * A interface non adiviña nada: quen chama declara ROM, entrada e saidas, e o
 * nucleo (`crates/rex-gameplay`) devolve o grafo da regra. Aqui ese grafo
 * projectase en frases comprensibles, co unico parametro editable (o limiar,
 * coa súa faixa) e o motivo explícito de cada elemento que non se edita — a
 * chamada externa permanece opaca porque o seu corpo non se recuperou.
 *
 * Como no painel de contexto, os pedidos levan selo de secuencia: unha
 * resposta anterior á ultima ROM cargada ou ao ultimo pedido nunca se mostra.
 */
export function RexGameplayRulePanel({
  romPath,
  logMessage,
}: {
  /** ROM analizada; trocala descarta grafo, proxeccion e pedidos en voo. */
  romPath: string;
  logMessage?: (level: LogLevel, message: string) => void;
}) {
  const [entryHex, setEntryHex] = useState("0x946");
  const [exitsHex, setExitsHex] = useState("0x970");
  const [scanCandidates, setScanCandidates] = useState<GameplayScanCandidate[] | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [recover, setRecover] = useState<GameplayRecoverResponse | null>(null);
  const [projection, setProjection] = useState<GameplayProjection | null>(null);
  const [thresholdText, setThresholdText] = useState("");
  const [thresholdMsg, setThresholdMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<"scan" | "recover" | "edit" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const seq = useRef(0);
  const romRef = useRef(romPath);
  romRef.current = romPath;

  useEffect(() => {
    seq.current += 1;
    setScanCandidates(null);
    setScanNote(null);
    setRecover(null);
    setProjection(null);
    setThresholdText("");
    setThresholdMsg(null);
    setErro(null);
  }, [romPath]);

  function asumirResposta(seqPedido: number, caminhoPedido: string): boolean {
    return seqPedido === seq.current && caminhoPedido === romRef.current;
  }

  const aplicarGrafo = useCallback((graphJson: string, response: GameplayRecoverResponse) => {
    const proxeccion = projectGameplayGraph(graphJson, response.limitations);
    setProjection(proxeccion);
    if (proxeccion.ok) {
      setThresholdText(String(proxeccion.regra.limiar));
      setThresholdMsg(null);
    }
  }, []);

  async function escanear() {
    if (!romPath) return;
    const seqPedido = (seq.current += 1);
    const caminho = romPath;
    setErro(null);
    setBusy("scan");
    try {
      const resposta = await rexGameplayScan({ request_id: novoRequestId("scan"), rom_path: caminho });
      if (!asumirResposta(seqPedido, caminho)) return;
      setScanCandidates(resposta.candidates);
      setScanNote(
        resposta.ambiguous
          ? `${resposta.candidates.length} candidatos con forma de garda: a varredura NON escolhe; declare entrada e saidas.`
          : `Unicamente 1 candidato (entrada ${resposta.candidates.length ? `0x${resposta.candidates[0].entry.toString(16)}` : "ningunha"}); declare aínda así entrada e saidas para recuperar.`
      );
      logMessage?.("info", `[REX gameplay] varredura: ${resposta.candidates.length} candidato(s).`);
    } catch (cause) {
      if (seqPedido === seq.current) setErro(erroEstruturado(cause));
    } finally {
      setBusy(null);
    }
  }

  async function recuperar() {
    if (!romPath) return;
    const validado = validateGameplayRecoverForm({ romPath, entry: entryHex, exits: exitsHex }, novoRequestId("recover"));
    if (!validado.ok) {
      setErro(validado.motivo);
      return;
    }
    const seqPedido = (seq.current += 1);
    const caminho = romPath;
    setErro(null);
    setBusy("recover");
    try {
      const resposta = await rexGameplayRecover(validado.request);
      if (!asumirResposta(seqPedido, caminho)) return;
      if (resposta.rom_sha256.length !== 64) {
        setErro("o nucleo devolveu unha identidade de ROM incompleta; nada se mostra");
        return;
      }
      setRecover(resposta);
      aplicarGrafo(resposta.graph_json, resposta);
      logMessage?.(
        "success",
        `[REX gameplay] regra recuperada en 0x${resposta.entry.toString(16)}; limiar ${resposta.threshold} (faixa ${resposta.threshold_range[0]}..${resposta.threshold_range[1]}).`
      );
    } catch (cause) {
      if (seqPedido === seq.current) setErro(erroEstruturado(cause));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Unica edicion exposta. O limiar aplícase no nucleo (`edit_threshold`), non
   * no navegador: a interface mostra o que o crate devolve, reproxectado pola
   * mesma ruta que a recuperación. Fóra da faixa recúsase aqui e, se alguén
   * chama directo ao IPC, `range_refused` faila ahi.
   */
  async function aplicarLimiar() {
    if (!recover) return;
    if (!projection?.ok) {
      setErro("sen unha proxeccion valida non hai limiar que editar");
      return;
    }
    const check = validateGameplayThreshold(
      thresholdText,
      projection.regra.limiarMin,
      projection.regra.limiarMax
    );
    if (!check.ok) {
      setThresholdMsg(check.motivo);
      return;
    }
    if (check.value === projection.regra.limiar) {
      setThresholdMsg(null);
      return;
    }
    const seqPedido = (seq.current += 1);
    const caminho = romPath;
    const respostaRecuperada = recover;
    setBusy("edit");
    setThresholdMsg(null);
    try {
      const resposta = await rexGameplayEditThreshold({
        request_id: novoRequestId("edit"),
        graph_json: respostaRecuperada.graph_json,
        threshold: check.value,
      });
      if (!asumirResposta(seqPedido, caminho)) return;
      const actualizado = { ...respostaRecuperada, graph_json: resposta.graph_json };
      setRecover(actualizado);
      aplicarGrafo(resposta.graph_json, actualizado);
      logMessage?.("success", `[REX gameplay] limiar aplicado no grafo: ${check.value}.`);
    } catch (cause) {
      if (seqPedido === seq.current) setErro(erroEstruturado(cause));
    } finally {
      setBusy(null);
    }
  }

  const regra = projection?.ok ? projection.regra : null;

  return (
    <div
      data-testid="rex-gameplay-rule-panel"
      className="rounded border border-[#cba6f7]/40 bg-[#1e1a2e] p-3 space-y-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-[#cba6f7]">
            Regra de gameplay desde a ROM (Experimental)
          </div>
          <div className="mt-1 max-w-3xl text-[10px] text-[#b7b0cf]">
            Perfil pechado <code>m68k.counter_threshold_state_gate.v1</code>: garda de input,
            incremento de contador, comparacion cun limiar e escrita de estado. Nada se
            autodetecta nin se compila de forma xeral: sen ROM, entrada e saidas declaradas non
            hai recuperacion.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-[#94a3b8]">
            entrada
            <input
              data-testid="rex-gameplay-entry"
              value={entryHex}
              onChange={(e) => setEntryHex(e.target.value)}
              className="w-24 rounded border border-[#313244] bg-[#0f172a] px-1 py-1 font-mono text-[10px] text-[#cdd6f4]"
            />
          </label>
          <label className="flex items-center gap-1 text-[10px] text-[#94a3b8]">
            saidas
            <input
              data-testid="rex-gameplay-exits"
              value={exitsHex}
              onChange={(e) => setExitsHex(e.target.value)}
              className="w-32 rounded border border-[#313244] bg-[#0f172a] px-1 py-1 font-mono text-[10px] text-[#cdd6f4]"
            />
          </label>
          <button
            type="button"
            data-testid="rex-gameplay-scan"
            onClick={() => void escanear()}
            disabled={!romPath || busy !== null}
            className="rounded border border-[#89b4fa]/50 px-2 py-1 text-[10px] text-[#89b4fa] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "scan" ? "Varredando..." : "Varredura orientativa"}
          </button>
          <button
            type="button"
            data-testid="rex-gameplay-recover"
            onClick={() => void recuperar()}
            disabled={!romPath || busy !== null}
            className="rounded bg-[#cba6f7] px-3 py-1.5 text-[10px] font-semibold text-[#1e1e2e] disabled:cursor-not-allowed disabled:bg-[#45475a] disabled:text-[#6c7086]"
          >
            {busy === "recover" ? "Recuperando..." : "Recuperar regra"}
          </button>
        </div>
      </div>

      {!romPath && (
        <p className="text-[10px] text-[#7f849c]">
          Ningunha ROM analizada: abra unha ROM autoral (BYOR) na barra do Reverse.
        </p>
      )}
      {erro && (
        <p data-testid="rex-gameplay-error" className="text-[10px] text-[#f38ba8]">
          {erro}
        </p>
      )}
      {scanNote && (
        <p data-testid="rex-gameplay-scan-note" className="text-[10px] text-[#94a3b8]">
          {scanNote}
          {scanCandidates && scanCandidates.length > 0
            ? ` — ${scanCandidates.map((c) => `0x${c.entry.toString(16)}→0x${c.exit.toString(16)}`).join(", ")}`
            : ""}
        </p>
      )}

      {projection && !projection.ok && (
        <p data-testid="rex-gameplay-refused" className="text-[10px] text-[#f9e2af]">
          Proxeccion recusada: {projection.motivo}
        </p>
      )}

      {regra && recover && (
        <div className="grid gap-2 text-[10px] text-[#cdd6f4] md:grid-cols-2">
          <div className="rounded bg-[#11111b] p-2" data-testid="rex-gameplay-rule-text">
            <div className="font-semibold text-[#a6e3a1]">A regra, en linguaxe comprensible</div>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {regra.resumoFrases.map((frase) => (
                <li key={frase}>{frase}</li>
              ))}
            </ul>
            <div className="mt-2 font-semibold text-[#f9e2af]">Limites declarados</div>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[#b7b0cf]">
              {regra.limitaciones.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>

          <div className="rounded bg-[#11111b] p-2">
            <div className="font-semibold text-[#89b4fa]">Parametro editable: limiar</div>
            <div className="mt-1 text-[#b7b0cf]">
              {regra.comparacion} · faixa do MOVEQ recuperado: {regra.limiarMin} a {regra.limiarMax}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                data-testid="rex-gameplay-threshold"
                value={thresholdText}
                onChange={(e) => setThresholdText(e.target.value)}
                inputMode="numeric"
                className="w-20 rounded border border-[#313244] bg-[#0f172a] px-1 py-1 text-center font-mono text-[#cdd6f4]"
              />
              <button
                type="button"
                data-testid="rex-gameplay-apply-threshold"
                onClick={() => void aplicarLimiar()}
                disabled={busy !== null}
                className="rounded border border-[#a6e3a1]/50 px-2 py-1 text-[#a6e3a1] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "edit" ? "Aplicando..." : "Aplicar no grafo"}
              </button>
            </div>
            {thresholdMsg && (
              <p data-testid="rex-gameplay-threshold-msg" className="mt-1 text-[#f38ba8]">
                {thresholdMsg}
              </p>
            )}

            <div className="mt-3 font-semibold text-[#cba6f7]">Nós da regra: que se edita e por que non</div>
            <ul className="mt-1 space-y-1">
              {regra.nos.map((no) => (
                <li key={no.id} data-testid={`rex-gameplay-node-${no.id}`} className="rounded bg-[#0f172a] p-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono">{no.titulo}</span>
                    <span className={no.editable ? "text-[#a6e3a1]" : "text-[#7f849c]"}>
                      {no.editable ? `editable: ${no.parametro}` : "sen edicion"}
                    </span>
                  </div>
                  {no.motivo && <div className="text-[#b7b0cf]">motivo: {no.motivo}</div>}
                  {no.mappings.length > 0 && (
                    <div className="mt-0.5 font-mono text-[#6c7086]">
                      {no.mappings.map((m) => `${m.rom_start}..${m.rom_end} ${m.bytes} ${m.mnemonic}`).join(" · ")}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {regra && (
        <ExperimentalNotice summary={`Ningun byte da ROM foi escrito por esta pantalla. Identidade observada: SHA-256 ${regra.romSha256.slice(0, 16)}… A xeracion da copia modificada segue o fluxo canónico (patch/rebuild) e pide confirmacion.`} />
      )}
    </div>
  );
}
