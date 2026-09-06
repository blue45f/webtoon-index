/**
 * Studio Localization Style Lint — 영문(EN) 대사 레터링 **문체·구두점 규칙의 결정적 검사기**.
 *
 * 왜 이 모듈이 필요한가
 * ---------------------
 * 이 저장소에는 번역 결함을 **분류하는 코드가 한 줄도 없었다**. 번역 쪽 숫자는 두 개뿐인데
 * 둘 다 품질 판정이 아니다:
 *  · `studio-dialogue-translate.dialogueTranslationCoverage` — 번역된 대사 "개수"(존재 여부)
 *  · `studio-translation-memory.StudioTranslationMemoryFuzzySuggestion.score` — 재사용 랭킹용
 *    **원문 유사도**(0.86 임계)
 * 대사 문자열의 **글자 자체**를 보는 모듈도 없었다. `studio-dialogue-format.ts`는 fontSize·align
 * 같은 타이포그래피 패치만 만지고 `element.text`는 복사만 한다. 기존 린터 세 개
 * (`studio-project-health-linter`·`studio-publish-preflight`·`studio-continuity`)는 대사 본문을
 * 아예 열지 않는다. 즉 "말줄임표가 점 두 개다", "?! 가 !? 로 뒤집혔다", "영문 대사에 ㅠㅠ 가
 * 그대로 남았다" 같은, **사람이 눈으로 잡아야 했던 결함**을 잡는 자리가 비어 있었다.
 *
 * 이 모듈은 그 자리를 채운다. 기계적으로 판정 가능한 규칙만 담고, 판정 불가능한 규칙은
 * **넣지 않는다**(아래 "일부러 구현하지 않은 규칙" 참고).
 *
 * 출처(모든 규칙은 아래 둘 중 하나에서만 나온다)
 * ----------------------------------------------
 * (A) WEBTOON 영문 레터링/번역 스타일 가이드
 *     guide.totus.pro/5ead53e8-42a5-4332-a74d-f36276cfea9c
 *     guide.totus.pro/5397ddfc-0c71-4830-9803-2671edd6c701
 * (B) Blambot 코믹 레터링 전통 — blambot.com/pages/comic-book-grammar-tradition
 *     (말끊김 이중대시 vs 여운 3점 말줄임, 외국어 꺾쇠 관례)
 * MQM 좌표계는 MQM-Core 표준에서 온다 —
 *     themqm.org/mqm-pillars/the-mqm-core-typology/
 *
 * MQM 좌표계 핸드오프(이 모듈의 존재 이유 절반)
 * ---------------------------------------------
 * 발견(finding)마다 **MQM 차원/하위유형**을 붙인다. 붙이지 않으면 이 린터의 결과가 MQM 점수
 * 체계와 다른 우주에 살게 되고, 에피소드 단위 품질 점수에 합류하지 못한다.
 *
 * 타이폴로지의 단일 소스는 `studio-localization-mqm.ts`다. 이 모듈은 차원/서브타입 이름을
 * **스스로 정의하지 않고** 그쪽 타입을 import 해 쓴다(그리고 호출부 편의를 위해 재수출한다).
 * `studioLocalizationStyleFindingToMqmError()`가 발견 하나를 그쪽 `StudioMqmErrorInput`으로
 * 바꿔 주므로, 린트 결과를 그대로 `scoreStudioMqmErrors()`에 넣어 에피소드 점수를 낼 수 있다.
 *
 * 심각도 이름(neutral/minor/major/critical)도 MQM 심각도 그대로다. **가중치(0/1/5/25)는 여기
 * 두지 않는다** — 가중치를 두 곳에 두면 갈라지고, 점수 계산은 MQM 모듈의 일이다. WMT 운영
 * 변형이 쓰는 "세그먼트당 최대 5개 오류" 같은 상한도 **점수 단계의 상한**이지 린트 단계의
 * 상한이 아니므로 여기서 자르지 않는다(편집자는 다 봐야 한다). ETW(유형 가중치)도 마찬가지로
 * 붙이지 않는다 — 규칙별 가중치는 작품/벤더 계약의 값이지 린터가 정할 값이 아니다.
 *
 * 서브타입은 **출처에 이름이 실린 것만** 붙는다. MQM-Core는 38개 서브타입을 갖지만 1차 출처에
 * 이름이 실린 것은 Accuracy 계열과 Design and markup 5종뿐이라, MQM 모듈의 카탈로그도 그만큼만
 * 담고 있다. 그래서 레이아웃 규칙 셋만 `"layout"` 서브타입을 쓰고 나머지 규칙은 `subtype: null`
 * (= 차원만)로 둔다. `null`은 "분류 실패"가 아니라 "출처가 없어 지어내지 않음"이며, MQM 쪽
 * 입력 유니온이 서브타입과 차원을 동시에 주는 것을 타입으로 막는 것과 정확히 같은 이유다.
 *
 * 일부러 구현하지 않은 규칙(중요 — 재제안 방지)
 * ---------------------------------------------
 *  · **비속어(profanity)** — 1차 출처에 단어 목록이 없다. 목록을 지어내면 그 자체가 결함이다.
 *    (성인 등급 작품이 이 규칙을 정당하게 어긴다는 것이 규칙 토글이 필요한 이유이지만, 규칙
 *    자체는 목록이 생기기 전까지 존재하지 않는다.)
 *  · **"같은 소리가 실제로 반복될 때만 글자를 반복한다"** — `AAAAH`가 정당한지 아닌지는
 *    문자열만 보고 결정할 수 없다. 기계 판정 불가라 넣지 않았다.
 *  · **폰트 변경 금지 / 밑줄·취소선 금지 / 볼드=드라마·이탤릭=강조** — 이건 글자가 아니라
 *    요소 스타일 속성(fontStyle·textDecoration)의 문제다. 문자열 린터의 관할이 아니다.
 *  · **이름 로마자화(장한나 → Hanna Jang), 숫자 표기(1~9는 단어, 10+는 숫자)** — 둘 다 판정에
 *    **작품별 용어집**이 있어야 한다(이름은 특히). 용어집 강제 레이어가 생긴 뒤에 붙일 규칙이다.
 *  · **말줄임 `...`(ASCII 세 점)** — 기본은 **통과**다. 출처는 "정확히 세 점"을 요구하고 `…`를
 *    보여주지만 ASCII 세 점을 금지한다고 쓰지 않았다. `…` 글자를 강제하고 싶은 작품은
 *    `requireEllipsisCharacter: true`로 켠다.
 *  · **전각 물결표 `～`(U+FF5E)** — 출처는 `~`(U+007E)와 `〜`(U+301C) 두 형태만 나열한다.
 *    U+FF5E는 같은 기호의 또 다른 이형이지만 출처에 없어 **넣지 않았다**. 필요하면
 *    `KOREAN_CHAT_MARKS`에 추가하되 그때 출처를 함께 남길 것.
 *
 * 모래시계(hourglass) 규칙의 출처 모순 — 그대로 기록해 둔다
 * --------------------------------------------------------
 * 이번 세션에 전달된 출처 문장은 이렇다:
 *     "balloon text silhouette must be diamond/round, never hourglass
 *      (no middle line longer than both its neighbours)"
 * 괄호 안 문장과 도형 이름이 **서로 반대**다. 다이아몬드는 가운데가 가장 **긴** 모양이고,
 * 모래시계는 가운데가 **잘록한**(짧은) 모양이다. 즉 "다이아몬드는 되고 모래시계는 안 된다"면
 * 금지 대상은 "가운데 줄이 양옆보다 **짧은**" 경우다.
 * 이 모듈은 **도형 이름을 따른다**(가운데가 잘록한 경우를 잡는다). 괄호 문장을 조용히 고치지
 * 않고 여기 남기는 이유는, W3C 텍스트 확장표의 51–70 행(151–170%)이 단조성을 깨는 오타로
 * 보이지만 고치지 않고 기록만 하는 것과 같은 이유다 — 출처의 흠은 감추지 않는다.
 *
 * 순수성
 * ------
 * 전부 순수·결정적. DOM/Konva/브라우저 API 의존 없음. 입력은 절대 변형하지 않는다. 줄 폭
 * 측정이 필요한 실루엣 규칙은 측정기를 **호출부가 주입**한다(`measureLineWidth`) — 주입하지
 * 않으면 글자 수로 대체하며, 이는 `studio-bubble-text-fit.ts`의 `BubbleTextMeasurer` 포트와
 * 같은 관례다.
 *
 * §1. MQM 좌표계 — MQM 모듈 타입 재수출 + 발견의 좌표 모양
 * §2. 입력 모델 — 검사 단위(unit)와 텍스트 종류(kind)
 * §3. 규칙 카탈로그 — 토글 메타데이터(UI가 이걸 그대로 목록으로 그린다)
 * §4. 옵션·결과 모델
 * §5. 공용 스캐너 — 토큰/줄 오프셋
 * §6. 텍스트 규칙 구현
 * §7. 레이아웃(줄) 규칙 구현
 * §8. 엔트리포인트 + MQM 오류 변환기
 */

