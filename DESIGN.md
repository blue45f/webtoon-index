# ToonSpectrum — 디자인 가이드

시그니처 디자인 언어: **"활자와 스펙트럼"**. 따뜻한 잉크-블랙 위의 편집적 다크. 콘텐츠 아트와 데이터가 주인공.

## 테마

다크 모드만 사용한다(확정). 장면: *새벽 1시 침대, 폰으로 다음 정주행작을 고르는 25세.* 라이트 모드 없음 — 콘텐츠 아트는 어둠 위에서 빛난다.

## 색상 — OKLCH

따뜻하게 틴트된 중립(hue ~70). `#000`/`#fff` 절대 금지. 전략: **확정** (잉크-블랙 표면 + 단일 시그니처 악센트 persimmon + 장르 스펙트럼).

```
중립(따뜻한 잉크)
--color-canvas      oklch(0.155 0.008 70)   페이지 바탕
--color-panel       oklch(0.185 0.009 68)   상단바·사이드·시트
--color-card        oklch(0.205 0.010 66)   카드 표면
--color-raised      oklch(0.245 0.011 64)   카드 위 요소
--color-line        oklch(0.305 0.012 64)   기본 보더
--color-line-strong oklch(0.42 0.013 64)    강조 보더
--color-fg          oklch(0.95 0.010 85)    본문(크림)
--color-fg-2        oklch(0.74 0.012 78)    보조
--color-fg-3        oklch(0.57 0.012 76)    희미

악센트(persimmon 감/주홍) — 라이브·액티브·프라이머리 신호 전용
--color-accent      oklch(0.72 0.185 42)
--color-accent-2    oklch(0.66 0.200 38)    hover/strong
--color-accent-soft oklch(0.72 0.185 42 / 0.14)
--color-on-accent   oklch(0.20 0.02 60)     악센트 위 텍스트

보조/시맨틱
--color-cool        oklch(0.80 0.11 232)    info/보조 신호
--color-good        oklch(0.80 0.15 150)    success·상승·무료
--color-warn        oklch(0.82 0.15 80)     warning
--color-bad         oklch(0.66 0.20 25)     error·하락·19금
```

장르 스펙트럼: 18개 장르를 색상환에 매핑(L 0.72 / C 0.15 고정, hue만 변주). `lib/genre-color.ts`가 단일 출처. 칩·바·그래프에서 일관 사용. 악센트(persimmon)와 충돌하지 않게 데이터 맥락에서만.

**Warm-ink 축 강제(필독).** 모든 중립 표면·그라디언트·그림자·장식 글로는 **hue ≈ 64–70** 축에만 둔다(예: 헤더/푸터 그라디언트, 카드 hover 그림자, hero 글로). hue 23x–27x 계열 쿨-블루/퍼플은 중립·장식 맥락에서 금지 — 따뜻한 잉크 명제를 정면으로 위반한다. 쿨톤은 오직 시맨틱 `--color-cool`(info/보조 신호, hue 232)로만, 데이터 맥락에서 의도적으로 사용한다. 색은 정보지 장식이 아니며, raw `rgb()/rgba()`/hex 대신 항상 OKLCH를 쓴다(`#000`/`#fff` 절대 금지).

## 타이포그래피

개념: **grotesque = 데이터/인덱스 voice, serif = 소설/문학 voice, sans = UI/한국어**.

- `--font-display` Space Grotesk → 로고 ToonSpectrum, 대형 인덱스 넘버럴(랭킹), 통계 수치, 섹션 영문 라벨. 라틴/숫자 전용. tabular-nums.
- `--font-sans` Pretendard → 모든 한국어 본문·UI·라벨. 기본 패밀리.
- `--font-serif` Nanum Myeongjo → 에디토리얼 순간에만(웹소설 인용·hero 문학 라인·리뷰 풀쿼트). 절제.

스케일(고정 rem, ratio ~1.2, 대형 디스플레이만 예외적으로 큼). tracking: 디스플레이/넘버럴 약간 타이트(-0.02em), 영문 라벨 대문자는 +0.12em.

## 깊이와 표면

플랫 + 경계 우선. 그림자는 거의 안 씀(다크에선 약함). 깊이는 surface 단계(canvas→panel→card→raised) + 보더 + 미세한 inner highlight로. **중첩 카드 금지.**
시그니처 텍스처: 아주 옅은 **ledger 그리드 해어라인**(배경) — 색인/대장(臺帳) 느낌.

## 시그니처 요소(고유 자산)

1. **인덱스 넘버럴**: 랭킹의 대형 tabular grotesque 숫자 + persimmon. baseline에 hairline.
2. **스펙트럼 바**: 다중 스톱 가로 그라디언트 바 = 평점분포/트렌드/장르믹스. 데이터 시그니처 모티프. 어디서나 재사용.
3. **장르 스펙트럼 칩**: 장르별 고유 hue 틴트 칩(플랫 그레이 금지).
4. **"어디서 봐" 라우터**: 플랫폼 브랜드 도트 + 가격 태그(무료/기다무/유료)의 신호판.
5. **어댑테이션 그래프**: 원작→웹툰→영상화 노드 연결 시각화.
6. **타이포그래픽 커버**: 실제 이미지 대신 장르 그라디언트 + 디스플레이 타이포 포스터(의도된 에디토리얼 미감).

## 컴포넌트(필수 상태: 기본/호버/포커스/활성/비활성/로딩/오류)

- 버튼: solid(accent, on-accent 텍스트) / ghost(line 보더) / quiet(텍스트). radius 0.625rem. focus ring = accent.
- 칩/태그: 장르=스펙트럼 틴트, 일반 태그=raised. 토글 가능.
- 작품 카드: 타이포그래픽 커버 + 제목 + 메타 + 미니 평점. hover 시 미세 lift + 커버 디테일.
- 별점: 가변 스케일(반쪽별/10점/100점) 입력 + 0.5단위 hover.
- 스켈레톤 로딩(스피너 금지). 빈 상태는 인터페이스를 가르친다.
- 커맨드 팔레트(⌘K): 통합 검색 진입점.

## 모션

제품 규범: 150–250ms, ease-out-expo(`cubic-bezier(0.16,1,0.3,1)`). 상태 전달 전용, 페이지 로드 안무 금지.
시그니처 마이크로: 탭 active underline `layoutId`, 수치 count-up, 스펙트럼 바 fill-in, 카드 hover lift, 커버 미세 parallax. `prefers-reduced-motion` 존중.

## 레이아웃

상단바(검색·⌘K·내 서재) 고정. 홈은 에디토리얼 비대칭 리듬, 검색/랭킹은 예측 가능한 그리드. 컨테이너 max ~1280px, 본문 prose 65–75ch. 반응형은 구조적(컬럼 붕괴), 폰트는 고정.
