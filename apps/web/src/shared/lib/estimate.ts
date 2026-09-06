// 시밍: statsAreEstimated 등 추정 판별은 @toonspectrum/core 패키지(packages/core/src/estimate.ts)로 이전됨.
// 상대 경로 재-export — plain-node(API-from-dist) 런타임이 컴파일된 .js 로 해석되도록(bare 지정자 부적합).
export * from "../../../../../packages/core/src/estimate";
