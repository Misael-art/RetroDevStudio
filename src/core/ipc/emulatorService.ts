import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { ActionableDiagnostic } from "../diagnostics";

// ── Types (mirror do Rust) ────────────────────────────────────────────────────

export interface EmulatorCommandResult {
  ok: boolean;
  message: string;
  diagnostics?: ActionableDiagnostic[];
}

export interface EmulatorObservationResult {
  ok: boolean;
  message: string;
  rom_path: string;
  rom_size: number;
  rom_sha256: string;
  core_label: string;
  core_path: string;
  frames_run: number;
  framebuffer_width: number;
  framebuffer_height: number;
  framebuffer_sha256: string;
  non_black_pixels: number;
  framebuffer_rgba: number[];
}

export interface EmulatorMemoryResult {
  ok: boolean;
  data: number[];
  total_size: number;
}

export interface ReplayCommandResult {
  ok: boolean;
  message: string;
  replay_path: string;
  frames_recorded: number;
  framebuffer_match: boolean | null;
}

/** Payload do evento `emulator://frame` — pixels RGBA prontos para ImageData */
export interface FramePayload {
  width: number;
  height: number;
  rgba: number[]; // Uint8Array serializado como array JSON
}

/** Payload do evento `emulator://audio` — amostras PCM i16 stereo */
export interface AudioPayload {
  sample_rate: number;
  samples: number[];
}

export interface JoypadState {
  b: boolean;
  y: boolean;
  select: boolean;
  start: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  a: boolean;
  x: boolean;
  l: boolean;
  r: boolean;
}

export const JOYPAD_DEFAULT: JoypadState = {
  b: false, y: false, select: false, start: false,
  up: false, down: false, left: false, right: false,
  a: false, x: false, l: false, r: false,
};

// ── IPC calls ─────────────────────────────────────────────────────────────────

export function emulatorLoadRom(romPath: string): Promise<EmulatorCommandResult> {
  return invoke<EmulatorCommandResult>("emulator_load_rom", { romPath });
}

export function emulatorRunFrame(): Promise<EmulatorCommandResult> {
  return invoke<EmulatorCommandResult>("emulator_run_frame");
}

export function emulatorRunFrames(frames: number): Promise<EmulatorCommandResult> {
  return invoke<EmulatorCommandResult>("emulator_run_frames", { frames });
}

export function emulatorObserve(): Promise<EmulatorObservationResult> {
  return invoke<EmulatorObservationResult>("emulator_observe");
}

export function emulatorSaveState(): Promise<EmulatorCommandResult> {
  return invoke<EmulatorCommandResult>("emulator_save_state");
}

export function emulatorLoadState(): Promise<EmulatorCommandResult> {
  return invoke<EmulatorCommandResult>("emulator_load_state");
}

export function emulatorRewindStep(): Promise<EmulatorCommandResult> {
  return invoke<EmulatorCommandResult>("emulator_rewind_step");
}

export function emulatorStartRecording(): Promise<ReplayCommandResult> {
  return invoke<ReplayCommandResult>("emulator_start_recording");
}

export function emulatorStopRecording(projectDir: string): Promise<ReplayCommandResult> {
  return invoke<ReplayCommandResult>("emulator_stop_recording", { projectDir });
}

export function emulatorPlayReplay(replayPath: string): Promise<ReplayCommandResult> {
  return invoke<ReplayCommandResult>("emulator_play_replay", { replayPath });
}

export function emulatorReadMemory(
  region: number,
  offset: number,
  length: number
): Promise<EmulatorMemoryResult> {
  return invoke<EmulatorMemoryResult>("emulator_read_memory", { region, offset, length });
}

export function emulatorSendInput(
  joypad: JoypadState,
  sessionEpoch?: number
): Promise<EmulatorCommandResult> {
  return invoke<EmulatorCommandResult>("emulator_send_input", {
    joypad,
    sessionEpoch: sessionEpoch ?? null,
  });
}