import type {
  StudioMqmDimensionId,
  StudioMqmErrorInput,
  StudioMqmSeverity,
  StudioMqmSubtypeId,
} from "./studio-localization-mqm";

// ── §1. MQM 좌표계 ────────────────────────────────────────────────────────────

/** 룰셋 버전 — 규칙을 추가/변경/삭제할 때마다 올린다(project-health 린터와 같은 관례). */
export const STUDIO_LOCALIZATION_STYLE_RULESET_VERSION = 1 as const;

/**
 * MQM 타이폴로지는 `studio-localization-mqm.ts`가 단일 소스다. 이 모듈은 **차원/서브타입 이름을
 * 스스로 정의하지 않는다** — 두 곳에 두면 갈라지고, 갈라지는 순간 이 린터의 발견은 점수 체계와
 * 다른 우주에 살게 된다. 여기서는 그 타입을 그대로 재수출해서 호출부가 import 두 번을 하지 않게
 * 해 줄 뿐이다.
 */
export type {
  StudioMqmDimensionId,
  StudioMqmSeverity,
  StudioMqmSubtypeId,
} from "./studio-localization-mqm";

/** 발견 하나가 MQM 표에서 차지하는 좌표. `subtype: null`은 "출처에 서브타입 이름이 없어 비워 둠". */
export interface StudioLocalizationMqmMapping {
  readonly dimension: StudioMqmDimensionId;
  readonly subtype: StudioMqmSubtypeId | null;
}

/**
 * 심각도는 MQM 심각도 그대로다(별칭). 가중치(Neutral 0 / Minor 1 / Major 5 / Critical 25)는
 * `STUDIO_MQM_SEVERITY_WEIGHTS`가 갖고 있고 점수 계산은 그쪽 일이다 — 여기서 곱하지 않는다.
 */
export type StudioLocalizationStyleSeverity = StudioMqmSeverity;

// ── §2. 입력 모델 ─────────────────────────────────────────────────────────────

/**
 * 검사 단위의 텍스트 종류.
 *  · `dialogue` — 말풍선/대사. ALLCAPS·문장부호 규칙의 대상.
 *  · `sfx`      — 효과음. 단어 형태 규칙의 대상이고 ALLCAPS/문장부호 규칙은 적용하지 않는다
 *                 (출처: "SFX가 말풍선에 홀로 있으면 구두점을 뗀다").
 *  · `in-art`   — 그림 안에 그려진 글자. 출처가 "in-art text stays mixed case"라고 명시하므로
 *                 **모든 규칙에서 제외**한다. 이 종류가 존재하는 이유가 그것이다 — 호출부가
 *                 페이지의 텍스트 요소를 걸러내지 않고 통째로 넘길 수 있게.
 */
export type StudioLocalizationTextKind = "dialogue" | "sfx" | "in-art";

/** 검사 단위 하나. `studio-dialogue-batch.DialogueBatchItem`에서 그대로 만들 수 있는 모양이다. */
export interface StudioLocalizationStyleUnit {
  /** 발견을 되짚을 식별자(대사 요소 id 등). */
  readonly id: string;
  /** 검사 대상 문자열(번역 결과). */
  readonly text: string;
  /** 기본값 `"dialogue"`. */
  readonly kind?: StudioLocalizationTextKind;
  /**
   * 조판된 줄들. 레이아웃 규칙(관사 뒤 줄바꿈·하이픈 앞 줄바꿈·실루엣)은 이게 있어야만 돈다.
   * 없으면 그 세 규칙은 **조용히 통과가 아니라 "미실행"**으로 집계된다(`skippedRuleCount`).
   */
  readonly lines?: readonly string[];
  /**
   * 대상 로케일. `en`으로 시작하지 않으면 이 단위는 통째로 건너뛴다 — 이 규칙표는 영문 대사
   * 전용이라, 프랑스어 대사에 ALLCAPS를 물리면 전량 오탐이 된다. 없으면 영문으로 본다
   * (호출부가 영문 린터를 명시적으로 돌린 것이므로).
   */
  readonly targetLocale?: string;
  /**
   * 이 SFX가 말풍선에 홀로 있는가. 기본 `true`. 출처의 "drop punctuation when the SFX is alone
   * in a bubble"이 이 조건부 규칙을 만든다 — 대사와 같은 풍선에 섞인 SFX는 대상이 아니다.
   */
  readonly aloneInBalloon?: boolean;
  /**
   * 1-based 페이지/컷 번호. 있으면 발견에 그대로 실어 `StudioMqmErrorInput`까지 흘려보낸다 —
   * 에피소드 보고서에서 발견을 되짚으려면 큐 id 만으로는 부족하다.
   * (`studio-dialogue-interchange.StudioDialogueCue`의 page/panel 과 같은 공간.)
   */
  readonly page?: number;
  readonly panel?: number;
}

// ── §3. 규칙 카탈로그 ─────────────────────────────────────────────────────────

