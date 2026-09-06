# ToonSpectrum — 웹툰·웹소설 통합 인덱스

> 흩어진 이야기를, 한 권의 색인으로.
> 네이버·카카오·리디·문피아·노벨피아를 가로질러 **검색·랭킹·리뷰**를 한 곳에서 제공하는 디스커버리 서비스.

ToonSpectrum는 콘텐츠를 호스팅하지 않습니다. 플랫폼 장벽 너머에서 **"무엇을, 어디서, 왜 봐야 하는지"** 답하는 디스커버리·큐레이션 레이어입니다.

<br/>

<p align="center">
  <img src="docs/screenshots/home.png" alt="ToonSpectrum 홈 — 웹툰·웹소설 통합 인덱스(검색·랭킹·리뷰)" width="820" />
</p>
<p align="center">
  <img src="docs/screenshots/home-mobile.png" alt="ToonSpectrum 모바일 홈" width="240" />
</p>

<br/>

## 왜 만들었나 — 기존 서비스의 빈자리

네이버·카카오·리디 등은 모두 **자기 플랫폼 안에 독자를 가두는** 워터가든입니다. 독자는 작품이 "어디서, 얼마에" 볼 수 있는지 여러 앱을 오가며 확인해야 하고, 신뢰할 만한 통합 평점·리뷰도, 웹소설 원작과 웹툰화의 연결도 한눈에 보기 어렵습니다. ToonSpectrum는 그 공백을 정확히 겨냥합니다.

### 차별화 기능 (기존 서비스 대비)

| 기능 | 네이버/카카오/리디 | ToonSpectrum |
| --- | :---: | :---: |
| 플랫폼 무관 통합 작품 DB | ✕ | ✓ |
| **크로스플랫폼 "어디서 봐" 라우터** (무료/기다무/유료 비교) | ✕ | ✓ |
| 투명 산식 다축 랭킹 (6개 축) | △ 단순 조회수 | ✓ |
| 신뢰 가능한 소셜 리뷰 + **가변 별점**(별/10점/100점) | △ | ✓ |
| 스포일러 토글 + 리뷰 태그 | ✕ | ✓ |
| **원작 ↔ 웹툰 ↔ 영상화 어댑테이션 그래프** | ✕ | ✓ |
| 통합 장르 스펙트럼 / 태그 디스커버리 | △ | ✓ |
| **취향 프로필 분석 + 추천** | ✕ | ✓ |
| **대중용 트렌드·데이터 대시보드** | ✕ | ✓ |

자세한 경쟁 분석은 [`docs/competitor-analysis.md`](docs/competitor-analysis.md) 참고.

<br/>

## 핵심 화면

- **홈** `/` — 에디토리얼 히어로, 실시간 인기 랭킹, 장르 스펙트럼, 어댑테이션 스포트라이트, 큐레이션 레일
- **통합 검색** `/search` — 질의 + 패싯 필터(유형·장르·상태·플랫폼·평점·이용가·무료) + 정렬 + 그리드/리스트
- **통합 랭킹** `/ranking` — 인기·급상승·평점·정주행 몰입·완결·신작 **6개 축**, 기간(일/주/월/전체), **순위 산식 투명 공개**
- **탐색** `/explore` — 18개 장르 색상 스펙트럼 + 태그 클라우드로 떠나는 발견
- **연재 캘린더** `/calendar` — 연재요일 메타데이터 기준 요일별 보드 + **표시할 플랫폼 멀티셀렉트 필터**(원하는 플랫폼만 골라 보기)
- **작품 상세** `/title/[slug]` — "어디서 봐" 라우터, 평점 분포·정주행 지표, 어댑테이션 그래프, 리뷰, 비슷한 작품
- **리뷰 피드** `/reviews` — Letterboxd 감성의 한 줄 리뷰 피드 (스포일러 블러·공감·정렬)
- **인사이트** `/insights` — 장르·플랫폼·연도·평점·가격·어댑테이션을 시각화한 트렌드 대시보드
- **내 서재** `/library` — 관심/평가/완독 관리, **취향 분석**, 맞춤 추천, 컬렉션
- **창작 스튜디오** `/studio` — 멀티페이지 컷·말풍선·표준 3D 파일/VRM·최대 64개 샷 보드와 컷별 LT Worker 합성 PNG 일괄 렌더·권한 검증형 IndexedDB 원자 복구·공개 manifest v3 Worker ZIP 패키징·
  시간대 무드 리그·가림 관계 인지 선화·의미 재질 분석·로컬 사진 포즈 스캔·시각적 관절/손목 IK·결정론적 물리 배치·분석적 IK·
  벡터/래스터 소재·기본 G펜과 영속 즐겨찾기를 포함한 226종 브러시 카탈로그·VRM `baseColor` 표면 직접 페인팅·UV 아일랜드 Worker precompute·
  SHA-256 PNG 무결성 저장/재편집과 기기 간 portable archive·WebGPU dirty-rect 부분 업로드 준비 계층·Studio 전용 COOP/COEP 격리·
  AI 제작 보조·검토·
  복구·Publish Package와 역할 기반 팀 초대·CRC 검증 바이너리 CRDT 동시 편집·화면 공유·기본 비활성인 선택형
  최대 6인 P2P 음성 작업실과 단기 TURN 자격증명·자동 ICE 재협상·
  공유 원본·revision 충돌 방지를 합친 모바일 대응 올인원
  제작실. 컷툰/업로드 작품 형식을 보존한 채 팀 작업 목록에서 바로 전환하며, 상세 벤치마크와 구현 현황은
  [`docs/studio-competitor-features.md`](docs/studio-competitor-features.md)와
  [`docs/studio-3d-webtoon-tool-benchmark-2026-07-19.md`](docs/studio-3d-webtoon-tool-benchmark-2026-07-19.md),
  [2026-07-27 코드 기반 997행 갭 재감사](docs/studio-feature-gap-audit-2026-07-27.md) 참고
