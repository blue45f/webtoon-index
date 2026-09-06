import { describe, it, expect } from "vitest";

import { planMotionExport } from "./export/studio-motion-export";
import {
  AMBIENT_PRESETS,
  CUT_BGM_SILENCE,
  DEFAULT_WORK_FX,
  EMPHASIS_PRESETS,
  REVEAL_PRESETS,
  SEQ_DEFAULT_MARK_H,
  SEQ_DEFAULT_MARK_W,
  SEQ_MARK_ANIMS,
  SEQ_MAX_DELAY_MS,
  SEQ_MAX_MARKS,
  SEQ_SUGGEST_BASE_DELAY_MS,
  SEQ_SUGGEST_STEP_MS,
  SFX_STINGER_PRESETS,
  buildAmbientParticles,
  createSeqMarkAtPoint,
  cutFx,
  emphasisAnimation,
  findAmbientPreset,
  findSfxStingerPreset,
  hasAnyFx,
  hasCutAudioFx,
  readWorkFx,
  revealHiddenStyle,
  seqMarkAnimation,
  seqMarkBaseStyle,
  stepAmbientParticle,
  suggestSeqMarksFromStudioDoc,
  type WorkCutSeqMark,
  type WorkFxSettings,
} from "./studio-motion-fx";

describe("프리셋 데이터", () => {
  it("리빌·앰비언트 id는 유일하고 'none'을 포함한다", () => {
    const r = REVEAL_PRESETS.map((p) => p.id);
    const a = AMBIENT_PRESETS.map((p) => p.id);
    expect(new Set(r).size).toBe(r.length);
    expect(new Set(a).size).toBe(a.length);
    expect(r).toContain("none");
    expect(a).toContain("none");
  });
});

describe("readWorkFx", () => {
  it("doc에 fx가 없으면 기본값", () => {
    expect(readWorkFx({})).toEqual(DEFAULT_WORK_FX);
    expect(readWorkFx(null)).toEqual(DEFAULT_WORK_FX);
    expect(readWorkFx(undefined)).toEqual(DEFAULT_WORK_FX);
  });

  it("유효한 fx를 정규화해 읽는다", () => {
    const fx = readWorkFx({ fx: { reveal: "fade-up", ambient: "snow", bgmMood: "calm", bgmUrl: "https://x/y.mp3", bgmVolume: 0.3 } });
    expect(fx.reveal).toBe("fade-up");
    expect(fx.ambient).toBe("snow");
    expect(fx.bgmMood).toBe("calm");
    expect(fx.bgmUrl).toBe("https://x/y.mp3");
    expect(fx.bgmVolume).toBe(0.3);
  });

  it("잘못된 reveal/ambient는 기본값으로 떨어진다", () => {
    const fx = readWorkFx({ fx: { reveal: "nope", ambient: "lava" } });
    expect(fx.reveal).toBe("none");
    expect(fx.ambient).toBe("none");
  });

  it("볼륨은 0..1로 클램프", () => {
    expect(readWorkFx({ fx: { bgmVolume: 5 } }).bgmVolume).toBe(1);
    expect(readWorkFx({ fx: { bgmVolume: -2 } }).bgmVolume).toBe(0);
  });
});

describe("hasAnyFx", () => {
  it("전부 기본이면 false, 하나라도 켜지면 true", () => {
    expect(hasAnyFx(DEFAULT_WORK_FX)).toBe(false);
    expect(hasAnyFx({ ...DEFAULT_WORK_FX, reveal: "zoom-in" })).toBe(true);
    expect(hasAnyFx({ ...DEFAULT_WORK_FX, ambient: "rain" })).toBe(true);
    expect(hasAnyFx({ ...DEFAULT_WORK_FX, bgmMood: "calm" })).toBe(true);
    expect(hasAnyFx({ ...DEFAULT_WORK_FX, bgmUrl: "http://x" })).toBe(true);
  });

  it("컷별 강조/리빌이 있으면 true", () => {
    expect(hasAnyFx({ ...DEFAULT_WORK_FX, cuts: [{ reveal: "", emphasis: "shake" }] })).toBe(true);
    expect(hasAnyFx({ ...DEFAULT_WORK_FX, cuts: [{ reveal: "zoom-in", emphasis: "none" }] })).toBe(true);
    expect(hasAnyFx({ ...DEFAULT_WORK_FX, cuts: [{ reveal: "", emphasis: "none" }] })).toBe(false);
  });
});