export type StudioLocalizationStyleRuleId =
  | "allcaps-dialogue"
  | "ellipsis-three-dots"
  | "interrobang-order"
  | "punctuation-run-limit"
  | "banned-source-locale-mark"
  | "banned-dialogue-mark"
  | "sentence-final-punctuation"
  | "sfx-single-word"
  | "sfx-root-form"
  | "sfx-standalone-punctuation"
  | "line-break-after-article"
  | "line-break-before-hyphen"
  | "balloon-silhouette-hourglass";

export interface StudioLocalizationStyleRuleMeta {
  readonly id: StudioLocalizationStyleRuleId;
  /** 설정 UI에 그대로 쓰는 한글 라벨. */
  readonly label: string;
  /** 한 줄 설명(한글). */
  readonly summary: string;
  /**
   * 기본 심각도. **출처에 심각도는 없다** — 출처는 규칙만 준다. 아래 값들은 "독자가 페이지에서
   * 얼마나 바로 알아채는가"로 정한 이 저장소의 기본값이며, 옵션으로 작품마다 덮을 수 있다.
   * major를 준 둘(원문 로케일 기호 잔존, 하이픈 앞 줄바꿈)만 예외적으로 강한 이유는 각 규칙의
   * 구현부 주석에 적었다.
   */
  readonly defaultSeverity: StudioLocalizationStyleSeverity;
  /** 이 규칙이 도는 텍스트 종류. */
  readonly appliesTo: readonly StudioLocalizationTextKind[];
  /** `unit.lines`가 있어야만 도는가. */
  readonly requiresLayout: boolean;
  readonly mqm: StudioLocalizationMqmMapping;
}

const RULES: readonly StudioLocalizationStyleRuleMeta[] = Object.freeze([
  Object.freeze({
    id: "allcaps-dialogue",
    label: "대사 대문자",
    summary: "영문 대사는 전부 대문자. 그림 안 글자(in-art)는 예외다.",
    defaultSeverity: "minor",
    appliesTo: Object.freeze(["dialogue"] as const),
    requiresLayout: false,
    // 하우스 스타일 가이드 준수 문제 → Style. 하위유형 이름은 출처 미확인.
    mqm: Object.freeze({ dimension: "style", subtype: null } as const),
  }),
  Object.freeze({
    id: "ellipsis-three-dots",
    label: "말줄임표 세 점",
    summary: "말줄임표는 정확히 세 점. 두 점도 네 점도 안 된다.",
    defaultSeverity: "minor",
    appliesTo: Object.freeze(["dialogue", "sfx"] as const),
    requiresLayout: false,
    mqm: Object.freeze({
      dimension: "linguistic-conventions",
      subtype: null,
    } as const),
  }),
  Object.freeze({
    id: "interrobang-order",
    label: "물음표·느낌표 순서",
    summary: '"?!"만 쓴다. "!?"는 뒤집힌 형태다.',
    defaultSeverity: "minor",
    appliesTo: Object.freeze(["dialogue", "sfx"] as const),
    requiresLayout: false,
    mqm: Object.freeze({
      dimension: "linguistic-conventions",
      subtype: null,
    } as const),
  }),
  Object.freeze({
    id: "punctuation-run-limit",
    label: "물음표·느낌표 연속 개수",
    summary: "? 또는 ! 는 최대 세 개까지 연속할 수 있다.",
    defaultSeverity: "minor",
    appliesTo: Object.freeze(["dialogue", "sfx"] as const),
    requiresLayout: false,
    mqm: Object.freeze({
      dimension: "linguistic-conventions",
      subtype: null,
    } as const),
  }),
  Object.freeze({
    id: "banned-source-locale-mark",
    label: "원문 로케일 기호 잔존",
    summary: "영문 대사에 남은 CJK 구두점·물결표·한국어 채팅 기호(^^ ㅠㅠ).",
    // major 이유: `。`나 `ㅠㅠ`가 영문 대사에 그대로 남은 것은 독자가 한 번에 알아채는,
    // "번역을 덜 했다"는 신호다. 다른 구두점 규칙들과 같은 무게로 둘 수 없다.
    defaultSeverity: "major",
    appliesTo: Object.freeze(["dialogue", "sfx"] as const),
    requiresLayout: false,
    // 원문 로케일의 표기 관례가 대상 로케일에 남은 것 → Locale conventions.
    mqm: Object.freeze({
      dimension: "locale-conventions",
      subtype: null,
    } as const),
  }),
  Object.freeze({
    id: "banned-dialogue-mark",
    label: "대사 금지 문자",
    summary: "영문 대사에 쓰지 않는 문자( ; : < > 이모지 ).",
    defaultSeverity: "minor",
    appliesTo: Object.freeze(["dialogue", "sfx"] as const),
    requiresLayout: false,
    mqm: Object.freeze({ dimension: "style", subtype: null } as const),
  }),
  Object.freeze({
    id: "sentence-final-punctuation",
    label: "문장 끝 구두점",
    summary: "원문에 없어도 문장은 구두점으로 끝낸다.",
    defaultSeverity: "minor",
    appliesTo: Object.freeze(["dialogue"] as const),
    requiresLayout: false,
    mqm: Object.freeze({
      dimension: "linguistic-conventions",
      subtype: null,
    } as const),
  }),
  Object.freeze({
    id: "sfx-single-word",
    label: "효과음 한 단어",
    summary: "효과음은 한 단어다(LEAN IN 이 아니라 LEAN).",
    defaultSeverity: "minor",
    appliesTo: Object.freeze(["sfx"] as const),
    requiresLayout: false,
    mqm: Object.freeze({ dimension: "style", subtype: null } as const),
  }),
  Object.freeze({
    id: "sfx-root-form",
    label: "효과음 원형",
    summary: "효과음은 동사 원형이다(JUMPING 이 아니라 JUMP).",
    defaultSeverity: "minor",
    appliesTo: Object.freeze(["sfx"] as const),
    requiresLayout: false,
    mqm: Object.freeze({ dimension: "style", subtype: null } as const),
  }),
  Object.freeze({
    id: "sfx-standalone-punctuation",
    label: "단독 효과음 구두점",
    summary: "말풍선에 효과음만 있으면 끝 구두점을 뗀다.",
    defaultSeverity: "minor",
    appliesTo: Object.freeze(["sfx"] as const),
    requiresLayout: false,
    mqm: Object.freeze({ dimension: "style", subtype: null } as const),
  }),
  Object.freeze({
    id: "line-break-after-article",
    label: "관사 뒤 줄바꿈",
    summary: "a/an/the 바로 뒤에서 줄을 바꾸지 않는다.",
    defaultSeverity: "minor",
    appliesTo: Object.freeze(["dialogue", "sfx"] as const),
    requiresLayout: true,
    // 줄바꿈 위치 = 조판 배치 문제 → Design and markup > Layout(출처에 이름이 실린 하위유형).
    mqm: Object.freeze({
      dimension: "design-and-markup",
      subtype: "layout",
    } as const),
  }),
  Object.freeze({
    id: "line-break-before-hyphen",
    label: "하이픈 앞 줄바꿈",
    summary: "하이픈은 앞줄에 남긴다 — 하이픈으로 시작하는 줄은 잘못된 분철이다.",
    // major 이유: 다음 줄이 `-DESTRUCT`로 시작하면 독자는 그 하이픈을 대시(말끊김)로 읽는다.
    // 즉 조판 흠이 아니라 **의미가 바뀌는** 결함이다.
    defaultSeverity: "major",
    appliesTo: Object.freeze(["dialogue", "sfx"] as const),
    requiresLayout: true,
    mqm: Object.freeze({
      dimension: "design-and-markup",
      subtype: "layout",
    } as const),
  }),
  Object.freeze({
    id: "balloon-silhouette-hourglass",
    label: "말풍선 실루엣(모래시계)",
    summary: "가운데 줄이 위아래보다 짧으면 모래시계 실루엣이 된다.",
    defaultSeverity: "minor",
    appliesTo: Object.freeze(["dialogue", "sfx"] as const),
    requiresLayout: true,
    mqm: Object.freeze({
      dimension: "design-and-markup",
      subtype: "layout",
    } as const),
  }),
] as const);

