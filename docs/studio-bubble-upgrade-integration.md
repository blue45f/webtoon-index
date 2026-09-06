# 말풍선 3종 고도화 — StudioPage.tsx 통합 설계

> 이 문서만 작성 대상이다 — **StudioPage.tsx / studio-bubble-style-presets.ts /
> StudioBubbleStylePresetPanel.tsx는 이 세션에서 수정하지 않았다.** 순수 로직/테스트/프레젠테이션
> **신규** 파일만 실제로 만들었고(§0, 이미 tsc/eslint/vitest 클린 통과), 나머지는 후속 통합 패스가
> 정확히 어디에 무엇을 넣어야 하는지에 대한 지시서다.
>
> 라인 번호는 **커밋 `1dcd7b6819ad708564b93ae75f124d53a41bd478` 기준**. `StudioPage.tsx` 자체는
> 그보다 앞선 `6285df150aea7ddbb52855686c3e0f8c2f06b06c`에서 마지막으로 바뀌었다(그 사이 커밋들은
> 다른 파일만 건드림) — 이 저장소는 병렬 세션이 `StudioPage.tsx`를 동시에 건드릴 수 있어 통합 시점엔
> 라인이 밀렸을 수 있다. **각 절의 "앵커 텍스트"로 실제 위치를 다시 찾아라, 라인 번호는 참고용이다.**
>
> **병렬 작업 겹침 주의**: 같은 워킹트리에 `docs/studio-bubble-custom-shape-integration.md`(다른
> 세션, 커밋 `e9b4338…` 기준)도 존재한다 — 그쪽은 말풍선을 커스텀 폴리곤 점 모양으로 바꾸는 별도
> 기능으로, **역시 `BubbleEl` 인터페이스와 렌더 스위치(`el.variant === "shout" ? (…) : …` 체인,
> §4)를 건드린다.** 필드명은 겹치지 않는다(이 문서: `gradient`/`strokeStyle`/`autoShrinkText`/
> `autoShrinkMinFontSize`/`starAmplitude`, 그쪽: 커스텀 폴리곤 점 관련 필드로 추정) — 하지만 **두
> 설계를 모두 통합할 때는 순차 적용(하나 적용 후 anchor를 다시 확인하고 다른 하나 적용)을
> 권장한다.** 한 번에 두 diff를 동시에 짜맞추면 같은 JSX 블록을 두 번 잘못 편집하기 쉽다.

## 0. 새로 만든 파일

- `src/domains/creator/studio-bubble-text-fit.ts` — 순수 코어(DOM/Konva 의존 없음, 측정만 주입받는
  포트 패턴). 기능 (1) 폰트 자동 축소의 워드랩 + 이진 탐색 + 패딩 공식.
- `src/domains/creator/studio-bubble-text-fit.test.ts` — 13개 유닛 테스트, 전부 통과(`npx vitest run
  src/domains/creator/studio-bubble-text-fit.test.ts`).
- `src/domains/creator/StudioBubbleAutoShrinkPanel.tsx` — 무상태 프레젠테이션 패널(`StudioBubbleAnchorPanel.tsx`와
  동일한 관례: 토글 + 슬라이더 + 상태 문구).

세 파일 모두 `npx tsc --noEmit -p .`/`npx eslint`를 이 상태에서 클린 통과했다.
기능 (2) 그라데이션과 기능 (3) 스타일 프리셋은 **새 파일이 필요 없다** — 기존 엔진
(`studio-gradient-engine.ts`, `studio-stroke-shapes.ts`)과 기존 UI(`StudioGradientEnginePanel.tsx`)를
그대로 재사용하고, `BubbleEl` 필드 추가 + 렌더 스위치 수정 + 기존 프리셋 카탈로그에 항목 추가만
하면 된다.

> **⚠️ 검증 단계(적대적 리뷰) 수정 — §1.1/§1.6/§1.8/§1.9 갱신됨.** `lineHeight`가 `BubbleFontFitInput`의
> **선택 필드**였고 미지정 시 내부적으로 `1.1`로 폴백했는데, StudioPage.tsx의 실제 말풍선 렌더가 쓰는
> `bubbleLineHeight`(테마/세로쓰기 조합에 따라 1.2~1.4)는 **어떤 조합에서도 1.1이 나오지 않는다** —
> 그런데도 이 문서가 원래 제시하던 §1.6/§1.8 통합 코드는 둘 다 `lineHeight: el.lineHeight ?? 1.1`을
> 그대로 하드코딩하고 있었다. 패딩(§1.1)에서는 "탐색이 가정한 값 = 실제 렌더 값"을 정확히 지켰으면서
> 행간에서는 어겨, 텍스트가 여러 줄일수록 실제보다 낮은 블록 높이로 계산되어(최대 ~27% 과소평가)
> "크기 고정"인데도 폰트가 충분히 안 줄어 텍스트가 넘치는 회귀가 날 수 있었다(6% 안전 여유로는
> 못 덮는 크기). 수정: `lineHeight`를 **필수 필드**로 바꿔(엔진 자체가 틀린 값으로 조용히 폴백할
> 수 없게) 호출부가 반드시 명시적으로 계산해 넘기게 했고, 아래 §1.6/§1.8/§1.9 코드 블록을 그
> 필수 인자를 올바르게 채우도록 갱신했다. 겸사겸사 같은 자리에서 발견한 별개 갭 하나도 §1.6/§1.8에
> 반영했다 — `el.vertical`(세로쓰기) 말풍선은 실제 렌더가 `el.text`가 아니라
> `formatVerticalText(el.text)`(글자 단위로 전치된 완전히 다른 문자열)를 그리는데, 원래 스니펫은
> `fitBubbleFontSize`/`bubbleAutoShrinkPreview`에 가공 전 `el.text`를 그대로 넘기고 있었다(§6-11
> 참고).

---

## 기능 (1) 폰트 크기 자동 축소

### 1.1 배경

`commitEditText`(StudioPage.tsx, grep `"말풍선은 텍스트가 넘치지 않게 높이를 자동 확장"`)는 텍스트
편집을 마칠 때마다 임시 `Konva.Text` 노드로 줄바꿈 후 높이를 재서 `el.height`를 늘린다(폭 고정,
높이만 확장). 이 기능은 그 반대 모드다 — 사용자가 말풍선 크기를 고정하고 싶으면, 높이를 늘리는 대신
**렌더 시점에 폰트 크기를 이진 탐색으로 줄여** 고정된 박스 안에 텍스트가 들어가게 한다.

`studio-bubble-text-fit.ts`의 핵심 export:

- `bubbleHorizontalPadding(fontSize)` / `bubbleVerticalPadding(fontSize)` — StudioPage.tsx가 이미
  쓰는 `bHPad`/`bVPadTop`/`bVPadBot` 공식(폰트 크기의 0.6/0.48/0.64배, 최소 12/8/10px)을 그대로
  옮긴 것. **탐색이 가정하는 여백과 실제 렌더 여백이 같은 소스여야** 정확한 크기가 나온다(§1.6에서
  StudioPage.tsx 쪽 인라인 공식도 이 함수 호출로 바꾼다).
- `wrapBubbleTextLines(text, maxWidth, fontPx, fontFamily, fontStyle, measurer)` — 그리디 워드랩(공백
  단위, `\n` 항상 존중, 공백 없는 긴 단어는 글자 단위 강제 분할).