describe("컷별 효과(cuts)", () => {
  it("readWorkFx는 cuts 배열을 정규화한다", () => {
    const fx = readWorkFx({ fx: { cuts: [{ reveal: "fade-up", emphasis: "shake" }, { reveal: "bad", emphasis: "nope" }, 42] } });
    expect(fx.cuts).toHaveLength(3);
    expect(fx.cuts[0]).toEqual({ reveal: "fade-up", emphasis: "shake" });
    expect(fx.cuts[1]).toEqual({ reveal: "", emphasis: "none" }); // 잘못된 값은 기본
    expect(fx.cuts[2]).toEqual({ reveal: "", emphasis: "none" }); // 객체 아님
  });

  it("cuts가 없으면 빈 배열", () => {
    expect(readWorkFx({ fx: {} }).cuts).toEqual([]);
  });

  it("cutFx: 컷별 reveal이 비면 작품 기본 reveal 상속", () => {
    const fx = { ...DEFAULT_WORK_FX, reveal: "zoom-in", cuts: [{ reveal: "", emphasis: "shake" }] };
    expect(cutFx(fx, 0)).toEqual({ reveal: "zoom-in", emphasis: "shake" });
  });

  it("cutFx: 컷별 reveal이 있으면 그걸 사용", () => {
    const fx = { ...DEFAULT_WORK_FX, reveal: "zoom-in", cuts: [{ reveal: "slide-in", emphasis: "none" }] };
    expect(cutFx(fx, 0).reveal).toBe("slide-in");
  });

  it("cutFx: 범위 밖 인덱스는 작품 기본 + 강조 없음", () => {
    const fx = { ...DEFAULT_WORK_FX, reveal: "fade", cuts: [] };
    expect(cutFx(fx, 5)).toEqual({ reveal: "fade", emphasis: "none" });
  });
});

describe("SE 스팅어 프리셋", () => {
  it("8종이고 id가 유일하며 라벨이 기획(두근/쿵/휙/반짝/긴장/타격/또르르/빰)을 덮는다", () => {
    expect(SFX_STINGER_PRESETS).toHaveLength(8);
    const ids = SFX_STINGER_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SFX_STINGER_PRESETS.map((p) => p.label)).toEqual([
      "두근",
      "쿵",
      "휙",
      "반짝",
      "긴장",
      "타격",
      "또르르",
      "빰",
    ]);
  });

  it("노트 파라미터가 Web Audio로 재생 가능한 범위다(양수 주파수·0..1 게인·어택<길이)", () => {
    for (const p of SFX_STINGER_PRESETS) {
      expect(p.duration).toBeGreaterThan(0);
      expect(p.notes.length).toBeGreaterThan(0);
      for (const n of p.notes) {
        expect(n.at).toBeGreaterThanOrEqual(0);
        expect(n.duration).toBeGreaterThan(0);
        expect(n.at + n.duration).toBeLessThanOrEqual(p.duration + 1e-9); // 총 길이가 노트를 덮는다
        expect(n.freq).toBeGreaterThan(0);
        if (n.freqEnd != null) expect(n.freqEnd).toBeGreaterThan(0); // 지수 램프는 0을 못 지난다
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(1);
        expect(n.attack).toBeGreaterThan(0);
        expect(n.attack).toBeLessThan(n.duration);
      }
    }
  });

  it("findSfxStingerPreset", () => {
    expect(findSfxStingerPreset("thud")?.label).toBe("쿵");
    expect(findSfxStingerPreset("nope")).toBeUndefined();
  });
});

