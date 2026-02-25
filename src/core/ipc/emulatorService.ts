import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

// ── Types (mirror do Rust) ────────────────────────────────────────────────────

export interface EmulatorCommandResult {
  ok: boolean;
  message: string;
}

/** Payload do evento `emulator://frame` — pixels RGBA prontos para ImageData */
export interface FramePayload {
  width: number;
  height: number;
  rgba: number[]; // Uint8Array serializado como array JSON
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

export function emulatorSendInput(joypad: JoypadState): Promise<EmulatorCommandResult> {
  return invoke<EmulatorCommandResult>("emulator_send_input", { joypad });
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
  onFrame: (payload: FramePayload) => void
): Promise<() => void> {
  let running = true;
  let unlisten: UnlistenFn | null = null;

  unlisten = await listen<FramePayload>("emulator://frame", (event) => {
    onFrame(event.payload);
  });

  // Loop a ~60fps usando requestAnimationFrame via setTimeout
  async function tick() {
    if (!running) return;
    await emulatorRunFrame();
    setTimeout(tick, 16); // ~60fps
  }

  tick();

  return () => {
    running = false;
    if (unlisten) unlisten();
  };
}

// ── Keyboard → JoypadState mapping ───────────────────────────────────────────

/** Mapeia teclas do teclado para botões do Mega Drive */
const KEY_MAP: Record<string, keyof JoypadState> = {
  ArrowUp:    "up",
  ArrowDown:  "down",
  ArrowLeft:  "left",
  ArrowRight: "right",
  KeyZ:       "a",    // A (Mega Drive)
  KeyX:       "b",    // B
  KeyC:       "y",    // C → Y (superset)
  Enter:      "start",
  ShiftRight: "select",
};

export function keyToJoypad(
  current: JoypadState,
  key: string,
  pressed: boolean
): JoypadState | null {
  const button = KEY_MAP[key];
  if (!button) return null;
  return { ...current, [button]: pressed };
}
