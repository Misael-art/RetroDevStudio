import { describe, expect, it } from "vitest";
import {
  PALETTE_ENTRIES,
  TILE_PX,
  TILESET_PER_ROW,
  ZOOMS_INTEIROS,
  ponteiroParaPixel,
} from "./rexLayerGeometry";

/** O `getBoundingClientRect()` devolve o tamanho COM QUE A PÁGINA renderizou o
 *  elemento: zoom do navegador, `max-width` do layout e zoom inteiro da camada
 *  entram por essa razão. Estes casos pinam a conversão antes de ela chegar a
 *  qualquer clique de mouse. */
describe("ponteiro → pixel natural da camada", () => {
  const natural = { largura: 120, altura: 72 };

  it("com zoom inteiro 2x, o ponteiro cai no pixel dobrado", () => {
    const rect = { left: 0, top: 0, width: 240, height: 144 };
    expect(ponteiroParaPixel(rect, natural, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(ponteiroParaPixel(rect, natural, 10, 6)).toEqual({ x: 5, y: 3 });
    expect(ponteiroParaPixel(rect, natural, 239, 143)).toEqual({ x: 119, y: 71 });
  });

  it("com a página escalada (elemento menor que o natural), a razão preserva o pixel", () => {
    // 120px naturais renderizados em 300px por CSS: (150,150) é o centro exato.
    const rect = { left: 0, top: 0, width: 300, height: 180 };
    expect(ponteiroParaPixel(rect, natural, 150, 150)).toEqual({ x: 60, y: 60 });
    expect(ponteiroParaPixel(rect, natural, 2.5, 2.5)).toEqual({ x: 1, y: 1 });
  });

  it("com a camada deslocada na página, só importa a distância até a borda", () => {
    const rect = { left: 40, top: 25, width: 240, height: 144 };
    expect(ponteiroParaPixel(rect, natural, 48, 33)).toEqual({ x: 4, y: 4 });
  });

  it("fora da imagem devolve null em vez de arredondar para dentro", () => {
    const rect = { left: 10, top: 10, width: 120, height: 72 };
    expect(ponteiroParaPixel(rect, natural, 9, 12)).toBeNull();
    expect(ponteiroParaPixel(rect, natural, 12, 9)).toBeNull();
    // A borda direita/inferior não pertence à imagem: o último pixel é 119/71.
    expect(ponteiroParaPixel(rect, natural, 130, 46)).toBeNull();
    expect(ponteiroParaPixel(rect, natural, 129.9999, 46)).toEqual({ x: 119, y: 36 });
  });

  it("elemento sem tamanho renderizado não produz coordenada", () => {
    const rect = { left: 0, top: 0, width: 0, height: 0 };
    expect(ponteiroParaPixel(rect, natural, 0, 0)).toBeNull();
  });

  it("o zoom oferecido é inteiro: pixel nítido não se compõe com fração", () => {
    expect(ZOOMS_INTEIROS).toEqual([1, 2, 3, 4, 6, 8]);
    for (const zoom of ZOOMS_INTEIROS) {
      expect(Number.isInteger(zoom)).toBe(true);
      expect(zoom).toBeGreaterThan(0);
    }
  });

  it("as constantes de grade são as que o núcleo usa ao compor a camada", () => {
    // 8 px por tile, 16 tiles por linha no sheet do TileSet, 4bpp → 16 índices.
    // Se o núcleo mudar a grade, a sobreposição do destaque muda junto; estes
    // valores pinam que as duas pontas concordam.
    expect(TILE_PX).toBe(8);
    expect(TILESET_PER_ROW).toBe(16);
    expect(PALETTE_ENTRIES).toBe(16);
  });
});
