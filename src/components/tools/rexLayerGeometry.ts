/// Geometria que a frente compartilha com o núcleo ao desenhar uma camada
/// composta do SGDK. O núcleo decide célula, flips e pixel de fonte; aqui só
/// existe a aritmética de grade e a conversão do ponteiro para o pixel NATURAL
/// da imagem, que é o que o comando de contexto aceita como entrada.
///
/// Os valores abaixo espelham o núcleo (`rex_context.rs`, `rex_resources.rs`):
/// 8 px por tile, sheet de TileSet com 16 tiles por linha, paleta 4bpp.

/** Lado de um tile do VDP, em pixels. */
export const TILE_PX = 8;

/** Tiles por linha no sheet que o núcleo compõe para a prévia de um TileSet. */
export const TILESET_PER_ROW = 16;

/** Entradas de um plano de paleta 4bpp. O índice 0 é o que o VDP lê como
 *  transparente, não uma cor ausente. */
export const PALETTE_ENTRIES = 16;

/** Zooms aceitos: inteiros, para que um pixel do artefato ocupe um quadradinho
 *  inteiro na tela. Com fração, o navegador interpola e o pixel some. */
export const ZOOMS_INTEIROS: readonly number[] = [1, 2, 3, 4, 6, 8];

export interface Retangulo {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DimensoesNaturais {
  largura: number;
  altura: number;
}

export interface PixelNatural {
  x: number;
  y: number;
}

/**
 * Converte a posição do ponteiro (coordenadas de viewport) no pixel natural da
 * imagem. `rect` é o `getBoundingClientRect()` já deformado por zoom inteiro,
 * `max-width` do layout e escala de página; a razão entre ele e o tamanho
 * natural desfaz as três coisas de uma vez.
 *
 * Fora da imagem devolve `null` em vez de prender o valor à borda: coordenada
 * inventada viraria clique em uma célula que o usuário não apontou.
 */
export function ponteiroParaPixel(
  rect: Retangulo,
  natural: DimensoesNaturais,
  clientX: number,
  clientY: number
): PixelNatural | null {
  const { largura, altura } = natural;
  if (
    !(rect.width > 0) ||
    !(rect.height > 0) ||
    !(largura > 0) ||
    !(altura > 0)
  ) {
    return null;
  }
  const fx = (clientX - rect.left) / rect.width;
  const fy = (clientY - rect.top) / rect.height;
  if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) return null;
  return { x: Math.floor(fx * largura), y: Math.floor(fy * altura) };
}