export function emulatorGetCoreEpoch(): Promise<number> {
  return invoke<number>("emulator_get_core_epoch");
}

export function emulatorStop(): Promise<EmulatorCommandResult> {
  return invoke<EmulatorCommandResult>("emulator_stop");
}

/**
 * Inicia o loop de renderização a 60fps.
 * Chama `emulator_run_frame` a cada ~16ms e escuta `emulator://frame` para
 * entregar cada frame ao callback `onFrame`.
 *
 * @returns função para parar o loop (chame ao desmontar o componente)
 */
export async function startFrameLoop(
  onFrame: (payload: FramePayload) => void,
  onError?: (message: string) => void
): Promise<() => void> {
  let running = true;
  let unlisten: UnlistenFn | null = null;

  unlisten = await listen<FramePayload>("emulator://frame", (event) => {
    onFrame(event.payload);
  });

  function stop() {
    running = false;
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
  }

  function fail(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    stop();
    onError?.(message);
  }

  // Loop a ~60fps usando requestAnimationFrame via setTimeout
  async function tick() {
    if (!running) return;
    try {
      const result = await emulatorRunFrame();
      if (!running) return;
      if (!result.ok) {
        fail(result.message || "Falha ao executar frame do emulador.");
        return;
      }
    } catch (error) {
      fail(error);
      return;
    }
    setTimeout(tick, 16); // ~60fps
  }

  tick();

  return stop;
}

/**
 * Observabilidade do encaminhamento de audio core → WebAudio. Separa o que o
 * core gerou (recebido), o que foi entregue ao grafo de saida do AudioContext
 * (renderizado) e o estado do contexto. Nao prova captura acustica/loopback.
 */
export type AudioOutputTelemetry = {
  receivedFrames: number;
  receivedNonZeroFrames: number;
  renderedFrames: number;
  renderedNonZeroFrames: number;
  renderedPeak: number;
  contextState: string | null;
  contextSampleRate: number | null;
  muted: boolean;
};

const audioOutputTelemetry: AudioOutputTelemetry = {
  receivedFrames: 0,
  receivedNonZeroFrames: 0,
  renderedFrames: 0,
  renderedNonZeroFrames: 0,
  renderedPeak: 0,
  contextState: null,
  contextSampleRate: null,
  muted: false,
};

export function recordAudioOutput(update: Partial<AudioOutputTelemetry> & {
  addReceived?: { frames: number; nonZero: number };
  addRendered?: { frames: number; nonZero: number; peak: number };
}): void {
  const { addReceived, addRendered, ...fields } = update;
  Object.assign(audioOutputTelemetry, fields);
  if (addReceived) {
    audioOutputTelemetry.receivedFrames += addReceived.frames;
    audioOutputTelemetry.receivedNonZeroFrames += addReceived.nonZero;
  }
  if (addRendered) {
    audioOutputTelemetry.renderedFrames += addRendered.frames;
    audioOutputTelemetry.renderedNonZeroFrames += addRendered.nonZero;
    audioOutputTelemetry.renderedPeak = Math.max(audioOutputTelemetry.renderedPeak, addRendered.peak);
  }
}

/** Last seconds of stereo samples received from the core, addressed by absolute index. */
const AUDIO_RING_CAPACITY = 44100 * 2 * 10;
const audioRing = new Int16Array(AUDIO_RING_CAPACITY);
let audioRingTotal = 0;
let audioRingSampleRate = 0;

export function recordReceivedAudioSamples(samples: ArrayLike<number>, sampleRate: number): void {
  audioRingSampleRate = sampleRate;
  for (let index = 0; index < samples.length; index += 1) {
    audioRing[(audioRingTotal + index) % AUDIO_RING_CAPACITY] = samples[index];
  }
  audioRingTotal += samples.length;
}

