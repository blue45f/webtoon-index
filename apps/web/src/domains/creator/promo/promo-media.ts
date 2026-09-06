import { drawPromoFrame, loadPromoImages } from "./promo-canvas";
import { PROMO_FPS, promoAudioGain, promoDataUrl, promoFrameCount, promoSize } from "./promo-model";

import type { PromoPanel, PromoProject } from "./promo-model";

export function readPromoFile(file: File, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => { reader.abort(); reject(new DOMException("취소했어요.", "AbortError")); };
    const clean = () => signal?.removeEventListener("abort", abort);
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    reader.onload = () => { clean(); resolve(String(reader.result)); };
    reader.onerror = () => { clean(); reject(new Error("파일을 읽지 못했어요.")); };
    reader.onabort = clean;
    reader.readAsDataURL(file);
  });
}
export async function importPromoPanel(file: File, index: number, signal?: AbortSignal): Promise<PromoPanel> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 10_000_000 || file.size === 0) throw new Error("컷은 10MB 이하 PNG·JPEG·WebP 파일이어야 해요.");
  const src = await readPromoFile(file, signal);
  const panel: PromoPanel = { id: crypto.randomUUID(), src, description: "", caption: "", motion: "push-in", fit: "contain", weight: 1 };
  const images = await loadPromoImages({ panels: [panel] }, signal);
  const image = images.get(panel.id);
  if (!image) throw new Error("이미지를 읽지 못했어요.");
  const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이 브라우저에서 이미지 처리를 지원하지 않아요.");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  panel.src = promoDataUrl(canvas.toDataURL("image/webp", 0.92), "image");
  panel.caption = `컷 ${index + 1}`;
  canvas.width = 0;
  canvas.height = 0;
  return panel;
}
export function promoRecorderMime(): string | null {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement === "undefined" || !HTMLCanvasElement.prototype.captureStream) return null;
  // Prefer the lower-latency real-time encoder; VP9 remains a supported fallback.
  return ["video/webm;codecs=vp8,opus", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null;
}
export interface PromoRecordingOptions { signal: AbortSignal; onProgress: (progress: number) => void; shortSide?: 720 | 1080 }
/** Real-time browser recording, not a fake MP4/renamed WebM or a server render job. */
export async function recordPromoVideo(project: PromoProject, { signal, onProgress, shortSide = 720 }: PromoRecordingOptions): Promise<Blob> {
  if (signal.aborted) throw new DOMException("취소했어요.", "AbortError");
  const mimeType = promoRecorderMime();
  if (!mimeType) throw new Error("이 브라우저는 영상 저장을 지원하지 않아요. Remotion 프로젝트로 내보내 주세요.");
  if (!project.panels.length || document.hidden) throw new Error("컷을 추가하고 이 탭을 화면에 표시한 상태에서 저장해 주세요.");
  const size = promoSize(project.ratio, shortSide);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("영상 캔버스를 만들지 못했어요.");
  let stream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let audioSource: AudioBufferSourceNode | null = null;
  let audioGain: GainNode | null = null;
  let recorder: MediaRecorder | null = null;
  try {
    if (project.audio) {
      audioContext = new AudioContext();
      await audioContext.resume();
      if (audioContext.state !== "running") throw new Error("오디오 권한을 허용한 후 다시 저장해 주세요.");
    }
    const images = await loadPromoImages(project, signal);
    if (signal.aborted) throw new DOMException("취소했어요.", "AbortError");
    drawPromoFrame(ctx, project, images, 0, size.width, size.height);
    stream = canvas.captureStream(Math.min(PROMO_FPS, 5));
    const videoTrack = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    if (!videoTrack) throw new Error("영상 캡처 트랙을 만들지 못했어요.");
    if (project.audio && audioContext) {
      const response = await fetch(project.audio.src, { signal });
      const audio = await audioContext.decodeAudioData(await response.arrayBuffer());
      if (audio.duration > 180 || !Number.isFinite(audio.duration) || audio.duration <= 0) throw new Error("BGM은 3분 이하의 오디오를 사용해 주세요.");
      audioSource = audioContext.createBufferSource();
      audioSource.buffer = audio;
      audioSource.loop = true;
      audioGain = audioContext.createGain();
      audioGain.gain.value = 0;
      const destination = audioContext.createMediaStreamDestination();
      audioSource.connect(audioGain);
      audioGain.connect(destination);
      for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    }
    if (signal.aborted) throw new DOMException("취소했어요.", "AbortError");
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: shortSide === 1080 ? 10_000_000 : 5_000_000 });
    const activeRecorder = recorder;
    const total = promoFrameCount(project);
    return await new Promise<Blob>((resolve, reject) => {
      const chunks: Blob[] = [];
      let raf = 0;
      let audioStopTimer: ReturnType<typeof setTimeout> | undefined;
      let bytes = 0;
      let settled = false;
      let finished = false;
      let failure: Error | null = null;
      const started = performance.now();
      const cleanup = () => {
        cancelAnimationFrame(raf);
        clearTimeout(watchdog);
        if (audioStopTimer !== undefined) clearTimeout(audioStopTimer);
        signal.removeEventListener("abort", abort);
        document.removeEventListener("visibilitychange", visibility);
        activeRecorder.ondataavailable = null;
        activeRecorder.onstop = null;
        activeRecorder.onerror = null;
      };
      const finish = (error?: Error) => {
        if (settled) return;
        // stop() flushes data asynchronously. Preserve failures arriving before onstop.
        if (error) failure ??= error;
        if (finished) return;
        finished = true;
        cancelAnimationFrame(raf);
        try {
          if (activeRecorder.state !== "inactive") activeRecorder.stop();
          else settle();
        } catch {
          failure ??= new Error("영상 녹화를 안전하게 종료하지 못했어요.");
          settle();
        }
      };
      const settle = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (failure) reject(failure);
        else if (!finished || !chunks.length) reject(new Error("영상 녹화가 예상보다 일찍 종료되었어요. 다시 시도해 주세요."));
        else {
          try { onProgress(1); resolve(new Blob(chunks, { type: activeRecorder.mimeType || mimeType })); }
          catch { reject(new Error("영상 파일을 마무리하지 못했어요.")); }
        }
      };
      const abort = () => finish(new DOMException("취소했어요.", "AbortError"));
      const visibility = () => { if (document.hidden) finish(new Error("다른 탭으로 이동해 녹화를 취소했어요. 정확한 영상 저장을 위해 이 탭을 유지해 주세요.")); };
      const watchdog = setTimeout(() => {
        finish(new Error("영상 저장 제한 시간을 초과했어요."));
        settle();
      }, (project.seconds + 15) * 1000);
      const tick = () => {
        if (finished) return;
        try {
          const frame = Math.floor((performance.now() - started) * PROMO_FPS / 1000);
          drawPromoFrame(ctx, project, images, Math.min(total - 1, frame), size.width, size.height);
          if (audioGain && audioContext) audioGain.gain.setValueAtTime(promoAudioGain(Math.min(total - 1, frame), total, project.audio?.volume ?? 0), audioContext.currentTime);
          onProgress(Math.min(0.99, frame / total));
          if (frame >= total) {
            // Canvas capture happens when the canvas is painted, after this callback.
            // Let the ending frame reach the track before stopping the recorder.
            videoTrack.requestFrame?.();
            // End audio slightly before the visual flush completes so the native
            // muxer cannot extend the audio track beyond the final video frame.
            audioStopTimer = setTimeout(() => {
              stream?.getAudioTracks?.().forEach((track) => track.stop());
            }, 250);
            if (typeof window === "undefined") {
              raf = requestAnimationFrame(() => {
                if (finished) return;
                raf = requestAnimationFrame(() => finish());
              });
            } else {
              setTimeout(() => {
                if (!finished) finish();
              }, 250);
            }
            return;
          }
          raf = requestAnimationFrame(tick);
        } catch { finish(new Error("영상 프레임을 처리하지 못했어요.")); }
      };
      signal.addEventListener("abort", abort, { once: true });
      document.addEventListener("visibilitychange", visibility);
      activeRecorder.ondataavailable = (event) => {
        if (!event.data.size) return;
        bytes += event.data.size;
        if (bytes > 150_000_000) { finish(new Error("영상이 저장 용량 제한을 초과했어요. 720p로 다시 저장해 주세요.")); return; }
        chunks.push(event.data);
      };
      activeRecorder.onstop = settle;
      activeRecorder.onerror = () => finish(new Error("브라우저 영상 인코딩에 실패했어요."));
      try {
        activeRecorder.start(250);
        audioSource?.start();
        if (signal.aborted || document.hidden) { abort(); return; }
        tick();
      } catch { finish(new Error("영상 녹화를 시작하지 못했어요.")); }
    });
  } finally {
    try { if (recorder && recorder.state !== "inactive") recorder.stop(); }
    catch { /* Still release the underlying media tracks when the encoder cannot stop. */ }
    stream?.getTracks().forEach((track) => track.stop());
    if (audioSource) { try { audioSource.stop(); } catch { /* A cancelled setup may not have started it. */ } audioSource.disconnect(); }
    audioGain?.disconnect();
    if (audioContext && audioContext.state !== "closed") await audioContext.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}
export function downloadPromoBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
