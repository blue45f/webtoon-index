/**
 * WebtoonFxPlayer — "무빙툰/효과툰" 리더. 정적 페이지 이미지에 동적 효과를 입힌다.
 * - 스크롤 리빌: 페이지가 화면에 들어오면 페이드업·줌 등으로 등장(IntersectionObserver).
 * - 분위기 오버레이: 비·눈·벚꽃 등 파티클을 화면 위에 sticky 캔버스로 깐다.
 * - BGM: 무드 자동생성(Web Audio) 또는 커스텀 URL을 사용자 제스처 후 재생.
 * - 컷 오디오 연출: 컷 진입 시 SE 스팅어 1회 재생 + BGM 무드 전환(소리 꺼짐이면 무시,
 *   빠른 스크롤 연타는 쿨다운으로 억제).
 * - 컷 연출 마크(seq): 컷 진입 시 지정 영역 위에 delayMs 순서로 오버레이 연출(포커스 링·
 *   플래시…)을 1회 재생. 컷은 플랫 이미지 한 장이라 레이어 분리 재생이 아닌 "이미지 위
 *   오버레이"다. 재생 규약은 리빌과 동일 — 컷당 1회, 재진입해도 다시 재생하지 않는다.
 * 접근성: prefers-reduced-motion이면 리빌·파티클·연출 마크를 끄고 정적으로 보여준다(소리는 별개 토글).
 */
import { Music, Pause, Play, Volume2 } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import {
  createBgmPlayer,
  createDynamicBgmPlayer,
  createSfxStingerPlayer,
  findBgmMood,
  type BgmPlayer,
  type SfxStingerPlayer,
} from "./studio-bgm";
import {
  CUT_BGM_SILENCE,
  REVEAL_SHOWN_STYLE,
  buildAmbientParticles,
  cutFx,
  emphasisAnimation,
  findAmbientPreset,
  findSfxStingerPreset,
  hasAnyFx,
  hasCutAudioFx,
  revealHiddenStyle,
  seqMarkAnimation,
  seqMarkBaseStyle,
  stepAmbientParticle,
  type AmbientParticle,
  type AmbientPreset,
  type WorkCutSeqMark,
  type WorkFxSettings,
} from "./studio-motion-fx";

import { CoverImage } from "@/shared/components/cover-image";
import { cn } from "@/shared/lib/utils";

// 컷 진입 오디오 디렉터 — FxControlBar(플레이어 소유)가 채워 넣고, RevealPage의
// IntersectionObserver가 컷 진입 시점에 호출한다. 상태를 ref로 건네 컷 수만큼 있는
// 옵저버 effect를 소리 토글 때마다 재구독시키지 않는다. SE 연타 방지 쿨다운은
// playStinger 내부(디렉터 소유)에서 적용된다.
interface CutAudioDirector {
  soundOn: boolean;
  playStinger(presetId: string): void;
  shiftBgm(mood: string): void;
}

// SE 연타 방지 쿨다운(ms) — 빠른 스크롤로 여러 컷이 연달아 들어와도 스팅어가 겹치지 않게.
const SFX_COOLDOWN_MS = 380;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

// 연출 마크 오버레이 하나 — 마운트 시(컷 진입 1회) delayMs만큼 기다렸다 Web Animations로
// 재생한다. 기본 opacity 0 + 시작/끝 키프레임 opacity 0 → 대기 중·재생 후 모두 안 보인다.
// 플랫 컷 이미지 "위"에 얹는 시선 유도 연출이라 그림 속 요소가 실제로 움직이진 않는다.
function SeqMarkOverlay({ mark }: { mark: WorkCutSeqMark }) {
  const ref = useRef<HTMLDivElement>(null);
  // 원시값 의존 — cutFx가 렌더마다 새 마크 객체를 만들어도(불변 복사) 값이 같으면
  // 애니메이션을 다시 재생하지 않는다(객체 정체 의존이면 부모 리렌더에 연출이 반복된다).
  const { anim, delayMs } = mark;

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return; // 미지원 환경 — 조용히 생략(opacity 0 유지)
    const spec = seqMarkAnimation(anim);
    if (!spec) return;
    const animation = el.animate(spec.keyframes, { ...spec.options, delay: delayMs });
    return () => animation.cancel();
  }, [anim, delayMs]);

  const look = seqMarkBaseStyle(mark.anim);
  return (
    <div
      ref={ref}
      className="absolute rounded-lg will-change-transform"
      style={{
        left: `${mark.x * 100}%`,
        top: `${mark.y * 100}%`,
        width: `${mark.w * 100}%`,
        height: `${mark.h * 100}%`,
        background: look.background,
        boxShadow: look.boxShadow,
        opacity: 0,
      }}
    />
  );
}

