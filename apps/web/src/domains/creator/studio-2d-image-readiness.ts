/** Native image lifecycle shared by the scene grid and preview. No eager offscreen fetches. */
export const STUDIO_2D_IMAGE_TIMEOUT_MS = 20_000;
export type Studio2dImageState = {
  readonly status: "loading" | "ready" | "error" | "mismatch";
  readonly pixels: { width: number; height: number } | null;
  readonly reason?: "load" | "decode" | "timeout" | "dimensions";
};
export const STUDIO_2D_IMAGE_LOADING: Studio2dImageState = { status: "loading", pixels: null };

type Dimensions = { readonly width: number; readonly height: number };

/** Call after an image is attached, and always dispose on source change or unmount. */
export function observeStudio2dImage(
  image: HTMLImageElement,
  expected: Dimensions | undefined,
  report: (state: Studio2dImageState) => void,
  timeoutMs = STUDIO_2D_IMAGE_TIMEOUT_MS,
): () => void {
  let active = true;
  let settled = false;
  let decoding = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: IntersectionObserver | undefined;
  const source = image.getAttribute("src");
  const current = () => active && !settled && image.getAttribute("src") === source;
  const finish = (state: Studio2dImageState) => {
    if (!current()) return;
    settled = true;
    clearTimeout(timer);
    observer?.disconnect();
    report(state);
  };
  const beginDeadline = () => {
    if (!current() || timer !== undefined) return;
    timer = setTimeout(() => finish({ status: "error", pixels: null, reason: "timeout" }), timeoutMs);
  };
  const validate = () => {
    if (!current()) return;
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
      || width > 8192 || height > 8192 || width * height > 36_000_000) {
      finish({ status: "error", pixels: null, reason: "dimensions" });
      return;
    }
    const pixels = { width, height };
    finish(expected && (width !== expected.width || height !== expected.height)
      ? { status: "mismatch", pixels, reason: "dimensions" } : { status: "ready", pixels });
  };
  const loaded = () => {
    if (!current() || decoding) return;
    decoding = true;
    beginDeadline();
    // decoding="async" is only a hint. Readiness follows the actual decode promise.
    if (typeof image.decode !== "function") { validate(); return; }
    try {
      void image.decode().then(validate, () => finish({ status: "error", pixels: null, reason: "decode" }));
    } catch {
      finish({ status: "error", pixels: null, reason: "decode" });
    }
  };
  const failed = () => finish({ status: "error", pixels: null, reason: "load" });
  image.addEventListener("load", loaded);
  image.addEventListener("error", failed);
  report(STUDIO_2D_IMAGE_LOADING);
  // Offscreen lazy images must not become errors just because the user has not scrolled.
  if (image.loading === "lazy" && typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { beginDeadline(); observer?.disconnect(); }
    }, { rootMargin: "400px" });
    observer.observe(image);
  } else {
    beginDeadline();
  }
  // Cached or broken images may have finished before listeners were attached.
  if (image.complete) {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) loaded();
    else failed();
  }
  return () => {
    active = false;
    clearTimeout(timer);
    observer?.disconnect();
    image.removeEventListener("load", loaded);
    image.removeEventListener("error", failed);
  };
}
