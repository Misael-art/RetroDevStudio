import { useEffect, useRef, useState } from "react";
import {
  rexGameplayEditThreshold,
  rexGameplayRecover,
  rexGameplayScan,
  type GameplayRecoverResponse,
  type GameplayScanCandidate,
} from "../../core/ipc/toolsService";
import {
  validateGameplayRecoverForm,
  validateGameplayThreshold,
  type GameplayRegra,
} from "../../core/nodegraph/rexGameplayGraph";
import {
  construirRegraRecuperada,
  lerRegraRecuperada,
  regraEditadaNoGrafo,
  revalidarIdentidade,
  type RegraRecuperada,
} from "../../core/nodegraph/rexGameplayScene";
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
 * Ponte coa escena do produto. Quen monta o panel di onde se garda (`entityId`),
 * que bloque hai gardado hoxe (`gardada`, o `components.logic.recovered_rule`
 * xa lido do proxecto), se a entidade ten lóxica propia que non se debe
 * sobrescreber, e como escribir (`gardar`) o bloque na escena e no disco.
 * `gardar` resolve `false` cando quedou só en memoria: a pantalla díoo.
 */
export type RexGameplayPersistencia = {
  entityId: string | null;
  gardada: unknown;
  entidadeConLogica?: boolean;
  gardar: (regra: RegraRecuperada) => Promise<boolean>;
};

type Fonte = {
  origem: "rom" | "escena";
  regra: RegraRecuperada;
  proxeccion: GameplayRegra;
};

type EstadoGardado = { entidade: string; persistido: boolean };

/**
 * Recuperacion delimitada de unha regra de gameplay (REX, Experimental).
 *
 * A interface non adiviña nada: quen chama declara ROM, entrada e saidas, e o
 * nucleo (`crates/rex-gameplay`) devolve o grafo da regra. Aqui ese grafo
 * projectase en frases comprensibles, co unico parametro editable (o limiar,
 * coa súa faixa) e o motivo explícito de cada elemento que non se edita — a
 * chamada externa permanece opaca porque o seu corpo non se recuperou.
 *
 * A regra viva e a regra gardada son o mesmo obxecto: o bloque que se escribe
 * na escena constrúese con `construirRegraRecuperada` e logo volve lerse con
 * `lerRegraRecuperada`, polo que a pantalla mostra sempre a proxeccion de lo
 * que realmente queda no proxecto. Un bloque gardado doutro perfil, cuxo grafo
 * foi adulterado ou cuxa identidade non bate coa ROM da barra retira-se co
 * motivo; nada se mostra "medio reaberto".
 *
 * Como no painel de contexto, os pedidos levan selo de secuencia: unha
 * resposta anterior á ultima ROM cargada ou ao ultimo pedido nunca se mostra.
 */