// 한 페이지(컷) 이미지를 감싸 스크롤 등장 효과 + 컷 강조 애니메이션 + 컷 연출 마크 +
// 컷 진입 오디오 트리거를 적용한다. 바깥 div가 리빌(opacity/transform transition), 안쪽
// div가 강조(Web Animations)·마크 오버레이를 맡아 서로 안 부딪힌다. 오디오 연출(SE·BGM
// 전환)은 모션이 아니므로 prefers-reduced-motion과 무관하게 관찰한다(소리 여부는 디렉터가
// 판단). 연출 마크는 모션이라 reduced-motion이면 재생하지 않는다.
function RevealPage({
  src,
  alt,
  reveal,
  emphasis,
  seqMarks,
  hasAudioFx,
  motionAllowed,
  onEnter,
}: {
  src: string;
  alt: string;
  reveal: string;
  emphasis: string;
  seqMarks: WorkCutSeqMark[];
  hasAudioFx: boolean;
  motionAllowed: boolean;
  onEnter: () => void;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const revealActive = motionAllowed && reveal !== "none";
  const emphasisActive = motionAllowed && emphasis !== "none";
  const seqActive = motionAllowed && seqMarks.length > 0;
  const observe = revealActive || emphasisActive || hasAudioFx || seqActive;
  const [shown, setShown] = useState(!revealActive);
  // 컷 진입 시 1회만 마크 시퀀스를 마운트 — 리빌과 같은 규약(재진입해도 다시 재생 안 함).
  const [seqStarted, setSeqStarted] = useState(false);
  // 컷 진입 1회 판정 — effect 재구독(옵저버 재생성)이 있어도 오디오가 중복 발화하지 않게.
  const enteredRef = useRef(false);
  // 최신 onEnter 유지(latest-ref) — 콜백 정체가 바뀌어도 옵저버를 재구독하지 않는다.
  const onEnterRef = useRef(onEnter);
  useEffect(() => {
    onEnterRef.current = onEnter;
  });

  useEffect(() => {
    if (!observe) {
      setShown(true);
      return;
    }
    const el = outerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          setShown(true);
          if (emphasisActive && innerRef.current && typeof innerRef.current.animate === "function") {
            const anim = emphasisAnimation(emphasis);
            if (anim) innerRef.current.animate(anim.keyframes, anim.options);
          }
          if (seqActive) setSeqStarted(true); // 이미 true면 no-op — 중복 재생 없음
          if (hasAudioFx && !enteredRef.current) {
            enteredRef.current = true;
            onEnterRef.current();
          }
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [observe, emphasisActive, emphasis, hasAudioFx, seqActive]);

  const style = revealActive && !shown ? revealHiddenStyle(reveal) : REVEAL_SHOWN_STYLE;
  return (
    <div
      ref={outerRef}
      style={{
        ...style,
        transition: revealActive
          ? "opacity 700ms ease, transform 760ms cubic-bezier(.2,.7,.2,1), filter 700ms ease"
          : undefined,
      }}
    >
      <div ref={innerRef} className="relative">
        <CoverImage
          src={src}
          alt={alt}
          className="block w-full"
          fallback={
            <span className="grid aspect-[3/4] w-full place-items-center bg-raised/40 text-xs text-fg-3">
              이미지를 불러올 수 없습니다.
            </span>
          }
        />
        {seqActive && seqStarted && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            {seqMarks.map((mark, index) => (
              <SeqMarkOverlay key={index} mark={mark} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function drawParticle(ctx: CanvasRenderingContext2D, p: AmbientParticle, preset: AmbientPreset, t: number) {
  const alpha = preset.twinkle ? 0.4 + 0.6 * Math.abs(Math.sin(p.phase + t * 2)) : 1;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = preset.color;
  ctx.strokeStyle = preset.color;
  switch (preset.shape) {
    case "line":
      ctx.lineWidth = Math.max(1, p.size * 0.18);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.size * 0.18, p.y + p.size);
      ctx.stroke();
      break;
    case "petal":
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    case "spark":
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "blob":
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      break;
    default: // dot
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
  }
}

// sticky 캔버스로 화면(뷰포트) 위에 파티클을 그린다 — 긴 스트립 전체를 덮지 않아 메모리 안전.
function AmbientCanvas({ preset }: { preset: AmbientPreset }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let particles: AmbientParticle[] = [];
    let cssW = 0;
    let cssH = 0;
    let raf = 0;
    let last = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
      cssW = Math.max(1, Math.round(rect.width));
      cssH = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = buildAmbientParticles(preset, cssW, cssH, 12345);
    };
    resize();

    const frame = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      ctx.clearRect(0, 0, cssW, cssH);
      const t = now / 1000;
      particles = particles.map((p) => stepAmbientParticle(p, cssW, cssH, dt));
      for (const p of particles) drawParticle(ctx, p, preset, t);
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [preset]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <canvas ref={canvasRef} className="sticky top-0 h-screen w-full" aria-hidden />
    </div>
  );
}

// 화면 하단 고정 효과툰 컨트롤 — 자동 재생(스스로 스크롤) + 소리(배경음악·컷 효과음).
// 자동재생 정책상 소리는 사용자가 켜야 난다. 컷 진입 SE/BGM 전환도 이 토글(음소거)을 존중한다.
function FxControlBar({
  fx,
  hasSound,
  directorRef,
}: {
  fx: WorkFxSettings;
  hasSound: boolean;
  directorRef: RefObject<CutAudioDirector | null>;
}) {
  const playerRef = useRef<BgmPlayer | null>(null);
  // SE 폴백 플레이어 — BGM 플레이어가 Web Audio 그래프를 안 가질 때(커스텀 URL)만 lazy 생성.
  const stingerRef = useRef<SfxStingerPlayer | null>(null);
  const sfxLastAtRef = useRef(0); // 마지막 스팅어 발화 시각(ms) — 연타 방지 쿨다운
  const [soundOn, setSoundOn] = useState(false);
  const [volume, setVolume] = useState(fx.bgmVolume);
  const [autoPlay, setAutoPlay] = useState(false);
  const rafRef = useRef(0);
  const targetRef = useRef(0);
  const lastRef = useRef(0);

  useEffect(() => {
    return () => {
      playerRef.current?.dispose();
      playerRef.current = null;
      stingerRef.current?.dispose();
      stingerRef.current = null;
      directorRef.current = null;
    };
  }, [directorRef]);

  const startSound = () => {
    if (!playerRef.current && hasSound) {
      // 커스텀 URL이 있으면 그대로 루프 재생, 아니면 무드 전환·SE(컨텍스트 재사용)까지
      // 지원하는 동적 신스 플레이어 — 기본 무드가 없어도(컷 전환 전용) 침묵으로 대기한다.
      playerRef.current = fx.bgmUrl
        ? createBgmPlayer({ url: fx.bgmUrl, volume })
        : createDynamicBgmPlayer({ mood: findBgmMood(fx.bgmMood) ?? null, volume });
    }
    playerRef.current?.play();
    setSoundOn(true);
  };
  const stopSound = () => {
    playerRef.current?.pause();
    setSoundOn(false);
  };

  // 컷 진입 오디오 디렉터 등록 — 매 렌더 최신 소리 상태·볼륨으로 갱신한다(값 대입만이라 저렴).
  useEffect(() => {
    directorRef.current = {
      soundOn,
      playStinger(presetId: string) {
        const preset = findSfxStingerPreset(presetId);
        if (!preset) return;
        // 연타 방지 쿨다운 — 빠른 스크롤로 여러 컷이 연달아 들어와도 스팅어가 겹치지 않게.
        const now = Date.now();
        if (now - sfxLastAtRef.current < SFX_COOLDOWN_MS) return;
        sfxLastAtRef.current = now;
        const player = playerRef.current;
        if (player?.playStinger) {
          player.playStinger(preset, volume); // BGM 컨텍스트 재사용
          return;
        }
        stingerRef.current ??= createSfxStingerPlayer({ volume });
        stingerRef.current.play(preset);
      },
      shiftBgm(mood: string) {
        const player = playerRef.current;
        if (!player?.setMood) return; // 커스텀 URL BGM 등 무드 전환 미지원 — 조용히 무시
        if (mood === CUT_BGM_SILENCE) {
          player.setMood(null);
          return;
        }
        const next = findBgmMood(mood);
        if (next) player.setMood(next); // 모르는 무드 id는 무시(침묵으로 오해하지 않게)
      },
    };
  });

  // 자동 스크롤 루프 — 일정 속도로 아래로 흘러가며 효과·BGM과 함께 감상.
  useEffect(() => {
    if (!autoPlay || typeof window === "undefined") return;
    const speed = 90; // px/s (천천히 읽히게)
    targetRef.current = window.scrollY;
    lastRef.current = 0;
    const tick = (now: number) => {
      const dt = lastRef.current ? Math.min(0.05, (now - lastRef.current) / 1000) : 0;
      lastRef.current = now;
      targetRef.current += speed * dt;
      window.scrollTo(0, targetRef.current);
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        setAutoPlay(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    const stopOnUser = () => setAutoPlay(false);
    window.addEventListener("wheel", stopOnUser, { passive: true });
    window.addEventListener("touchmove", stopOnUser, { passive: true });
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("wheel", stopOnUser);
      window.removeEventListener("touchmove", stopOnUser);
    };
  }, [autoPlay]);

  const toggleAutoPlay = () => {
    const next = !autoPlay;
    setAutoPlay(next);
    if (next && hasSound && !soundOn) startSound(); // 재생 시작 시 소리도 함께
  };

  const moodLabel = fx.bgmUrl ? "내 음악" : (findBgmMood(fx.bgmMood)?.label ?? "효과음");

  return (
    <div className="pointer-events-auto fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-panel/95 px-3 py-2 shadow-xl backdrop-blur">
      <button
        type="button"
        onClick={toggleAutoPlay}
        aria-pressed={autoPlay}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
          autoPlay ? "bg-accent text-on-accent" : "bg-card text-fg-2 hover:bg-raised"
        )}
        title={autoPlay ? "자동 재생 멈춤" : "자동 재생 — 효과와 함께 스스로 스크롤"}
      >
        {autoPlay ? <Pause size={13} /> : <Play size={13} />}
        자동 재생
      </button>
      {hasSound && (
        <>
          <span className="h-4 w-px bg-line" />
          <button
            type="button"
            onClick={() => (soundOn ? stopSound() : startSound())}
            aria-pressed={soundOn}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
              soundOn ? "bg-accent text-on-accent" : "bg-card text-fg-2 hover:bg-raised"
            )}
            title={soundOn ? "소리 끄기 (배경음악·컷 효과음)" : "소리 켜기 (배경음악·컷 효과음)"}
          >
            <Music size={13} />
            {moodLabel}
          </button>
          <label className="flex items-center gap-1.5 text-fg-3" title="소리 음량">
            <Volume2 size={13} />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                playerRef.current?.setVolume(v);
                stingerRef.current?.setVolume(v);
              }}
              className="h-1 w-16 cursor-pointer accent-[var(--color-accent)]"
              aria-label="소리 음량"
            />
          </label>
        </>
      )}
    </div>
  );
}

