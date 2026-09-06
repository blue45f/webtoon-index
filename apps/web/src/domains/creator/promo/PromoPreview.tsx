import { useEffect, useRef, useState } from "react";

import { drawPromoFrame, loadPromoImages } from "./promo-canvas";
import { PROMO_FPS, promoAudioGain, promoFrameCount, promoSize } from "./promo-model";

import type { PromoImages } from "./promo-canvas";
import type { PromoPanel, PromoProject } from "./promo-model";

export function PromoPreview({ project, disabled }: { project: PromoProject; disabled: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const startFrame = useRef(0);
  const imageCache = useRef<{ sources: Pick<PromoPanel, "id" | "src">[]; images: PromoImages } | null>(null);
  const [images, setImages] = useState<PromoImages>(new Map());
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const total = promoFrameCount(project);
  const size = promoSize(project.ratio, 480);
  useEffect(() => {
    const cached = imageCache.current;
    if (cached && cached.sources.length === project.panels.length && project.panels.every((panel, index) => panel.id === cached.sources[index]?.id && panel.src === cached.sources[index]?.src)) {
      setImages(cached.images); setLoading(false); setError("");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setImages(new Map());
    loadPromoImages(project, controller.signal).then((loaded) => {
      if (!controller.signal.aborted) { imageCache.current = { sources: project.panels.map(({ id, src }) => ({ id, src })), images: loaded }; setImages(loaded); setLoading(false); }
    }).catch(() => {
      if (!controller.signal.aborted) { setError("미리보기 이미지를 읽지 못했어요."); setLoading(false); }
    });
    return () => controller.abort();
  }, [project]);
  useEffect(() => { setPlaying(false); setFrame(0); }, [project, disabled]);
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawPromoFrame(ctx, project, images, frame, size.width, size.height);
  }, [project, images, frame, size.width, size.height]);
  useEffect(() => {
    if (!playing) { audioRef.current?.pause(); return; }
    const audio = audioRef.current;
    const initialFrame = startFrame.current;
    let raf = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now;
      const next = initialFrame + Math.floor((now - start) * PROMO_FPS / 1000);
      setFrame(Math.min(total - 1, next));
      if (audio) audio.volume = promoAudioGain(Math.min(total - 1, next), total, project.audio?.volume ?? 0);
      if (next >= total - 1 || document.hidden) { setPlaying(false); return; }
      raf = requestAnimationFrame(tick);
    };
    // Hidden tabs may suspend animation frames while audio keeps playing.
    const visibility = () => {
      if (!document.hidden) return;
      cancelAnimationFrame(raf);
      audio?.pause();
      setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      cancelAnimationFrame(raf);
      audio?.pause();
    };
  }, [playing, total, project.audio]);
  const play = () => {
    if (playing) { setPlaying(false); return; }
    const nextFrame = frame >= total - 1 ? 0 : frame;
    startFrame.current = nextFrame;
    setFrame(nextFrame);
    setError("");
    const audio = audioRef.current;
    if (audio) {
      const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Number.POSITIVE_INFINITY;
      audio.currentTime = (nextFrame / PROMO_FPS) % duration;
      audio.volume = promoAudioGain(nextFrame, total, project.audio?.volume ?? 0);
      void audio.play().catch(() => setError("BGM을 재생하지 못했어요. 오디오 파일 또는 브라우저 권한을 확인해 주세요."));
    }
    setPlaying(true);
  };
  return (
    <section className="promo-preview" aria-label="홍보영상 미리보기">
      <div className="promo-preview-top"><span>미리보기</span><span>{project.ratio} · {project.seconds}초 · 30fps</span></div>
      <div className="promo-canvas-wrap"><canvas ref={canvasRef} width={size.width} height={size.height} aria-label={`${project.title} 홍보영상. 아래 컷 편집 영역에서 장면별 자막을 확인할 수 있어요.`} /></div>
      {project.audio ? <audio ref={audioRef} src={project.audio.src} loop preload="metadata" aria-label="미리보기 배경음악"><track kind="captions" srcLang="ko" label="배경음악 안내" src={`data:text/vtt;charset=utf-8,${encodeURIComponent("WEBVTT\n\n00:00:00.000 --> 00:01:00.000\n[사용자가 추가한 배경음악]\n")}`} default /></audio> : null}
      <div className="promo-playback">
        <button type="button" onClick={play} disabled={disabled || loading || images.size !== project.panels.length || !project.panels.length}>{playing ? "일시정지" : "재생"}</button>
        <label className="promo-sr-only" htmlFor="promo-seek">영상 탐색</label>
        <input id="promo-seek" type="range" min={0} max={total - 1} value={frame} disabled={disabled || playing} onChange={(event) => setFrame(Number(event.target.value))} />
        <output>{(frame / PROMO_FPS).toFixed(1)} / {project.seconds}초</output>
      </div>
      {loading ? <p role="status">컷을 준비하고 있어요.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <p className="promo-muted">원본 컷에 카메라 이동·자막·페이드를 적용하는 모션툰입니다. 인물 동작·립싱크·새 프레임을 생성하는 기능은 아닙니다.</p>
    </section>
  );
}