/** 규칙 카탈로그 — 설정 UI가 이 배열을 그대로 체크박스 목록으로 그린다. 순서 = 보고 순서. */
export const STUDIO_LOCALIZATION_STYLE_RULES: readonly StudioLocalizationStyleRuleMeta[] = RULES;

const RULE_BY_ID: ReadonlyMap<StudioLocalizationStyleRuleId, StudioLocalizationStyleRuleMeta> =
  new Map(RULES.map((rule) => [rule.id, rule]));

// ── §4. 옵션·결과 모델 ────────────────────────────────────────────────────────

/** 규칙 하나의 설정. `false`/`true`는 켬끔만, 객체는 심각도까지 덮는다. */
export type StudioLocalizationStyleRuleSetting =
  | boolean
  | {
      readonly enabled?: boolean;
      readonly severity?: StudioLocalizationStyleSeverity;
    };

export interface StudioLocalizationStyleLintOptions {
  /**
   * 규칙별 켬끔·심각도. 지정하지 않은 규칙은 켜진 상태에 카탈로그 기본 심각도를 쓴다.
   * 성인 등급 작품이 특정 규칙을 정당하게 어기거나, 작품이 Blambot 외국어 꺾쇠 관례를 쓰는
   * 경우가 이 옵션의 존재 이유다.
   */
  readonly rules?: Partial<
    Record<StudioLocalizationStyleRuleId, StudioLocalizationStyleRuleSetting>
  >;
  /**
   * 금지 문자에서 빼 줄 글자들. 예: Blambot 관례대로 외국어 대사를 꺾쇠로 감싸는 작품은
   * `["<", ">"]`를 넘긴다. 규칙 전체를 끄면 `;` `:` 검사까지 같이 꺼지므로 이 옵션이 따로 있다.
   */
  readonly allowCharacters?: readonly string[];
  /**
   * `true`면 ASCII 세 점(`...`)도 `…`로 바꾸라고 지적한다. 기본 `false` — 출처는 "정확히 세 점"만
   * 요구하고 ASCII 형태를 금지하지 않는다.
   */
  readonly requireEllipsisCharacter?: boolean;
  /**
   * 실루엣 규칙이 쓸 줄 폭 측정기. 주입하지 않으면 `line.trim().length`(글자 수)로 대체한다.
   * 하우스 관례(`studio-bubble-text-fit.BubbleTextMeasurer`)와 같은 이유로 포트로 뺐다 —
   * 실제 화면은 px 폭이 맞고, 테스트는 글자 수로 결정적이어야 한다.
   */
  readonly measureLineWidth?: (line: string) => number;
  /**
   * 실루엣 잘록함 허용치(측정 단위 그대로). 기본 0 = 한 단위라도 잘록하면 지적.
   * px 측정기를 주입한 호출부는 여기에 "이 정도 잘록함은 눈에 안 띈다"는 값을 준다.
   */
  readonly silhouetteTolerance?: number;
}

/** 오프셋의 기준 문자열. `"lines"`는 `unit.lines.join("\n")` 기준이다(원문 text 기준이 아니다). */
export type StudioLocalizationStyleSpanBasis = "text" | "lines";

export interface StudioLocalizationStyleFinding {
  readonly ruleId: StudioLocalizationStyleRuleId;
  readonly severity: StudioLocalizationStyleSeverity;
  /** 어느 단위에서 나왔는가(`StudioLocalizationStyleUnit.id`). */
  readonly unitId: string;
  /**
   * 오프셋 기준. 조판 결과(`lines`)는 원문 `text`에서 기계적으로 유도할 수 없으므로(하드랩이
   * 들어간다) 레이아웃 규칙의 오프셋은 `lines.join("\n")` 기준이다. 이 필드가 없으면 호출부가
   * 두 좌표계를 조용히 섞는다.
   */
  readonly spanBasis: StudioLocalizationStyleSpanBasis;
  /** 기준 문자열에서의 시작 오프셋(포함). */
  readonly start: number;
  /** 기준 문자열에서의 끝 오프셋(제외). */
  readonly end: number;
  /** 레이아웃 규칙만 채운다 — 몇 번째 줄인가(0-based). */
  readonly line: number | null;
  /** 지적된 실제 문자열(하이라이트/보고서용). */
  readonly excerpt: string;
  /** 사람이 읽는 한글 메시지. */
  readonly message: string;
  /** 고칠 방향(있을 때만). */
  readonly suggestion: string | null;
  /** 단위가 알려 준 1-based 페이지/컷 번호. 없으면 null. */
  readonly page: number | null;
  readonly panel: number | null;
  readonly mqm: StudioLocalizationMqmMapping;
}

export interface StudioLocalizationStyleLintResult {
  readonly basis: "webtoon-en-lettering-guide";
  readonly rulesetVersion: typeof STUDIO_LOCALIZATION_STYLE_RULESET_VERSION;
  /** 실제로 한 번이라도 실행된 규칙 수(켜져 있고, 적용 가능한 단위가 있었던 규칙). */
  readonly checkedRuleCount: number;
  /** 실행됐고 발견이 하나도 없던 규칙 수. */
  readonly passedRuleCount: number;
  /** 꺼져 있거나 적용 가능한 단위가 없어 한 번도 실행되지 않은 규칙 수. */
  readonly skippedRuleCount: number;
  /** 로케일이 영문이 아니어서 통째로 건너뛴 단위 수. */
  readonly skippedUnitCount: number;
  readonly counts: Readonly<Record<StudioLocalizationStyleSeverity, number>>;
  /** 문서 순서(단위 순 → 카탈로그 순 → 오프셋 순). 심각도로 정렬하지 않는다 — 편집자는 본문
   *  순서로 훑는다. 심각도 정렬이 필요한 화면은 이 배열을 복사해서 정렬하면 된다. */
  readonly findings: readonly StudioLocalizationStyleFinding[];
}