export function WebtoonFxPlayer({
  pages,
  fx,
  title,
}: {
  pages: string[];
  fx: WorkFxSettings;
  title: string;
}) {
  const reduced = usePrefersReducedMotion();
  const ambientPreset = reduced ? undefined : findAmbientPreset(fx.ambient);
  const ambientOn = ambientPreset && ambientPreset.id !== "none";
  // 소리 = 작품 BGM(무드/URL) 또는 컷 오디오 연출(SE·BGM 전환) — 하나라도 있으면 토글 노출.
  const hasSound = fx.bgmMood !== "" || fx.bgmUrl !== "" || hasCutAudioFx(fx);
  const directorRef = useRef<CutAudioDirector | null>(null);

  // 컷 진입(IntersectionObserver 발화) — SE 스팅어 재생 + BGM 무드 전환.
  // 소리가 꺼져 있으면(음소거) 아무것도 하지 않는다. 연타 방지는 디렉터가 맡는다.
  const handleCutEnter = (index: number) => {
    const director = directorRef.current;
    if (!director || !director.soundOn) return;
    const cut = cutFx(fx, index);
    if (cut.bgmShift) director.shiftBgm(cut.bgmShift.mood); // 같은 무드 중복 전환은 플레이어가 무시
    if (cut.sfx) director.playStinger(cut.sfx.preset); // 쿨다운은 디렉터 내부에서 적용
  };

  return (
    <>
      <div className="relative mb-8 overflow-hidden rounded-2xl border border-line bg-panel">
        {pages.length === 0 ? (
          <p className="px-4 py-16 text-center text-sm text-fg-3">표시할 페이지가 없습니다.</p>
        ) : (
          pages.map((page, index) => {
            const cut = cutFx(fx, index); // 컷별 리빌(상속 포함) + 강조 + 연출 마크 + 오디오 연출
            return (
              <RevealPage
                key={`${page}-${index}`}
                src={page}
                alt={`${title} ${index + 1}컷`}
                reveal={cut.reveal}
                emphasis={cut.emphasis}
                seqMarks={cut.seq?.marks ?? []}
                hasAudioFx={cut.sfx != null || cut.bgmShift != null}
                motionAllowed={!reduced}
                onEnter={() => handleCutEnter(index)}
              />
            );
          })
        )}
        {ambientOn && <AmbientCanvas preset={ambientPreset} />}
      </div>
      {(hasAnyFx(fx) || pages.length >= 2) && (
        <FxControlBar fx={fx} hasSound={hasSound} directorRef={directorRef} />
      )}
    </>
  );
}
