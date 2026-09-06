// 시밍: 런타임 카탈로그 스토어(TITLES·replaceCatalogData·getTitle·activeTags 등)는
// @toonspectrum/core 패키지(packages/core/src/server/catalog-store.ts)로 이전됨.
// 상대 경로 재-export 로 모든 소비자(Vite 웹 번들러·tsx 스크립트·vitest·plain-node API-from-dist)가
// 동일 모듈 인스턴스를 공유한다 — bare 패키지 지정자는 plain-node 가 .ts exports 를 못 풀어 부적합.
export * from "../../../../../../packages/core/src/server/catalog-store";
