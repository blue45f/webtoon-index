import { describe, it, expect, vi } from "vitest";

import {
  BGM_MOODS,
  buildProgression,
  createDynamicBgmPlayer,
  createSfxStingerPlayer,
  findBgmMood,
  noteToFreq,
  scheduleSfxStinger,
  type StingerSynthContext,
  type StingerSynthNode,
} from "./studio-bgm";
import { SFX_STINGER_PRESETS, findSfxStingerPreset } from "./studio-motion-fx";

describe("BGM_MOODS 데이터", () => {
  it("무드 id는 유일하고 음계·템포가 유효하다", () => {
    const ids = BGM_MOODS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BGM_MOODS.length).toBeGreaterThanOrEqual(6);
    for (const m of BGM_MOODS) {
      expect(m.scale.length).toBeGreaterThan(0);
      expect(m.scale[0]).toBe(0); // 루트 포함
      expect(m.tempo).toBeGreaterThan(0);
      expect(m.rootFreq).toBeGreaterThan(0);
    }
  });

  it("findBgmMood", () => {
    expect(findBgmMood("calm")?.label).toBe("잔잔");
    expect(findBgmMood("nope")).toBeUndefined();
  });
});

describe("noteToFreq", () => {
  it("유니즌은 그대로, 한 옥타브는 2배", () => {
    expect(noteToFreq(220, 0)).toBeCloseTo(220, 5);
    expect(noteToFreq(220, 12)).toBeCloseTo(440, 5);
    expect(noteToFreq(440, -12)).toBeCloseTo(220, 5);
  });

  it("완전5도(7반음)는 약 1.5배", () => {
    expect(noteToFreq(100, 7) / 100).toBeCloseTo(1.4983, 3);
  });
});

describe("buildProgression", () => {
  it("마디 수만큼 스텝을 만들고 박자가 4씩 증가한다", () => {
    const mood = BGM_MOODS[0];
    const steps = buildProgression(mood, 4);
    expect(steps).toHaveLength(4);
    expect(steps.map((s) => s.atBeat)).toEqual([0, 4, 8, 12]);
    for (const s of steps) {
      expect(s.semitones).toHaveLength(3); // 트라이어드
      expect(s.beats).toBe(4);
      for (const st of s.semitones) expect(Number.isFinite(st)).toBe(true);
    }
  });

  it("결정적 — 같은 무드·마디면 항상 같은 진행", () => {
    const mood = BGM_MOODS[2];
    expect(buildProgression(mood, 8)).toEqual(buildProgression(mood, 8));
  });

  it("0마디는 빈 진행", () => {
    expect(buildProgression(BGM_MOODS[0], 0)).toEqual([]);
  });
});

// ── SE 스팅어 스케줄러 ───────────────────────────────────────────────

// vi.fn()에 명시 시그니처를 줘 Mock이 호출 가능 타입으로 남게 한다(StingerSynth* 구조 호환).
function makeStingerParam() {
  return {
    value: 0,
    setValueAtTime: vi.fn<(value: number, startTime: number) => unknown>(),
    exponentialRampToValueAtTime: vi.fn<(value: number, endTime: number) => unknown>(),
  };
}

type FakeStingerParam = ReturnType<typeof makeStingerParam>;

interface FakeStingerOsc {
  type: string;
  frequency: FakeStingerParam;
  connect: (node: StingerSynthNode) => unknown;
  startAt: number;
  stopAt: number;
  start(when: number): void;
  stop(when: number): void;
}

interface FakeStingerGain {
  gain: FakeStingerParam;
  connect: (node: StingerSynthNode) => unknown;
}

function createFakeStingerContext(currentTime = 2) {
  const oscillators: FakeStingerOsc[] = [];
  const gains: FakeStingerGain[] = [];
  const ctx: StingerSynthContext = {
    currentTime,
    createGain() {
      const gain: FakeStingerGain = { gain: makeStingerParam(), connect: vi.fn() };
      gains.push(gain);
      return gain;
    },
    createOscillator() {
      const osc: FakeStingerOsc = {
        type: "",
        frequency: makeStingerParam(),
        connect: vi.fn(),
        startAt: -1,
        stopAt: -1,
        start(when: number) {
          osc.startAt = when;
        },
        stop(when: number) {
          osc.stopAt = when;
        },
      };
      oscillators.push(osc);
      return osc;
    },
  };
  return { ctx, oscillators, gains };
}