describe("컷 오디오 필드(sfx·bgmShift) 정규화", () => {
  it("유효한 sfx·bgmShift를 읽는다", () => {
    const fx = readWorkFx({
      fx: { cuts: [{ reveal: "", emphasis: "none", sfx: { preset: "thud" }, bgmShift: { mood: "tense" } }] },
    });
    expect(fx.cuts[0].sfx).toEqual({ preset: "thud" });
    expect(fx.cuts[0].bgmShift).toEqual({ mood: "tense" });
  });

  it('bgmShift는 "silence"(음악 멈춤)도 허용한다', () => {
    const fx = readWorkFx({ fx: { cuts: [{ bgmShift: { mood: CUT_BGM_SILENCE } }] } });
    expect(fx.cuts[0].bgmShift).toEqual({ mood: "silence" });
  });

  it("잘못된 값은 키 자체를 만들지 않는다", () => {
    const fx = readWorkFx({
      fx: {
        cuts: [
          { sfx: { preset: "unknown" }, bgmShift: { mood: "" } }, // 모르는 프리셋 · 빈 무드
          { sfx: "thud", bgmShift: 42 }, // 객체 아님
          { sfx: {}, bgmShift: {} }, // 필드 누락
        ],
      },
    });
    for (const c of fx.cuts) {
      expect("sfx" in c).toBe(false);
      expect("bgmShift" in c).toBe(false);
    }
  });

  it("구버전 doc(필드 없음)은 새 키가 생기지 않는다(직렬화 하위호환)", () => {
    const fx = readWorkFx({ fx: { cuts: [{ reveal: "fade-up", emphasis: "shake" }] } });
    expect(fx.cuts[0]).toEqual({ reveal: "fade-up", emphasis: "shake" });
    expect(Object.keys(fx.cuts[0])).toEqual(["reveal", "emphasis"]);
  });

  it("cutFx는 sfx·bgmShift를 실효 효과에 실어 나른다(범위 밖·미지정은 undefined)", () => {
    const fx: WorkFxSettings = {
      ...DEFAULT_WORK_FX,
      reveal: "fade",
      cuts: [{ reveal: "", emphasis: "none", sfx: { preset: "hit" }, bgmShift: { mood: "epic" } }],
    };
    expect(cutFx(fx, 0)).toEqual({
      reveal: "fade",
      emphasis: "none",
      sfx: { preset: "hit" },
      bgmShift: { mood: "epic" },
    });
    expect(cutFx(fx, 3).sfx).toBeUndefined();
    expect(cutFx(fx, 3).bgmShift).toBeUndefined();
  });

  it("hasAnyFx/hasCutAudioFx — 컷 오디오만 있어도 효과로 친다", () => {
    const onlySfx: WorkFxSettings = {
      ...DEFAULT_WORK_FX,
      cuts: [{ reveal: "", emphasis: "none", sfx: { preset: "thud" } }],
    };
    const onlyShift: WorkFxSettings = {
      ...DEFAULT_WORK_FX,
      cuts: [{ reveal: "", emphasis: "none", bgmShift: { mood: "calm" } }],
    };
    expect(hasAnyFx(onlySfx)).toBe(true);
    expect(hasAnyFx(onlyShift)).toBe(true);
    expect(hasCutAudioFx(onlySfx)).toBe(true);
    expect(hasCutAudioFx(onlyShift)).toBe(true);
    expect(hasCutAudioFx(DEFAULT_WORK_FX)).toBe(false);
    expect(hasCutAudioFx({ ...DEFAULT_WORK_FX, cuts: [{ reveal: "zoom-in", emphasis: "shake" }] })).toBe(false);
  });
});

// ── 컷 연출 마크(seq) — 요소 단위 시간차 오버레이 ─────────────────────
const MARK: WorkCutSeqMark = { x: 0.1, y: 0.2, w: 0.3, h: 0.15, delayMs: 600, anim: "focus" };

