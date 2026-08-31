const DEFAULT_MAX_PIXEL_RATIO = 2;

export function normalizedPixelRatio(value, maximum = DEFAULT_MAX_PIXEL_RATIO) {
  const ratio = Number(value);
  const cap = Number(maximum);
  if (!Number.isFinite(cap) || cap < 1) {
    throw new TypeError("maximum은 1 이상의 유한한 수여야 합니다");
  }
  if (!Number.isFinite(ratio) || ratio < 1) return 1;
  return Math.min(ratio, cap);
}

export function configureHiDpiSquareCanvas(
  canvas,
  logicalSize,
  devicePixelRatio = 1,
) {
  if (!canvas || typeof canvas.getContext !== "function") {
    throw new TypeError("canvas가 필요합니다");
  }
  if (!Number.isFinite(logicalSize) || logicalSize <= 0) {
    throw new TypeError("logicalSize는 양수여야 합니다");
  }
  const pixelRatio = normalizedPixelRatio(devicePixelRatio);
  canvas.width = Math.round(logicalSize * pixelRatio);
  canvas.height = Math.round(logicalSize * pixelRatio);
  canvas.dataset.pixelRatio = String(pixelRatio);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas context를 만들 수 없습니다");
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return Object.freeze({ context, logicalSize, pixelRatio });
}

export function clientPointToCanvas(event, rectangle, logicalSize) {
  if (!rectangle || rectangle.width <= 0 || rectangle.height <= 0) {
    throw new TypeError("canvas의 표시 크기가 필요합니다");
  }
  return Object.freeze({
    x: (Number(event.clientX) - rectangle.left) * logicalSize / rectangle.width,
    y: (Number(event.clientY) - rectangle.top) * logicalSize / rectangle.height,
  });
}
