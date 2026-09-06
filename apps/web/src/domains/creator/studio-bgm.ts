/**
 * Studio BGM — 작품 배경음악(네이버 효과툰식). 두 갈래로 제공한다.
 * 1) 자동 생성 앰비언트: 무드별 음계/템포 데이터로 Web Audio가 부드러운 패드 코드를 반복
 *    재생한다. 외부 오디오 파일이 필요 없어 깨질 일이 없고 오프라인에서도 동작한다.
 * 2) 커스텀 URL: 창작자가 직접 가진 오디오 파일 URL을 넣으면 그걸 루프 재생한다.
 *
 * 여기에 컷 연출용 오디오 두 가지가 얹힌다(코미포식 컷별 SE/BGM 전환).
 * - scheduleSfxStinger: SE 스팅어 프리셋(studio-motion-fx)의 노트들을 임의의 Web Audio
 *   그래프에 예약하는 순수 파라미터→노트 스케줄러. 컨텍스트를 주입받으므로 기존
 *   createBgmPlayer(자동 생성 플레이어)의 오디오 컨텍스트를 그대로 재사용할 수 있다.
 * - setMood(옵셔널): 자동 생성 플레이어가 재생 중 무드를 갈아탄다(컷 진입 BGM 전환).
 *
 * 음악이론 헬퍼(noteToFreq·buildProgression·BGM_MOODS)와 scheduleSfxStinger는 순수·결정적이라
 * 단위 테스트가 가능하고, 실제 소리를 내는 createBgmPlayer는 브라우저(AudioContext/Audio)
 * 전용 얇은 래퍼다. 자동재생 정책상 반드시 사용자 제스처(재생 버튼) 후에만 소리를 낸다.
 */
import type { SfxStingerPreset } from "./studio-motion-fx";

export type BgmWaveform = "sine" | "triangle" | "square" | "sawtooth";

export interface BgmMood {
  id: string;
  label: string;
  description: string;
  /** 기준 음 주파수(Hz). 음계 semitone 오프셋의 기준. */
  rootFreq: number;
  /** 루트 기준 반음 오프셋 음계. */
  scale: number[];
  /** 분당 박자(코드 전환 속도 기준). */
  tempo: number;
  waveform: BgmWaveform;
}

// 7가지 무드 — 라벨/설명은 한글. rootFreq는 낮은 옥타브(부담 없는 패드 음역).
export const BGM_MOODS: BgmMood[] = [
  { id: "calm", label: "잔잔", description: "평온한 일상·휴식", rootFreq: 130.81, scale: [0, 2, 4, 7, 9], tempo: 64, waveform: "sine" },
  { id: "romance", label: "설렘", description: "두근거리는 로맨스", rootFreq: 146.83, scale: [0, 2, 4, 7, 11], tempo: 72, waveform: "triangle" },
  { id: "tense", label: "긴장", description: "조여오는 서스펜스", rootFreq: 110.0, scale: [0, 2, 3, 7, 8], tempo: 88, waveform: "triangle" },
  { id: "sad", label: "슬픔", description: "먹먹한 슬픔·이별", rootFreq: 123.47, scale: [0, 2, 3, 5, 7, 10], tempo: 58, waveform: "sine" },
  { id: "epic", label: "웅장", description: "벅차오르는 클라이맥스", rootFreq: 98.0, scale: [0, 4, 7, 11, 12], tempo: 76, waveform: "triangle" },
  { id: "mystery", label: "미스터리", description: "수상한 미스터리", rootFreq: 116.54, scale: [0, 2, 4, 6, 8, 10], tempo: 66, waveform: "sine" },
  { id: "cheerful", label: "경쾌", description: "발랄·코믹", rootFreq: 164.81, scale: [0, 2, 4, 7, 9], tempo: 100, waveform: "triangle" },
];

export function findBgmMood(id: string): BgmMood | undefined {
  return BGM_MOODS.find((m) => m.id === id);
}