- `fitBubbleFontSize(input, measurer?)` — `{ text, boxWidth, boxHeight, maxFontSize, minFontSize?,
  fontFamily, fontStyle?, lineHeight }` → `{ fontSize, lines, overflow }`. `lineHeight`는 **선택값이
  아니다** — 호출부가 StudioPage.tsx의 실제 렌더가 쓰는 `bubbleLineHeight`와 정확히 같은 값을 계산해
  넘겨야 한다(테마/세로쓰기에 따라 1.2~1.4 사이, 고정 기본값 없음 — 검증 단계에서 `?? 1.1` 폴백이
  실제 렌더보다 항상 작다는 게 드러나 필수 필드로 바꿨다, §1.6/§1.8). `maxFontSize`에서 이미
  맞으면 탐색 없이 그대로 반환, `minFontSize`(기본 10, `BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT`)에서도
  안 맞으면 `overflow: true`와 함께 `minFontSize`를 반환(그 이상은 줄이지 않음 — Canva/Figma와 동일).
- `createCanvasBubbleTextMeasurer()` — 실제 화면용 측정기(재사용 캔버스 1개, `ctx.measureText`).
  테스트는 글자 수 기반 가짜 측정기를 주입해 전부 결정적으로 검증한다(`studio-pdf-contact-sheet.ts`의
  `fitLabelToWidth` 이진 탐색과 동일 관례).

측정은 letterSpacing을 반영하지 않는 근사이고, 높이 판정에 6% 안전 여유(`HEIGHT_SAFETY_MARGIN`)를
둔 이유·이진 탐색의 단조성 가정은 모듈 상단 docstring에 있다(§6-1도 참고).

### 1.2 import 추가 (StudioPage.tsx 상단)

앵커: `import { BUBBLE_MAX_TAILS, bubblePathData, bubblePathDataMulti, normalizeExtraTails, type
BubbleTailSpec } from "./studio-bubble-path";` 바로 다음 줄(알파벳 순서상 `studio-bubble-path` <
`studio-bubble-text-fit` < `studio-characters`이 정확한 자리다).

```ts
import {
  BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
  bubbleHorizontalPadding,
  bubbleVerticalPadding,
  createCanvasBubbleTextMeasurer,
  fitBubbleFontSize,
} from "./studio-bubble-text-fit";
```

### 1.3 지연 패널 import — 앵커: `StudioBubbleStylePresetPanel` lazyRetry 블록 바로 다음(줄 510-513)

```ts
const StudioBubbleAutoShrinkPanel = lazyRetry(
  () => import("./StudioBubbleAutoShrinkPanel").then((mod) => ({ default: mod.StudioBubbleAutoShrinkPanel })),
  "StudioBubbleAutoShrinkPanel"
);
```

### 1.4 모듈 스코프 측정기 — 앵커: `KonvaRuntime.Filters = KonvaRuntime.Filters ?? {};` 바로 다음(줄 498)

```ts
// 말풍선 자동 축소(studio-bubble-text-fit) 실측 캔버스 측정기 — 모듈 스코프에 1회만 생성한다
// (내부 공유 <canvas>를 감싸는 얇은 래퍼라 element/렌더별로 새로 만들 이유가 없다).
const BUBBLE_TEXT_MEASURER = createCanvasBubbleTextMeasurer();
```

### 1.5 `BubbleEl` 필드 추가

§3.1과 한 번에 묶어서 적용하는 게 효율적이다 — **정확한 삽입 지점과 전체 diff는 §2에 모아뒀다.**
이 기능이 추가하는 필드는 `autoShrinkText?: boolean`과 `autoShrinkMinFontSize?: number` 둘이다.

### 1.6 렌더 통합 — `bFs`/`bHPad`/`bVPadTop`/`bVPadBot` 교체

앵커(그대로 유일하게 매치되는 4줄, bubble 렌더 블록 안 "안쪽 여백" 주석 바로 다음):

```ts
                const bFs = el.fontSize ?? 24;
                const bHPad = Math.max(12, Math.round(bFs * 0.6));
                const bVPadTop = Math.max(8, Math.round(bFs * 0.48));
                const bVPadBot = Math.max(10, Math.round(bFs * 0.64));
```

교체:

```ts
                const bubbleMaxFontSize = el.fontSize ?? 24;
                const bFs = el.autoShrinkText
                  ? fitBubbleFontSize(
                      {
                        text: el.vertical ? formatVerticalText(el.text) : el.text,
                        boxWidth: el.width,
                        boxHeight: el.height,
                        maxFontSize: bubbleMaxFontSize,
                        minFontSize: el.autoShrinkMinFontSize ?? BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
                        fontFamily: el.font ?? "Pretendard, sans-serif",
                        fontStyle: el.fontStyle ?? "bold",
                        lineHeight: bubbleLineHeight,
                      },
                      BUBBLE_TEXT_MEASURER
                    ).fontSize
                  : bubbleMaxFontSize;
                // bHPad/bVPadTop/bVPadBot 공식을 studio-bubble-text-fit.ts와 공유(§1.1) — fitBubbleFontSize의
                // 내부 탐색이 가정한 패딩과 실제 렌더 패딩이 정확히 일치해야 한다.
                const bHPad = bubbleHorizontalPadding(bFs);
                const { top: bVPadTop, bottom: bVPadBot } = bubbleVerticalPadding(bFs);
```

**왜 이 위치인가**: `bFs`는 뒤이어 오는 `bHPad`/`bVPadTop`/`bVPadBot`(패딩) 계산의 입력이고, `KText`
노드의 `fontSize={bFs}`(§4 근처, 말풍선 렌더 마지막 `<KText ...>`)에도 그대로 흘러간다 — 이 한
지점만 바꾸면 자동 축소가 "실제 표시 폰트 크기"와 "패딩" 양쪽에 자동으로 반영된다. 패딩 공식을
`bubbleHorizontalPadding`/`bubbleVerticalPadding` 호출로 바꾸는 건 **동작을 바꾸지 않는 리팩터**다
(완전히 동일한 산술식을 옮겨온 것 — §6-2 참고).