export function RexGameplayRulePanel({
  romPath,
  logMessage,
  persistencia = null,
}: {
  /** ROM analizada; trocala descarta grafo, proxeccion e pedidos en voo. */
  romPath: string;
  logMessage?: (level: LogLevel, message: string) => void;
  /** Persistencia na escena activa; sen ela a regra non se pode gardar. */
  persistencia?: RexGameplayPersistencia | null;
}) {
  const [entryHex, setEntryHex] = useState("0x946");
  const [exitsHex, setExitsHex] = useState("0x970");
  const [scanCandidates, setScanCandidates] = useState<GameplayScanCandidate[] | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [fonte, setFonteState] = useState<Fonte | null>(null);
  const [recusada, setRecusada] = useState<string | null>(null);
  const [identidadeConfirmada, setIdentidadeConfirmada] = useState(false);
  const [gardado, setGardado] = useState<EstadoGardado | null>(null);
  const [thresholdText, setThresholdText] = useState("");
  const [thresholdMsg, setThresholdMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<"scan" | "recover" | "edit" | "save" | "revalidate" | null>(
    null
  );
  const [erro, setErro] = useState<string | null>(null);

  const seq = useRef(0);
  const romRef = useRef(romPath);
  romRef.current = romPath;
  const fonteRef = useRef<Fonte | null>(null);
  const romDoEfecto = useRef(romPath);

  function setFonte(nova: Fonte | null) {
    fonteRef.current = nova;
    setFonteState(nova);
  }

  function asumirResposta(seqPedido: number, caminhoPedido: string): boolean {
    return seqPedido === seq.current && caminhoPedido === romRef.current;
  }

  const gardadaBruta = persistencia?.gardada ?? null;

  // A ROM da barra e o bloque da escena son as dúas fontes de verdade. Calquer
  // troque descarta a regra viva: primeiro lése o bloque, e só se proxecta se
  // pasa todas as comprobacions de `lerRegraRecuperada`.
  useEffect(() => {
    const trocouRom = romDoEfecto.current !== romPath;
    romDoEfecto.current = romPath;
    const viva = fonteRef.current;
    const xaEesteBloque =
      viva !== null && JSON.stringify(viva.regra) === JSON.stringify(gardadaBruta);
    if (xaEesteBloque && !trocouRom) return;

    seq.current += 1;
    setScanCandidates(null);
    setScanNote(null);
    setErro(null);
    setThresholdMsg(null);
    setGardado(null);
    if (gardadaBruta === null) {
      setFonte(null);
      setRecusada(null);
      setIdentidadeConfirmada(false);
      setThresholdText("");
      return;
    }
    const lectura = lerRegraRecuperada(gardadaBruta);
    if (!lectura.ok) {
      setFonte(null);
      setRecusada(lectura.motivo);
      setIdentidadeConfirmada(false);
      setThresholdText("");
      return;
    }
    setRecusada(null);
    setFonte({
      origem: "escena",
      regra: lectura.regra,
      proxeccion: lectura.proxeccion,
    });
    setIdentidadeConfirmada(false);
    setThresholdText(String(lectura.proxeccion.limiar));
  }, [romPath, gardadaBruta]);

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
      const resposta: GameplayRecoverResponse = await rexGameplayRecover(validado.request);
      if (!asumirResposta(seqPedido, caminho)) return;
      const construida = construirRegraRecuperada(resposta, caminho);
      if (!construida.ok) {
        setErro(`regra recusada: ${construida.motivo}`);
        return;
      }
      // Re-lese o bloque recien construido: o que se mostra e exactamente o
      // que se gardaria na escena, non unha segunda interpretacion do grafo.
      const relectura = lerRegraRecuperada(construida.regra);
      if (!relectura.ok) {
        setErro(`regra recusada ao relela: ${relectura.motivo}`);
        return;
      }
      setRecusada(null);
      setGardado(null);
      setFonte({ origem: "rom", regra: construida.regra, proxeccion: relectura.proxeccion });
      setIdentidadeConfirmada(true);
      setThresholdText(String(relectura.proxeccion.limiar));
      setThresholdMsg(null);
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
    const viva = fonteRef.current;
    if (!viva) return;
    const check = validateGameplayThreshold(
      thresholdText,
      viva.proxeccion.limiarMin,
      viva.proxeccion.limiarMax
    );
    if (!check.ok) {
      setThresholdMsg(check.motivo);
      return;
    }
    if (check.value === viva.proxeccion.limiar) {
      setThresholdMsg(null);
      return;
    }
    const seqPedido = (seq.current += 1);
    const caminho = romPath;
    setBusy("edit");
    setThresholdMsg(null);
    try {
      const resposta = await rexGameplayEditThreshold({
        request_id: novoRequestId("edit"),
        graph_json: viva.regra.graph_json,
        threshold: check.value,
      });
      if (!asumirResposta(seqPedido, caminho)) return;
      const editada = regraEditadaNoGrafo(viva.regra, resposta.graph_json);
      if (!editada.ok) {
        setErro(`a edicion quedou rexeitada: ${editada.motivo}`);
        return;
      }
      setFonte({ origem: viva.origem, regra: editada.regra, proxeccion: editada.proxeccion });
      setGardado(null);
      logMessage?.("success", `[REX gameplay] limiar aplicado no grafo: ${check.value}.`);
    } catch (cause) {
      if (seqPedido === seq.current) setErro(erroEstruturado(cause));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Gardar na escena non toca a ROM: escribe `components.logic.recovered_rule`
   * co grafo verbatim e persiste o proxecto. Recusase con motivo cando non hai
   * entidade, cando a entidade ten lóxica propia que se sobrescribiría, e avisa
   * explicitamente cando a escritura no disco fallou.
   */
  async function gardarNaEscena() {
    const viva = fonteRef.current;
    if (!viva) {
      setErro("sen unha regra recuperada non hai nada que gardar na escena");
      return;
    }
    if (!persistencia || !persistencia.entityId) {
      setErro("seleccione unha entidade na escena: sen entidade non hai onde gardar a regra");
      return;
    }
    if (persistencia.entidadeConLogica) {
      setErro(
        `a entidade ${persistencia.entityId} xa ten lóxica propia; escolla outra entidade para non a sobrescreber`
      );
      return;
    }
    const entidade = persistencia.entityId;
    setErro(null);
    setBusy("save");
    try {
      const persistido = await persistencia.gardar(viva.regra);
      setGardado({ entidade, persistido });
      logMessage?.(
        persistido ? "success" : "warn",
        persistido
          ? `[REX gameplay] regra gardada na entidade ${entidade} e escrita no proxecto.`
          : `[REX gameplay] regra gardada en memoria na entidade ${entidade}; a escena non se puido escribir.`
      );
    } catch (cause) {
      setErro(erroEstruturado(cause));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Unha regra reaberta di de onde veu, pero a identidade coa ROM da barra
   * vólvese comprobar contra o crate: `rex_gameplay_scan` le e hashrea a ROM
   * actual. Se o SHA diverxe, a regra retira-se: non se mostra nada como se
   * fose da ROM que non e.
   */
  async function revalidar() {
    const viva = fonteRef.current;
    if (!viva || !romPath) return;
    const seqPedido = (seq.current += 1);
    const caminho = romPath;
    setErro(null);
    setBusy("revalidate");
    try {
      const resposta = await rexGameplayScan({ request_id: novoRequestId("revalidate"), rom_path: caminho });
      if (!asumirResposta(seqPedido, caminho)) return;
      const check = revalidarIdentidade(viva.regra, resposta.rom_sha256);
      if (!check.ok) {
        setFonte(null);
        setRecusada(check.motivo);
        setIdentidadeConfirmada(false);
        logMessage?.("error", `[REX gameplay] ${check.motivo}`);
        return;
      }
      setIdentidadeConfirmada(true);
      logMessage?.(
        "success",
        `[REX gameplay] identidade revalidada: a regra da escena e da ROM observada (${resposta.rom_sha256.slice(0, 12)}…).`
      );
    } catch (cause) {
      if (seqPedido === seq.current) setErro(erroEstruturado(cause));
    } finally {
      setBusy(null);
    }
  }

  const regra: GameplayRegra | null = fonte?.proxeccion ?? null;

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
          Ningunha ROM na barra: pode reabrir o que estea gardado na escena, pero non haberá
          recuperacion nova nin revalidacion de identidade.
        </p>
      )}
      {erro && (
        <p data-testid="rex-gameplay-error" className="text-[10px] text-[#f38ba8]">
          {erro}
        </p>
      )}
      {recusada && (
        <p data-testid="rex-gameplay-saved-refused" className="text-[10px] text-[#f9e2af]">
          Bloque gardado rexeitado: {recusada}
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

      {fonte && (
        <div className="space-y-1 rounded bg-[#11111b] p-2 text-[10px]">
          <div data-testid="rex-gameplay-source" className="text-[#cdd6f4]">
            {fonte.origem === "rom"
              ? `Orixe: recuperada agora da ROM da barra (${romPath}).`
              : `Orixe: regra reaberta desde a escena${
                  persistencia?.entityId ? ` (entidade ${persistencia.entityId})` : ""
                }; o grafo guarda-se verbatim no proxecto.`}
          </div>
          <div data-testid="rex-gameplay-identity" className="text-[#b7b0cf]">
            {identidadeConfirmada
              ? `Identidade confirmada: SHA-256 ${fonte.regra.rom_sha256.slice(0, 12)}… observado nesta sesión.`
              : `Identidade non revalidada: o bloque gardado corresponde á SHA-256 ${fonte.regra.rom_sha256.slice(
                  0,
                  12
                )}… e aínda non se comparou coa ROM da barra.`}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {fonte.origem === "escena" && (
              <button
                type="button"
                data-testid="rex-gameplay-revalidate"
                onClick={() => void revalidar()}
                disabled={!romPath || busy !== null}
                className="rounded border border-[#89b4fa]/50 px-2 py-1 text-[#89b4fa] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "revalidate" ? "Revalidando..." : "Revalidar identidade"}
              </button>
            )}
            <button
              type="button"
              data-testid="rex-gameplay-save-scene"
              onClick={() => void gardarNaEscena()}
              disabled={busy !== null}
              className="rounded border border-[#f9e2af]/50 px-2 py-1 text-[#f9e2af] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "save" ? "Gardando..." : "Gardar na escena"}
            </button>
          </div>
          {gardado && (
            <p
              data-testid="rex-gameplay-saved-state"
              className={gardado.persistido ? "text-[#a6e3a1]" : "text-[#f9e2af]"}
            >
              {gardado.persistido
                ? `Regra gardada na entidade ${gardado.entidade} e escrita no disco do proxecto.`
                : `Regra gardada en memoria na entidade ${gardado.entidade}; a escena non se puido escribir, polo que aínda non está no disco.`}
            </p>
          )}
        </div>
      )}

      {regra && (
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
              {fonte && fonte.regra.threshold_recovered !== fonte.regra.threshold_current && (
                <span className="text-[#f9e2af]">
                  {" "}
                  · limiar da ROM original: {fonte.regra.threshold_recovered}
                </span>
              )}
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