/** 반음 오프셋 → 주파수(평균율). 한 옥타브(12반음)는 두 배. */
export function noteToFreq(rootFreq: number, semitone: number): number {
  return rootFreq * Math.pow(2, semitone / 12);
}

export interface BgmStep {
  atBeat: number;
  /** 이 스텝에서 동시에 울릴 반음 오프셋들(코드). */
  semitones: number[];
  beats: number;
}

// 코드 진행(스케일 도수 사이클) — I·V·vi·IV 느낌을 음계 인덱스로 근사. 결정적.
const DEGREE_CYCLE = [0, 4, 5, 3];

/**
 * 무드의 음계로 bars 마디짜리 코드 진행을 만든다(마디당 4박, 3음 트라이어드).
 * 도수는 DEGREE_CYCLE을 순환하며, 음계를 넘어가면 옥타브(+12)로 올린다. 순수·결정적.
 */
export function buildProgression(mood: BgmMood, bars: number): BgmStep[] {
  const steps: BgmStep[] = [];
  const len = mood.scale.length;
  for (let b = 0; b < bars; b++) {
    const deg = DEGREE_CYCLE[b % DEGREE_CYCLE.length];
    const semitones = [0, 2, 4].map((k) => {
      const idx = deg + k;
      return mood.scale[idx % len] + 12 * Math.floor(idx / len);
    });
    steps.push({ atBeat: b * 4, semitones, beats: 4 });
  }
  return steps;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

// ── SE 스팅어 스케줄러(주입형 오디오 그래프) ─────────────────────────
// 컷 진입 효과음(studio-motion-fx.SFX_STINGER_PRESETS)을 임의의 Web Audio 그래프에 예약한다.
// AudioContext의 구조적 부분집합만 요구하므로 (1) 자동 생성 BGM 플레이어의 컨텍스트 재사용,
// (2) 독립 컨텍스트, (3) 테스트의 가짜 컨텍스트 주입이 전부 가능하다.

export interface StingerSynthParam {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  exponentialRampToValueAtTime(value: number, endTime: number): unknown;
}

export interface StingerSynthNode {
  connect(node: StingerSynthNode): unknown;
}

export interface StingerSynthOscillator extends StingerSynthNode {
  type: string;
  frequency: StingerSynthParam;
  start(when: number): void;
  stop(when: number): void;
}

export interface StingerSynthGain extends StingerSynthNode {
  gain: StingerSynthParam;
}

export interface StingerSynthContext {
  currentTime: number;
  createGain(): StingerSynthGain;
  createOscillator(): StingerSynthOscillator;
}

/**
 * 스팅어 프리셋의 노트들을 dest로 예약하고 실제 시작 시각(초)을 돌려준다.
 * when을 생략하면 "지금 + 0.02초"(클릭 잡음 방지 여유)에 시작한다. 노트마다
 * 어택(지수 상승) 후 노트 끝까지 지수 감쇠하는 엔벨로프를 건다 — BGM 패드와 같은 문법.
 */
export function scheduleSfxStinger(
  ctx: StingerSynthContext,
  dest: StingerSynthNode,
  preset: SfxStingerPreset,
  volume: number,
  when?: number
): number {
  const t0 = Math.max(when ?? 0, ctx.currentTime + 0.02);
  const master = ctx.createGain();
  master.gain.value = clamp01(volume) * 0.5; // 스팅어는 BGM 패드(0.22)보다 또렷하게, 과하지 않게
  master.connect(dest);
  for (const note of preset.notes) {
    const start = t0 + note.at;
    const end = start + note.duration;
    const osc = ctx.createOscillator();
    osc.type = note.wave;
    osc.frequency.setValueAtTime(note.freq, start);
    if (note.freqEnd != null && note.freqEnd !== note.freq) {
      // 지수 램프는 0을 못 지나므로 최소 1Hz로 가드(프리셋 데이터도 테스트로 양수 보장).
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, note.freqEnd), end);
    }
    const env = ctx.createGain();
    const peak = Math.max(0.0001, clamp01(note.gain));
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(peak, start + Math.min(Math.max(note.attack, 0.001), note.duration * 0.5));
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(env);
    env.connect(master);
    osc.start(start);
    osc.stop(end + 0.05);
  }
  return t0;
}

