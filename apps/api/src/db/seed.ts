/**
 * 샘플 시드 — 기능 점검·데모용 풍부한 샘플 데이터.
 * 동적 데이터(계정·평점·리뷰·읽음·구독·컬렉션·커뮤니티·창작·Q&A·수익화)만 채운다(카탈로그는 파일 기반).
 * 재실행 안전(고정 id + onConflictDoNothing). 실행: `pnpm db:seed` (또는 DATABASE_URL=... tsx apps/api/src/db/seed.ts)
 *
 * 안전: titleId 는 파일 카탈로그의 실제 작품 id 를 읽어 참조한다(없으면 폴백 id). DB 에는 카탈로그를 쓰지 않는다.
 */
import { existsSync } from "node:fs";

// 카탈로그에서 실제 작품 id 를 못 읽을 때 쓰는 폴백(2026-06 카탈로그 상위 작품).
const FALLBACK_TITLE_IDS = [
  "nw-769209", // 화산귀환
  "nw-747269", // 전지적 독자 시점
  "nw-641253", // 외모지상주의
  "nw-747271", // 나노마신
  "nw-844058", // 신체
  "nw-828715", // 절대회귀
  "nw-841624", // 오! 나의 교주님
  "nw-832677", // 절대군림
  "nw-822657", // 환생천마
  "nw-836052", // 마흔 즈음에
  "nw-812354", // 육아일기
  "nw-824543", // 오늘만 사는 기사
];

// 실행마다 동일한 결과(멱등)를 위해 결정적 시퀀스를 쓴다. createdAt 도 고정 기준일에서 역산.
const BASE_TS = Date.UTC(2026, 5, 1, 9, 0, 0); // 2026-06-01 09:00 UTC
const daysAgo = (d: number) => new Date(BASE_TS - d * 24 * 60 * 60 * 1000);

// 카탈로그 파일에서 실제 작품 id 를 읽어 리뷰/평점이 실제 작품을 가리키게 한다(없으면 폴백).
async function resolveTitleIds(): Promise<string[]> {
  try {
    const { loadCatalogTitlesFromFile } = await import("../server/catalog-file");
    const loaded = loadCatalogTitlesFromFile();
    const ids = (loaded?.titles ?? []).map((t) => t.id).filter(Boolean);
    if (ids.length >= FALLBACK_TITLE_IDS.length) return ids.slice(0, 24);
  } catch {
    // 파일 못 읽으면 폴백.
  }
  return FALLBACK_TITLE_IDS;
}