// ── §5. 공용 스캐너 ───────────────────────────────────────────────────────────

/** 규칙 구현이 돌려주는 원시 발견. `ruleId`/심각도/MQM 좌표는 엔트리포인트가 카탈로그에서 붙인다. */
interface RawFinding {
  readonly ruleId: StudioLocalizationStyleRuleId;
  readonly basis: StudioLocalizationStyleSpanBasis;
  readonly start: number;
  readonly end: number;
  readonly line: number | null;
  readonly excerpt: string;
  readonly message: string;
  readonly suggestion: string | null;
}

interface Token {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const WHITESPACE_RUN = /\S+/gu;

/** 공백으로 나눈 토큰과 그 오프셋. `matchAll`은 원본 정규식의 lastIndex를 건드리지 않는다. */
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const match of text.matchAll(WHITESPACE_RUN)) {
    const start = match.index ?? 0;
    out.push({ text: match[0], start, end: start + match[0].length });
  }
  return out;
}

/** `lines.join("\n")` 기준으로 각 줄이 시작하는 오프셋. */
function lineStartOffsets(lines: readonly string[]): number[] {
  const out: number[] = [];
  let cursor = 0;
  for (const line of lines) {
    out.push(cursor);
    cursor += line.length + 1; // +1 = 조인에 쓰인 "\n"
  }
  return out;
}

/** 앞뒤의 문자(letter)가 아닌 글자를 떼어 낸 토큰. 오프셋은 원본 기준을 유지한다. */
function trimToLetters(token: Token): Token | null {
  const leading = /^[^\p{L}]+/u.exec(token.text);
  const trailing = /[^\p{L}]+$/u.exec(token.text);
  const start = token.start + (leading ? leading[0].length : 0);
  const end = token.end - (trailing ? trailing[0].length : 0);
  if (end <= start) return null;
  return {
    text: token.text.slice(start - token.start, end - token.start),
    start,
    end,
  };
}

// ── §6. 텍스트 규칙 구현 ──────────────────────────────────────────────────────

/**
 * 소문자 연속 구간. `\p{Ll}`을 쓰는 이유: 대소문자가 없는 문자(한글·CJK·숫자·구두점)는 정의상
 * 걸리지 않으므로 한영 혼재 문자열에서도 오탐이 없고, `café` 같은 라틴 확장 소문자도 잡는다.
 */
const LOWERCASE_RUN = /\p{Ll}+/gu;

/** 출처: "dialogue is ALLCAPS; in-art text stays mixed case". */
function ruleAllcapsDialogue(text: string): readonly Omit<RawFinding, "ruleId">[] {
  const out: Omit<RawFinding, "ruleId">[] = [];
  for (const match of text.matchAll(LOWERCASE_RUN)) {
    const start = match.index ?? 0;
    out.push({
      basis: "text",
      start,
      end: start + match[0].length,
      line: null,
      excerpt: match[0],
      message: `영문 대사는 대문자로 씁니다. "${match[0]}"가 소문자입니다.`,
      suggestion: match[0].toUpperCase(),
    });
  }
  return out;
}

/** 말줄임표 후보 = 마침표/말줄임표 글자의 연속 구간. */
const DOT_RUN = /[.…]+/gu;
/** 출처: "ellipsis is exactly three dots (…); never two, never four". */
const ELLIPSIS_DOT_COUNT = 3;

function ruleEllipsisThreeDots(
  text: string,
  requireEllipsisCharacter: boolean,
): readonly Omit<RawFinding, "ruleId">[] {
  const out: Omit<RawFinding, "ruleId">[] = [];
  for (const match of text.matchAll(DOT_RUN)) {
    const run = match[0];
    const start = match.index ?? 0;
    // 홑 마침표는 문장 끝이지 말줄임표가 아니다. (`MR. KIM`도 여기서 걸러진다.)
    if (run === ".") continue;
    let dots = 0;
    for (const ch of run) dots += ch === "…" ? ELLIPSIS_DOT_COUNT : 1;
    if (dots === ELLIPSIS_DOT_COUNT) {
      if (!requireEllipsisCharacter || run === "…") continue;
      out.push({
        basis: "text",
        start,
        end: start + run.length,
        line: null,
        excerpt: run,
        message: '말줄임표는 "…" 한 글자로 씁니다.',
        suggestion: "…",
      });
      continue;
    }
    out.push({
      basis: "text",
      start,
      end: start + run.length,
      line: null,
      excerpt: run,
      message: `말줄임표는 점 ${ELLIPSIS_DOT_COUNT}개입니다. 여기는 ${dots}개입니다.`,
      suggestion: "…",
    });
  }
  return out;
}

/** 출처: '"?!" never "!?"'. `!?!`처럼 겹쳐 나와도 `!?` 부분마다 한 번씩 잡힌다. */
const REVERSED_INTERROBANG = /!\?/gu;

function ruleInterrobangOrder(text: string): readonly Omit<RawFinding, "ruleId">[] {
  const out: Omit<RawFinding, "ruleId">[] = [];
  for (const match of text.matchAll(REVERSED_INTERROBANG)) {
    const start = match.index ?? 0;
    out.push({
      basis: "text",
      start,
      end: start + match[0].length,
      line: null,
      excerpt: match[0],
      message: '"!?"는 뒤집힌 형태입니다. "?!"로 씁니다.',
      suggestion: "?!",
    });
  }
  return out;
}

/** 출처: "at most 3 consecutive ? or !". */
const MAX_TERMINAL_PUNCTUATION_RUN = 3;
const LONG_PUNCTUATION_RUN = /[?!]{4,}/gu;

function rulePunctuationRunLimit(text: string): readonly Omit<RawFinding, "ruleId">[] {
  const out: Omit<RawFinding, "ruleId">[] = [];
  for (const match of text.matchAll(LONG_PUNCTUATION_RUN)) {
    const start = match.index ?? 0;
    out.push({
      basis: "text",
      start,
      end: start + match[0].length,
      line: null,
      excerpt: match[0],
      message: `? 와 ! 는 최대 ${MAX_TERMINAL_PUNCTUATION_RUN}개까지 연속할 수 있습니다. 여기는 ${match[0].length}개입니다.`,
      suggestion: match[0].slice(0, MAX_TERMINAL_PUNCTUATION_RUN),
    });
  }
  return out;
}

/**
 * 출처의 금지 문자 중 **원문 로케일에서 넘어온 표기**만 모은 것:
 * CJK 구두점 `、。「」『』`, 물결표 `〜`(U+301C)와 `~`(U+007E), 한국어 채팅 기호 `^^`·`ㅠㅠ`.
 *
 * 전각 물결표 `～`(U+FF5E)는 **일부러 뺐다** — 출처가 두 형태만 나열한다(파일 상단 "일부러
 * 구현하지 않은 규칙" 참고). `ㅜㅜ`도 같은 이유로 없다.
 */
const KOREAN_CHAT_MARKS = /[、。「」『』〜~]|\^{2,}|ㅠ{2,}/gu;