// ── 브라우저 플레이어(테스트 대상 아님) ──────────────────────────────
export interface BgmPlayer {
  play(): void;
  pause(): void;
  setVolume(v: number): void;
  dispose(): void;
  /** (선택) 재생 중 BGM 무드 전환 — 자동 생성 플레이어만 지원. null이면 침묵으로 페이드아웃. */
  setMood?(mood: BgmMood | null): void;
  /** (선택) 같은 오디오 컨텍스트로 SE 스팅어 재생 — 자동 생성 플레이어만 지원. */
  playStinger?(preset: SfxStingerPreset, volume?: number): void;
}

const NOOP_PLAYER: BgmPlayer = {
  play() {},
  pause() {},
  setVolume() {},
  dispose() {},
};

type AudioCtor = typeof AudioContext;

function getAudioContextCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

// 자동 생성 앰비언트 플레이어 — 무드 코드 진행을 lookahead 스케줄러로 반복 재생.
// initialMood가 null이면 침묵으로 대기하다 setMood(컷 BGM 전환)로 시작할 수 있다.
function createProceduralPlayer(initialMood: BgmMood | null, volume: number): BgmPlayer {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return NOOP_PLAYER;
  const ctx = new Ctor();
  let currentVolume = clamp01(volume);
  const master = ctx.createGain();
  master.gain.value = currentVolume * 0.22; // 패드는 낮게 — 배경에 묻히게
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1400;
  master.connect(lp);
  lp.connect(ctx.destination);

  let mood = initialMood;
  let progression = mood ? buildProgression(mood, 4) : [];
  let secPerBeat = mood ? 60 / mood.tempo : 1;
  // 무드 시대(era)별 서브 버스 — 전환 시 이전 버스만 페이드아웃해, 이미 예약된
  // 코드가 뚝 끊기지 않고 새 무드와 짧게 겹치며 저문다(크로스페이드).
  let bus = ctx.createGain();
  bus.connect(master);
  let stepIndex = 0;
  let nextTime = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  function scheduleStep(m: BgmMood, target: GainNode, step: BgmStep, when: number) {
    const dur = step.beats * secPerBeat;
    for (const st of step.semitones) {
      const osc = ctx.createOscillator();
      osc.type = m.waveform;
      osc.frequency.value = noteToFreq(m.rootFreq, st);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(0.9, when + Math.min(0.6, dur * 0.3));
      env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      osc.connect(env);
      env.connect(target);
      osc.start(when);
      osc.stop(when + dur + 0.05);
    }
  }

  function tick() {
    const m = mood;
    if (!m || progression.length === 0) return; // 침묵 대기 — 예약할 코드가 없다
    const ahead = 0.2;
    while (nextTime < ctx.currentTime + ahead) {
      const step = progression[stepIndex % progression.length];
      scheduleStep(m, bus, step, nextTime);
      nextTime += step.beats * secPerBeat;
      stepIndex += 1;
    }
  }

  return {
    play() {
      void ctx.resume();
      if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.1;
      if (timer == null) timer = setInterval(tick, 60);
      tick();
    },
    pause() {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
      void ctx.suspend();
    },
    setVolume(v: number) {
      currentVolume = clamp01(v);
      master.gain.value = currentVolume * 0.22;
    },
    setMood(next: BgmMood | null) {
      if ((next?.id ?? "") === (mood?.id ?? "")) return; // 같은 무드 재진입은 무시(중복 전환 방지)
      const now = ctx.currentTime;
      // 이전 무드 버스는 0.6초 페이드아웃 — 새 무드는 새 버스에서 시작.
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(0.0001, now + 0.6);
      mood = next;
      if (!next) return; // 침묵(CUT_BGM_SILENCE) 전환 — 더 예약하지 않는다
      bus = ctx.createGain();
      bus.connect(master);
      progression = buildProgression(next, 4);
      secPerBeat = 60 / next.tempo;
      stepIndex = 0;
      nextTime = now + 0.12;
      if (timer != null) tick(); // 재생 중이면 즉시 새 무드 예약(멈춤 상태면 다음 play가 처리)
    },
    playStinger(preset: SfxStingerPreset, v?: number) {
      // 스팅어는 BGM 로우패스(1400Hz)를 우회해 출력에 직결 — 고음(반짝 등)이 뭉개지지 않게.
      scheduleSfxStinger(ctx, ctx.destination, preset, v ?? currentVolume);
    },
    dispose() {
      if (timer != null) clearInterval(timer);
      timer = null;
      void ctx.close();
    },
  };
}

