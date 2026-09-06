import { useEffect, useRef, useState } from "react";

import { buildSteps } from "./fortune-types";

import type { FortunePanel, PlaybackStep } from "./fortune-types";

// 운세 웹툰의 "재생"을 총괄하는 오케스트레이터.
// 패널을 스텝(대사/나레이션) 시퀀스로 펼쳐, 스텝마다
//   ① 활성 컷 포커스 ② 음성 낭독 ③ 진행률에 맞춘 말풍선 타이핑
// 을 동기화해 모션코믹처럼 연출한다.
//
// 음성은 무료 브라우저 내장 Web Speech(ko-KR)만 사용한다. 현재 자연스러운 한국어
// 여성 보이스(유나/Yuna)만 채택하며, 그에 어울리는 캐릭터(아라·레오나)와 나레이션만
// 낭독한다. 남성 캐릭터(단우·가온)는 어울리는 보이스가 없어 무음으로 두되, 컷
// 애니메이션과 말풍선 타이핑은 동일하게 진행한다.

type PlaybackStatus = "idle" | "playing" | "paused";

// 음성으로 낭독할 화자(여성 캐릭터). 그 외(단우·가온)는 무음 + 타이핑만.
const VOICED_CHARACTERS = new Set(["ara", "leona"]);
// 캐릭터별 미세 피치(같은 유나 보이스를 살짝 구분)
const VOICE_PITCH: Record<string, number> = { ara: 1.12, leona: 0.98, _narration: 1.0 };
const SEGMENT_GAP_MS = 220; // 컷 사이 호흡

// 유나(Yuna) 한국어 보이스를 우선 선택. 없으면 ko 보이스 폴백.
function pickYunaVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const ko = voices.filter((v) => v.lang?.toLowerCase().startsWith("ko"));
  if (ko.length === 0) return null;
  const yuna = ko.find((v) => /yuna|유나/i.test(`${v.name} ${v.voiceURI}`));
  return yuna ?? ko[0];
}

// 나레이션(화자 null)도 유나로 낭독, 단우·가온은 무음
function shouldVoice(characterId: string | null): boolean {
  if (!characterId) return true; // 나레이션
  return VOICED_CHARACTERS.has(characterId);
}

export interface FortunePlayback {
  supported: boolean;
  status: PlaybackStatus;
  steps: PlaybackStep[];
  activeStep: number;
  activePanel: number;
  typed: number;
  speed: number;
  play: () => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  setSpeed: (s: number) => void;
}