function ruleBannedSourceLocaleMark(
  text: string,
  allowed: ReadonlySet<string>,
): readonly Omit<RawFinding, "ruleId">[] {
  const out: Omit<RawFinding, "ruleId">[] = [];
  for (const match of text.matchAll(KOREAN_CHAT_MARKS)) {
    if (isFullyAllowed(match[0], allowed)) continue;
    const start = match.index ?? 0;
    out.push({
      basis: "text",
      start,
      end: start + match[0].length,
      line: null,
      excerpt: match[0],
      message: `영문 대사에 원문 표기 "${match[0]}"가 남아 있습니다.`,
      suggestion: null,
    });
  }
  return out;
}

/**
 * 출처의 금지 문자 중 **영문 대사 자체의 금지 기호**: `;` `:` `<` `>` 와 이모지.
 *
 * 이모지 판정은 `\p{Emoji_Presentation}`(기본 이모지 표시) 또는 `Extended_Pictographic + VS16`
 * 로 잡고 ZWJ 결합 시퀀스를 하나로 묶는다. `\p{Extended_Pictographic}` 단독으로 잡으면
 * `™` `©` `‼` 같은 텍스트 표시 기본 문자까지 "이모지"로 지적하게 되어 오탐이 난다.
 *
 * VS16(U+FE0F)과 ZWJ(U+200D)는 **반드시 `\u` 이스케이프로** 적는다 — 소스에 그대로 넣으면
 * 보이지 않는 글자가 되어 다음 사람이 지웠는지 아닌지도 알 수 없다.
 */
const BANNED_DIALOGUE_MARK =
  /[;:<>]|(?:(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F))*)+/gu;

const ASCII_DIGIT = /[0-9]/u;

function ruleBannedDialogueMark(
  text: string,
  allowed: ReadonlySet<string>,
): readonly Omit<RawFinding, "ruleId">[] {
  const out: Omit<RawFinding, "ruleId">[] = [];
  for (const match of text.matchAll(BANNED_DIALOGUE_MARK)) {
    const hit = match[0];
    if (isFullyAllowed(hit, allowed)) continue;
    const start = match.index ?? 0;
    // 시계 표기 예외: 같은 가이드가 "12-hour clock"으로 시각을 쓰라고 하므로 `3:30`의 콜론까지
    // 금지하면 두 규칙이 서로를 부순다. 숫자 사이의 콜론만 통과시킨다.
    if (
      hit === ":" &&
      ASCII_DIGIT.test(text.charAt(start - 1)) &&
      ASCII_DIGIT.test(text.charAt(start + 1))
    ) {
      continue;
    }
    out.push({
      basis: "text",
      start,
      end: start + hit.length,
      line: null,
      excerpt: hit,
      message: `영문 대사에 "${hit}"는 쓰지 않습니다.`,
      suggestion: null,
    });
  }
  return out;
}

function isFullyAllowed(hit: string, allowed: ReadonlySet<string>): boolean {
  if (allowed.size === 0) return false;
  for (const ch of hit) {
    if (!allowed.has(ch)) return false;
  }
  return true;
}

/** 문장 끝으로 인정되는 구두점. */
const SENTENCE_TERMINALS = /[.?!…]$/u;
/** 구두점 뒤에 올 수 있는 닫는 기호 — 벗겨 내고 판정한다. */
const TRAILING_CLOSERS = /[)\]}"'”’»]+$/u;
/** Blambot 관례: 말이 끊길 때는 이중대시(또는 대시). 여운은 3점 말줄임. 둘 다 문장 끝으로 본다. */
const INTERRUPTION_DASH = /(?:--|—|–)$/u;
const TRAILING_SPACE = /\s+$/u;
const LAST_TOKEN = /(\S+)\s*$/u;

/** 출처: "every sentence is punctuated even when the source is not". */
function ruleSentenceFinalPunctuation(text: string): readonly Omit<RawFinding, "ruleId">[] {
  const trimmed = text.replace(TRAILING_SPACE, "");
  if (trimmed.length === 0) return [];
  const stripped = trimmed.replace(TRAILING_CLOSERS, "");
  if (stripped.length === 0) return [];
  if (SENTENCE_TERMINALS.test(stripped)) return [];
  if (INTERRUPTION_DASH.test(stripped)) return [];
  const last = LAST_TOKEN.exec(trimmed);
  if (!last) return [];
  const start = trimmed.length - last[1].length;
  return [
    {
      basis: "text",
      start,
      end: trimmed.length,
      line: null,
      excerpt: last[1],
      message: "문장이 구두점 없이 끝납니다. 원문에 없어도 영문 대사는 구두점을 찍습니다.",
      suggestion: `${last[1]}.`,
    },
  ];
}

/** 출처: "SFX is one word in root verb form (LEAN not LEAN IN…)". */
function ruleSfxSingleWord(text: string): readonly Omit<RawFinding, "ruleId">[] {
  const tokens = tokenize(text);
  if (tokens.length < 2) return [];
  const start = tokens[0].start;
  const end = tokens[tokens.length - 1].end;
  return [
    {
      basis: "text",
      start,
      end,
      line: null,
      excerpt: text.slice(start, end),
      message: `효과음은 한 단어로 씁니다. 여기는 ${tokens.length}단어입니다.`,
      suggestion: tokens[0].text,
    },
  ];
}

/**
 * 출처: "SFX is one word in **root verb form** (… JUMP not JUMPING)".
 *
 * 기계 판정은 `-ING`/`-ED` 접미사만 본다. 어간이 3자 이상이고 **모음을 포함할 때만** 지적하는데,
 * 이 가드가 없으면 자음군 어간의 정당한 효과음(`SHRED`→`SHR`, `SPED`→`SP`, `CLING`→`CL`,
 * `STING`→`ST`, `SWING`→`SW`)을 전부 오탐한다.
 *
 * 알려진 오탐(가드로도 안 걸러지는 것): `KACHING`(어간 `KACH`), `SPEED`(어간 `SPE`).
 * 휴리스틱이므로 작품 단위로 이 규칙만 끌 수 있게 해 뒀다. 어미 목록을 `-S`까지 넓히지 않은
 * 이유도 같다 — `HISS`·`BUZZ`류가 전부 걸린다.
 */
const SFX_MIN_STEM_LENGTH = 3;
const STEM_VOWEL = /[AEIOUY]/u;
const SFX_INFLECTIONS: readonly {
  readonly suffix: string;
  readonly label: string;
}[] = Object.freeze([
  Object.freeze({ suffix: "ING", label: "-ing" }),
  Object.freeze({ suffix: "ED", label: "-ed" }),
]);