**⚠️ 검증 단계 수정 — `lineHeight`와 `text` 두 필드.** 이 앵커 블록 바로 위(줄 10409-10410, "타이포:
한글 가독성을 위한 테마별 줄간격…" 주석 다음)에 이미 `const bubbleLineHeight = el.lineHeight ??
(el.vertical ? 1.4 : webtoonTheme === "soft" ? 1.35 : webtoonTheme === "vivid" ? 1.2 : 1.25);`가
계산돼 있고, 뒤이어 나오는 실제 `<KText lineHeight={bubbleLineHeight} .../>`(§4 근처)도 이 변수를
그대로 쓴다 — 즉 이 스코프엔 이미 "정답"이 변수로 존재한다. 원래 이 문서가 제시하던 코드는 그걸
무시하고 `el.lineHeight ?? 1.1`을 새로 하드코딩했는데(1.1은 위 네 값 중 어느 것과도 안 맞고 전부보다
작다), `fitBubbleFontSize`가 이제 `lineHeight`를 필수로 요구하므로(§1.1) 애초에 이 실수가 타입
에러 없이 조용히 재발할 수 없다 — 그래도 반드시 **이미 계산된 `bubbleLineHeight` 변수를 그대로
재사용**하고 새 계산식을 만들지 말 것(하나라도 다른 값이면 탐색·렌더가 다시 어긋난다). `text`도
마찬가지 이유로 `el.vertical ? formatVerticalText(el.text) : el.text`로 바꿨다 — 세로쓰기 말풍선은
실제 `<KText text={...}>`(줄 10754 근처)가 `el.text`가 아니라 `formatVerticalText(el.text)`(글자당
2칸 공백을 끼워 전치한 문자열)를 그리므로, 폭 기반 워드랩 탐색도 같은 문자열을 봐야 한다(둘 다
`formatVerticalText`는 StudioPage.tsx 최상단의 모듈 스코프 함수 선언이라 호이스팅되어 이 위치에서도
바로 호출 가능하다 — 별도 import 불필요). 세로쓰기 말풍선에서 폭 기반 줄바꿈이 근본적으로 "세로로
읽는" 레이아웃과 맞는 개념인지 자체는 여전히 열린 질문이다(§6-11).

### 1.7 `commitEditText` — 자동 축소 모드면 높이 확장을 건너뛴다

앵커: `function commitEditText() { ... }` 전체(줄 7747-7767).

```ts
  function commitEditText() {
    if (editing) {
      const el = elementById.get(editing.id);
      // 말풍선은 텍스트가 넘치지 않게 높이를 자동 확장(수동으로 키운 크기는 보존) — 단,
      // autoShrinkText(크기 고정 모드)가 켜져 있으면 높이는 건드리지 않는다(렌더 시점에
      // fitBubbleFontSize가 폰트 크기를 알아서 줄인다, §1.6).
      let height: number | undefined;
      if (el && el.type === "bubble" && !el.autoShrinkText) {
        const measure = new KonvaRuntime.Text({
          text: editing.value || " ",
          width: el.width - 36,
          fontSize: el.fontSize ?? 24,
          fontFamily: el.font ?? "Pretendard, sans-serif",
          align: "center",
          lineHeight: el.lineHeight ?? 1.1,
        });
        height = Math.max(el.height, Math.ceil(measure.height()) + 28);
        measure.destroy();
      }
      patchEl(editing.id, { text: editing.value, ...(height !== undefined ? { height } : {}) } as Partial<El>);
    }
    setEditing(null);
  }
```

바뀐 곳은 딱 한 줄 — `if (el && el.type === "bubble")` → `if (el && el.type === "bubble" &&
!el.autoShrinkText)`. 이 함수 안 `lineHeight: el.lineHeight ?? 1.1`은 **의도적으로 그대로 둔다** —
이 기능의 범위 밖인 기존(자동 축소 이전부터 있던) 높이-자동-확장 경로다. 참고로 이 줄은 §1.1/§6-11에서
찾은 것과 **동일한 종류의 기존 불일치**를 이미 갖고 있다(여기서 재는 높이도 실제 `bubbleLineHeight`가
아니라 `1.1`을 가정한다) — 다만 이 기능이 새로 만드는 코드가 아니라 손대지 않으므로 고치지 않았다.
후속 패스가 원한다면 별도 버그로 다뤄 `lineHeight: bubbleLineHeight`로 바꿀 수 있다(이 함수 스코프엔
`bubbleLineHeight`가 없으므로 그 변수와 동일한 공식을 새로 계산해야 한다 — commitEditText는
렌더 루프 밖에 있다).

### 1.8 인스펙터 미리보기 헬퍼 함수 — 앵커: `elementLabel(...)` 함수가 끝나는 지점(줄 1250 `}`) 바로
다음, `const DRAW_COLOR_SWATCHES = [...]` 앞

```ts
// 말풍선 "크기 고정" 미리보기 — 인스펙터가 StudioBubbleAutoShrinkPanel에 넘길 계산된 폰트 크기/
// 오버플로 여부. autoShrinkText가 꺼져 있으면 계산 자체를 하지 않는다(null).
//
// lineHeight를 인자로 받는 이유: 이 함수는 elementLabel(...) 근처의 모듈 스코프(StudioPage
// 컴포넌트 함수 바깥)에 있어 webtoonTheme(컴포넌트 useState)에 접근할 수 없다 — 실제 렌더가 쓰는
// bubbleLineHeight(줄 10409-10410)와 정확히 같은 값을 호출부(§1.9, webtoonTheme에 접근 가능한
// 컴포넌트 스코프)가 계산해 넘겨야 한다(§1.6과 동일한 이유 — 검증 단계에서 `?? 1.1` 폴백이 실제
// 렌더보다 항상 작다는 게 드러나 필수 인자로 뺐다).
function bubbleAutoShrinkPreview(
  el: BubbleEl,
  lineHeight: number
): { fontSize: number; overflow: boolean } | null {
  if (!el.autoShrinkText) return null;
  return fitBubbleFontSize(
    {
      text: el.vertical ? formatVerticalText(el.text) : el.text,
      boxWidth: el.width,
      boxHeight: el.height,
      maxFontSize: el.fontSize ?? 24,
      minFontSize: el.autoShrinkMinFontSize ?? BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT,
      fontFamily: el.font ?? "Pretendard, sans-serif",
      fontStyle: el.fontStyle ?? "bold",
      lineHeight,
    },
    BUBBLE_TEXT_MEASURER
  );
}
```

### 1.9 인스펙터 마운트 — "테두리 설정" 섹션과 "말풍선 그림자" 섹션 사이

앵커: "테두리 설정" 블록이 끝나는 `</div>`(줄 12173) 다음, "말풍선 그림자 (Shadow)" 블록이 시작하는
`<div className="mt-2.5 border-t border-line/40 pt-2.5 space-y-2.5">`(줄 12175) 앞.

```tsx
                  {(() => {
                    // bubbleLineHeight와 정확히 같은 공식(§1.6/줄 10409-10410) — 이 인스펙터 블록도
                    // StudioPage 컴포넌트 스코프 안이라 webtoonTheme에 접근 가능하다.
                    const previewLineHeight =
                      selected.lineHeight ??
                      (selected.vertical ? 1.4 : webtoonTheme === "soft" ? 1.35 : webtoonTheme === "vivid" ? 1.2 : 1.25);
                    const fit = bubbleAutoShrinkPreview(selected, previewLineHeight);
                    return (
                      <Suspense fallback={<StudioPanelLoading label="텍스트 크기 고정 패널을 여는 중..." />}>
                        <StudioBubbleAutoShrinkPanel
                          enabled={!!selected.autoShrinkText}
                          minFontSize={selected.autoShrinkMinFontSize ?? BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT}
                          effectiveFontSize={fit ? Math.round(fit.fontSize) : null}
                          overflow={fit?.overflow ?? false}
                          onToggleEnabled={(v) => patchEl(selected.id, { autoShrinkText: v } as Partial<El>)}
                          onMinFontSizeChange={(v) => patchEl(selected.id, { autoShrinkMinFontSize: v } as Partial<El>)}
                        />
                      </Suspense>
                    );
                  })()}
```

이 블록은 이미 `{selected.type === "bubble" && ( <> ... </> )}` 안이라 `selected`가 `BubbleEl`로
좁혀져 있다(바로 위 `<StudioBubbleStylePresetPanel selected={selected} .../>`가 `BubbleStylePresetTarget`
프롭을 요구하는데도 캐스트 없이 통과하는 게 그 증거 — `selected`는 `const`라 이 IIFE 안에서도 좁혀진
타입이 유지된다). 만약 통합 시 tsc가 `bubbleAutoShrinkPreview(selected, previewLineHeight)` 호출에서
타입 에러를 내면 `bubbleAutoShrinkPreview(selected as BubbleEl, previewLineHeight)`로 방어적으로
캐스트해도 무방하다.

---

## 기능 (2) 그라데이션 채우기

`DrawEl.gradient?: StudioGradientSpec`(studio-gradient-engine.ts)와 완전히 동일한 패턴을 `BubbleEl`에
그대로 옮긴다 — **새 UI 없음**, 기존 `StudioGradientEnginePanel`을 그대로 마운트하고, 렌더은
`konvaGradientProps(el.gradient, bbox)`를 각 variant 분기의 `fill={el.fill}` 뒤에 스프레드하면 끝이다
(둘 다 이미 StudioPage.tsx에 import돼 있다 — 새 import 불필요).

### 2.1 `BubbleEl` 필드 — §3.1과 한 곳에 같이 추가(정확한 삽입 지점은 §2 아래 통합 diff 참고)

`gradient?: StudioGradientSpec;` — 있으면 `fill`(단색)보다 우선한다(DrawEl과 동일 우선순위 규약).

### 2.2 인스펙터에 재사용 마운트 — "말풍선색" 블록과 "테두리 설정" 블록 사이

앵커: `selected.fill !== "transparent" && (<span>...말풍선색...</span>)}`가 끝나는 `)}`(줄 12123)
다음, "테두리 설정" `<div>`(줄 12125) 앞.

```tsx
                  {selected.fill !== "transparent" && (
                    <div className="mt-2.5 border-t border-line/40 pt-2.5 space-y-2">
                      <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">그라데이션 채우기</p>
                      <Suspense fallback={<StudioPanelLoading label="그라데이션 패널을 여는 중..." />}>
                        <StudioGradientEnginePanel
                          value={selected.gradient ?? null}
                          onChange={(spec) => patchEl(selected.id, { gradient: spec ?? undefined } as Partial<El>)}
                          title="말풍선 그라데이션"
                        />
                      </Suspense>
                    </div>
                  )}