/** Samples [from, from+count) if still in the ring; `total` is the running sample count. */
export function readReceivedAudioSamples(from: number, count: number): { total: number; sampleRate: number; from: number; samples: number[] } {
  const start = Math.max(from, audioRingTotal - AUDIO_RING_CAPACITY, 0);
  const end = Math.min(start + count, audioRingTotal);
  const samples: number[] = [];
  for (let index = start; index < end; index += 1) samples.push(audioRing[index % AUDIO_RING_CAPACITY]);
  return { total: audioRingTotal, sampleRate: audioRingSampleRate, from: start, samples };
}

export function getAudioOutputTelemetry(): AudioOutputTelemetry {
  return { ...audioOutputTelemetry };
}

export async function listenToAudioStream(
  onAudio: (payload: AudioPayload) => void
): Promise<UnlistenFn> {
  return listen<AudioPayload>("emulator://audio", (event) => {
    onAudio(event.payload);
  });
}

// ── Keyboard → JoypadState mapping ───────────────────────────────────────────

export type JoypadPlatform = "megadrive" | "snes";

/**
 * Teclado → RetroPad. Os campos de `JoypadState` sao ids do RetroPad Libretro,
 * nao botoes do console. O Genesis Plus GX liga RetroPad Y→A, B→B e A→C do
 * Mega Drive (verificado com ROM SGDK real: so `y` aciona `BUTTON_A`), entao
 * Z/X/C precisam mirar Y/B/A para chegarem como A/B/C no jogo.
 */
const MEGADRIVE_KEY_MAP: Record<string, keyof JoypadState> = {
  ArrowUp:    "up",
  ArrowDown:  "down",
  ArrowLeft:  "left",
  ArrowRight: "right",
  KeyZ:       "y",    // Mega Drive A
  KeyX:       "b",    // Mega Drive B
  KeyC:       "a",    // Mega Drive C
  Enter:      "start",
  ShiftRight: "select",
};

/** SNES: RetroPad segue o layout nativo do controle. */
const SNES_KEY_MAP: Record<string, keyof JoypadState> = {
  ArrowUp:    "up",
  ArrowDown:  "down",
  ArrowLeft:  "left",
  ArrowRight: "right",
  KeyZ:       "a",
  KeyX:       "b",
  KeyC:       "y",
  Enter:      "start",
  ShiftRight: "select",
};

/** Botao do Mega Drive (como o SGDK o nomeia, sem o prefixo `BUTTON_`). */
export type MegadriveButton = "A" | "B" | "C" | "START" | "UP" | "DOWN" | "LEFT" | "RIGHT";

/** RetroPad → botao do Mega Drive, conforme o core Genesis Plus GX (ver comentario acima). */
const MEGADRIVE_RETROPAD_TO_BUTTON: Partial<Record<keyof JoypadState, MegadriveButton>> = {
  y: "A",
  b: "B",
  a: "C",
  start: "START",
  up: "UP",
  down: "DOWN",
  left: "LEFT",
  right: "RIGHT",
};

/**
 * Teclas do teclado que chegam ao jogo como `button` no Mega Drive. Derivado do mesmo
 * `MEGADRIVE_KEY_MAP` usado pela Game View, para a UI nunca divergir do core.
 */
export function megadriveKeyboardKeysForButton(button: MegadriveButton): string[] {
  return Object.entries(MEGADRIVE_KEY_MAP)
    .filter(([, retroPad]) => MEGADRIVE_RETROPAD_TO_BUTTON[retroPad] === button)
    .map(([key]) => key);
}

export function keyToJoypad(
  current: JoypadState,
  key: string,
  pressed: boolean,
  platform: JoypadPlatform = "megadrive"
): JoypadState | null {
  const button = (platform === "snes" ? SNES_KEY_MAP : MEGADRIVE_KEY_MAP)[key];
  if (!button) return null;
  return { ...current, [button]: pressed };
}