async function main() {
  // apps/api/src/db 는 모듈 로드 시 DATABASE_URL 을 읽으므로 import 전에 .env.local 주입.
  if (!process.env.DATABASE_URL && existsSync(".env.local")) {
    process.loadEnvFile(".env.local");
  }

  // 안전장치: 운영 DB(Neon) 로의 시드를 차단한다. 시드는 로컬/QA 전용.
  const url = process.env.DATABASE_URL ?? "";
  if (/neon\.tech/i.test(url)) {
    console.error("✗ refusing to seed a Neon host. Seed targets local/QA Postgres only.");
    process.exit(1);
  }

  const { db } = await import("./index");
  const s = await import("./schema");
  const { hashPassword } = await import("../../../web/src/shared/lib/auth-crypto");

  const titleIds = await resolveTitleIds();
  const T = (i: number) => titleIds[i % titleIds.length];

  // ── 1. 로그인 가능한 테스트 계정 + 데모 작성자 계정 ──────────────────────
  // 비밀번호 로그인용 scrypt 해시(lib/auth-crypto.ts). 멱등을 위해 고정 id 사용.
  const PASSWORD = "Demo1234!"; // NOSONAR S2068 데모 테스트 계정 전용 비밀번호(시드 스크립트)
  type SeedUser = {
    id: string;
    name: string;
    email: string;
    role: string;
    avatar: string;
    bio: string;
    login?: boolean;
  };
  const seedUsers: SeedUser[] = [
    { id: "seed-admin", name: "데모 관리자", email: "admin@toonspectrum.dev", role: "admin", avatar: "#ef4444", bio: "데모 관리자 계정", login: true },
    { id: "seed-tester", name: "데모 독자", email: "tester@toonspectrum.dev", role: "user", avatar: "#7c3aed", bio: "로그인 검증용 데모 독자 계정", login: true },
    { id: "seed-creator", name: "데모 창작자", email: "creator@toonspectrum.dev", role: "user", avatar: "#0ea5e9", bio: "창작 스튜디오 데모 작가", login: true },
    { id: "seed-user-001", name: "샘플 독자", email: "sample-reader@toonspectrum.dev", role: "user", avatar: "#22c55e", bio: "시드 샘플 계정(기능 점검용)" },
    { id: "seed-u2", name: "별점요정", email: "seed2@toonspectrum.dev", role: "user", avatar: "#f59e0b", bio: "리뷰 샘플 작성자" },
    { id: "seed-u3", name: "완독장인", email: "seed3@toonspectrum.dev", role: "user", avatar: "#ec4899", bio: "리뷰 샘플 작성자" },
    { id: "seed-u4", name: "장르탐험가", email: "seed4@toonspectrum.dev", role: "user", avatar: "#14b8a6", bio: "리뷰 샘플 작성자" },
    { id: "seed-u5", name: "취향수집가", email: "seed5@toonspectrum.dev", role: "user", avatar: "#8b5cf6", bio: "리뷰 샘플 작성자" },
    { id: "seed-u6", name: "야간순찰자", email: "seed6@toonspectrum.dev", role: "user", avatar: "#64748b", bio: "리뷰 샘플 작성자" },
  ];
  const pwHash = hashPassword(PASSWORD);
  await db
    .insert(s.users)
    .values(
      seedUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        avatar: u.avatar,
        bio: u.bio,
        passwordHash: u.login ? pwHash : null,
        emailVerified: u.login ? daysAgo(60) : null,
        createdAt: daysAgo(90),
      }))
    )
    .onConflictDoNothing();

  // ── 2. 창작자 프로필 + 창작 시리즈/회차 ─────────────────────────────────
  await db
    .insert(s.creatorProfiles)
    .values([
      { id: "seed-cp-1", userId: "seed-creator", displayName: "데모 창작자", profile: "브라우저 스튜디오로 컷툰을 만드는 데모 작가입니다.", isVerifiedCreator: true },
      { id: "seed-cp-2", userId: "seed-user-001", displayName: "샘플 창작자", profile: "시드로 생성된 데모 창작자 프로필", isVerifiedCreator: false },
    ])
    .onConflictDoNothing();

  await db
    .insert(s.creatorSeries)
    .values({
      id: "seed-series-1",
      userId: "seed-creator",
      author: "데모 창작자",
      avatar: "#0ea5e9",
      title: "한밤의 편의점",
      description: "야간 편의점에서 벌어지는 짧은 컷툰 연재.",
      tags: ["일상", "코미디"],
      status: "ongoing",
      createdAt: daysAgo(40),
    })
    .onConflictDoNothing();

  await db
    .insert(s.creatorWorks)
    .values([
      { id: "seed-work-1", userId: "seed-creator", title: "한밤의 편의점 1화", description: "첫 손님", format: "cuttoon", status: "published", tags: ["일상", "데모"], seriesId: "seed-series-1", episodeNo: 1, views: 1240, createdAt: daysAgo(40) },
      { id: "seed-work-2", userId: "seed-creator", title: "한밤의 편의점 2화", description: "삼각김밥의 비밀", format: "cuttoon", status: "published", tags: ["일상", "데모"], seriesId: "seed-series-1", episodeNo: 2, views: 980, createdAt: daysAgo(33) },
      { id: "seed-work-3", userId: "seed-user-001", title: "데모 컷툰: 첫 화", description: "시드 샘플 창작물", format: "cuttoon", status: "published", tags: ["데모", "시드"], titleId: T(0), views: 421, createdAt: daysAgo(20) },
    ])
    .onConflictDoNothing();

  // 창작물 좋아요/댓글
  await db
    .insert(s.creatorWorkLikes)
    .values([
      { userId: "seed-tester", workId: "seed-work-1" },
      { userId: "seed-u2", workId: "seed-work-1" },
      { userId: "seed-u3", workId: "seed-work-2" },
    ])
    .onConflictDoNothing();
  await db
    .insert(s.creatorWorkComments)
    .values([
      { id: "seed-wc-1", workId: "seed-work-1", userId: "seed-tester", text: "그림체 너무 좋아요!", createdAt: daysAgo(38) },
      { id: "seed-wc-2", workId: "seed-work-2", userId: "seed-u4", text: "다음 화 기대됩니다 :)", createdAt: daysAgo(30) },
    ])
    .onConflictDoNothing();

  await db
    .insert(s.creatorFollows)
    .values([
      { followerId: "seed-tester", creatorId: "seed-creator", createdAt: daysAgo(35) },
      { followerId: "seed-u2", creatorId: "seed-creator", createdAt: daysAgo(28) },
    ])
    .onConflictDoNothing();

  // ── 3. 평점 + 읽음 상태 + 구독(찜) — 여러 사용자 × 여러 작품 ────────────────
  const readStates = ["want", "reading", "done", "dropped"] as const;
  const ratingRows: { userId: string; titleId: string; value: number; updatedAt: Date }[] = [];
  const readRows: { userId: string; titleId: string; state: string }[] = [];
  const subRows: { userId: string; titleId: string }[] = [];
  const raters = ["seed-tester", "seed-user-001", "seed-u2", "seed-u3", "seed-u4", "seed-u5", "seed-u6"];
  raters.forEach((uid, ui) => {
    // 각 사용자마다 6~9개 작품을 평가/표시.
    const count = 6 + (ui % 4);
    for (let k = 0; k < count; k++) {
      const tid = T(ui * 2 + k);
      const value = 25 + ((ui * 7 + k * 5) % 26); // 25~50 (×10 정수)
      ratingRows.push({ userId: uid, titleId: tid, value, updatedAt: daysAgo(10 + k) });
      readRows.push({ userId: uid, titleId: tid, state: readStates[(ui + k) % readStates.length] });
      if (k % 2 === 0) subRows.push({ userId: uid, titleId: tid });
    }
  });
  await db.insert(s.ratings).values(ratingRows).onConflictDoNothing();
  await db.insert(s.reads).values(readRows).onConflictDoNothing();
  await db.insert(s.subscriptions).values(subRows).onConflictDoNothing();

  // ── 4. 리뷰 + 좋아요 + 답글 ───────────────────────────────────────────────
  const reviewTexts = [
    "초반은 느리지만 중반부터 미친듯이 몰입됩니다. 작화도 점점 좋아져요.",
    "캐릭터 서사가 탄탄해서 감정 이입이 잘 됩니다. 강력 추천.",
    "사이다 전개 좋아하시는 분께 딱. 스트레스 없이 정주행했어요.",
    "그림체는 호불호 갈릴 수 있지만 스토리로 끝까지 끌고 갑니다.",
    "후반 떡밥 회수가 깔끔합니다. 완결까지 보길 잘했어요.",
    "분량 대비 전개가 빠른 편. 가볍게 보기 좋습니다.",
    "세계관이 방대해서 초반 진입장벽이 있지만 그만한 가치가 있어요.",
  ];
  const reviewTagSets = [["스토리"], ["작화"], ["사이다"], ["캐릭터"], ["떡밥회수"], ["몰입감"], ["세계관"]];
  const reviewRows: {
    id: string;
    userId: string;
    titleId: string;
    rating: number;
    text: string;
    tags: string[];
    spoiler: boolean;
    createdAt: Date;
  }[] = [];
  let rIdx = 0;
  raters.forEach((uid, ui) => {
    for (let k = 0; k < 4; k++) {
      const tid = T(ui * 2 + k);
      reviewRows.push({
        id: `seed-review-${uid}-${k}`,
        userId: uid,
        titleId: tid,
        rating: 30 + ((ui + k * 3) % 21), // 30~50
        text: reviewTexts[rIdx % reviewTexts.length],
        tags: reviewTagSets[rIdx % reviewTagSets.length],
        spoiler: rIdx % 5 === 0,
        createdAt: daysAgo(2 + rIdx),
      });
      rIdx++;
    }
  });
  await db.insert(s.reviews).values(reviewRows).onConflictDoNothing();

  // 리뷰 좋아요 — 앞쪽 리뷰들에 여러 사용자가 좋아요.
  const likeRows: { userId: string; reviewId: string }[] = [];
  reviewRows.slice(0, 12).forEach((r, i) => {
    raters.slice(0, 1 + (i % 4)).forEach((liker) => {
      if (liker !== r.userId) likeRows.push({ userId: liker, reviewId: r.id });
    });
  });
  await db.insert(s.reviewLikes).values(likeRows).onConflictDoNothing();

  // 리뷰 답글(대댓글 포함)
  await db
    .insert(s.reviewReplies)
    .values([
      { id: "seed-rr-1", reviewId: reviewRows[0].id, userId: "seed-u3", text: "저도 같은 부분에서 몰입됐어요!", createdAt: daysAgo(1) },
      { id: "seed-rr-2", reviewId: reviewRows[0].id, parentId: "seed-rr-1", userId: "seed-tester", text: "그쵸 그 장면 명장면", createdAt: daysAgo(1) },
      { id: "seed-rr-3", reviewId: reviewRows[1].id, userId: "seed-u5", text: "추천 감사합니다, 정주행 시작합니다.", createdAt: daysAgo(1) },
    ])
    .onConflictDoNothing();

  // ── 5. 컬렉션 + 항목 ──────────────────────────────────────────────────────
  await db
    .insert(s.collections)
    .values([
      { id: "seed-col-1", userId: "seed-tester", name: "내 인생작", emoji: "⭐", createdAt: daysAgo(25) },
      { id: "seed-col-2", userId: "seed-tester", name: "정주행 대기열", emoji: "📚", createdAt: daysAgo(15) },
      { id: "seed-col-3", userId: "seed-user-001", name: "무협 모음", emoji: "🗡️", createdAt: daysAgo(12) },
    ])
    .onConflictDoNothing();
  await db
    .insert(s.collectionItems)
    .values([
      { collectionId: "seed-col-1", titleId: T(0) },
      { collectionId: "seed-col-1", titleId: T(1) },
      { collectionId: "seed-col-1", titleId: T(2) },
      { collectionId: "seed-col-2", titleId: T(3) },
      { collectionId: "seed-col-2", titleId: T(4) },
      { collectionId: "seed-col-3", titleId: T(0) },
      { collectionId: "seed-col-3", titleId: T(5) },
    ])
    .onConflictDoNothing();

  // ── 6. 장르 카페(커뮤니티) + 회원 + 팬 게시글 ──────────────────────────────
  await db
    .insert(s.communityCafes)
    .values([
      { id: "seed-cafe-1", slug: "muhyup-lovers", name: "무협 애호가 모임", description: "무협·역사물 정주행 인증과 추천을 나누는 카페", genre: "무협", createdBy: "seed-tester", createdAt: daysAgo(50) },
      { id: "seed-cafe-2", slug: "daily-toon", name: "일상툰 정류장", description: "잔잔한 일상툰을 함께 보는 모임", genre: "일상", createdBy: "seed-creator", createdAt: daysAgo(45) },
    ])
    .onConflictDoNothing();
  await db
    .insert(s.communityCafeMembers)
    .values([
      { cafeId: "seed-cafe-1", userId: "seed-tester", role: "owner", joinedAt: daysAgo(50) },
      { cafeId: "seed-cafe-1", userId: "seed-u2", role: "member", joinedAt: daysAgo(40) },
      { cafeId: "seed-cafe-1", userId: "seed-u3", role: "member", joinedAt: daysAgo(38) },
      { cafeId: "seed-cafe-2", userId: "seed-creator", role: "owner", joinedAt: daysAgo(45) },
      { cafeId: "seed-cafe-2", userId: "seed-u4", role: "member", joinedAt: daysAgo(33) },
    ])
    .onConflictDoNothing();

  await db
    .insert(s.fanPosts)
    .values([
      { id: "seed-fp-1", scope: "title", targetId: T(0), targetLabel: "화산귀환", userId: "seed-tester", kind: "talk", title: "청명 최애 장면 공유해요", text: "화산파 재건 시작하는 그 장면이 명장면이라고 생각합니다.", tags: ["명장면"], createdAt: daysAgo(8) },
      { id: "seed-fp-2", scope: "title", targetId: T(1), targetLabel: "전지적 독자 시점", userId: "seed-u4", kind: "theory", title: "결말 떡밥 정리", text: "지금까지 나온 복선들을 표로 정리해봤어요.", tags: ["이론", "떡밥"], createdAt: daysAgo(6) },
      { id: "seed-fp-3", scope: "cafe", targetId: "muhyup-lovers", targetLabel: "무협 애호가 모임", userId: "seed-u2", kind: "cheer", title: "이번 주 무협 정주행 인증", text: "절대회귀 100화까지 달렸습니다. 다음 추천 받아요!", tags: ["정주행"], createdAt: daysAgo(4) },
      { id: "seed-fp-4", scope: "cafe", targetId: "daily-toon", targetLabel: "일상툰 정류장", userId: "seed-creator", kind: "talk", title: "잔잔한 일상툰 추천 모음", text: "마음이 따뜻해지는 작품들 모아봤어요.", tags: ["추천"], createdAt: daysAgo(3) },
    ])
    .onConflictDoNothing();
  await db
    .insert(s.fanPostReplies)
    .values([
      { id: "seed-fpr-1", postId: "seed-fp-1", userId: "seed-u3", text: "동의합니다, 소름 돋았어요.", createdAt: daysAgo(7) },
      { id: "seed-fpr-2", postId: "seed-fp-2", userId: "seed-tester", text: "정리 깔끔하네요 감사해요!", createdAt: daysAgo(5) },
    ])
    .onConflictDoNothing();

  // ── 7. 사이트 Q&A(피드백 게시판) + 운영자 답변 ────────────────────────────
  await db
    .insert(s.feedbackPosts)
    .values([
      { id: "seed-fb-1", userId: "seed-tester", category: "question", title: "찜한 작품 알림 받을 수 있나요?", text: "구독한 작품 새 화 알림 기능이 있는지 궁금합니다.", status: "answered", answeredAt: daysAgo(9), createdAt: daysAgo(11) },
      { id: "seed-fb-2", userId: "seed-u5", category: "idea", title: "다크모드 추가 제안", text: "야간에 보기 편하게 다크모드가 있으면 좋겠어요.", status: "open", createdAt: daysAgo(5) },
      { id: "seed-fb-3", userId: "seed-u6", category: "bug", title: "검색 결과 정렬이 가끔 이상해요", text: "인기순 정렬 시 순서가 뒤섞이는 경우가 있습니다.", status: "open", createdAt: daysAgo(2) },
    ])
    .onConflictDoNothing();
  await db
    .insert(s.feedbackReplies)
    .values([
      { id: "seed-fbr-1", postId: "seed-fb-1", userId: "seed-admin", text: "네! 서재에서 구독하시면 캘린더에 연재일이 표시됩니다. 푸시 알림도 곧 추가될 예정이에요.", isOfficial: true, createdAt: daysAgo(9) },
    ])
    .onConflictDoNothing();

  // ── 8. 수익화 플랜 + 후원 캠페인 + 정산 원장(데모) ────────────────────────
  await db
    .insert(s.monetizationPlans)
    .values([
      { id: "seed-plan-free", code: "free", name: "무료", description: "기본 기능", intervalDays: 30, priceCents: 0, perks: ["광고 포함"], isActive: true },
      { id: "seed-plan-supporter", code: "supporter", name: "서포터", description: "광고 제거 + 후원 뱃지", intervalDays: 30, priceCents: 4900_00, perks: ["광고 제거", "후원 뱃지", "조기 열람"], isActive: true },
    ])
    .onConflictDoNothing();
  await db
    .insert(s.creatorCampaigns)
    .values({
      id: "seed-campaign-1",
      creatorId: "seed-creator",
      titleId: null,
      planId: "seed-plan-supporter",
      title: "한밤의 편의점 시즌2 제작 후원",
      description: "다음 시즌 제작을 위한 후원 캠페인입니다.",
      targetAmountCents: 1_000_000_00,
      raisedAmountCents: 320_000_00,
      isActive: true,
      startsAt: daysAgo(20),
      createdAt: daysAgo(20),
    })
    .onConflictDoNothing();
  await db
    .insert(s.revenueLedger)
    .values([
      { id: "seed-rl-1", payerId: "seed-tester", recipientId: "seed-creator", planId: "seed-plan-supporter", kind: "plan", status: "paid", amountCents: 4900_00, createdAt: daysAgo(18) },
      { id: "seed-rl-2", payerId: "seed-u2", recipientId: "seed-creator", campaignId: "seed-campaign-1", kind: "campaign", status: "paid", amountCents: 30_000_00, createdAt: daysAgo(12) },
    ])
    .onConflictDoNothing();

  // ── 9. 런타임 설정(app_setting) — 데모는 수익화 OFF, 소셜 OFF 기본값 ──────
  await db
    .insert(s.appSettings)
    .values({ key: "app.config", value: { monetizationEnabled: false, authKakao: false, authNaver: false }, updatedAt: daysAgo(1) })
    .onConflictDoNothing();

  // ── 집계 출력 ─────────────────────────────────────────────────────────────
  const counts = await Promise.all([
    db.$count(s.users),
    db.$count(s.ratings),
    db.$count(s.reviews),
    db.$count(s.reviewLikes),
    db.$count(s.reviewReplies),
    db.$count(s.reads),
    db.$count(s.subscriptions),
    db.$count(s.collections),
    db.$count(s.collectionItems),
    db.$count(s.communityCafes),
    db.$count(s.fanPosts),
    db.$count(s.fanPostReplies),
    db.$count(s.feedbackPosts),
    db.$count(s.creatorWorks),
    db.$count(s.revenueLedger),
  ]);
  const [
    users,
    rt,
    rv,
    rl,
    rr,
    rd,
    sub,
    col,
    ci,
    cafe,
    fp,
    fpr,
    fb,
    cw,
    led,
  ] = counts;
  console.log("✓ seed done — rich sample data:");
  console.log(`  users=${users} ratings=${rt} reviews=${rv} reviewLikes=${rl} reviewReplies=${rr}`);
  console.log(`  reads=${rd} subscriptions=${sub} collections=${col} collectionItems=${ci}`);
  console.log(`  cafes=${cafe} fanPosts=${fp} fanPostReplies=${fpr} feedbackPosts=${fb} creatorWorks=${cw} revenueLedger=${led}`);
  console.log("");
  console.log("  Loginable test accounts (password: Demo1234!):");
  console.log("    admin@toonspectrum.dev   (role=admin)");
  console.log("    tester@toonspectrum.dev  (role=user)");
  console.log("    creator@toonspectrum.dev (role=user, creator profile)");
  process.exit(0);
}

main().catch((e) => {
  console.error("seed failed:", e);
  process.exit(1);
});