- **창작 마켓** `/market` — 스튜디오 커뮤니티 마켓플레이스의 공개 발견 표면. 브러시·필터·팔레트·템플릿·3D 프리셋·3D 에셋·에셋 7종 카테고리(클립스튜디오 ASSETS 스타일의 3D 에셋·소품·모델 거래 및 공유 지원), URL 파라미터 필터(검색·종류·라이선스·태그·배급자)와 커서 페이지네이션 탐색, 라이선스·출처·AI 사용 여부가 명시된 리소스 상세, `/studio?assetMarket=community` 딥링크로 스튜디오 자산 메뉴 커뮤니티 탭 즉시 진입. 전 리소스 무료 공유
- **2D → 3D 변환** `/studio/lift3d` — 캐릭터·소품·배경 원화 한 장을 실루엣 거리장(캐릭터·소품)과 명암 부조(배경)로 읽어 3D 모델로 세우는 스튜디오 도구. 브라우저 안에서만 계산하고(업로드·외부 추론 호출 없음), 결과는 이 앱 자신의 모델 가져오기 게이트를 통과하는 텍스처 GLB 로 나가 배경 3D 씬에 그대로 들어간다. 설계는 [`docs/studio-2d-to-3d-lift.md`](docs/studio-2d-to-3d-lift.md) 참고
- **캐릭터 셰이퍼** `/studio/character` — 프리셋 카드 15슬롯(얼굴형·눈·눈동자·코·입·귀·헤어·체형·상의·하의·신발·액세서리·표정·포즈·손 포즈)로 3D 캐릭터를 세우는 작업실. 카드 한 번이 곧 되돌리기 한 단계이고, 모델이 지원하지 않는 항목은 이유를 적어 두고 몰래 바꿔치기하지 않는다. 참고 이미지 추천·팔레트 추출·사진/웹캠 포즈는 전부 기기 안에서 처리하고, 결과는 투명 배경 PNG 또는 밑색·음영·하이라이트·주선이 나뉜 레이어 PSD 로 나간다. 사용법은 [`docs/studio/character-shaper.md`](docs/studio/character-shaper.md), 소개는 `/shaper`
- **⌘K 커맨드 팔레트** — 어디서든 통합 검색

<br/>

## 디자인 — "활자와 스펙트럼 (Type & Spectrum)"

따뜻한 잉크-블랙 위의 에디토리얼 다크. 디자인 시스템은 `impeccable` 스킬로 확립했습니다.

- **컬러**: OKLCH 토큰. 따뜻하게 틴트된 중립 + persimmon(감/주홍) 시그니처 악센트 + 18개 장르를 색상환에 매핑한 **장르 스펙트럼**
- **타이포**: 데이터/인덱스는 grotesque(Space Grotesk), 한국어 UI는 Pretendard, 문학적 순간은 serif(Nanum Myeongjo)
- **시그니처**: 인덱스 넘버럴, 스펙트럼 바, 타이포그래픽 커버(이미지 없이 활자 포스터), 어댑테이션 그래프
- 토큰·컴포넌트 규약은 [`DESIGN.md`](DESIGN.md), 제품 정의는 [`PRODUCT.md`](PRODUCT.md) 참고

<br/>

## 기술 스택

- **Vite 8** · **React 19** · **React Router 7** · **TypeScript**
- **NestJS API** — 카탈로그·랭킹·커뮤니티·내 서재·인증 엔드포인트
- **Tailwind CSS v4** (CSS-first `@theme` 토큰)
- **Zustand** (+ `localStorage` 영속화) — 평점·리뷰·북마크·취향·컬렉션
- **Motion** — 마이크로 인터랙션 · 스크롤 리빌
- 검색·랭킹·추천·취향분석 로직은 의존성 없는 순수 TypeScript (`lib/`)

## 라이브러리 (용도별)

`package.json` 기준 주요 의존성과 한 줄 용도입니다.

| 라이브러리 | 용도 |
| --- | --- |
| `drizzle-orm` + `pg` (node-postgres) | DB/ORM — PostgreSQL(로컬 docker / Neon 원격) 접근 (`DATABASE_URL`) |
| `react` · `react-dom` | UI 런타임 (React 19, React Compiler 활성) |
| `react-router-dom` | 라우팅 — React Router 7 SPA 라우트 |
| `zustand` | 상태 관리 — 평점·리뷰·북마크·취향·컬렉션 (localStorage 영속화) |
| `react-hook-form` + `@hookform/resolvers` + `zod` | 다중 필드 폼 — 관리자 플랜/캠페인·로그인/가입·리뷰 작성 폼의 상태·검증(`useForm` + `zodResolver`, 폼별 co-located 스키마) |
| `cmdk` | 커맨드 팔레트 — ⌘K 통합 검색 UI |
| `motion` | 애니메이션 — 마이크로 인터랙션·스크롤 리빌 |
| `lucide-react` | 아이콘 셋 |
| `tailwindcss` + `@tailwindcss/postcss` | 스타일 — Tailwind CSS v4 (CSS-first `@theme`) |
| `clsx` + `tailwind-merge` | 클래스 합성·중복 제거 (`cn` 유틸) |
| `vite` + `@vitejs/plugin-react` | 빌드/개발 서버 (Vite 8) |
| `babel-plugin-react-compiler` + `@rolldown/plugin-babel` | React Compiler — 자동 메모이제이션 |
| `drizzle-kit` | DB 마이그레이션·스키마 도구 |
| `typescript` · `eslint` · `typescript-eslint` | 타입 검사·린트 |
| `vitest` | 단위 테스트 |

### Studio 하이브리드 엔진 정책