```

`allowClear`는 안 넘긴다(기본 true) — DrawEl 도형 패널(줄 11976-11982)과 동일 관례. "배경 투명"
체크박스와 같은 `selected.fill !== "transparent"` 게이트를 공유한다(그라데이션도 결국 "배경 채우기"
설정의 일부라 투명 상태에선 의미가 없다).

렌더 쪽 diff(각 variant 분기에 `konvaGradientProps` 스프레드 삽입)는 기능 (3)의 점선 diff와 같은
JSX 블록을 건드리므로 **§4에 한 번에 모아뒀다.**

### 2.3 알려진 갭 — SVG 내보내기

`studio-svg-export.ts`의 `serializeBubble`/`SvgBubbleElLike`는 그라데이션을 모른다(DrawEl 쪽은 이미
`gradientDef(ctx, el.gradient, bbox, origin)`를 쓰는 선례가 있다 — 줄 625 근처). 이번 배치엔 포함하지
않았다(§6-4). 캔버스/PNG 내보내기(`stage.toDataURL`, `handleSave`가 쓰는 실제 게시 경로)는 Konva가
그대로 그려주므로 영향 없다 — 별도 "SVG로 내보내기" 기능을 쓸 때만 그라데이션이 빠진 채 단색으로
내보내진다.

---

## 기능 (3) 웹툰 특화 스타일 프리셋

### 3.1 `BubbleEl` 필드 추가 — 기능 (1)·(2)와 한 번에

앵커: `BubbleEl` 인터페이스 안 `strokeWidth?: number;`(줄 953) 다음, `shadowColor?: string;`(줄 954) 앞.

```ts
  stroke?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle; // 점선 등(studio-stroke-shapes 규약) — 화살촉 필드는 말풍선엔 의미 없어 무시.
  gradient?: StudioGradientSpec; // 멀티스톱 그라데이션 채우기 — 있으면 fill(단색)보다 우선(studio-gradient-engine).
  autoShrinkText?: boolean; // true면 텍스트가 넘칠 때 높이 대신 폰트 크기를 자동 축소(studio-bubble-text-fit).
  autoShrinkMinFontSize?: number; // 자동 축소 하한(px). 미설정 시 BUBBLE_AUTO_SHRINK_MIN_FONT_DEFAULT.
  starAmplitude?: number; // shout/angry variant(Star)의 안쪽 반경 비율(0..1). 미설정 시 각 variant의 기존 비율(36/68, 28/64).
  shadowColor?: string;
```

`StrokeStyle`/`StudioGradientSpec` 둘 다 이미 StudioPage.tsx에 import돼 있다(줄 194, 411) — **새
import 불필요**. `strokeDashArray`/`normalizeStrokeStyle`도 이미 import돼 있다(줄 408-409).

### 3.2 `studio-bubble-style-presets.ts`에 신규 3종 추가 (기존 파일 — 아래는 diff 지시일 뿐, 적용은
후속 통합 패스가 한다)

**인터페이스 확장** — 앵커: `export interface BubbleStylePreset { ... }` 블록.

```ts
import type { BubbleVariant } from "./studio-assets";
import type { StrokeStyle } from "./studio-stroke-shapes";

export interface BubbleStylePreset {
  id: string;
  label: string;
  description: string;
  fill: string;
  textFill: string;
  stroke?: string;
  strokeWidth?: number;
  strokeStyle?: StrokeStyle; // 점선 등(studio-stroke-shapes) — 지정하면 프리셋 적용 시 함께 바뀐다.
  variant?: BubbleVariant; // 지정하면 프리셋 적용 시 말풍선 모양(variant) 자체도 바뀐다(기존 8종은 전부 미지정=모양 유지).
  starAmplitude?: number; // shout/angry 등 Star 기반 variant의 안쪽 반경 비율(0..1) 오버라이드.
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  font?: string;
}
```

**카탈로그에 3종 추가** — 앵커: 배열을 닫는 `];`(현재 `flashback_memory` 항목 다음, 줄 173) **바로
앞**. 이 파일은 확인 시점(커밋 `1dcd7b6`)에 이미 11종(classic_white ~ flashback_memory)이 있다 —
라인 번호보다 "배열을 닫는 `];`를 찾아 그 앞에 추가"가 안전한 앵커다(병렬 세션이 계속 색상만 튜닝할
가능성이 있다 — 실제로 이 설계 작업 도중에도 한 번 그랬다, 아래 참고 박스).

```ts
  {
    id: "hushed_whisper",
    label: "속삭임",
    description: "조용히 소곤대는 귓속말, ASMR 대사",
    fill: "#fbfbfe",
    textFill: "#5b5f6b",
    stroke: "#b9bdc7",
    strokeWidth: 1.25,
    strokeStyle: { dash: "dot", lineCap: "round", arrowStart: "none", arrowEnd: "none" },
  },
  {
    id: "mecha_transmission",
    label: "전화/기계음",
    description: "무전기·전화·안내음성 등 딱딱한 기계 대사",
    variant: "box",
    fill: "#202832",
    textFill: "#d7dde3",
    stroke: "#5b6472",
    strokeWidth: 2.5,
    strokeStyle: { dash: "solid", lineCap: "square", arrowStart: "none", arrowEnd: "none" },
    shadowColor: "#5b6472",
    shadowBlur: 4,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowOpacity: 0.3,
  },
  {
    id: "trembling_fear",
    label: "다급함/공포",
    description: "겁에 질려 떨리는 다급한 대사",
    variant: "shout",
    starAmplitude: 0.78,
    fill: "#eef0f5",
    textFill: "#2a2f3a",
    stroke: "#4b4f5c",
    strokeWidth: 2,
    strokeStyle: { dash: "dash", lineCap: "round", arrowStart: "none", arrowEnd: "none" },
  },
```

**왜 이 3개인가** (요청 프롬프트의 예시 그대로):

- **속삭임** — 가는 점선(`dot`) 테두리 + 아주 연한 배경. variant는 안 바꾼다(지금 쓰고 있는
  speech/thought/box 등 아무 모양에나 얹을 수 있는 "색+선" 재스킨이라, 기존 8종과 같은 성격).
- **전화/기계음** — `variant: "box"`로 전환(각진 사각 — box variant는 테마별로 이미 모서리
  반경이 3~6px로 작아 상당히 각져 있다, §6-3)에 스틸그레이 팔레트 + 실선. `system` variant(네온
  사이언 상태창)와는 톤을 다르게 가져갔다 — 이건 "무전기/안내음성"처럼 더 절제된 기계음 쪽이다.
- **다급함/공포** — `variant: "shout"`(뾰족별 실루엣 재사용) + `starAmplitude: 0.78`로 뾰족함을
  줄여(기본 0.53 → 0.78, 안쪽 반경이 커질수록 삐죽함이 줄고 자잘하게 떠는 느낌에 가까워진다) +
  가는 파선(`dash`)으로 "떨리는 외곽선"을 근사, 창백한 팔레트로 공포 톤.

### 3.3 `StudioBubbleStylePresetPanel.tsx` 타입/isMatch/적용 로직 확장 (기존 파일 — diff 지시만)

**import 추가**:

```tsx
import { BUBBLE_STYLE_PRESETS, type BubbleStylePreset } from "./studio-bubble-style-presets";
import { normalizeStrokeStyle, type StrokeStyle } from "./studio-stroke-shapes";
import type { BubbleVariant } from "./studio-assets";