function ruleSfxRootForm(text: string): readonly Omit<RawFinding, "ruleId">[] {
  const out: Omit<RawFinding, "ruleId">[] = [];
  for (const raw of tokenize(text)) {
    const token = trimToLetters(raw);
    if (!token) continue;
    const upper = token.text.toUpperCase();
    for (const { suffix, label } of SFX_INFLECTIONS) {
      if (!upper.endsWith(suffix)) continue;
      const stem = upper.slice(0, upper.length - suffix.length);
      if (stem.length < SFX_MIN_STEM_LENGTH) break;
      if (!STEM_VOWEL.test(stem)) break;
      out.push({
        basis: "text",
        start: token.start,
        end: token.end,
        line: null,
        excerpt: token.text,
        message: `효과음은 동사 원형으로 씁니다. "${token.text}"는 ${label} 형태입니다.`,
        suggestion: stem,
      });
      break;
    }
  }
  return out;
}

const TRAILING_TERMINALS = /[.?!…]+$/u;

/** 출처: "drop punctuation when the SFX is alone in a bubble". */
function ruleSfxStandalonePunctuation(text: string): readonly Omit<RawFinding, "ruleId">[] {
  const trimmed = text.replace(TRAILING_SPACE, "");
  const match = TRAILING_TERMINALS.exec(trimmed);
  if (!match) return [];
  const start = trimmed.length - match[0].length;
  return [
    {
      basis: "text",
      start,
      end: trimmed.length,
      line: null,
      excerpt: match[0],
      message: `말풍선에 효과음만 있을 때는 끝 구두점 "${match[0]}"를 뗍니다.`,
      suggestion: trimmed.slice(0, start),
    },
  ];
}

// ── §7. 레이아웃(줄) 규칙 구현 ────────────────────────────────────────────────

/** 출처: "never break right after a/an/the". */
const ARTICLES: ReadonlySet<string> = new Set(["A", "AN", "THE"]);

function ruleLineBreakAfterArticle(
  lines: readonly string[],
): readonly Omit<RawFinding, "ruleId">[] {
  if (lines.length < 2) return [];
  const offsets = lineStartOffsets(lines);
  const out: Omit<RawFinding, "ruleId">[] = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    const tokens = tokenize(lines[i]);
    if (tokens.length === 0) continue;
    const token = trimToLetters(tokens[tokens.length - 1]);
    if (!token) continue;
    if (!ARTICLES.has(token.text.toUpperCase())) continue;
    out.push({
      basis: "lines",
      start: offsets[i] + token.start,
      end: offsets[i] + token.end,
      line: i,
      excerpt: token.text,
      message: `관사 "${token.text}" 바로 뒤에서 줄을 바꾸지 않습니다. 다음 낱말과 같은 줄에 둡니다.`,
      suggestion: null,
    });
  }
  return out;
}

/**
 * 출처: "break after a hyphen" — 즉 하이픈은 **앞줄 끝**에 남는다. 따라서 위반은 "하이픈으로
 * **시작하는** 줄"이다.
 *
 * 이중대시로 시작하는 줄(`--NO!`)은 Blambot 말끊김 표기라 제외하고, 앞줄이 글자/숫자로 끝날
 * 때만 잡는다(앞줄이 구두점으로 끝났다면 그 하이픈은 분철이 아니라 새 호흡의 대시다).
 */
const HYPHEN_LINE_START = /^-(?!-)[\p{L}\p{N}]/u;
const ALPHANUMERIC_LINE_END = /[\p{L}\p{N}]$/u;
const LEADING_SPACE = /^\s*/u;

function ruleLineBreakBeforeHyphen(
  lines: readonly string[],
): readonly Omit<RawFinding, "ruleId">[] {
  if (lines.length < 2) return [];
  const offsets = lineStartOffsets(lines);
  const out: Omit<RawFinding, "ruleId">[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    // 앞 공백을 건너뛰고 본다. 조판된 줄은 보통 공백으로 시작하지 않지만, 호출부가 저자가 친
    // 문자열을 그대로 `split("\n")`해서 넘기는 경로가 있어 여기서 흡수한다.
    const indent = (LEADING_SPACE.exec(lines[i]) ?? [""])[0].length;
    const line = lines[i].slice(indent);
    if (!HYPHEN_LINE_START.test(line)) continue;
    if (!ALPHANUMERIC_LINE_END.test(lines[i - 1].replace(TRAILING_SPACE, ""))) continue;
    out.push({
      basis: "lines",
      start: offsets[i] + indent,
      end: offsets[i] + indent + 1,
      line: i,
      excerpt: "-",
      message: "하이픈은 앞줄 끝에 남깁니다. 하이픈으로 시작하는 줄은 대시(말끊김)로 읽힙니다.",
      suggestion: null,
    });
  }
  return out;
}

/**
 * 출처: "balloon text silhouette must be diamond/round, never hourglass".
 * 모래시계 = 가운데가 잘록한 모양이므로, **양옆보다 짧은 가운데 줄**을 잡는다.
 * (출처 괄호 문장이 도형 이름과 반대인 건 파일 상단에 그대로 기록해 뒀다.)
 */
function ruleBalloonSilhouetteHourglass(
  lines: readonly string[],
  measure: (line: string) => number,
  tolerance: number,
): readonly Omit<RawFinding, "ruleId">[] {
  if (lines.length < 3) return [];
  const offsets = lineStartOffsets(lines);
  const widths = lines.map((line) => measure(line));
  const out: Omit<RawFinding, "ruleId">[] = [];
  for (let i = 1; i < lines.length - 1; i += 1) {
    const narrowestNeighbour = Math.min(widths[i - 1], widths[i + 1]);
    if (widths[i] + tolerance >= narrowestNeighbour) continue;
    out.push({
      basis: "lines",
      start: offsets[i],
      end: offsets[i] + lines[i].length,
      line: i,
      excerpt: lines[i],
      message: `${i + 1}번째 줄이 위아래 줄보다 짧아 모래시계 실루엣이 됩니다. 가운데를 넓히거나 줄바꿈 위치를 옮기세요.`,
      suggestion: null,
    });
  }
  return out;
}

// ── §8. 엔트리포인트 ──────────────────────────────────────────────────────────

const ENGLISH_LOCALE = /^en(?:[-_].*)?$/iu;

/** 대상 로케일이 영문 계열인가. 값이 없으면 영문으로 본다(호출부가 영문 린터를 돌린 것이므로). */
export function isEnglishLocalizationTarget(locale: string | undefined): boolean {
  if (locale === undefined) return true;
  const trimmed = locale.trim();
  if (trimmed.length === 0) return true;
  return ENGLISH_LOCALE.test(trimmed);
}

function resolveSetting(
  meta: StudioLocalizationStyleRuleMeta,
  options: StudioLocalizationStyleLintOptions | undefined,
): { enabled: boolean; severity: StudioLocalizationStyleSeverity } {
  const setting = options?.rules?.[meta.id];
  if (setting === undefined) return { enabled: true, severity: meta.defaultSeverity };
  if (typeof setting === "boolean") return { enabled: setting, severity: meta.defaultSeverity };
  return {
    enabled: setting.enabled ?? true,
    severity: setting.severity ?? meta.defaultSeverity,
  };
}

/** 1-based 페이지/컷 번호 정규화. 0·음수·비유한값은 "모름"(null)으로 떨어뜨린다. */
function normalizeUnitNumber(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value)) return null;
  const floored = Math.floor(value);
  return floored > 0 ? floored : null;
}

