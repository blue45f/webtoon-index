// 시밍: 카탈로그 슬리밍 규약(toListTitle·detailShard*·mergeDetailExtra 등)은 @toonspectrum/core 패키지
// (packages/core/src/catalog-slim.ts)로 이전됨. 상대 경로 재-export — plain-node(API-from-dist) 런타임이
// 컴파일된 .js 로 해석되도록(bare @toonspectrum/core 지정자는 node 가 .ts exports 를 못 풀어 부적합).
export * from "../../../../../packages/core/src";