import { cx } from "@/shared/lib/cx";
```

**`BubbleStylePresetTarget`/`BubbleStylePresetPatch` 확장**:

```tsx
export type BubbleStylePresetTarget = {
  fill: string;
  textFill: string;
  stroke?: string;
  strokeWidth?: number;
  font?: string;
  strokeStyle?: StrokeStyle;
  variant: BubbleVariant; // 항상 존재(BubbleEl.variant는 필수 필드) — 프리셋이 모양을 안 바꿀 때 되돌릴 기본값으로 쓴다.
};

export type BubbleStylePresetPatch = Pick<
  BubbleStylePreset,
  | "fill"
  | "textFill"
  | "stroke"
  | "strokeWidth"
  | "strokeStyle"
  | "variant"
  | "starAmplitude"
  | "shadowColor"
  | "shadowBlur"
  | "shadowOffsetX"
  | "shadowOffsetY"
  | "shadowOpacity"
  | "font"
>;
```

**`isMatch` 확장** (앵커: `const isMatch = ...` 블록):

```tsx
          const isMatch =
            selected.fill === preset.fill &&
            selected.textFill === preset.textFill &&
            (preset.stroke ? selected.stroke === preset.stroke : !selected.stroke) &&
            (preset.strokeWidth ? selected.strokeWidth === preset.strokeWidth : true) &&
            (preset.variant ? selected.variant === preset.variant : true) &&
            (preset.strokeStyle
              ? normalizeStrokeStyle(selected.strokeStyle).dash === preset.strokeStyle.dash
              : true);
```

**적용 로직 확장 — ⚠️ 주의 필요** (앵커: `onClick={() => { onApplyPreset({ ... }); }}` 블록):

```tsx
              onClick={() => {
                onApplyPreset({
                  fill: preset.fill,
                  textFill: preset.textFill,
                  stroke: preset.stroke,
                  strokeWidth: preset.strokeWidth,
                  strokeStyle: preset.strokeStyle,
                  variant: preset.variant ?? selected.variant,
                  starAmplitude: preset.starAmplitude,
                  shadowColor: preset.shadowColor,
                  shadowBlur: preset.shadowBlur,
                  shadowOffsetX: preset.shadowOffsetX,
                  shadowOffsetY: preset.shadowOffsetY,
                  shadowOpacity: preset.shadowOpacity,
                  font: preset.font ?? selected.font,
                });
              }}