Studio는 하나의 캔버스 라이브러리에 모든 책임을 몰지 않습니다. 문서·명령·히스토리·협업은
renderer-neutral canonical 모델을 권위로 두고, 아래 엔진을 교체 가능한 provider로 조합합니다.
번들 바이트와 정적 요청 수는 관찰 지표일 뿐 릴리스 차단 조건이 아니며, 픽셀 품질·입력 지연·색
정확도·대형 문서 안정성·기능 확장성을 우선합니다.

| 엔진 / 라이브러리 | Studio 역할 |
| --- | --- |
| Raw WebGPU / WGSL | RGBA16F 브러시 타일, 레이어 합성, 필터, readback·device-loss replay의 기본 픽셀 권위 |
| `canvaskit-wasm` (Skia) | 정밀 벡터·패스·텍스트·PDF/출판 렌더링 및 CPU/GPU 품질 기준 |
| `pixi.js` | 별도 투명 surface의 GPU scene graph, z-order, 선택·hover·custom hit-area와 transform overlay |
| `konva` + `react-konva` | 오브젝트·텍스트·말풍선의 선택/변형/히트테스트 overlay — 문서나 브러시 픽셀 권위는 맡지 않음 |
| `paper` + `polygon-clipping` | Bézier 교차·스무딩·단순화·부울·경로 기하 계산(화면 renderer가 아닌 동적 격리 vector geometry provider) |
| Vello 0.9.0 격리 PoC | 공식 MMark를 Chrome WebGPU/Metal에서 실측한 차세대 벡터 후보. 1600×1600·10k 경로는 p95 13.6ms였지만 50k 경로는 p95 59.6ms였고 upstream alpha·교차 브라우저·device-loss·canonical parity 게이트가 남아 제품 권위 없이 연구 후보로 유지 |
| `perfect-freehand` | 필압을 가진 centerline을 연속 잉크 outline으로 변환하는 실시간 geometry provider — 합성·질감·히스토리는 맡지 않음 |
| `lazy-brush` | 정밀 모드에서만 선택하는 입력 leash/손떨림 보정 — 기본 펜 입력에는 지연을 추가하지 않으며 예측 포인트가 상태를 오염시키지 않음 |
| `roughjs` | 문서에 저장한 seed로 결정적으로 재생하는 손그림 도형 renderer — 자유곡선 브러시 권위는 맡지 않음 |
| `p5.brush` | 검증된 `2.2.1-adapter.3` 어댑터가 전용 Worker의 private OffscreenCanvas WebGL2에서 flow-field·hatch·mass·수채 채움·플랫 워시를 처리하는 격리된 settled-only 예술 브러시 provider — 합성 채움은 별도 메모리 예산을 적용하고 image/custom tip은 실제 어댑터 검증 전까지 fail-closed |
| `rbush` | 대형 2D 문서의 동적 공간 인덱스, point/area hit-test와 topmost 후보 탐색 |
| `harfbuzzjs` | 한글·복합문자·세로쓰기·루비·OpenType/가변 글꼴의 renderer-neutral glyph shaping |
| `@resvg/resvg-wasm` | 제한·정규화된 SVG 가져오기, 미리보기, 결정적 래스터/PNG 출력 |
| `@techstark/opencv-js` | Worker 전용 선택 마스크, morphology, contour/edge, perspective, 영상 처리 provider |
| `onnxruntime-web` | WebGPU/WASM 로컬 AI 추론 — 선택·세그멘테이션·포즈·채색/작화 보조의 서버비 절감 경로 |
| Studio wet-ink binary codec | 물·이동 안료·젖음·고정 얼룩·종이 상태를 보존해 저장 후에도 동일한 물리 시뮬레이션을 재개 |
| `three` + R3F/Drei + `three-mesh-bvh` | 3D 배경/캐릭터와 raycast·surface snap·라쏘·표면 페인팅 가속 |
| `@gltf-transform/*` | GLB/glTF 읽기·정규화·확장·애니메이션·재질·압축·내보내기 파이프라인 |
| `manifold-3d` | 위상적으로 안정적인 3D 부울·절단·단면·CAD형 메시 편집 |
| `xatlasjs` | 단일 전용 Worker 안에서 직접 실행하는 자동 UV 언랩·패킹 WASM, 표면 페인팅/베이크용 atlas와 명시적 해제 |
| `@dimforge/rapier3d-deterministic-compat` | 결정적 3D 물리·충돌·배경 이펙트 시뮬레이션 |
| Studio hybrid textured-vector ink | 편집 가능한 centerline/outline과 R8 브러시 팁·종이 질감, 변형 후 결정적 재샘플링 |
| Studio corrective-driver graph | 뼈 회전·표정·사용자 scalar를 다중 보정 변형에 연결하고 충돌·미리보기·결정적 bake 관리 |
| Studio weighted-deformation oracle + Worker | point·curve·envelope를 정규화 거리 가중치로 혼합해 2D/3D 위치와 UV를 보존하며, 큰 작업은 transfer·취소·timeout·epoch를 갖춘 전용 Worker에서 fail-closed 실행 |
| Studio live-surface effects | 같은 레이어/별도 height map의 서브픽셀 변위와 단일 방향·점 조명을 비파괴 recipe로 재생 |
| Studio multi-light surface oracle + Worker | signed height·roughness·metalness·normal map에 방향·점·스폿 광원, 감쇠·Fresnel·에너지 분할 specular를 결정적으로 합성하고 전용 Worker에서 transfer·취소·timeout·epoch를 fail-closed 처리 |
| Studio spectral pigment mixing | 400–700nm 반사율을 Kubelka–Munk K/S와 유한 두께 two-flux 층으로 혼합하고 CIE 관찰자 근사를 거쳐 scene-linear 색으로 변환 |
| Studio signed impasto height | add·excavate·erase·flatten과 종이/팁 질감, 압력·속도, 보존형 plow를 signed height·색·roughness 채널에 결정적으로 기록 |
| Studio individual-fiber bristle oracle + Worker | seeded 섬유별 강성·splay·bend·종이 접촉·안료 잔량·pickup을 고정 arc-length station으로 계산하고 append/rebuild를 동일 replay로 보존하며 전용 Worker 경계에서 입력·출력 소유권과 취소·복구를 강제 |
| Studio out-of-core export | BigInt/decimal 좌표, lazy row/Morton 타일, exact halo crop, resume 무결성 재검증과 메모리 backpressure로 브라우저 캔버스·상주 메모리보다 큰 원고를 renderer/sink 독립적으로 출고 |
| Studio physics-particle brush oracle + Worker | generic orbital·flow·spring-net 입자를 fixed arc/timestep으로 재생하고 flow field·smoothed chaos·pressure/speed/tilt expression과 exact append/rebuild를 보존하며 전용 Worker에서 모든 실패를 hard terminate·cold restart |
| Studio procedural media-surface oracle + Worker | 독점 종이 스캔 없이 seeded relief·fiber·weave·pore를 생성하고 height·absorbency·grain·flow를 전역 좌표로 평가해 full-frame과 tile+halo 결과를 동일하게 유지하며 전용 Worker에서 typed-array transfer·취소·복구 |

