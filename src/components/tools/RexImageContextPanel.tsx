import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  rexResourceContext,
  rexResourceContextHit,
  type RexContextoImagem,
  type RexContextoRom,
  type RexResolucaoClique,
} from "../../core/ipc/toolsService";
import {
  PALETTE_ENTRIES,
  TILE_PX,
  TILESET_PER_ROW,
  ZOOMS_INTEIROS,
  ponteiroParaPixel,
} from "./rexLayerGeometry";

type LogLevel = "info" | "warn" | "error" | "success";

function hex(valor: number): string {
  return `0x${valor.toString(16)}`;
}

function flipsDaCelula(celula: { hflip: boolean; vflip: boolean }): string {
  if (celula.hflip && celula.vflip) return "H e V";
  if (celula.hflip) return "H";
  if (celula.vflip) return "V";
  return "nenhum";
}

/**
 * Contexto somente leitura de uma imagem composta por vínculo verificado
 * (REX, Experimental).
 *
 * A UI não sabe geometria: ela converte o ponteiro em pixel natural da camada e
 * pergunta ao núcleo qual célula, quais flips e qual pixel de fonte estão ali.
 * Por isso a mesma camada mostra, sem contas próprias, que quatro posições
 * diferentes vêm de um único tile — e que editar uma delas edita as quatro.
 *
 * Nada aqui escreve. Enfileirar uma edição delega ao painel de recursos, que é
 * quem conhece o domínio do índice e aplica pela transação canônica (identidade
 * da ROM, dependentes verificados, patch BPS).
 */