describe("컷 연출 마크(seq) 정규화", () => {
  it("유효한 마크를 그대로 읽는다", () => {
    const fx = readWorkFx({ fx: { cuts: [{ seq: { marks: [MARK, { ...MARK, y: 0.5, anim: "flash" }] } }] } });
    expect(fx.cuts[0].seq).toEqual({ marks: [MARK, { ...MARK, y: 0.5, anim: "flash" }] });
  });

  it("좌표는 0..1로 클램프되고 넘치는 너비/높이는 캔버스 안으로 줄인다", () => {
    const fx = readWorkFx({
      fx: { cuts: [{ seq: { marks: [{ x: -0.2, y: 0.9, w: 5, h: 0.4, delayMs: -50, anim: "shake" }] } }] },
    });
    const m = fx.cuts[0].seq!.marks[0];
    expect(m.x).toBe(0); // 음수 → 0
    expect(m.w).toBe(1); // 폭 5 → 1-x
    expect(m.y).toBe(0.9);
    expect(m.h).toBeCloseTo(0.1, 10); // 높이 0.4 → 1-y (부동소수 근사)
    expect(m.y + m.h).toBeLessThanOrEqual(1); // 캔버스를 벗어나지 않는다
    expect(m.delayMs).toBe(0);
    expect(m.anim).toBe("shake");
  });

  it("지연은 0..SEQ_MAX_DELAY_MS 정수로 클램프·반올림, 없으면 0", () => {
    const fx = readWorkFx({
      fx: {
        cuts: [
          {
            seq: {
              marks: [
                { ...MARK, delayMs: 250.6 },
                { ...MARK, delayMs: 99999 },
                { ...MARK, delayMs: "nope" },
              ],
            },
          },
        ],
      },
    });
    expect(fx.cuts[0].seq!.marks.map((m) => m.delayMs)).toEqual([251, SEQ_MAX_DELAY_MS, 0]);
  });

  it(`마크는 컷당 최대 ${SEQ_MAX_MARKS}개로 자른다`, () => {
    const many = Array.from({ length: SEQ_MAX_MARKS + 3 }, (_, i) => ({ ...MARK, delayMs: i * 100 }));
    const fx = readWorkFx({ fx: { cuts: [{ seq: { marks: many } }] } });
    expect(fx.cuts[0].seq!.marks).toHaveLength(SEQ_MAX_MARKS);
    expect(fx.cuts[0].seq!.marks[SEQ_MAX_MARKS - 1].delayMs).toBe((SEQ_MAX_MARKS - 1) * 100);
  });

  it("잘못된 마크(비수치 좌표·퇴화 면적·모르는 anim·객체 아님)는 버린다", () => {
    const fx = readWorkFx({
      fx: {
        cuts: [
          {
            seq: {
              marks: [
                { ...MARK, x: "a" }, // 비수치
                { ...MARK, w: 0 }, // 면적 없음
                { ...MARK, x: 1, w: 0.5 }, // 클램프 후 면적 없음(x=1 → w=0)
                { ...MARK, anim: "ripple" }, // 모르는 anim(미래 추가분은 우아하게 무시)
                { ...MARK, anim: 3 },
                42,
                MARK, // 유일한 생존자
              ],
            },
          },
        ],
      },
    });
    expect(fx.cuts[0].seq).toEqual({ marks: [MARK] });
  });

  it("빈/전부 무효/비객체 seq는 키 자체를 만들지 않는다(직렬화 하위호환)", () => {
    const fx = readWorkFx({
      fx: {
        cuts: [
          { seq: { marks: [] } },
          { seq: { marks: [{ ...MARK, x: NaN }] } },
          { seq: "marks" },
          { seq: { marks: "nope" } },
          { reveal: "fade-up", emphasis: "shake" }, // 구버전 컷
        ],
      },
    });
    for (const c of fx.cuts) expect("seq" in c).toBe(false);
    expect(Object.keys(fx.cuts[4])).toEqual(["reveal", "emphasis"]);
  });

  it("cutFx는 seq를 실효 효과에 불변 복사로 실어 나른다", () => {
    const src: WorkFxSettings = {
      ...DEFAULT_WORK_FX,
      reveal: "fade",
      cuts: [{ reveal: "", emphasis: "none", seq: { marks: [{ ...MARK }] } }],
    };
    const out = cutFx(src, 0);
    expect(out.seq).toEqual({ marks: [MARK] });
    out.seq!.marks[0].delayMs = 9999; // 소비자가 변형해도 원본 설정은 그대로
    expect(src.cuts[0].seq!.marks[0].delayMs).toBe(600);
    expect(cutFx(src, 3).seq).toBeUndefined(); // 범위 밖 컷은 마크 없음
  });

  it("hasAnyFx — 연출 마크만 있어도 효과로 친다(빈 marks는 아님)", () => {
    expect(hasAnyFx({ ...DEFAULT_WORK_FX, cuts: [{ reveal: "", emphasis: "none", seq: { marks: [MARK] } }] })).toBe(true);
    expect(hasAnyFx({ ...DEFAULT_WORK_FX, cuts: [{ reveal: "", emphasis: "none", seq: { marks: [] } }] })).toBe(false);
  });
});

