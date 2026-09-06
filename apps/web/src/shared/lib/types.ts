// 시밍: 도메인 타입은 @toonspectrum/core 패키지(packages/core/src/types.ts)로 이전됨 — 웹 앱·API가 공유.
// 상대 경로 재-export 로 plain-node(API-from-dist) 도 컴파일된 .js 로 해석되게 한다(bare @toonspectrum/core
// 지정자는 node 가 .ts exports 를 못 풀어 부적합 — 번들러/tsx/vitest 는 동일 realpath 라 영향 없음).
export * from "../../../../../packages/core/src";