export function useFortunePlayback(panels: FortunePanel[] | undefined): FortunePlayback {
  const supported =
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    "SpeechSynthesisUtterance" in window;

  const steps = panels ? buildSteps(panels) : [];

  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [activeStep, setActiveStep] = useState(-1);
  const [typed, setTyped] = useState(0);
  const [speed, setSpeedState] = useState(1);

  const stepsRef = useRef<PlaybackStep[]>(steps);
  stepsRef.current = steps;
  const tokenRef = useRef(0); // 재생 세션 토큰 — stop/play마다 증가, 옛 콜백 무시
  const speedRef = useRef(1);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  // Web Speech 보이스 로드 (Safari는 늦게 채워지므로 voiceschanged 구독)
  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const load = () => {
      voicesRef.current = synth.getVoices();
    };
    load();
    synth.addEventListener("voiceschanged", load);
    return () => {
      synth.removeEventListener("voiceschanged", load);
      synth.cancel();
    };
  }, [supported]);

  // 언마운트 정리
  useEffect(() => {
    return () => {
      tokenRef.current += 1;
      clearTimers();
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* noop */
      }
    };
  }, []);

  function clearTimers() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  // 한 스텝 낭독 + 진행률(타이핑) 콜백. cancel 함수를 반환.
  function speakStep(step: PlaybackStep, onProgress: (chars: number) => void, onEnd: () => void): () => void {
    const text = step.text;
    let cancelled = false;

    // 무음(남성 캐릭터) 또는 음성 미지원 → 시간 기반 타이핑만
    const voiced = supported && shouldVoice(step.characterId);
    if (!voiced) {
      const started = performance.now();
      const cps = 12 * speedRef.current; // 무음 타이핑 속도
      const tick = () => {
        if (cancelled) return;
        const chars = Math.floor(((performance.now() - started) / 1000) * cps);
        onProgress(Math.min(text.length, chars));
        if (chars >= text.length) {
          // 짧은 여운 후 종료
          timerRef.current = setTimeout(onEnd, 250);
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => {
        cancelled = true;
      };
    }

    // 유나 보이스로 낭독
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = Math.min(2, 1.0 * speedRef.current);
    u.pitch = VOICE_PITCH[step.characterId ?? "_narration"] ?? 1.0;
    const v = pickYunaVoice(voicesRef.current);
    if (v) u.voice = v;

    let boundarySeen = false;
    let ended = false;
    let watchdog: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (watchdog != null) clearTimeout(watchdog);
      watchdog = null;
      if (cancelled || ended) return;
      ended = true;
      onProgress(text.length);
      onEnd();
    };
    u.onboundary = (e: SpeechSynthesisEvent) => {
      boundarySeen = true;
      const len = (e as SpeechSynthesisEvent & { charLength?: number }).charLength ?? 1;
      onProgress(Math.min(text.length, (e.charIndex ?? 0) + len));
    };
    u.onend = finish;
    u.onerror = finish;
    synth.speak(u);

    // Safari 등 boundary 미지원 + onend 누락 대비: 시간 추정 타이핑 + 워치독
    const started = performance.now();
    const cps = 9 * speedRef.current;
    const estMs = (text.length / Math.max(1, cps)) * 1000 + 2000;
    watchdog = setTimeout(finish, estMs);
    const estimate = () => {
      if (cancelled || ended) return;
      if (!boundarySeen) {
        const chars = Math.floor(((performance.now() - started) / 1000) * cps);
        onProgress(Math.min(text.length, chars));
      }
      rafRef.current = requestAnimationFrame(estimate);
    };
    rafRef.current = requestAnimationFrame(estimate);

    return () => {
      cancelled = true;
      if (watchdog != null) clearTimeout(watchdog);
      try {
        synth.cancel();
      } catch {
        /* noop */
      }
    };
  }

  function runStep(i: number) {
    const list = stepsRef.current;
    const token = tokenRef.current;
    if (i < 0 || i >= list.length) {
      setStatus("idle");
      setActiveStep(-1);
      return;
    }
    setActiveStep(i);
    setTyped(0);
    cancelRef.current?.();
    cancelRef.current = speakStep(
      list[i],
      (chars) => {
        if (tokenRef.current === token) setTyped(chars);
      },
      () => {
        if (tokenRef.current !== token) return;
        timerRef.current = setTimeout(() => {
          if (tokenRef.current !== token) return;
          runStep(i + 1);
        }, SEGMENT_GAP_MS);
      }
    );
  }

  function startFrom(i: number) {
    if (stepsRef.current.length === 0) return;
    tokenRef.current += 1;
    clearTimers();
    cancelRef.current?.();
    setStatus("playing");
    runStep(Math.max(0, Math.min(i, stepsRef.current.length - 1)));
  }

  const play = () => {
    if (status === "paused") {
      resume();
      return;
    }
    startFrom(0);
  };

  const stop = () => {
    tokenRef.current += 1;
    clearTimers();
    cancelRef.current?.();
    cancelRef.current = null;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* noop */
    }
    setStatus("idle");
    setActiveStep(-1);
    setTyped(0);
  };

  const pause = () => {
    if (status !== "playing") return;
    try {
      window.speechSynthesis?.pause();
    } catch {
      /* noop */
    }
    setStatus("paused");
  };

  const resume = () => {
    if (status !== "paused") return;
    try {
      window.speechSynthesis?.resume();
    } catch {
      /* noop */
    }
    setStatus("playing");
  };

  const next = () => {
    const target = activeStep < 0 ? 0 : activeStep + 1;
    if (target >= stepsRef.current.length) {
      stop();
      return;
    }
    startFrom(target);
  };

  const prev = () => {
    const target = Math.max(0, activeStep < 0 ? 0 : activeStep - 1);
    startFrom(target);
  };

  const setSpeed = (s: number) => {
    speedRef.current = s;
    setSpeedState(s);
  };

  const activePanel = activeStep >= 0 && steps[activeStep] ? steps[activeStep].panel : -1;

  return {
    supported,
    status,
    steps,
    activeStep,
    activePanel,
    typed,
    speed,
    play,
    pause,
    resume,
    stop,
    next,
    prev,
    setSpeed,
  };
}
