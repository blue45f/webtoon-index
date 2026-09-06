// 시밍: 홈 read-model(getHomeData)은 @toonspectrum/core 패키지(packages/core/src/server/home.ts)로 이전됨.
// @/shared/lib/server/home 임포트 경로 보존용 상대 재-export.
// (리뷰 총계는 더 이상 core 가 apps/api/src/server/reviews 를 되짚지 않고 호출자가 loadReviewStats 로 주입한다 —
//  즉 이 모듈을 import 해도 DB 그래프가 딸려오지 않는다.)
export * from "../../../../../../packages/core/src/server/home";