// 커스텀 오디오 URL 플레이어 — <audio> 루프 래퍼.
function createUrlPlayer(url: string, volume: number): BgmPlayer {
  if (typeof Audio === "undefined") return NOOP_PLAYER;
  const audio = new Audio(url);
  audio.loop = true;
  audio.volume = clamp01(volume);
  audio.crossOrigin = "anonymous";
  return {
    play() {
      void audio.play().catch(() => {});
    },
    pause() {
      audio.pause();
    },
    setVolume(v: number) {
      audio.volume = clamp01(v);
    },
    dispose() {
      audio.pause();
      audio.src = "";
    },
  };
}

/**
 * BGM 플레이어 생성 — URL이 있으면 URL 우선, 아니면 무드 자동 생성, 둘 다 없으면 무동작.
 * 브라우저 외(SSR/테스트)에서는 안전하게 무동작 플레이어를 돌려준다.
 */
export function createBgmPlayer(opts: { mood?: BgmMood | null; url?: string; volume?: number }): BgmPlayer {
  const volume = clamp01(opts.volume ?? 0.5);
  if (opts.url) return createUrlPlayer(opts.url, volume);
  if (opts.mood) return createProceduralPlayer(opts.mood, volume);
  return NOOP_PLAYER;
}

/**
 * 컷 연출용 동적 BGM 플레이어 — 기본 무드 없이(null = 침묵 대기) 시작할 수 있고,
 * setMood(컷 진입 BGM 전환)·playStinger(컷 SE, 같은 컨텍스트 재사용)를 지원한다.
 * 자동 생성 신스 전용이며, 브라우저 외에서는 무동작 플레이어를 돌려준다.
 */
export function createDynamicBgmPlayer(opts: { mood?: BgmMood | null; volume?: number }): BgmPlayer {
  return createProceduralPlayer(opts.mood ?? null, clamp01(opts.volume ?? 0.5));
}

// ── 독립 SE 스팅어 플레이어 ──────────────────────────────────────────
// 커스텀 URL BGM처럼 Web Audio 그래프가 없는 조합에서 쓰는 폴백. 자체 AudioContext를
// 첫 play()에서 lazy 생성한다(자동재생 정책상 사용자 제스처 이후 호출이 전제).
export interface SfxStingerPlayer {
  play(preset: SfxStingerPreset): void;
  setVolume(v: number): void;
  dispose(): void;
}

export function createSfxStingerPlayer(opts?: { volume?: number }): SfxStingerPlayer {
  let volume = clamp01(opts?.volume ?? 0.5);
  let ctx: AudioContext | null = null;
  let disposed = false;
  return {
    play(preset: SfxStingerPreset) {
      if (disposed) return;
      if (!ctx) {
        const Ctor = getAudioContextCtor();
        if (!Ctor) return; // 브라우저 외 — 무동작
        ctx = new Ctor();
      }
      void ctx.resume().catch(() => {});
      scheduleSfxStinger(ctx, ctx.destination, preset, volume);
    },
    setVolume(v: number) {
      volume = clamp01(v);
    },
    dispose() {
      disposed = true;
      if (ctx) {
        void ctx.close().catch(() => {});
        ctx = null;
      }
    },
  };
}
