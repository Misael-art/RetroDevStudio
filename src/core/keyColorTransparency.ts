export type KeyColor = {
  r: number;
  g: number;
  b: number;
};

export type KeyColorTransparencyOptions = {
  keyColor?: KeyColor;
  showKeyColor?: boolean;
};

export type KeyColorTransparencyResult = {
  imageData: ImageData;
  detected: boolean;
  transparentPixels: number;
};

const DEFAULT_KEY_COLOR: KeyColor = { r: 255, g: 0, b: 255 };

function pixelMatches(data: Uint8ClampedArray, offset: number, keyColor: KeyColor): boolean {
  return (
    data[offset] === keyColor.r &&
    data[offset + 1] === keyColor.g &&
    data[offset + 2] === keyColor.b &&
    data[offset + 3] > 0
  );
}

export function hasBorderKeyColor(
  imageData: ImageData,
  keyColor: KeyColor = DEFAULT_KEY_COLOR
): boolean {
  const { width, height, data } = imageData;
  if (width <= 0 || height <= 0) {
    return false;
  }

  for (let x = 0; x < width; x += 1) {
    const top = x * 4;
    const bottom = ((height - 1) * width + x) * 4;
    if (pixelMatches(data, top, keyColor) || pixelMatches(data, bottom, keyColor)) {
      return true;
    }
  }

  for (let y = 0; y < height; y += 1) {
    const left = y * width * 4;
    const right = (y * width + (width - 1)) * 4;
    if (pixelMatches(data, left, keyColor) || pixelMatches(data, right, keyColor)) {
      return true;
    }
  }

  return false;
}

export function applyKeyColorTransparency(
  imageData: ImageData,
  options: KeyColorTransparencyOptions = {}
): KeyColorTransparencyResult {
  const keyColor = options.keyColor ?? DEFAULT_KEY_COLOR;
  const output = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const detected = hasBorderKeyColor(imageData, keyColor);

  if (!detected || options.showKeyColor) {
    return {
      imageData: output,
      detected,
      transparentPixels: 0,
    };
  }

  const { width, height } = output;
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const enqueue = (x: number, y: number) => {
    const pixelIndex = y * width + x;
    if (visited[pixelIndex]) {
      return;
    }
    const offset = pixelIndex * 4;
    if (!pixelMatches(output.data, offset, keyColor)) {
      return;
    }
    visited[pixelIndex] = 1;
    queue.push(pixelIndex);
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  let transparentPixels = 0;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const pixelIndex = queue[cursor];
    const offset = pixelIndex * 4;
    output.data[offset + 3] = 0;
    transparentPixels += 1;

    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    if (x > 0) {
      enqueue(x - 1, y);
    }
    if (x + 1 < width) {
      enqueue(x + 1, y);
    }
    if (y > 0) {
      enqueue(x, y - 1);
    }
    if (y + 1 < height) {
      enqueue(x, y + 1);
    }
  }

  return {
    imageData: output,
    detected,
    transparentPixels,
  };
}