```

> **이 줄을 놓치면 심각한 회귀가 생긴다**: `patchEl`은 `{...el, ...patch}` 얕은 병합이다(StudioPage.tsx
> 줄 4837). `variant: preset.variant`를 폴백 없이 그대로 넘기면, `variant`를 지정하지 않는 기존
> 8개 프리셋(classic_white 등)을 적용할 때마다 `patch.variant`가 `undefined`인 채로 병합돼 **말풍선의
> `variant`(필수 필드)가 실제로 `undefined`가 돼버린다** — 렌더 스위치가 전부 `el.variant === "X"`
> 체크라 이 경우 마지막 `else` 분기(speech 말풍선)로 떨어져, 예를 들어 "박스" 말풍선에 아무 색상
> 프리셋이나 눌렀는데 갑자기 모양이 말풍선으로 바뀌는 버그가 생긴다. 기존 `font: preset.font ??
> selected.font`가 이미 정확히 이 패턴(있으면 덮어쓰고, 없으면 유지)을 쓰고 있다 — `variant`도
> 동일하게 따라야 한다. `strokeStyle`/`starAmplitude`는 반대로 **폴백 없이 그대로 undefined로
> 흘려보내는 게 맞다** — 둘 다 선택적 "스타일 오버라이드"라 프리셋이 지정하지 않으면 리셋(점선
> 해제/별 진폭 기본값 복귀)되는 게 "프리셋을 새로 적용한다"는 사용자 기대와 맞다(옛날에 다른
> 프리셋으로 넣어둔 점선이 새 프리셋에도 그대로 남아있으면 오히려 이상하다).

---

## 기능 (2)+(3) 공용 — 렌더 스위치 통합(그라데이션 + 점선 + 별 진폭)

두 기능 모두 같은 JSX 블록(`el.variant === "shout" ? (...) : el.variant === "thought" ? (...) : ...`,
줄 10611-10750)을 건드리므로 한 번에 정리한다.

### 4.1 `bDash` 상수 — 앵커: 테마별(webtoonTheme) if/else 블록이 끝나는 `}`(줄 10372) 다음,
`const flipTailX = (pts: number[]) => {`(줄 10374) 앞

```ts
                // 점선 등 스트로크 스타일 — strokeStyle을 지정하면 그걸 우선 적용한다. whisper는
                // strokeStyle 미지정 시 기존 하드코딩 dash([8,5])를 그대로 유지한다(하위호환, §6-1).
                // scared/system/angry는 스트로크 색(및 system은 두께)이 이미 하드코딩이라 점선도
                // 적용하지 않는다(사용자가 지정 안 한 색 위에 점선만 얹히는 어색함 방지 — 기존 갭,
                // 이 배치의 책임 밖).
                const bDash = el.strokeStyle
                  ? strokeDashArray(normalizeStrokeStyle(el.strokeStyle).dash, bStrokeW)
                  : el.variant === "whisper"
                    ? [8, 5]
                    : undefined;
```

### 4.2 variant별 반영 표

| variant | `el.fill` 읽음(그라데이션 적용) | `bStroke`/`bStrokeW` 읽음(점선 적용) | Star + 하드코딩 비율(별 진폭 적용) |
|---|---|---|---|
| shout | ✅ | ✅ | ✅ (36/68) |
| thought | ✅ | ✅ | — |
| whisper | ✅ | ✅(기존 하드코딩 `[8,5]` 대체) | — |
| scared | ✅(투명/흰색 리매핑 유지) | ❌(스트로크 색 하드코딩 `#7c3aed`) | — |
| system | ❌(fill 자체가 `"#0a0f24"` 하드코딩) | ❌ | — |
| angry | ✅ | ❌(스트로크 색이 테마 기반 하드코딩) | ✅ (28/64) |
| phone | ✅ | ✅ | — |
| heart | ✅ | ✅ | — |
| box | ✅ | ✅ | — |
| 기본(speech) | ✅ | ✅ | — |

그라데이션 로컬 bbox(`konvaGradientProps`의 2번째 인자, studio-gradient-engine.ts 규약 — 원점
좌상단 도형은 `{x:0,y:0,width,height}`, 원점 중심 도형은 자기 로컬 반경 기준):

- shout Star: `{ x: -68, y: -68, width: 136, height: 136 }` (outerRadius=68 기준, scaleX/Y가 최종
  크기로 늘린다)
- angry Star: `{ x: -64, y: -64, width: 128, height: 128 }` (outerRadius=64 기준)
- heart Path: `{ x: 0, y: 0, width: 24, height: 24 }` (path 자체가 24×24 기준 좌표)
- 그 외(thought/whisper/scared/phone/box/기본): `{ x: 0, y: 0, width: el.width, height: el.height }`

### 4.3 전체 블록 교체(원본 → 교체본)

**원본** (줄 10611-10750, `<KText ...>` 시작 직전까지):

```jsx
                    {el.variant === "shout" ? (
                      <Star
                        x={el.width / 2}
                        y={el.height / 2}
                        numPoints={20}
                        innerRadius={36}
                        outerRadius={68}
                        scaleX={el.width / 136}
                        scaleY={el.height / 136}
                        fill={el.fill}
                        stroke={bStroke}
                        strokeWidth={bStrokeW}
                        lineJoin="round"
                      />
                    ) : el.variant === "thought" ? (
                      <>
                        <Rect
                          width={el.width}
                          height={el.height}
                          fill={el.fill}
                          cornerRadius={Math.min(el.width, el.height) / 2}
                          stroke={bStroke}
                          strokeWidth={bStrokeW}
                        />
                        {thoughtEllipses}
                      </>
                    ) : el.variant === "whisper" ? (
                      <Path
                        data={speechPathData}
                        fill={el.fill}
                        stroke={bStroke}
                        strokeWidth={bStrokeW}
                        lineJoin="round"
                        lineCap="round"
                        dash={[8, 5]}
                      />
                    ) : el.variant === "scared" ? (
                      <>
                        <Rect
                          width={el.width}
                          height={el.height}
                          fill={el.fill === "transparent" ? "transparent" : (el.fill === "#ffffff" ? "#f5f3ff" : el.fill)}
                          cornerRadius={14}
                          stroke="#7c3aed"
                          strokeWidth={2}
                          shadowColor="#7c3aed"
                          shadowBlur={6}
                          shadowOpacity={0.16}
                        />
                        {showTail && (
                          <Line
                            points={scaredTailPts}
                            closed
                            fill={el.fill === "transparent" ? "transparent" : (el.fill === "#ffffff" ? "#f5f3ff" : el.fill)}
                            stroke="#7c3aed"
                            strokeWidth={2}
                          />
                        )}
                      </>
                    ) : el.variant === "system" ? (
                      <>
                        <Rect
                          width={el.width}
                          height={el.height}
                          fill="#0a0f24"
                          opacity={0.88}
                          cornerRadius={4}
                          stroke="#0ea5e9"
                          strokeWidth={2.5}
                          shadowColor="#0ea5e9"
                          shadowBlur={8}
                          shadowOpacity={0.4}
                        />
                        <Rect
                          x={4}
                          y={4}
                          width={el.width - 8}
                          height={el.height - 8}
                          fill="transparent"
                          cornerRadius={2}
                          stroke="#38bdf8"
                          strokeWidth={1}
                          opacity={0.5}
                        />
                      </>
                    ) : el.variant === "angry" ? (
                      <Star
                        x={el.width / 2}
                        y={el.height / 2}
                        numPoints={22}
                        innerRadius={28}
                        outerRadius={64}
                        scaleX={el.width / 160}
                        scaleY={el.height / 160}
                        fill={el.fill}
                        stroke={webtoonTheme === "soft" ? "#dc2626" : webtoonTheme === "vivid" ? "#7f1d1d" : "#991b1b"}
                        strokeWidth={Math.max(bStrokeW, 3.5)}
                        lineJoin="round"
                      />
                    ) : el.variant === "phone" ? (
                      <>
                        <Rect
                          width={el.width}
                          height={el.height}
                          fill={el.fill}
                          cornerRadius={webtoonTheme === "soft" ? 10 : webtoonTheme === "vivid" ? 6 : 8}
                          stroke={bStroke}
                          strokeWidth={bStrokeW}
                        />
                        {showTail && (
                          <Line
                            points={phoneTailPts}
                            closed
                            fill={el.fill}
                            stroke={bStroke}
                            strokeWidth={bStrokeW}
                          />
                        )}
                      </>
                    ) : el.variant === "heart" ? (
                      <Path
                        data="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41 0.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                        fill={el.fill}
                        stroke={bStroke}
                        strokeWidth={bStrokeW}
                        scaleX={el.width / 24}
                        scaleY={el.height / 24}
                      />
                    ) : el.variant === "box" ? (
                      <Rect width={el.width} height={el.height} fill={el.fill} cornerRadius={webtoonTheme === "soft" ? 6 : webtoonTheme === "vivid" ? 3 : 4} stroke={bStroke} strokeWidth={bStrokeW} />
                    ) : (
                      <Path
                        data={speechPathData}
                        fill={el.fill}
                        stroke={bStroke}
                        strokeWidth={bStrokeW}
                        lineJoin="round"
                        lineCap="round"
                      />
                    )}
```

**교체본**:

```jsx
                    {el.variant === "shout" ? (
                      <Star
                        x={el.width / 2}
                        y={el.height / 2}
                        numPoints={20}
                        innerRadius={68 * Math.min(0.95, Math.max(0.1, el.starAmplitude ?? 36 / 68))}
                        outerRadius={68}
                        scaleX={el.width / 136}
                        scaleY={el.height / 136}
                        fill={el.fill}
                        {...konvaGradientProps(el.gradient, { x: -68, y: -68, width: 136, height: 136 })}
                        stroke={bStroke}
                        strokeWidth={bStrokeW}
                        dash={bDash}
                        lineJoin="round"
                      />
                    ) : el.variant === "thought" ? (
                      <>
                        <Rect
                          width={el.width}
                          height={el.height}
                          fill={el.fill}
                          {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: el.width, height: el.height })}
                          cornerRadius={Math.min(el.width, el.height) / 2}
                          stroke={bStroke}
                          strokeWidth={bStrokeW}
                          dash={bDash}
                        />
                        {thoughtEllipses}
                      </>
                    ) : el.variant === "whisper" ? (
                      <Path
                        data={speechPathData}
                        fill={el.fill}
                        {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: el.width, height: el.height })}
                        stroke={bStroke}
                        strokeWidth={bStrokeW}
                        lineJoin="round"
                        lineCap="round"
                        dash={bDash}
                      />
                    ) : el.variant === "scared" ? (
                      <>
                        <Rect
                          width={el.width}
                          height={el.height}
                          fill={el.fill === "transparent" ? "transparent" : (el.fill === "#ffffff" ? "#f5f3ff" : el.fill)}
                          {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: el.width, height: el.height })}
                          cornerRadius={14}
                          stroke="#7c3aed"
                          strokeWidth={2}
                          shadowColor="#7c3aed"
                          shadowBlur={6}
                          shadowOpacity={0.16}
                        />
                        {showTail && (
                          <Line
                            points={scaredTailPts}
                            closed
                            fill={el.fill === "transparent" ? "transparent" : (el.fill === "#ffffff" ? "#f5f3ff" : el.fill)}
                            stroke="#7c3aed"
                            strokeWidth={2}
                          />
                        )}
                      </>
                    ) : el.variant === "system" ? (
                      <>
                        <Rect
                          width={el.width}
                          height={el.height}
                          fill="#0a0f24"
                          opacity={0.88}
                          cornerRadius={4}
                          stroke="#0ea5e9"
                          strokeWidth={2.5}
                          shadowColor="#0ea5e9"
                          shadowBlur={8}
                          shadowOpacity={0.4}
                        />
                        <Rect
                          x={4}
                          y={4}
                          width={el.width - 8}
                          height={el.height - 8}
                          fill="transparent"
                          cornerRadius={2}
                          stroke="#38bdf8"
                          strokeWidth={1}
                          opacity={0.5}
                        />
                      </>
                    ) : el.variant === "angry" ? (
                      <Star
                        x={el.width / 2}
                        y={el.height / 2}
                        numPoints={22}
                        innerRadius={64 * Math.min(0.95, Math.max(0.1, el.starAmplitude ?? 28 / 64))}
                        outerRadius={64}
                        scaleX={el.width / 160}
                        scaleY={el.height / 160}
                        fill={el.fill}
                        {...konvaGradientProps(el.gradient, { x: -64, y: -64, width: 128, height: 128 })}
                        stroke={webtoonTheme === "soft" ? "#dc2626" : webtoonTheme === "vivid" ? "#7f1d1d" : "#991b1b"}
                        strokeWidth={Math.max(bStrokeW, 3.5)}
                        lineJoin="round"
                      />
                    ) : el.variant === "phone" ? (
                      <>
                        <Rect
                          width={el.width}
                          height={el.height}
                          fill={el.fill}
                          {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: el.width, height: el.height })}
                          cornerRadius={webtoonTheme === "soft" ? 10 : webtoonTheme === "vivid" ? 6 : 8}
                          stroke={bStroke}
                          strokeWidth={bStrokeW}
                          dash={bDash}
                        />
                        {showTail && (
                          <Line
                            points={phoneTailPts}
                            closed
                            fill={el.fill}
                            stroke={bStroke}
                            strokeWidth={bStrokeW}
                          />
                        )}
                      </>
                    ) : el.variant === "heart" ? (
                      <Path
                        data="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41 0.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                        fill={el.fill}
                        {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: 24, height: 24 })}
                        stroke={bStroke}
                        strokeWidth={bStrokeW}
                        dash={bDash}
                        scaleX={el.width / 24}
                        scaleY={el.height / 24}
                      />
                    ) : el.variant === "box" ? (
                      <Rect
                        width={el.width}
                        height={el.height}
                        fill={el.fill}
                        {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: el.width, height: el.height })}
                        cornerRadius={webtoonTheme === "soft" ? 6 : webtoonTheme === "vivid" ? 3 : 4}
                        stroke={bStroke}
                        strokeWidth={bStrokeW}
                        dash={bDash}
                      />
                    ) : (
                      <Path
                        data={speechPathData}
                        fill={el.fill}
                        {...konvaGradientProps(el.gradient, { x: 0, y: 0, width: el.width, height: el.height })}
                        stroke={bStroke}
                        strokeWidth={bStrokeW}
                        dash={bDash}
                        lineJoin="round"
                        lineCap="round"
                      />
                    )}
```

바뀐 게 없는 분기: `system`(그대로). 꼬리 도형(`scaredTailPts`/`phoneTailPts`를 그리는 `<Line>`,
`thoughtEllipses`의 작은 구름방울 `<Ellipse>`)은 의도적으로 손대지 않았다(§6-5) — 본체만 그라데이션/
점선을 반영한다.

---

## 5. QA 체크리스트 (3기능 통합 후)

- [ ] 말풍선 텍스트 편집 중 "크기 고정" 토글이 꺼져 있으면 기존과 동일하게 텍스트가 넘칠 때 높이가
      늘어난다(회귀 없음 확인).
- [ ] "크기 고정"을 켜고 짧은 대사를 넣으면 원래 폰트 크기 그대로 보인다(탐색이 불필요할 때 그대로
      통과하는지).
- [ ] "크기 고정" 상태에서 대사를 길게 늘리면 높이는 그대로고 폰트가 점점 작아진다. 최소 크기
      슬라이더를 낮추면 더 작게까지 줄어든다.
- [ ] 최소 크기에서도 못 맞을 만큼 긴 텍스트를 넣으면 패널에 "⚠️ 최소 크기에서도 넘쳐요" 경고가 뜬다.
- [ ] 말풍선을 드래그로 리사이즈하면(크기 고정 켜진 상태) 박스가 커질 때 폰트가 다시 커지고, 작아질
      땐 다시 줄어든다(렌더 시점 재계산이므로 실시간으로 반영돼야 한다).
- [ ] (검증 단계에서 추가, §6-11) "세로 쓰기" 토글이 켜진 말풍선에 "크기 고정"을 함께 켜고 여러
      줄 넘치는 대사를 넣어도 실제로 넘치지 않는다 — 인스펙터 미리보기(effectiveFontSize)와 캔버스에
      실제로 보이는 폰트 크기가 일치하는지도 함께 확인(§1.6/§1.8이 `bubbleLineHeight`와
      `formatVerticalText(el.text)`를 공유하는지의 회귀 확인 케이스).
- [ ] 말풍선 인스펙터의 "그라데이션 채우기" 패널에서 프리셋을 고르면 말풍선 배경이 그라데이션으로
      바뀐다. "배경 투명" 체크 시 그라데이션 패널이 사라진다.
- [ ] 그라데이션이 적용된 상태에서 "말풍선색"(단색) 컨트롤은 사라지거나(현재 설계상 `fill !==
      "transparent"` 게이트만 공유하고 별도 우선순위 UI 전환은 없음 — §6-6) 그라데이션이 우선
      적용되어 화면엔 그라데이션만 보인다.
- [ ] shout/thought/whisper/phone/heart/box/기본(speech) variant 각각에서 그라데이션이 도형 모양에
      맞게 자연스럽게 걸린다(별은 별 모양 안에, 사각은 사각 안에).
- [ ] 스타일 프리셋 패널에서 "속삭임"을 누르면 현재 variant는 그대로 유지되고 연한 배경 + 가는
      점선 테두리로 바뀐다.
- [ ] "전화/기계음"을 누르면 말풍선이 box variant(각진 사각)로 바뀌고 스틸그레이 톤이 된다.
- [ ] "다급함/공포"를 누르면 shout variant(별 모양)로 바뀌되 기존 "외침"보다 덜 뾰족하고 창백한
      톤 + 가는 파선 테두리가 보인다.
- [ ] 스타일 프리셋을 하나 적용한 뒤(예: 전화/기계음, variant가 box로 바뀜) **다른(variant 미지정)
      프리셋**(예: 기본 흰색)을 다시 누르면 **모양이 box로 유지된 채 색만 바뀐다**(§3.3 경고 박스의
      회귀가 없는지 확인하는 핵심 케이스).
- [ ] ⌘Z로 각 프리셋 적용/자동 축소 토글/그라데이션 적용이 각각 히스토리 1건으로 되돌아간다.
- [ ] `npx tsc --noEmit -p .`, `npx eslint`, 관련 vitest 스위트가 통합 후에도 클린 통과한다.

---

## 6. 스케치 대비 편차(§5, 의도적 스코프 축소·구현 선택)

1. **폰트 자동 축소의 워드랩은 근사다.** `wrapBubbleTextLines`는 캔버스 `measureText` 기반 그리디
   워드랩이고, 실제 화면에 그려지는 건 여전히 Konva `Text`의 자체 워드랩이다(§1.6에서 `bFs`만
   넘겨주고 줄바꿈 자체는 그대로 Konva에 맡긴다) — 둘의 줄바꿈 결정 지점이 아주 드물게 다를 수
   있다. 이를 보완하기 위해 높이 판정에 6% 안전 여유(`HEIGHT_SAFETY_MARGIN`)를 뒀다 — 넘치는 쪽보다
   살짝 이르게 줄이는 쪽이 안전하다는 판단. `letterSpacing`도 측정에 반영하지 않는다(자간이 큰
   말풍선은 실제보다 살짝 여유 있게 계산될 수 있음).
2. **`bHPad`/`bVPadTop`/`bVPadBot` 인라인 공식을 `bubbleHorizontalPadding`/`bubbleVerticalPadding`
   호출로 바꾸는 것은 순수 리팩터다** — 완전히 동일한 산술식(최소 12/8/10px, 폰트의 0.6/0.48/0.64배)을
   옮겨온 것뿐이라 자동 축소를 쓰지 않는 기존 말풍선의 렌더 결과는 바이트 단위로 동일하다.
3. **"전화/기계음" 프리셋은 box variant의 기존 모서리 반경(테마별 3~6px)을 그대로 쓴다** — "각진
   브라켓형 테두리"를 완전히 새로 그리려면(모서리 대괄호 장식 등) `BubbleEl`에 커스텀 지오메트리
   필드를 추가하고 새 렌더 분기를 만들어야 해서(요청 프롬프트가 명시한 "완전히 새로운 렌더링 로직은
   필요 없다"는 제약을 벗어난다) 이번 스코프에서 뺐다. box variant는 이미 충분히 각져 있어(모서리
   반경이 도형 크기 대비 매우 작음) 실용적으로 근사한다고 판단했다.
4. **"다급함/공포" 프리셋은 shout variant의 별 실루엣을 재사용한다.** 완전히 새로운 "삐죽삐죽한
   떨림" 지오메트리(불규칙 진폭·노이즈가 있는 윤곽)를 만들려면 새 패스 생성 함수가 필요해 스코프를
   벗어난다. 대신 기존에 하드코딩돼 있던 별의 안쪽 반경 비율(36/68 ≈ 0.53)을 `starAmplitude`
   필드로 뽑아내(하위호환 기본값 유지) 프리셋에서 0.78로 바꿔 "덜 뾰족하고 자잘하게 떠는" 느낌을
   근사했다 — 실제 손떨림 노이즈는 아니다. `angry` variant도 같은 방식으로 파라미터화했다(28/64 ≈
   0.4375 기본값 유지) — shout/angry 둘 다 같은 하드코딩 패턴이라 하나만 고치는 게 오히려 더
   부자연스러워서 함께 정리했다.
5. **꼬리(tail) 도형은 그라데이션/점선 대상에서 제외했다.** `scared`/`phone`의 말풍선 꼬리
   `<Line>`, `thought`의 구름방울 `<Ellipse>` 3개는 본체보다 훨씬 작아 그라데이션을 걸면 시각적으로
   어색하고(수 px 안에 그라데이션 스톱이 뭉개짐), 꼬리에까지 점선을 넣으면 이음새가 부자연스럽다
   판단해 본체만 반영했다.
6. **SVG 벡터 내보내기는 그라데이션/점선/별 진폭을 모르는 채로 남는다**(§2.3) — `studio-svg-export.ts`의
   `serializeBubble`/`SvgBubbleElLike`를 함께 확장해야 완전해지지만, 캔버스/PNG 저장(실제 게시
   경로)엔 영향이 없어 이번 배치에서는 뺐다. 후속 패스가 원하면 DrawEl 경로의 `gradientDef` 사용
   패턴(줄 625 근처)을 그대로 따르면 된다.
7. **그라데이션과 단색 사이 전용 토글 UI는 만들지 않았다.** TextEl은 `fillType: "solid" | "gradient"`
   토글 버튼 쌍이 있지만, DrawEl은 그런 필드 없이 "그라데이션 패널에서 색을 지정하면 자동으로
   우선 적용되고, 지우면(X 버튼) 단색으로 돌아간다"는 방식이다. Bubble도 DrawEl 쪽 관례를 따랐다
   (요청 프롬프트가 "기존 그라디언트 정의/피커 UI를 그대로 재사용"이라 명시) — `fillType` 필드를
   새로 만들지 않았다.
8. **`scared`/`system`/`angry` variant는 점선(대시) 적용 대상에서 뺐다**(§4.2 표) — 셋 다 스트로크
   색(혹은 system은 두께까지)이 테마/하드코딩으로 고정돼 있어 `el.stroke`/`el.strokeWidth` 자체를
   지금도 반영하지 않는 기존 갭이다. 사용자가 고르지 않은 색 위에 점선만 얹히면 "내가 설정한 게
   아닌데 왜 점선만 바뀌지"라는 혼란을 줄 수 있어, 이 갭을 넓히지 않는 선에서 멈췄다(이 3개
   variant의 `el.stroke` 미반영 자체를 고치는 건 이번 요청 범위 밖이라 손대지 않았다).
