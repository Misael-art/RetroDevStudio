import { readProjectAssetBytes } from "./ipc/toolsService";

/**
 * PPM (P6 binary / P3 ASCII) decoding shared by every editor surface. WebKit cannot
 * decode PPM through <img>/asset://, so project PPMs are read as bytes over IPC
 * (`readProjectAssetBytes`) and decoded here — the one canonical path.
 */
export function decodePpmP3(content: string): ImageData | null {
  const cleaned = content
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter((line) => line.length > 0)
    .join(" ")
    .trim();
  if (!cleaned.startsWith("P3 ")) return null;

  const tokens = cleaned.split(/\s+/);
  if (tokens.length < 4) return null;

  const width = Number(tokens[1]);
  const height = Number(tokens[2]);
  const maxValue = Number(tokens[3]);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return null;
  }
  if (!Number.isFinite(maxValue) || maxValue <= 0) return null;

  const expectedComponents = width * height * 3;
  const values = tokens.slice(4, 4 + expectedComponents).map((token) => Number(token));
  if (values.length !== expectedComponents || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const sourceOffset = index * 3;
    const targetOffset = index * 4;
    pixels[targetOffset] = Math.round((values[sourceOffset] / maxValue) * 255);
    pixels[targetOffset + 1] = Math.round((values[sourceOffset + 1] / maxValue) * 255);
    pixels[targetOffset + 2] = Math.round((values[sourceOffset + 2] / maxValue) * 255);
    pixels[targetOffset + 3] = 255;
  }

  return new ImageData(pixels, width, height);
}

function readPpmToken(bytes: Uint8Array, start: number): { token: string; next: number } | null {
  let cursor = start;
  while (cursor < bytes.length) {
    while (cursor < bytes.length && bytes[cursor] <= 32) cursor += 1;
    if (bytes[cursor] !== 35) break;
    while (cursor < bytes.length && bytes[cursor] !== 10) cursor += 1;
  }
  const tokenStart = cursor;
  while (cursor < bytes.length && bytes[cursor] > 32) cursor += 1;
  if (cursor === tokenStart) return null;
  return { token: new TextDecoder().decode(bytes.slice(tokenStart, cursor)), next: cursor };
}

function decodePpmP6(bytes: Uint8Array): ImageData | null {
  let cursor = 0;
  const magic = readPpmToken(bytes, cursor);
  if (!magic || magic.token !== "P6") return null;
  cursor = magic.next;
  const widthToken = readPpmToken(bytes, cursor);
  if (!widthToken) return null;
  cursor = widthToken.next;
  const heightToken = readPpmToken(bytes, cursor);
  if (!heightToken) return null;
  cursor = heightToken.next;
  const maxValueToken = readPpmToken(bytes, cursor);
  if (!maxValueToken) return null;
  cursor = maxValueToken.next;

  const width = Number(widthToken.token);
  const height = Number(heightToken.token);
  const maxValue = Number(maxValueToken.token);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  if (!Number.isFinite(maxValue) || maxValue <= 0 || maxValue > 255) return null;

  if (bytes[cursor] === 13 && bytes[cursor + 1] === 10) cursor += 2;
  else if (bytes[cursor] <= 32) cursor += 1;

  const expectedComponents = width * height * 3;
  if (bytes.length - cursor < expectedComponents) return null;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const sourceOffset = cursor + index * 3;
    const targetOffset = index * 4;
    pixels[targetOffset] = Math.round((bytes[sourceOffset] / maxValue) * 255);
    pixels[targetOffset + 1] = Math.round((bytes[sourceOffset + 1] / maxValue) * 255);
    pixels[targetOffset + 2] = Math.round((bytes[sourceOffset + 2] / maxValue) * 255);
    pixels[targetOffset + 3] = 255;
  }
  return new ImageData(pixels, width, height);
}

export function decodePpm(bytes: ArrayBuffer): ImageData | null {
  const data = new Uint8Array(bytes);
  const signature = new TextDecoder().decode(data.slice(0, 2));
  return signature === "P6"
    ? decodePpmP6(data)
    : decodePpmP3(new TextDecoder().decode(data));
}


export function isPpmPath(path: string | null | undefined): boolean {
  return String(path ?? "").trim().toLowerCase().endsWith(".ppm");
}

/** Reads a project PPM over IPC and decodes it; throws with a useful reason on failure. */
export async function loadProjectPpmImageData(projectDir: string, relativePath: string): Promise<ImageData> {
  const bytes = await readProjectAssetBytes(projectDir, relativePath);
  const imageData = decodePpm(Uint8Array.from(bytes).buffer);
  if (!imageData) {
    throw new Error(`PPM invalido ou nao suportado (esperado P6/P3 8-bit): ${relativePath}`);
  }
  return imageData;
}

export function imageDataToPngDataUrl(imageData: ImageData): string {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas indisponivel");
  context.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/png");
}
