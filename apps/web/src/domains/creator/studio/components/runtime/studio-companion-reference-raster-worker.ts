import {
  STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_DATA_URL_CHARS,
  STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_HEIGHT,
  STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_INPUT_BYTES,
  STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_OUTPUT_BYTES,
  STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_WIDTH,
} from "./studio-companion-reference-raster-worker-protocol";

type WorkerScope = {
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function decodeStudioCompanionReferenceWorkerDataUrl(
  dataUrl: string
): Uint8Array<ArrayBuffer> {
  if (dataUrl.length > STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_DATA_URL_CHARS) {
    throw new TypeError("oversized data URL");
  }
  const separator = dataUrl.indexOf(",");
  if (separator < 5 || !dataUrl.startsWith("data:")) throw new TypeError("invalid data URL");
  const metadata = dataUrl.slice(5, separator);
  const payload = dataUrl.slice(separator + 1);
  if (metadata.split(";").slice(1).some((token) => token.trim().toLowerCase() === "base64")) {
    const decoded = atob(decodeURIComponent(payload).replace(/[\t\n\f\r ]/gu, ""));
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  }
  const encoder = new TextEncoder();
  const maximumCapacity = Math.min(
    STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_INPUT_BYTES + 1,
    payload.length * 3
  );
  const bytes = new Uint8Array(maximumCapacity);
  let byteOffset = 0;
  let start = 0;
  const appendText = (end: number) => {
    if (end <= start) return;
    const text = payload.slice(start, end);
    const encoded = encoder.encodeInto(text, bytes.subarray(byteOffset));
    if (encoded.read !== text.length) throw new TypeError("oversized decoded payload");
    byteOffset += encoded.written;
    if (byteOffset > STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_INPUT_BYTES) {
      throw new TypeError("oversized decoded payload");
    }
  };
  for (let index = 0; index < payload.length; index += 1) {
    if (payload[index] !== "%") continue;
    appendText(index);
    const encoded = payload.slice(index + 1, index + 3);
    if (!/^[0-9a-f]{2}$/iu.test(encoded)) throw new TypeError("invalid percent payload");
    if (byteOffset >= STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_INPUT_BYTES) {
      throw new TypeError("oversized decoded payload");
    }
    bytes[byteOffset] = Number.parseInt(encoded, 16);
    byteOffset += 1;
    index += 2;
    start = index + 1;
  }
  appendText(payload.length);
  return bytes.subarray(0, byteOffset);
}

function fitDimensions(width: number, height: number, maximumOutputPixels: number) {
  const scale = Math.min(
    1,
    STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_WIDTH / width,
    STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_HEIGHT / height,
    Math.sqrt(maximumOutputPixels / (width * height))
  );
  let outputWidth = Math.max(1, Math.floor(width * scale));
  let outputHeight = Math.max(1, Math.floor(height * scale));
  while (outputWidth * outputHeight > maximumOutputPixels) {
    if (outputWidth >= outputHeight && outputWidth > 1) outputWidth -= 1;
    else outputHeight -= 1;
  }
  return { width: outputWidth, height: outputHeight };
}

function resizeRgba(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  deadlineAt: number
): Uint8ClampedArray {
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) {
    return new Uint8ClampedArray(source);
  }
  const output = new Uint8ClampedArray(targetWidth * targetHeight * 4);
  const xScale = sourceWidth / targetWidth;
  const yScale = sourceHeight / targetHeight;
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    if ((targetY & 15) === 0 && Date.now() > deadlineAt) throw new DOMException("deadline", "TimeoutError");
    const sourceY = Math.max(0, Math.min(sourceHeight - 1, (targetY + 0.5) * yScale - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const yWeight = sourceY - y0;
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const sourceX = Math.max(0, Math.min(sourceWidth - 1, (targetX + 0.5) * xScale - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const xWeight = sourceX - x0;
      const target = (targetY * targetWidth + targetX) * 4;
      const topLeft = (y0 * sourceWidth + x0) * 4;
      const topRight = (y0 * sourceWidth + x1) * 4;
      const bottomLeft = (y1 * sourceWidth + x0) * 4;
      const bottomRight = (y1 * sourceWidth + x1) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = (source[topLeft + channel] ?? 0) * (1 - xWeight)
          + (source[topRight + channel] ?? 0) * xWeight;
        const bottom = (source[bottomLeft + channel] ?? 0) * (1 - xWeight)
          + (source[bottomRight + channel] ?? 0) * xWeight;
        output[target + channel] = Math.round(top * (1 - yWeight) + bottom * yWeight);
      }
    }
  }
  return output;
}

function postJobError(
  scope: WorkerScope,
  common: { jobId: string; epoch: number },
  code: "deadline" | "invalid-input" | "processing-failed"
): void {
  try {
    scope.postMessage({ ...common, kind: "job-error", code });
  } catch {
    // A closing worker cannot report its terminal error; the client deadline remains a backstop.
  }
}

export function installStudioCompanionReferenceRasterWorker(scope: WorkerScope): void {
  scope.addEventListener("message", (event) => {
    const request = record(event.data);
    if (
      !request
      || typeof request.jobId !== "string"
      || !positiveInteger(request.epoch)
    ) return;
    const common = { jobId: request.jobId, epoch: request.epoch };
    if (
      typeof request.deadlineAt !== "number"
      || !Number.isFinite(request.deadlineAt)
      || request.deadlineAt < Date.now()
    ) {
      postJobError(scope, common, "deadline");
      return;
    }
    void (async () => {
      if (request.kind === "hash") {
        if (typeof request.dataUrl !== "string") throw new TypeError("invalid hash input");
        const bytes = decodeStudioCompanionReferenceWorkerDataUrl(request.dataUrl);
        try {
          if (bytes.byteLength > STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_INPUT_BYTES) {
            throw new TypeError("oversized decoded payload");
          }
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          if (Date.now() > (request.deadlineAt as number)) {
            throw new DOMException("deadline", "TimeoutError");
          }
          const hash = Array.from(
            new Uint8Array(digest),
            (byte) => byte.toString(16).padStart(2, "0")
          ).join("");
          scope.postMessage({ ...common, kind: "hash-result", hash: `sha256:${hash}` });
        } finally {
          bytes.fill(0);
        }
        return;
      }
      if (
        request.kind !== "normalize"
        || !positiveInteger(request.width)
        || !positiveInteger(request.height)
        || !positiveInteger(request.maximumOutputPixels)
        || !(request.buffer instanceof ArrayBuffer)
      ) throw new TypeError("invalid normalize input");
      const inputPixels = request.width * request.height;
      if (
        !Number.isSafeInteger(inputPixels)
        || request.buffer.byteLength !== inputPixels * 4
        || request.buffer.byteLength > STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_INPUT_BYTES
        || request.maximumOutputPixels * 4 > STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_OUTPUT_BYTES
      ) throw new TypeError("oversized normalize input");
      const input = new Uint8ClampedArray(request.buffer);
      let output: Uint8ClampedArray | null = null;
      try {
        const dimensions = fitDimensions(request.width, request.height, request.maximumOutputPixels);
        output = resizeRgba(
          input,
          request.width,
          request.height,
          dimensions.width,
          dimensions.height,
          request.deadlineAt as number
        );
        if (Date.now() > (request.deadlineAt as number)) {
          throw new DOMException("deadline", "TimeoutError");
        }
        scope.postMessage({
          ...common,
          kind: "normalize-result",
          width: dimensions.width,
          height: dimensions.height,
          buffer: output.buffer,
        }, [output.buffer]);
      } finally {
        input.fill(0);
        if (output?.buffer.byteLength) output.fill(0);
      }
    })().catch((error: unknown) => {
      postJobError(
        scope,
        common,
        error instanceof DOMException && error.name === "TimeoutError"
          ? "deadline"
          : error instanceof TypeError
            ? "invalid-input"
            : "processing-failed"
      );
    });
  });
}

const workerScope = globalThis as unknown as Partial<WorkerScope>;
if (
  typeof workerScope.addEventListener === "function"
  && typeof workerScope.postMessage === "function"
) {
  installStudioCompanionReferenceRasterWorker(workerScope as WorkerScope);
}