9. **스타일 프리셋이 이제 두 종류로 나뉜다** — "색만 바꾸는" 기존 8종(narration_box/deadpan_sarcasm/
   flashback_memory 포함, 커밋 `1dcd7b6`에서 막 재작업됨)과 "색+모양을 함께 바꾸는" 신규 2종(전화/
   기계음=box, 다급함/공포=shout). 이건 새로운 동작 클래스라 QA 체크리스트(§5)에 "모양이 바뀐 뒤
   다른 프리셋을 눌러도 모양이 유지되는지"를 별도 항목으로 넣었다 — `variant ?? selected.variant`
   폴백(§3.3)이 정확히 적용됐는지가 핵심이다.
10. **"3~4개" 중 3개만 만들었다.** 요청 프롬프트가 제시한 예시 3개(속삭임/전화·기계음/다급함·공포)를
    그대로 구현했고, 4번째(예: 나레이션 박스 계열의 다른 변형)는 카탈로그 append 지점이 명확하니
    후속 패스가 같은 패턴으로 쉽게 추가할 수 있다.
11. **(검증 단계에서 발견·수정) `lineHeight`를 선택값으로 두면 실제 렌더와 어긋난다.**
    `studio-bubble-text-fit.ts`의 `fitBubbleFontSize`가 원래 `lineHeight?: number`(미지정 시
    `1.1`로 폴백)였는데, StudioPage.tsx 실제 말풍선 렌더의 `bubbleLineHeight` 공식(`el.lineHeight ??
    (el.vertical ? 1.4 : webtoonTheme === "soft" ? 1.35 : webtoonTheme === "vivid" ? 1.2 : 1.25)`)은
    테마/세로쓰기 어느 조합에서도 `1.1`을 내지 않는다(최솟값이 `1.2`) — §1.1이 명시한 "탐색이
    가정하는 값과 실제 렌더 값은 반드시 같은 소스"라는 원칙을 패딩에는 지키면서 행간에서는 어겼던
    설계 결함이다. 여러 줄 말풍선일수록 탐색이 실제보다 낮은 텍스트 블록 높이를 가정해(최대 ~27%
    과소평가, 6% 안전 여유로는 못 덮는 크기) 폰트를 충분히 줄이지 못하고, 결과적으로 "크기 고정"
    기능의 핵심 약속(텍스트가 절대 넘치지 않음)이 깨질 수 있었다. 수정: `lineHeight`를 필수 필드로
    바꾸고(엔진이 틀린 값으로 조용히 폴백할 수 없게), §1.6/§1.8/§1.9의 통합 코드가 이미 같은
    스코프에 존재하는 `bubbleLineHeight`(또는 인스펙터 쪽 동일 공식)를 재사용하도록 갱신했다.
    같은 자리에서 `el.vertical`(세로쓰기) 말풍선의 실제 렌더 텍스트가 `el.text`가 아니라
    `formatVerticalText(el.text)`(전치된 별도 문자열)라는 것도 함께 드러나 §1.6/§1.8의 `text` 필드도
    맞춰 고쳤다 — 다만 폭 기반 워드랩이 세로쓰기 레이아웃에 개념적으로 얼마나 맞는지는 이 배치에서
    검증하지 않은 열린 질문으로 남는다(세로쓰기 말풍선에 자동 축소를 아예 비활성화하는 편이 더
    안전할 수 있다 — 후속 패스가 QA §5에서 세로쓰기 케이스를 별도로 확인하길 권장한다).