const FAKE_DEST: StingerSynthNode = { connect: vi.fn() };

describe("scheduleSfxStinger", () => {
  it("노트 수만큼 오실레이터를 만들고 오프셋대로 시작·정지한다", () => {
    const { ctx, oscillators } = createFakeStingerContext(2);
    const preset = findSfxStingerPreset("heartbeat")!;
    const t0 = scheduleSfxStinger(ctx, FAKE_DEST, preset, 0.5);
    expect(t0).toBeCloseTo(2.02, 9); // when 생략 → 지금 + 0.02초 여유
    expect(oscillators).toHaveLength(preset.notes.length);
    preset.notes.forEach((note, i) => {
      const osc = oscillators[i];
      expect(osc.type).toBe(note.wave);
      expect(osc.startAt).toBeCloseTo(t0 + note.at, 9);
      expect(osc.stopAt).toBeCloseTo(t0 + note.at + note.duration + 0.05, 9);
      expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(note.freq, expect.closeTo(t0 + note.at, 9));
    });
  });

  it("피치 슬라이드(freqEnd)는 지수 램프, 고정음은 램프를 걸지 않는다", () => {
    const { ctx, oscillators } = createFakeStingerContext();
    scheduleSfxStinger(ctx, FAKE_DEST, findSfxStingerPreset("thud")!, 1); // 두 노트 모두 freqEnd 있음
    for (const osc of oscillators) expect(osc.frequency.exponentialRampToValueAtTime).toHaveBeenCalled();

    const second = createFakeStingerContext();
    scheduleSfxStinger(second.ctx, FAKE_DEST, findSfxStingerPreset("sparkle")!, 1); // 전부 고정음
    for (const osc of second.oscillators) {
      expect(osc.frequency.exponentialRampToValueAtTime).not.toHaveBeenCalled();
    }
  });

  it("마스터 게인 = clamp01(볼륨)×0.5, 과거 when은 현재+0.02로 보정한다", () => {
    const { ctx, gains } = createFakeStingerContext(1);
    scheduleSfxStinger(ctx, FAKE_DEST, findSfxStingerPreset("hit")!, 2, 5); // 볼륨 2 → 1로 클램프
    expect(gains[0].gain.value).toBeCloseTo(0.5, 9); // 첫 게인 = 마스터
    const late = createFakeStingerContext(9);
    expect(scheduleSfxStinger(late.ctx, FAKE_DEST, findSfxStingerPreset("hit")!, 0.5, 5)).toBeCloseTo(9.02, 9);
  });

  it("모든 프리셋이 예외 없이 스케줄되고 노트마다 엔벨로프 게인이 생긴다", () => {
    for (const preset of SFX_STINGER_PRESETS) {
      const { ctx, oscillators, gains } = createFakeStingerContext();
      expect(() => scheduleSfxStinger(ctx, FAKE_DEST, preset, 0.7)).not.toThrow();
      expect(oscillators).toHaveLength(preset.notes.length);
      expect(gains).toHaveLength(preset.notes.length + 1); // 마스터 1 + 노트별 엔벨로프
    }
  });
});

describe("브라우저 플레이어 폴백(노드 환경)", () => {
  it("createDynamicBgmPlayer는 AudioContext 없이 전 메서드가 무동작으로 안전하다", () => {
    const bgm = createDynamicBgmPlayer({ mood: findBgmMood("calm") ?? null, volume: 0.5 });
    expect(() => {
      bgm.play();
      bgm.setMood?.(findBgmMood("tense") ?? null);
      bgm.setMood?.(null);
      bgm.playStinger?.(SFX_STINGER_PRESETS[0], 0.5);
      bgm.pause();
      bgm.setVolume(0.2);
      bgm.dispose();
    }).not.toThrow();
  });

  it("createSfxStingerPlayer도 AudioContext 없이 안전하다", () => {
    const se = createSfxStingerPlayer({ volume: 0.4 });
    expect(() => {
      se.play(SFX_STINGER_PRESETS[0]);
      se.setVolume(1);
      se.dispose();
    }).not.toThrow();
  });
});
