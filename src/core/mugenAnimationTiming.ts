// Tempo por quadro das animacoes importadas de MUGEN (perfil mugen.character.v1, Experimental).
// Unidade real do contrato: cada elemento da animacao tem a sua duracao em ticks de 1/60 s
// (o "tempo" da linha do .air). `-1` = quadro parado. O gerador SGDK usa `frame_durations`
// (u8: -1 ou 1..=255); `fps` das animacoes MUGEN e so um resumo e nao afeta a ROM.
import type { AnimationDef } from "./ipc/sceneService";

export const MUGEN_TICKS_PER_SECOND = 60;
export const MUGEN_MAX_TICKS = 255;

export type TicksParse = { ok: true; value: number } | { ok: false; message: string };

export function isMugenAnimation(def: AnimationDef): boolean {
  return (
    Array.isArray(def.mugen_frames) &&
    Array.isArray(def.frame_durations) &&
    def.frame_durations.length === def.frames.length &&
    def.mugen_frames.length === def.frames.length
  );
}

/** Valida o texto digitado; nada e arredondado nem cortado em silencio. */
export function parseTicks(raw: string): TicksParse {
  const text = raw.trim();
  if (text === "") {
    return { ok: false, message: "Digite um numero de ticks (1 a 255) ou -1 para parar." };
  }
  if (!/^-?\d+$/.test(text)) {
    return { ok: false, message: `"${text}" nao e um numero inteiro. Use ticks inteiros (1 a 255) ou -1.` };
  }
  const value = Number.parseInt(text, 10);
  if (value === -1) return { ok: true, value };
  if (value === 0) {
    return { ok: false, message: "0 nao e aceito: use 1 a 255 ticks, ou -1 para o quadro ficar parado." };
  }
  if (value < -1) {
    return { ok: false, message: `${value} nao e valido: use 1 a 255 ticks, ou -1 para parar.` };
  }
  if (value > MUGEN_MAX_TICKS) {
    return {
      ok: false,
      message: `${value} passa do maximo de ${MUGEN_MAX_TICKS} ticks (cerca de 4,25 s). Repita o quadro para tempos maiores.`,
    };
  }
  return { ok: true, value };
}

/** Copia da animacao com a duracao de UM quadro trocada; os demais ficam como estavam. */
export function withFrameDuration(def: AnimationDef, index: number, ticks: number): AnimationDef {
  return {
    ...def,
    frame_durations: (def.frame_durations ?? []).map((d, i) => (i === index ? ticks : d)),
    mugen_frames: (def.mugen_frames ?? []).map((f, i) => (i === index ? { ...f, duration: ticks } : f)),
  };
}

export function describeTicks(ticks: number): string {
  if (ticks === -1) return "parado (fica na tela ate a animacao ser trocada)";
  const seconds = ticks / MUGEN_TICKS_PER_SECOND;
  return `${ticks} tick${ticks === 1 ? "" : "s"} = ${seconds.toFixed(3).replace(".", ",")} s`;
}
