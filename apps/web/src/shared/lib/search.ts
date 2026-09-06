// 시밍: searchTitles/sortTitles/suggest 등 검색 로직은 @toonspectrum/core 패키지(packages/core/src/search.ts)로 이전됨.
// 상대 경로 재-export — plain-node(API-from-dist) 런타임이 컴파일된 .js 로 해석되도록(bare 지정자 부적합).
export * from "../../../../../packages/core/src/search";