새 후보는 라이선스·공급망, lazy/Worker 격리, 취소·예산·복구 receipt, 실제 브라우저 품질 게이트를
통과한 뒤 같은 provider 계약 아래 승격합니다. Vello처럼 유망하지만 웹 지원이 alpha인 엔진은
제품 권위를 주지 않고 실험실에서 비교하며, 실측 근거와 한계는
[`studio-vello-observed-poc.ts`](src/domains/creator/studio-vello-observed-poc.ts)에 고정합니다.
더 나은 결과가 모든 hard gate에서 확인되면 기존 provider를 교체합니다.
Signature Pad·Atrament·Croquis는 필기 품질 비교용 benchmark oracle일 뿐 런타임 의존성이 아니며,
Fabric.js는 Konva와 장면 모델이 중복되어 제품 런타임 도입 대상에서 제외합니다.
위 표는 provider의 계산·소유권 경계를 설명하며 곧바로 Studio UI 연결 완료를 뜻하지 않습니다.
실제 기능 완료는 선택 UI부터 live/commit, Undo, 저장·재열기, 협업, 내보내기와 실브라우저 검증이
한 수직 경로로 닫힌 경우에만 판정합니다.
상용 기능의 공식 근거, clean-room 독립 구현 경계, 현재 단계와 다음 승격 순서는
[`docs/studio-commercial-clean-room-radar-2026-07-28.md`](docs/studio-commercial-clean-room-radar-2026-07-28.md)에서
지속해서 관리합니다.
이번 provider 파동에서 추가한 제3자 패키지의 정확한 버전·라이선스·원본 저장소는
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)에 별도로 기록합니다.

> 참고: 클라이언트 검색은 입력마다 `/api/search` 네트워크 요청으로 동작합니다. `useDeferredValue`는 네트워크 호출을 디바운스하지 않으므로(메모리 내 파생 렌더만 지연) 검색/팔레트에는 적용하지 않습니다.

## 실데이터 수집과 스냅샷 갱신

작품 데이터는 하드코딩 seed가 아니라 크롤러가 만든 검증 스냅샷을 운영 소스로 사용합니다. `lib/data/` seed 모듈은 제거했고, 기본 사용자 경로는 `apps/api/data/catalog.json.gz`를 빌드 시 `public/data/*.json`으로 변환해 Vercel/CDN에서 제공하는 정적 카탈로그입니다. **카탈로그는 파일 전용입니다** — Nest API도 같은 gz 파일(`WEBDEX_CATALOG_FILE`로 재정의 가능)을 부팅 시 로드하고 파일 스탯 폴링으로 핫 리로드하며, DB는 동적 데이터(리뷰·커뮤니티·계정·창작) 전용입니다(DB `catalog_snapshot` 읽기/쓰기는 `WEBDEX_CATALOG_FORCE_DB=1` 레거시 모드 전용). 파일이 없으면 빈 런타임 카탈로그로 시작해 잘못된 하드코딩 데이터가 노출되지 않게 합니다.

```bash
pnpm crawl                       # 크롤러 JSON을 stdout으로 출력(서버 스케줄러용)
pnpm ingest                      # 크롤 후 catalog.json.gz 원자적 갱신(DB 불필요; --db는 레거시)
pnpm ingest --from out.json      # 미리 크롤해 둔 JSON 적재(재크롤 없음)
pnpm catalog:gen                 # apps/api/data/catalog.json.gz → public/data/*.json 정적 카탈로그 생성
KMAS_PRV_KEY=... pnpm kmas:update-catalog  # 기존 catalog.json.gz 썸네일 URL/줄거리/연령등급을 규장각 API 응답으로 점진 병합
```