describe("seqMarkAnimation / seqMarkBaseStyle", () => {
  it("프리셋 id는 4종이고 유일하다", () => {
    expect(SEQ_MARK_ANIMS.map((p) => p.id)).toEqual(["focus", "flash", "zoompulse", "shake"]);
  });

  it("모든 anim은 시작·끝 opacity 0 키프레임을 가진다(대기 중·재생 후 안 보임 규약)", () => {
    for (const p of SEQ_MARK_ANIMS) {
      const a = seqMarkAnimation(p.id);
      expect(a).not.toBeNull();
      expect(a!.keyframes.length).toBeGreaterThanOrEqual(2);
      expect(a!.options.duration).toBeGreaterThan(0);
      expect(a!.keyframes[0].opacity).toBe(0);
      expect(a!.keyframes[a!.keyframes.length - 1].opacity).toBe(0);
    }
  });

  it("모르는 anim은 null / 투명 스타일(안전 no-op)", () => {
    expect(seqMarkAnimation("nope")).toBeNull();
    expect(seqMarkBaseStyle("nope")).toEqual({ background: "transparent", boxShadow: "none" });
  });

  it("플래시는 채움, 나머지는 링(box-shadow)으로 그린다", () => {
    expect(seqMarkBaseStyle("flash").background).not.toBe("transparent");
    for (const id of ["focus", "zoompulse", "shake"]) {
      expect(seqMarkBaseStyle(id).boxShadow).not.toBe("none");
      expect(seqMarkBaseStyle(id).background).toBe("transparent");
    }
  });
});

describe("createSeqMarkAtPoint (썸네일 클릭 → 마크)", () => {
  it("클릭 지점을 중심으로 기본 크기 마크를 만든다", () => {
    const m = createSeqMarkAtPoint(180, 120, 360, 240, 500);
    expect(m).toEqual({
      x: 0.5 - SEQ_DEFAULT_MARK_W / 2,
      y: 0.5 - SEQ_DEFAULT_MARK_H / 2,
      w: SEQ_DEFAULT_MARK_W,
      h: SEQ_DEFAULT_MARK_H,
      delayMs: 500,
      anim: "focus",
    });
  });

  it("모서리 클릭은 캔버스 안으로 클램프된다", () => {
    expect(createSeqMarkAtPoint(0, 0, 360, 240, 0)).toMatchObject({ x: 0, y: 0 });
    const br = createSeqMarkAtPoint(360, 240, 360, 240, 0)!;
    expect(br.x).toBeCloseTo(1 - SEQ_DEFAULT_MARK_W, 4);
    expect(br.y).toBeCloseTo(1 - SEQ_DEFAULT_MARK_H, 4);
  });

  it("지연은 클램프·반올림, 표시 크기가 0 이하이거나 좌표가 무한이면 null", () => {
    expect(createSeqMarkAtPoint(10, 10, 100, 100, 123.7)!.delayMs).toBe(124);
    expect(createSeqMarkAtPoint(10, 10, 100, 100, -5)!.delayMs).toBe(0);
    expect(createSeqMarkAtPoint(10, 10, 100, 100, 99999)!.delayMs).toBe(SEQ_MAX_DELAY_MS);
    expect(createSeqMarkAtPoint(10, 10, 0, 100, 0)).toBeNull();
    expect(createSeqMarkAtPoint(10, 10, 100, -1, 0)).toBeNull();
    expect(createSeqMarkAtPoint(NaN, 10, 100, 100, 0)).toBeNull();
  });
});