function defaultLineWidth(line: string): number {
  return line.trim().length;
}

function runRule(
  meta: StudioLocalizationStyleRuleMeta,
  unit: StudioLocalizationStyleUnit,
  options: StudioLocalizationStyleLintOptions | undefined,
  allowed: ReadonlySet<string>,
): readonly Omit<RawFinding, "ruleId">[] {
  const lines = unit.lines ?? [];
  switch (meta.id) {
    case "allcaps-dialogue":
      return ruleAllcapsDialogue(unit.text);
    case "ellipsis-three-dots":
      return ruleEllipsisThreeDots(unit.text, options?.requireEllipsisCharacter === true);
    case "interrobang-order":
      return ruleInterrobangOrder(unit.text);
    case "punctuation-run-limit":
      return rulePunctuationRunLimit(unit.text);
    case "banned-source-locale-mark":
      return ruleBannedSourceLocaleMark(unit.text, allowed);
    case "banned-dialogue-mark":
      return ruleBannedDialogueMark(unit.text, allowed);
    case "sentence-final-punctuation":
      return ruleSentenceFinalPunctuation(unit.text);
    case "sfx-single-word":
      return ruleSfxSingleWord(unit.text);
    case "sfx-root-form":
      return ruleSfxRootForm(unit.text);
    case "sfx-standalone-punctuation":
      // 다른 대사와 같은 풍선에 섞인 효과음은 이 규칙의 대상이 아니다(출처의 "alone in a bubble").
      return unit.aloneInBalloon === false ? [] : ruleSfxStandalonePunctuation(unit.text);
    case "line-break-after-article":
      return ruleLineBreakAfterArticle(lines);
    case "line-break-before-hyphen":
      return ruleLineBreakBeforeHyphen(lines);
    case "balloon-silhouette-hourglass":
      return ruleBalloonSilhouetteHourglass(
        lines,
        options?.measureLineWidth ?? defaultLineWidth,
        options?.silhouetteTolerance ?? 0,
      );
  }
}

/**
 * 영문 대사 문체 린트.
 *
 * 순수·결정적이다. 입력은 읽기만 하고, 발견은 **문서 순서**(단위 순 → 카탈로그 순 → 오프셋 순)
 * 로 나온다. 로케일이 영문이 아닌 단위, `in-art` 종류, 빈 문자열은 규칙을 돌리지 않는다.
 */
export function lintStudioLocalizationStyle(
  units: readonly StudioLocalizationStyleUnit[],
  options?: StudioLocalizationStyleLintOptions,
): StudioLocalizationStyleLintResult {
  const allowed: ReadonlySet<string> = new Set(
    (options?.allowCharacters ?? []).flatMap((entry) => Array.from(entry)),
  );
  const findings: StudioLocalizationStyleFinding[] = [];
  const ranRules = new Set<StudioLocalizationStyleRuleId>();
  const firedRules = new Set<StudioLocalizationStyleRuleId>();
  let skippedUnitCount = 0;

  for (const unit of units) {
    if (!isEnglishLocalizationTarget(unit.targetLocale)) {
      skippedUnitCount += 1;
      continue;
    }
    const kind = unit.kind ?? "dialogue";
    if (kind === "in-art") continue;
    const hasText = unit.text.trim().length > 0;
    const hasLines = (unit.lines?.length ?? 0) > 0;

    for (const meta of RULES) {
      const { enabled, severity } = resolveSetting(meta, options);
      if (!enabled) continue;
      if (!meta.appliesTo.includes(kind)) continue;
      if (meta.requiresLayout ? !hasLines : !hasText) continue;
      ranRules.add(meta.id);

      for (const raw of runRule(meta, unit, options, allowed)) {
        firedRules.add(meta.id);
        findings.push(
          Object.freeze({
            ruleId: meta.id,
            severity,
            unitId: unit.id,
            spanBasis: raw.basis,
            start: raw.start,
            end: raw.end,
            line: raw.line,
            excerpt: raw.excerpt,
            message: raw.message,
            suggestion: raw.suggestion,
            page: normalizeUnitNumber(unit.page),
            panel: normalizeUnitNumber(unit.panel),
            mqm: meta.mqm,
          }),
        );
      }
    }
  }

  const counts: Record<StudioLocalizationStyleSeverity, number> = {
    neutral: 0,
    minor: 0,
    major: 0,
    critical: 0,
  };
  for (const finding of findings) counts[finding.severity] += 1;

  return Object.freeze({
    basis: "webtoon-en-lettering-guide",
    rulesetVersion: STUDIO_LOCALIZATION_STYLE_RULESET_VERSION,
    checkedRuleCount: ranRules.size,
    passedRuleCount: ranRules.size - firedRules.size,
    skippedRuleCount: RULES.length - ranRules.size,
    skippedUnitCount,
    counts: Object.freeze(counts),
    findings: Object.freeze(findings),
  });
}

/**
 * 발견 하나를 `studio-localization-mqm.scoreStudioMqmErrors`가 그대로 먹을 수 있는 오류 입력으로
 * 바꾼다. **이 함수가 이 모듈의 존재 이유 절반이다** — 이게 없으면 린터 결과는 점수에 합류하지
 * 못하고 별도 화면에만 남는다.
 *
 * MQM 쪽 입력 유니온은 서브타입과 차원을 **동시에 주는 것을 타입으로 막는다**(둘이 어긋나면
 * 어느 쪽이 참인지 정할 수 없으므로). 그래서 서브타입이 있으면 서브타입만 주고 차원은 그쪽
 * 카탈로그가 유도하게 두고, 없으면 차원만 준다.
 *
 * `typeWeight`(ETW)는 주지 않는다 — 규칙별 유형 가중치는 작품/벤더 계약의 값이지 린터가 정할
 * 값이 아니다. 필요하면 호출부가 반환값에 얹는다.
 */
export function studioLocalizationStyleFindingToMqmError(
  finding: StudioLocalizationStyleFinding,
): StudioMqmErrorInput {
  const base = {
    id: `${finding.unitId}:${finding.ruleId}:${finding.start}`,
    severity: finding.severity,
    cueId: finding.unitId,
    page: finding.page ?? undefined,
    panel: finding.panel ?? undefined,
    note: finding.message,
    evidence: Object.freeze({
      ruleId: finding.ruleId,
      spanBasis: finding.spanBasis,
      start: finding.start,
      end: finding.end,
      excerpt: finding.excerpt,
    }),
  } as const;
  return finding.mqm.subtype !== null
    ? { ...base, subtype: finding.mqm.subtype }
    : { ...base, dimension: finding.mqm.dimension };
}

/** 규칙 하나의 메타데이터. 설정 UI가 라벨/기본 심각도를 물어볼 때 쓴다. */
export function studioLocalizationStyleRule(
  id: StudioLocalizationStyleRuleId,
): StudioLocalizationStyleRuleMeta | undefined {
  return RULE_BY_ID.get(id);
}