> DB는 **PostgreSQL**입니다(`apps/api/src/db`가 `DATABASE_URL`로 연결, 미설정 시 로컬 docker `:55432` 폴백). 리뷰·커뮤니티·인증 같은 동적 데이터와 ingest 실행 이력(수 KB)에만 사용합니다 — 카탈로그 본문은 DB에 저장하지 않습니다. 설정은 아래 [실행](#실행)의 "DB 준비"를 참고하세요.

- **웹툰**: 요일별/완결 목록 전체를 검색 색인으로 저장하고, 상위/설정 범위는 상세 API로 제목·작가·**별점·장르·시놉시스·태그·연재요일·연령등급·연재 시작 연도·표지 썸네일**을 보강합니다. 카카오웹툰/레진을 비롯한 14개 공개 카탈로그도 추가로 정규화합니다.
- **웹소설**: 웹툰의 원작 정보(`novelOriginAuthors`)로 실제 원작 엔트리와 **원작↔웹툰 어댑테이션 연결**을 생성하고, 네이버 시리즈 장르 랭킹으로 보강.
- **규장각 실시간 병합**: `KMAS_PRV_KEY`가 설정되어 있으면 웹 앱 진입 시 브라우저가 `/api/kmas/merge-on-access`를 한 번 호출하고, 서버가 기존 스냅샷의 노출 우선순위 작품을 만화규장각 Open API(`result` + `itemList`)로 제목 조회해 `imageDownloadUrl` 썸네일 URL, `outline` 줄거리, 연령등급을 병합합니다. KMAS 썸네일은 기존 크롤 썸네일 URL과 같은 `coverImage` 메타데이터로 저장/노출하되, 이미지 바이너리는 저장하지 않고 `/api/cover` 서버 프록시로도 중계하지 않습니다. `/api/home` 등 카탈로그 API 진입도 같은 병합 루틴을 공유합니다. `KMAS_MERGE_ON_ACCESS=0`으로 끌 수 있고, `KMAS_MERGE_ON_ACCESS_LIMIT`/`KMAS_RESPONSE_ENRICH_LIMIT`로 최초 병합·응답 보강 건수를 조절합니다. 외부 KMAS 진입 병합 결과는 `KMAS_MERGE_ON_ACCESS_TTL_MS` 동안 서버 메모리에 캐시되며 기본값은 5분입니다. 제목별 KMAS 조회도 일 1,000회 한도와 응답 지연을 줄이기 위해 서버 메모리 TTL 캐시를 사용하며, 기본값은 24시간입니다(`KMAS_LOOKUP_CACHE_TTL_MS`). 클라이언트가 인증키를 직접 들고 호출하지 않도록 서버 프록시 `/api/kmas/book-webtoons`도 제공합니다.
- **KMAS 전체 목록 제약**: `bookAndWebtoonList`와 `dcmtDtaList` 모두 `prvKey`만 붙인 무조건 전체 목록 호출은 실제 응답에서 `데이터가 없습니다.`를 반환합니다. 전체 목록 단독 호출 검증 경로는 남겨두되, 운영 갱신은 기존 카탈로그 제목을 기준으로 공식 KMAS 응답을 매칭합니다.
- **표지 썸네일**: 플랫폼 표지는 핫링크/CORS 회피를 위해 Nest API의 `/api/cover` 프록시를 경유해 표시합니다. 허용 호스트는 플랫폼별 표지 CDN으로 한정합니다 — pstatic·kakaopagecdn·kakaocdn·lezhin·ridicdn·munpia·joara·cloudfront(포스타입)·mrblue·bookcube·onestore·yes24·novelpia·balcony(봄툰)·toptoon·toomics·kyobobook. KMAS 썸네일은 `/api/cover`로 중계하지 않고, KMAS API가 응답한 `imageDownloadUrl` 원본 URL을 `coverImage`로 직접 노출합니다.
- 평가 수·평점 분포·완독률·몰입 지수 등 공개되지 않는 일부 보조 지표는 추정값이며, 랭킹은 실제 수집 데이터에 산식을 적용해 계산합니다. **네이버 웹툰 별점은 실수집이지만, 네이버가 공개 조회수 집계를 비공개로 전환(목록 API가 `viewCount=0` 응답)함에 따라 조회·관심수는 추정값(≈)으로 표시합니다.** 어떤 경로로든 조회수가 0/누락이면 `scripts/crawl.mjs`의 `normalizeStats`가 별점·해시 기반 추정값으로 보정하고, 해당 작품은 `statsEstimated` 플래그로 표기되어 화면에서 ≈/추정 배지가 붙습니다(**"조회 0" 노출 방지**).
- **플랫폼 커버리지(19개 슬롯)**: 공개 카탈로그 크롤러로 수집 가능한 플랫폼 — 네이버웹툰·네이버시리즈·카카오웹툰·카카오페이지·레진·리디·문피아·조아라·노벨피아·봄툰·탑툰·포스타입·미스터블루·투믹스·북큐브·원스토리·교보문고·예스24·코미코. 구현 상태는 `scripts/crawlers/<id>.mjs`와 `apps/api/src/server/catalog-sources.ts`가 관리합니다. 로그인/성인 인증/약관을 우회하지 않고 공개 목록 메타데이터만 사용합니다. **피너툰**(도메인 연결 종료)·**버프툰**(서비스 종료, nc.com 리다이렉트)은 폐기 서비스라 목록에서 제외했습니다. **코미코**는 운영 중이지만 한국 외 IP를 방화벽에서 차단(지오펜스)하므로, 크롤러(`scripts/crawlers/comico.mjs`)를 **KR egress 조건부**로 배선했습니다 — 한국 리전 egress(운영 크론)에선 자동 수집되고, 그 외 환경에선 첫 요청 타임아웃 시 즉시 빈 결과로 종료합니다. 또한 검색·랭킹·캘린더의 플랫폼 필터는 **카탈로그에 실제 존재하는 플랫폼만** 노출하므로(데이터 기반), 수집되지 않은 환경에서 코미코가 빈 슬롯으로 보이지 않습니다.
- **DB 주기 갱신**:
  - `CATALOG_INGEST_MODE=off|fixed`
  - `CATALOG_INGEST_INTERVAL_SECONDS=1800`
  - `CATALOG_INGEST_TRIGGER_TOKEN` 설정 시 `/api/catalog/ingest/run` 수동 실행 가능
  - `/api/catalog/ingest/status`에서 current snapshot, 최근 실행 이력, 다음 실행 예정 시각 확인
  - `WEBDEX_SOURCE_IDS=all` 또는 쉼표 구분 source id로 실제 실행 소스를 제한
- **랭킹 갱신성**: 웹 기본 경로는 `/api/ranking` 서버 응답이며, 정적 모드(`VITE_CATALOG_SOURCE=static`)에서는 `scripts/build-static-catalog.ts`와 `src/catalog-static.ts`가 사전 계산한 파일을 사용합니다. 두 경로 모두 기본 랭킹은 같은 스냅샷 산식으로 동작하고, 규장각 병합은 작품 메타와 썸네일 URL 보강에만 적용됩니다. `lib/server/live.ts`의 실시간 어댑터와 `WEBTOON_LIVE_*` 환경변수는 보존되어 있지만, 별도 운영 경로로 다시 연결하기 전까지 기본 랭킹에는 외부 실시간 랭킹 호출을 반영하지 않습니다.
- **카탈로그 호출 경로**: 웹 기본값은 `/api/*` 서버 경로입니다. 규장각 병합·런타임 정책을 타지 않는 완전 정적 카탈로그가 필요하면 `VITE_CATALOG_SOURCE=static`을 명시합니다.

법적 리스크 완화를 위해 기본 수집 모드는 `off`입니다. 운영 전 플랫폼별 robots.txt, 이용약관, API 약관, 제휴 가능성, 저장 필드 범위를 검토해야 합니다. 랭킹 산식·스냅샷 모드·보존된 live 어댑터의 경계는 [`docs/ranking-architecture.md`](docs/ranking-architecture.md)에서 확인하세요. 수집 → 스냅샷 → 정적 카탈로그/API → 화면 노출까지의 전 과정 도식과 단계별 설명은 [`docs/data-pipeline.md`](docs/data-pipeline.md)를 참고하세요.

## 실행

```bash
pnpm install
pnpm dev          # Vite 웹앱: http://localhost:5173
pnpm dev:api     # http://127.0.0.1:4001
pnpm dev:all     # 권장: 웹앱(:5173) + Nest API(:4001) 한 번에 실행
pnpm build && pnpm start   # 프로덕션 프리뷰
```

### Studio 3D 에셋 배치 업로드

`toonstudio` 쪽 3D 배경/캐릭터/소품을 `manifest`로 묶어 운영 API에 업로드하려면
[`docs/studio-asset-upload-automation.md`](docs/studio-asset-upload-automation.md)를 그대로 따라오면 됩니다.

권장 로컬 원샷 플로우:
1. `pnpm run studio:toolchain:setup -- --check`로 준비상태 점검
2. `pnpm run studio:asset:release -- --auto-deploy -- --auto-demo-login --type auto --max-items 20`
- `--auto-deploy`는 GitHub Actions `Studio 3D Asset Batch Upload`를 `main` 브랜치 기준으로 dispatch 합니다.
- 운영에서 `studio:batch`/`studio:upload-assets`는 여전히 사용 가능하며, 단일 명령으로 관리하려면 `studio:asset:release` 권장.
- `TOONSTUDIO_HOME`을 고정하면 다른 경로에서도 동일하게 실행 가능합니다.
- 운영 배포 체크리스트와 토큰 관리(Secret) 규칙은 위 문서의 “운영 배포 마무리 체크리스트” 참조

```bash
pnpm run studio:manifest:generate -- --source-dir ./batch_source --output batch_generated/manifest.json
pnpm run studio:batch -- --source-dir ./batch_source --output batch_generated/manifest.json -- --dry-run --max-items 20
pnpm run studio:toolchain:setup -- --check
pnpm run studio:upload-assets:dry-run -- --manifest batch_generated/manifest.json --max-items 20
TOONSTUDIO_HOME="/path/to/toonspectrum"
pnpm --dir "$TOONSTUDIO_HOME" run studio:asset:release -- \
  --source-dir "$TOONSTUDIO_HOME/batch_source" \
  --manifest "$TOONSTUDIO_HOME/batch_generated/manifest.json" \
  --auto-deploy \
  --deploy-ref main \
  --deploy-environment production \
  -- \
  --auto-demo-login \
  --type auto \
  --work-title "toonbatch-$(date +%Y%m%d)" \
  --max-items 20
```

### DB 준비 (PostgreSQL / Neon)

DB는 **PostgreSQL**입니다 — 로컬은 docker, 원격·배포는 **Neon**(서버리스 Postgres). `DATABASE_URL`은 필수이며, Studio 다중 인스턴스와 SQL migration에는 transaction pooler가 아닌 `STUDIO_LIVE_POSTGRES_URL` direct endpoint도 필요합니다. 개발/빈 DB는 스키마를 push한 뒤 historical SQL(0001~0019)을 한 번 적용하고, 구조 증명에 성공한 history를 checksum 원장에 채택하면서 genuine pending(0020~0022, 0024~0025)을 적용한 다음 카탈로그를 적재하세요. `0023`부터 배포 원장은 이미 적용한 migration을 다시 실행하지 않으며, 파일 변경·중단 상태·중간 번호 누락을 fail-closed로 처리합니다. 필요한 capability가 빠진 프로세스는 요청 중 DDL을 실행하지 않고 readiness/부팅 단계에서 실패합니다.

**A. 로컬 docker Postgres**

```bash
docker run -d --name wd-pg \
  -e POSTGRES_USER=webdex -e POSTGRES_PASSWORD=webdex -e POSTGRES_DB=webdex \
  -p 55432:5432 postgres:16-alpine
export DATABASE_URL='postgresql://webdex:webdex@127.0.0.1:55432/webdex'
export STUDIO_LIVE_POSTGRES_URL="$DATABASE_URL"
```

**B. 원격 Neon** — `.env.local`에 연결 문자열만 넣으면 크롤·ingest·API가 모두 원격을 사용합니다.

```bash
# .env.local (gitignore됨): 앱 일반 쿼리는 pooler, realtime migration/adapter는 direct endpoint
echo 'DATABASE_URL="postgresql://<user>:<pw>@<host>-pooler.<region>.aws.neon.tech/<db>?sslmode=verify-full"' >> .env.local
echo 'STUDIO_LIVE_POSTGRES_URL="postgresql://<user>:<pw>@<direct-host>.<region>.aws.neon.tech/<db>?sslmode=verify-full"' >> .env.local
set -a; source .env.local; set +a
```

**C. 선택한 완전한 빈 로컬 DB 최초 provision** — 아래 `drizzle-kit push`는 public table이 없는
DB에 처음 한 번만 실행합니다. Drizzle 0.31.x의 반복 push는 FK/unique 재정렬 오류가 있으므로 이미
provision된 DB의 upgrade나 운영 rolling migration에 사용하지 않습니다. migration runner는
`scripts/production-database-migrations.manifest`가 모든 numbered SQL 파일을 정확히 한 번씩
0001부터 번호 누락 없이 정렬해 포함하는지 검사합니다. 최초 `adopt`는 0019까지의 relation,
constraint/index, comment re-anchor, AI gate/receipt, 0017 cutover marker를 먼저 증명한 뒤 해당
checksum을 `adopted`로 기록하며 과거 migration을 재실행하지 않습니다.

수동 DDL 대신 fail-closed bootstrap 명령 하나를 사용합니다. 먼저 `--plan`은 읽기 전용으로
대상 DB, 다른 연결, 기존 application object, migrator/runtime 역할 분리, manifest와 schema
fingerprint를 검사합니다. URL과 비밀번호는 출력하지 않습니다.

```bash
release_sha="$(git rev-parse HEAD)"
MIGRATION_DATABASE_URL="$STUDIO_LIVE_POSTGRES_URL" \
  pnpm db:bootstrap:production-empty -- \
    --plan \
    --allow-loopback \
    --runtime-database-role webdex_runtime \
    --release-sha "$release_sha"
```

계획이 빈 DB임을 확인한 뒤 실행합니다. runtime role이 아직 없을 때만 별도 runtime 연결에
사용할 24자 이상의 비밀번호를 환경변수로 제공합니다. 명령은 `pg_trgm`, 현재 Drizzle base,
reviewed 0001~0019 구조, checksum adoption, 실제 0020~0022/0024~0025 forward migration, runtime 최소
권한, idempotent apply와 전체 capability verifier를 순서대로 수행합니다.

```bash
MIGRATION_DATABASE_URL="$STUDIO_LIVE_POSTGRES_URL" \
BOOTSTRAP_RUNTIME_DATABASE_PASSWORD='<runtime-role-secret-if-missing>' \
  pnpm db:bootstrap:production-empty -- \
    --execute \
    --allow-loopback \
    --runtime-database-role webdex_runtime \
    --release-sha "$release_sha" \
    --confirmation BOOTSTRAP-EMPTY-TOONSPECTRUM-DATABASE
```

대상에 application object가 하나라도 있으면 실행은 거부됩니다. 백업과 대상 DB 확인을 마친
**폐기 가능한 DB**만 계획 출력에 표시된 DB명 결합 토큰을 별도로 추가해 초기화할 수 있습니다.
예: `--reset-confirmation RESET-AND-BOOTSTRAP-TOONSPECTRUM-DATABASE:webdex`. 이 승인은
`public`과 `toonspectrum_ops` application schema의 모든 데이터를 삭제하며 다른 DB 이름에는
재사용할 수 없습니다. 실행 중 schema/migration 소스가 바뀌거나 다른 client가 연결되면 즉시
중단되고, 부분 상태를 자동 채택하지 않습니다.

`--execute`는 사전 점검 뒤 runtime role을 대상 DB에 한정해 일시적으로 `NOLOGIN`으로
전환하고, 전환 직후 다른 client가 끼어들지 않았는지 다시 확인한 다음에만 DDL을 시작합니다.
따라서 `PUBLIC`의 기본 `CONNECT` 권한이 남아 있어도 새 runtime writer는 들어올 수 없습니다.
정상 완료와 포착 가능한 실패에서는 `finally` 경계가 `LOGIN`을 복원하고 최종 verifier가 이를
재확인합니다. 호스트 강제 종료처럼 복원 코드를 실행할 수 없었던 경우에는 fail-closed로
`NOLOGIN`이 남을 수 있습니다. bootstrap 프로세스가 완전히 종료되고 다른 client가 없음을
확인한 뒤 migrator로 `ALTER ROLE webdex_runtime LOGIN;`을 실행하고, 반드시 `--plan`과 capability
verifier를 다시 통과시킨 후 API를 시작합니다. `--plan`은 역할이나 ACL을 변경하지 않습니다.

기존 운영 DB upgrade에는 `drizzle-kit push`를 사용하지 않고, 앱 시작 시에는 어떤 DDL도 실행하지
않습니다.
[production-database-migrations.yml](.github/workflows/production-database-migrations.yml)을
정확한 release commit SHA로 수동 실행하고,
`production-database` GitHub Environment의 required reviewer 승인과
`PRODUCTION_DATABASE_DIRECT_URL` secret, `PRODUCTION_RUNTIME_DATABASE_ROLE` variable을 사용합니다.
direct URL은 runtime 앱 role과 별개인 전용 DDL migrator role이어야 하며 runtime role은 migrator
role을 포함한 다른 role을 상속하거나 DB·extension·`public` 객체를 소유할 수 없고, DB 또는
`public` schema의 `CREATE` 권한과 `toonspectrum_ops` schema/원장 table의 어떤 권한도 가질 수
없습니다. migration runner는 `PUBLIC`과 runtime role의 원장 접근을 매번 회수한 뒤 verifier와
동일한 0024 object-storage 컬럼 권한 계약을 적용하고, 0025 인증 lifecycle 스키마·인덱스와
runtime DML 권한을 검증합니다. runtime
role의 public relation/sequence 최소 DML GRANT와 실제 `DATABASE_URL` canary는
[`DEPLOY.md`](DEPLOY.md)의 운영 전제대로 별도 완료해야 합니다. URL은
구조 파싱 후 `postgresql:`/`postgres:`
protocol, credentialed authority, direct hostname을 확인하고, query는
`sslmode=verify-full&channel_binding=require`만 정확히 한 번씩 허용합니다. `host`, `hostaddr`,
`service`, `port`, `user`, `dbname`, `options`를 포함한 libpq override와 pooler hostname은
거부합니다. DB secret은 URL 검증·migration·capability 검증 step에만 전달됩니다.

최초 원장 도입은 `migration_mode=adopt`와
`ADOPT-TOONSPECTRUM-MIGRATION-HISTORY`, 이후 일반 배포는 `migration_mode=apply`와
`APPLY-TOONSPECTRUM-PRODUCTION-MIGRATIONS`를 사용합니다. 중단되어 `applying`/`failed`가 남으면
일반 실행은 거부되며, 원인을 확인한 뒤에만 `migration_mode=repair`와
`REPAIR-TOONSPECTRUM-MIGRATION-STATE`를 사용합니다. `repair`는 checksum이 일치하는 기존
`applying`/`failed` row만 재개하며, 원장이 없거나 누락된 history/pending migration을 생성하는
우회 경로로 사용할 수 없습니다. durable lock이 남아 있으면 DB에서 확인한 exact 64자리
`ownerToken`을 workflow의 `stale_lock_owner_token`에 입력해야 하고, 획득 후 60분이 지나지 않은
lock은 token이 일치해도 active runner로 간주해 탈취하지 않습니다. 모든 mode는
`NO-STUDIO-WRITERS` 확인과 Environment reviewer 승인을 요구합니다. workflow는 exact checksum
원장, 현재 runtime health relation 전체, comment reanchor, Marketplace generated search/GIN
opclass, `pg_trgm`, `0017` cutover marker를 함께 검증합니다.

이 workflow는 이미 provision된 운영 DB upgrade 전용이며 `user`, `creator_work`,
`creator_work_live_lock` base relation이 없으면 DDL 전에 실패합니다. 새 production DB bootstrap은
별도의 승인·검증 작업으로 먼저 완료해야 합니다. `0017` 최초 cutover와 최초 adoption 전에 모든
Studio writer를 drain해야 합니다. Render pre-deploy 등 다른 migration writer와 동시에 활성화하면
안 됩니다. API writer drain, live-lock revision cutover, retry, emergency rollback 절차는
[`docs/STUDIO-LIVE-LOCK-REVISION-MIGRATION.md`](docs/STUDIO-LIVE-LOCK-REVISION-MIGRATION.md)를 따릅니다.

> 데이터 갱신: 정적 운영에서는 `pnpm catalog:gen`으로 `public/data/*.json`을 재생성하고 재배포합니다. API는 gz 파일 mtime/size 폴링(`CATALOG_REFRESH_POLL_SECONDS`, 기본 60s — DB 왕복 없음)으로 새 카탈로그를 **무중단 핫 리로드**하거나, `POST /api/catalog/refresh`로 즉시 반영합니다. 전체 흐름은 [`docs/data-pipeline.md`](docs/data-pipeline.md) 참고.

## 프로젝트 구조

```
apps/web/            Vite·React 브라우저 애플리케이션
  src/app/           부트스트랩·라우팅·서비스 워커·앱 셸
  src/domains/       creator·catalog·community·auth 등 기능 도메인
  src/shared/        도메인 간 브라우저 서비스·계약·정적 카탈로그 런타임
  src/components/    앱 셸·오류·브라우저 호환 컴포넌트
  src/infrastructure/ API·클라우드 저장소 클라이언트
  public/             브라우저 배포 자산
apps/api/            NestJS 백엔드
```

<br/>

> **데이터 고지** — 작품 메타데이터와 공개 수치는 공개적으로 접근 가능한 소스에서 수집합니다. 평가 수·평점 분포·완독률·몰입 지수 등 플랫폼이 공개하지 않는 지표는 추정값(≈)으로 표기합니다. 표지 이미지의 저작권은 각 저작권자에게 있으며, 운영 시 플랫폼별 약관·robots·제휴 가능성을 준수합니다.

## 저장소 구조 원칙

브라우저 애플리케이션은 `apps/web`, NestJS 백엔드는 `apps/api`에 있습니다. 웹과 API가 함께 사용하는 계약·엔진은 `packages`에 두고, 저장소 전용 검증 코드는 `scripts`, `tools`, `e2e`, `tests`에 둡니다. 경계와 경로 규칙은 [ARCHITECTURE.md](ARCHITECTURE.md)를 참고하세요.

### 런타임 소스 지도

프런트엔드는 `apps/web/src/app`(부트스트랩·라우팅), `apps/web/src/domains`(기능 도메인), `apps/web/src/shared`(도메인 간 브라우저 서비스·호환 경계)를 중심으로 구성합니다. 백엔드 기능은 `apps/api/src/modules`, 외부 서비스 어댑터는 `apps/api/src/infrastructure`, 스키마·마이그레이션은 `apps/api/src/db`, 서버 유스케이스는 `apps/api/src/server`에 둡니다. 루트 `api/` 파일은 Vercel 진입점용 어댑터이며 애플리케이션 로직이 아닙니다.