describe("suggestSeqMarksFromStudioDoc (게시 doc → 마크 시드)", () => {
  // 스튜디오 게시 doc 형태: width=캔버스 폭, pagesList[i] = { canvasH, elements }.
  const doc = {
    width: 720,
    pagesList: [
      {
        canvasH: 1000,
        elements: [
          { id: "t1", type: "text", x: 360, y: 500, width: 144, fontSize: 25, text: "가\n나" },
          { id: "b1", type: "bubble", x: 72, y: 100, width: 144, height: 100, text: "안녕" },
          { id: "img", type: "image", x: 0, y: 0, width: 720, height: 1000 }, // 대상 아님
          { id: "hid", type: "bubble", x: 10, y: 10, width: 80, height: 60, hidden: true }, // 숨김
        ],
      },
      { canvasH: 1000, elements: [] },
    ],
  };

  it("말풍선·텍스트만 정규화해 읽기 순서(위→아래)로 제안한다", () => {
    const marks = suggestSeqMarksFromStudioDoc(doc, 0);
    expect(marks).toHaveLength(2);
    // 말풍선(y=100)이 텍스트(y=500)보다 먼저.
    expect(marks[0]).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.1,
      delayMs: SEQ_SUGGEST_BASE_DELAY_MS,
      anim: "focus",
    });
    // 텍스트 높이는 스튜디오 바운즈 관용(fontSize×1.4)×줄 수 근사: 25×1.4×2 = 70px → 0.07.
    expect(marks[1]).toEqual({
      x: 0.5,
      y: 0.5,
      w: 0.2,
      h: 0.07,
      delayMs: SEQ_SUGGEST_BASE_DELAY_MS + SEQ_SUGGEST_STEP_MS,
      anim: "focus",
    });
  });

  it("같은 y는 x 순으로 정렬하고 상한을 지킨다", () => {
    const many = {
      width: 720,
      pagesList: [
        {
          canvasH: 720,
          elements: Array.from({ length: SEQ_MAX_MARKS + 4 }, (_, i) => ({
            id: `b${i}`,
            type: "bubble",
            x: (SEQ_MAX_MARKS + 3 - i) * 36, // 역순 x — 정렬 검증
            y: 100,
            width: 72,
            height: 72,
          })),
        },
      ],
    };
    const marks = suggestSeqMarksFromStudioDoc(many, 0);
    expect(marks).toHaveLength(SEQ_MAX_MARKS);
    const xs = marks.map((m) => m.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(marks[SEQ_MAX_MARKS - 1].delayMs).toBe(
      SEQ_SUGGEST_BASE_DELAY_MS + (SEQ_MAX_MARKS - 1) * SEQ_SUGGEST_STEP_MS
    );
  });

  it("width가 없으면 스튜디오 기본 폭 720으로 정규화한다", () => {
    const noWidth = { pagesList: [{ canvasH: 1000, elements: [{ id: "b", type: "bubble", x: 360, y: 0, width: 72, height: 100 }] }] };
    expect(suggestSeqMarksFromStudioDoc(noWidth, 0)[0].x).toBe(0.5);
  });

  it("제안 불가 doc(업로드형·범위 밖·canvasH 없음)은 빈 배열", () => {
    expect(suggestSeqMarksFromStudioDoc(null, 0)).toEqual([]);
    expect(suggestSeqMarksFromStudioDoc({}, 0)).toEqual([]); // pagesList 없음(업로드형 작품)
    expect(suggestSeqMarksFromStudioDoc(doc, 5)).toEqual([]); // 페이지 범위 밖
    expect(suggestSeqMarksFromStudioDoc(doc, 1)).toEqual([]); // 요소 없는 페이지
    expect(suggestSeqMarksFromStudioDoc({ width: 720, pagesList: [{ elements: [] }] }, 0)).toEqual([]); // canvasH 없음
  });

  it("캔버스 밖·퇴화 요소는 제안하지 않는다", () => {
    const off = {
      width: 720,
      pagesList: [
        {
          canvasH: 1000,
          elements: [
            { id: "out", type: "bubble", x: 900, y: 100, width: 100, height: 100 }, // x가 캔버스 밖
            { id: "tiny", type: "bubble", x: 100, y: 100, width: 1, height: 1 }, // 퇴화(1% 미만)
          ],
        },
      ],
    };
    expect(suggestSeqMarksFromStudioDoc(off, 0)).toEqual([]);
  });
});

// studio-motion-export는 수정 없이 새 컷 필드(sfx·bgmShift·seq)를 "모른 채" 동작해야 한다(무시 보장).
describe("모션툰 영상 내보내기 하위호환", () => {
  it("planMotionExport는 sfx·bgmShift·seq가 있어도 플랜이 동일하다(필드 무시)", () => {
    const opts = { fps: 10, revealSec: 0.5, holdSec: 1, tailSec: 0.5, width: 72, height: 128 };
    const base: WorkFxSettings = {
      ...DEFAULT_WORK_FX,
      reveal: "fade-up",
      bgmMood: "calm",
      cuts: [
        { reveal: "", emphasis: "shake" },
        { reveal: "slide-in", emphasis: "none" },
      ],
    };
    const withAudio: WorkFxSettings = {
      ...base,
      cuts: [
        {
          reveal: "",
          emphasis: "shake",
          sfx: { preset: "thud" },
          bgmShift: { mood: "tense" },
          seq: { marks: [MARK] },
        },
        {
          reveal: "slide-in",
          emphasis: "none",
          sfx: { preset: "sparkle" },
          bgmShift: { mood: CUT_BGM_SILENCE },
          seq: { marks: [{ ...MARK, anim: "zoompulse" }, { ...MARK, y: 0.6, anim: "flash" }] },
        },
      ],
    };
    expect(planMotionExport(2, withAudio, opts)).toEqual(planMotionExport(2, base, opts));
  });
});