export function RexImageContextPanel({
  romPath,
  romSha,
  tilesetSelecionado,
  sheetPreview,
  onQueuePaint,
  logMessage,
}: {
  /** ROM a inspecionar. Trocar de ROM descarta contexto, seleção e pedidos. */
  romPath: string;
  /** SHA que a lista de recursos verificou; o contexto tem que bater. */
  romSha: string;
  /** Stream do TileSet do recurso selecionado no editor, ou `null`. */
  tilesetSelecionado: number | null;
  /** Prévia do TileSet selecionado, para destacar o tile de origem. */
  sheetPreview: { data_url: string; largura_px: number; altura_px: number } | null;
  onQueuePaint: (pixel: { tile: number; row: number; col: number }) => void;
  logMessage?: (level: LogLevel, message: string) => void;
}) {
  const [contexto, setContexto] = useState<RexContextoRom | null>(null);
  const [structSelecionado, setStructSelecionado] = useState<number | null>(null);
  const [clique, setClique] = useState<RexResolucaoClique | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Pedidos em voo são rotulados: uma resposta mais velha que a última ROM,
  // última carga ou último clique nunca chega à tela.
  const contextoSeq = useRef(0);
  const cliqueSeq = useRef(0);
  const romPathRef = useRef(romPath);
  const contextoRef = useRef<RexContextoRom | null>(null);

  useEffect(() => {
    romPathRef.current = romPath;
  }, [romPath]);

  useEffect(() => {
    contextoSeq.current += 1;
    cliqueSeq.current += 1;
    contextoRef.current = null;
    setContexto(null);
    setStructSelecionado(null);
    setClique(null);
    setErro(null);
    setAviso(null);
  }, [romPath]);

  const imagem: RexContextoImagem | null = useMemo(() => {
    if (!contexto || structSelecionado == null) return null;
    return contexto.imagens.find((i) => i.struct_offset === structSelecionado) ?? null;
  }, [contexto, structSelecionado]);

  const carregar = useCallback(async () => {
    const seq = (contextoSeq.current += 1);
    const caminhoPedida = romPath;
    setErro(null);
    setAviso(null);
    try {
      const resposta = await rexResourceContext(caminhoPedida);
      if (seq !== contextoSeq.current || caminhoPedida !== romPathRef.current) return;
      if (romSha && resposta.rom_sha256 !== romSha) {
        contextoRef.current = null;
        setContexto(null);
        setStructSelecionado(null);
        setClique(null);
        setErro(
          `identidade divergente: o contexto veio com ROM ${resposta.rom_sha256.slice(
            0,
            16
          )}… e os recursos verificados são da ${romSha.slice(0, 16)}…. Nenhum contexto é exibido.`
        );
        return;
      }
      contextoRef.current = resposta;
      setContexto(resposta);
      setStructSelecionado(resposta.imagens[0]?.struct_offset ?? null);
      setClique(null);
      logMessage?.(
        "info",
        `REX contexto: ${resposta.imagens.length} imagem(ns) com vínculo verificado, ` +
          `${resposta.sem_vinculo.length} sem vínculo, ${resposta.recusados.length} recusado(s).`
      );
    } catch (cause) {
      if (seq === contextoSeq.current) setErro(String(cause));
    }
  }, [romPath, romSha, logMessage]);

  const resolverClique = useCallback(
    async (structOffset: number, x: number, y: number) => {
      const seq = (cliqueSeq.current += 1);
      setErro(null);
      setAviso(null);
      try {
        const resposta = await rexResourceContextHit(romPath, structOffset, x, y);
        if (seq !== cliqueSeq.current) return;
        const esperado = contextoRef.current;
        if (!esperado || resposta.rom_sha256 !== esperado.rom_sha256) {
          setClique(null);
          setErro(
            `identidade divergente na resolução do clique: a resposta traz a ROM ` +
              `${resposta.rom_sha256.slice(0, 16)}…, que não é a do contexto carregado. ` +
              `Nenhuma seleção é mostrada.`
          );
          return;
        }
        setClique(resposta);
      } catch (cause) {
        if (seq === cliqueSeq.current) {
          setClique(null);
          setErro(String(cause));
        }
      }
    },
    [romPath]
  );

  const noCliqueDaCamada = useCallback(
    (event: React.MouseEvent<HTMLImageElement>) => {
      if (!imagem) return;
      const pixel = ponteiroParaPixel(
        event.currentTarget.getBoundingClientRect(),
        { largura: imagem.camada.largura_px, altura: imagem.camada.altura_px },
        event.clientX,
        event.clientY
      );
      if (!pixel) {
        setAviso(
          `clique fora da camada (${imagem.camada.largura_px}x${imagem.camada.altura_px} px): ` +
            `nada foi enviado ao núcleo e a seleção anterior foi mantida.`
        );
        return;
      }
      void resolverClique(imagem.struct_offset, pixel.x, pixel.y);
    },
    [imagem, resolverClique]
  );

  const enfileirarEdicaoDaFonte = useCallback(() => {
    if (!imagem || !clique) return;
    // A identidade é revalidada no uso, não só na carga: a lista de recursos
    // pode ter verificado outra ROM depois que este contexto foi montado.
    if (romSha && contexto && contexto.rom_sha256 !== romSha) {
      setErro(
        `identidade divergente ao enfileirar: o contexto é da ROM ${contexto.rom_sha256.slice(
          0,
          16
        )}… e os recursos verificados são da ${romSha.slice(0, 16)}…. Recarregue o contexto; ` +
          `nada entrou na fila.`
      );
      return;
    }
    if (tilesetSelecionado !== imagem.tileset.stream_offset) {
      const motivo =
        `esta imagem usa o TileSet ${hex(imagem.tileset.stream_offset)} (stream): selecione esse ` +
        `recurso na lista acima antes de enfileirar. Nada entrou na fila.`;
      setAviso(motivo);
      logMessage?.("warn", `REX edição não entrou na fila: ${motivo}`);
      return;
    }
    setAviso(null);
    onQueuePaint({
      tile: clique.fonte.tile,
      row: clique.fonte.linha,
      col: clique.fonte.coluna,
    });
  }, [imagem, clique, contexto, romSha, tilesetSelecionado, onQueuePaint, logMessage]);

  const camada = imagem?.camada ?? null;
  const tamanhoCamada = camada
    ? { largura: camada.largura_px * zoom, altura: camada.altura_px * zoom }
    : { largura: 0, altura: 0 };
  const passo = TILE_PX * zoom;

  return (
    <div className="flex flex-col gap-2 rounded border border-[#313244] bg-[#11111b] p-3" data-testid="rex-context-panel">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-semibold text-[#89b4fa]">
          Contexto da imagem (somente leitura) — Experimental
        </p>
        <button
          type="button"
          data-testid="rex-context-load"
          onClick={() => void carregar()}
          disabled={romPath.trim().length === 0}
          className="rounded border border-[#89b4fa] bg-[#89b4fa]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#89b4fa] disabled:opacity-40"
        >
          Carregar contexto
        </button>
        {contexto && (
          <select
            data-testid="rex-context-image-select"
            value={structSelecionado == null ? "" : hex(structSelecionado)}
            onChange={(event) => {
              const valor = Number.parseInt(event.target.value, 16);
              setStructSelecionado(Number.isNaN(valor) ? null : valor);
              setClique(null);
              setAviso(null);
              setErro(null);
            }}
            className="rounded border border-[#313244] bg-[#11111b] px-2 py-1 text-[11px] text-[#cdd6f4]"
          >
            {contexto.imagens.length === 0 && <option value="">nenhuma imagem</option>}
            {contexto.imagens.map((img) => (
              <option key={img.struct_offset} value={hex(img.struct_offset)}>
                {hex(img.struct_offset)} — {img.proveniencia} · {img.camada.largura_px}x
                {img.camada.altura_px} px · {img.mapa.cols}x{img.mapa.rows} células
              </option>
            ))}
          </select>
        )}
        {imagem && (
          <label className="flex items-center gap-1 text-[10px] text-[#a6adc8]">
            zoom
            <select
              data-testid="rex-context-zoom"
              value={String(zoom)}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="rounded border border-[#313244] bg-[#11111b] px-1 py-0.5 text-[#cdd6f4]"
            >
              {ZOOMS_INTEIROS.map((z) => (
                <option key={z} value={String(z)}>
                  {z}x
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {contexto && contexto.imagens.length === 0 && (
        <p className="text-[11px] text-[#a6adc8]" data-testid="rex-context-empty">
          nenhuma imagem foi verificada nesta ROM: nenhum trio de ponteiros alcança paleta,
          TileSet e TileMap que decodifiquem. A varredura não adivinha associações por
          proximidade.
        </p>
      )}

      {imagem && (
        <div className="flex flex-col gap-1 text-[10px] text-[#6c7086]" data-testid="rex-context-provenance">
          <p>
            vínculo <span className="text-[#a6e3a1]">{imagem.proveniencia}</span> · paleta{" "}
            {hex(imagem.paleta.stream_offset)} · TileSet {hex(imagem.tileset.stream_offset)} ·
            TileMap {hex(imagem.tilemap.stream_offset)}
          </p>
          <ul className="list-disc pl-4">
            {imagem.conferido.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p className="text-[#f9e2af]">Não prova:</p>
          <ul className="list-disc pl-4">
            {imagem.nao_prova.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {imagem && (
        <p className="text-[10px] text-[#6c7086]" data-testid="rex-context-geometry">
          camada {imagem.camada.largura_px}x{imagem.camada.altura_px} px ·{" "}
          {imagem.mapa.cols}x{imagem.mapa.rows} células · tiles sem uso neste mapa:{" "}
          {imagem.mapa.tiles_sem_uso.length === 0
            ? "nenhum"
            : imagem.mapa.tiles_sem_uso.map((t) => hex(t)).join(", ")}
        </p>
      )}

      {imagem && camada?.recusada && (
        <p className="text-[11px] text-[#f9e2af]" data-testid="rex-context-layer-refused">
          prévia recusada: {camada.recusada}. As células, ocorrências e identidades acima continuam
          publicados.
        </p>
      )}

      {imagem && camada?.png_data_url && (
        <div className="flex flex-wrap items-start gap-3 overflow-x-auto">
          <div
            className="relative shrink-0"
            style={{ width: tamanhoCamada.largura, height: tamanhoCamada.altura }}
          >
            <img
              src={camada.png_data_url}
              alt="camada composta do mapa verificado"
              data-testid="rex-context-layer"
              onClick={noCliqueDaCamada}
              width={camada.largura_px}
              height={camada.altura_px}
              style={{
                width: tamanhoCamada.largura,
                height: tamanhoCamada.altura,
                maxWidth: "none",
                imageRendering: "pixelated",
              }}
              className="cursor-crosshair rounded border border-[#313244]"
            />
            {(clique?.ocorrencias ?? []).map((ocorrencia) => (
              <div
                key={`rex-context-occurrence-${ocorrencia.indice}`}
                data-testid="rex-context-occurrence"
                className="absolute border border-[#89b4fa]/70 bg-[#89b4fa]/10"
                style={{
                  left: ocorrencia.col * passo,
                  top: ocorrencia.row * passo,
                  width: passo,
                  height: passo,
                }}
              />
            ))}
            {clique && (
              <div
                data-testid="rex-context-cell-highlight"
                className="absolute border-2 border-[#f9e2af]"
                style={{
                  left: clique.celula.col * passo,
                  top: clique.celula.row * passo,
                  width: passo,
                  height: passo,
                }}
              />
            )}
          </div>

          {tilesetSelecionado === imagem.tileset.stream_offset && sheetPreview && (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-[#6c7086]">TileSet (o tile de origem fica destacado)</p>
              <div
                className="relative shrink-0"
                style={{
                  width: sheetPreview.largura_px * zoom,
                  height: sheetPreview.altura_px * zoom,
                }}
              >
                <img
                  src={sheetPreview.data_url}
                  alt="prévia do TileSet"
                  data-testid="rex-context-tileset-sheet"
                  style={{
                    width: sheetPreview.largura_px * zoom,
                    height: sheetPreview.altura_px * zoom,
                    maxWidth: "none",
                    imageRendering: "pixelated",
                  }}
                  className="rounded border border-[#313244]"
                />
                {clique && (
                  <div
                    data-testid="rex-context-tile-highlight"
                    className="absolute border-2 border-[#f9e2af]"
                    style={{
                      left: (clique.fonte.tile % TILESET_PER_ROW) * passo,
                      top: Math.floor(clique.fonte.tile / TILESET_PER_ROW) * passo,
                      width: passo,
                      height: passo,
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {clique && imagem && (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-[#cdd6f4]" data-testid="rex-context-hit">
            célula ({clique.celula.col}, {clique.celula.row}) · índice {clique.celula.indice} ·
            tile {clique.celula.tile} · flips {flipsDaCelula(clique.celula)} · banco{" "}
            {clique.celula.banco} · prioridade {clique.celula.prioridade ? "sim" : "não"} · local
            na célula ({clique.x - clique.celula.col * TILE_PX},{" "}
            {clique.y - clique.celula.row * TILE_PX}) · tile de origem {clique.fonte.tile}, linha{" "}
            {clique.fonte.linha}, coluna {clique.fonte.coluna} · índice atual {clique.fonte.indice}
          </p>
          <p className="text-[11px] text-[#89b4fa]" data-testid="rex-context-occurrences">
            {clique.ocorrencias.length} ocorrências neste mapa verificado — {imagem.mapa.escopo}
          </p>
          <p className="text-[10px] text-[#f9e2af]" data-testid="rex-context-impact">
            editar o tile de origem muda as {clique.ocorrencias.length} ocorrências deste mapa;
            nenhuma ocorrência isolada é editável enquanto o tile for compartilhado — isso exigiria
            duplicar e realocar o tile, que a transação não faz.
          </p>
          <div>
            <button
              type="button"
              data-testid="rex-context-queue-edit"
              onClick={enfileirarEdicaoDaFonte}
              className="rounded border border-[#a6e3a1] bg-[#a6e3a1]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a6e3a1]"
            >
              Enfileirar edição no pixel de origem
            </button>
          </div>
        </div>
      )}

      {contexto && contexto.sem_vinculo.length > 0 && (
        <div className="text-[10px] text-[#6c7086]" data-testid="rex-context-unlinked">
          <p>Recursos verificados sem vínculo com nenhuma imagem desta ROM:</p>
          <ul className="list-disc pl-4">
            {contexto.sem_vinculo.map((recurso) => (
              <li key={`${recurso.tipo}-${recurso.identidade.stream_offset}`}>
                {recurso.tipo} {hex(recurso.identidade.stream_offset)} ({recurso.identidade.codec},{" "}
                {recurso.identidade.plain_len} B) — {recurso.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}

      {contexto && contexto.recusados.length > 0 && (
        <div className="text-[10px] text-[#6c7086]" data-testid="rex-context-refused-links">
          <p>Trias que parecem um struct `Image` mas foram recusados:</p>
          <ul className="list-disc pl-4">
            {contexto.recusados.map((recusado) => (
              <li key={recusado.struct_offset}>
                {hex(recusado.struct_offset)} · {recusado.codigo} · {recusado.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}

      {contexto && (
        <p className="text-[10px] text-[#6c7086]">
          ROM {contexto.rom_sha256.slice(0, 16)}… ({contexto.rom_len} B) · orçamento de{" "}
          {contexto.limite_trabalho.max_pixels_por_camada} pixels por camada · {contexto.escopo}
          {" "}· índice de paleta é um valor de 0 a {PALETTE_ENTRIES - 1}.
        </p>
      )}

      {aviso && (
        <p className="text-[11px] text-[#f9e2af]" data-testid="rex-context-notice">
          {aviso}
        </p>
      )}
      {erro && (
        <p className="text-[11px] text-[#f38ba8]" data-testid="rex-context-error">
          {erro}
        </p>
      )}
    </div>
  );
}