describe("emphasisAnimation", () => {
  it("none/미지정은 null", () => {
    expect(emphasisAnimation("none")).toBeNull();
    expect(emphasisAnimation("xxx")).toBeNull();
  });

  it("강조 프리셋은 키프레임+옵션을 돌려준다", () => {
    for (const p of EMPHASIS_PRESETS.filter((e) => e.id !== "none")) {
      const a = emphasisAnimation(p.id);
      expect(a).not.toBeNull();
      expect(a!.keyframes.length).toBeGreaterThanOrEqual(2);
      expect(a!.options.duration).toBeGreaterThan(0);
    }
  });
});

describe("revealHiddenStyle", () => {
  it("none/미지정은 완전 표시 상태", () => {
    expect(revealHiddenStyle("none")).toEqual({ opacity: 1, transform: "none", filter: "none" });
    expect(revealHiddenStyle("xxx")).toEqual({ opacity: 1, transform: "none", filter: "none" });
  });
  it("fade-up은 아래로 이동+투명", () => {
    const s = revealHiddenStyle("fade-up");
    expect(s.opacity).toBe(0);
    expect(s.transform).toContain("translateY");
  });
  it("blur-in은 흐림 필터", () => {
    expect(revealHiddenStyle("blur-in").filter).toContain("blur");
  });
});

describe("buildAmbientParticles", () => {
  it("none/0 크기는 빈 배열", () => {
    expect(buildAmbientParticles(AMBIENT_PRESETS[0], 720, 1000)).toEqual([]);
    const rain = findAmbientPreset("rain")!;
    expect(buildAmbientParticles(rain, 0, 1000)).toEqual([]);
    expect(buildAmbientParticles(rain, 720, 0)).toEqual([]);
  });

  it("같은 시드면 같은 입자(결정적)", () => {
    const snow = findAmbientPreset("snow")!;
    const a = buildAmbientParticles(snow, 720, 1000, 7);
    const b = buildAmbientParticles(snow, 720, 1000, 7);
    expect(a).toEqual(b);
    const c = buildAmbientParticles(snow, 720, 1000, 8);
    expect(c).not.toEqual(a);
  });

  it("입자는 캔버스 범위 안에서 시작하고 크기 범위를 지킨다", () => {
    const petals = findAmbientPreset("petals")!;
    const ps = buildAmbientParticles(petals, 720, 1280, 3);
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(720);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1280);
      expect(p.size).toBeGreaterThanOrEqual(petals.minSize);
      expect(p.size).toBeLessThanOrEqual(petals.maxSize);
    }
  });

  it("폭이 넓으면 입자 수가 비례해 늘어난다", () => {
    const rain = findAmbientPreset("rain")!;
    const narrow = buildAmbientParticles(rain, 360, 1000, 1).length;
    const wide = buildAmbientParticles(rain, 1440, 1000, 1).length;
    expect(wide).toBeGreaterThan(narrow);
  });
});

describe("stepAmbientParticle", () => {
  it("입력을 변형하지 않고(불변) 위치를 전진시킨다", () => {
    const p = { x: 100, y: 100, size: 4, vx: 0, vy: 60, rot: 0, vr: 0, phase: 0 };
    const next = stepAmbientParticle(p, 720, 1000, 0.5);
    expect(p.y).toBe(100); // 원본 불변
    expect(next.y).toBeGreaterThan(100);
  });

  it("아래로 빠지면 위에서 재진입(래핑)", () => {
    const p = { x: 100, y: 999, size: 4, vx: 0, vy: 60, rot: 0, vr: 0, phase: 0 };
    const next = stepAmbientParticle(p, 720, 1000, 1);
    expect(next.y).toBeLessThan(0);
  });
});
