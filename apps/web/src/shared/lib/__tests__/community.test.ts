import { inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, dbClient, fanPostReplies, fanPosts, users } from "../../../../../../apps/api/src/db";
import {
  createFanPost,
  createFanPostReply,
  ensureCommunityTables,
  listFanPostReplies,
  maskDeletedReply,
  slugifyCafeName,
  validateCafeInput,
  validatePostInput,
  validateReplyText,
} from "../../../../../../apps/api/src/server/community";
import {
  getCommunityScopeTargetLink,
  parseCommunityScope,
  parseCommunitySort,
  parseCommunityScopeWithAll,
} from "../community-ui";
import { GENRES } from "../taxonomy";

import { retryOnDeadlock } from "./db-test-utils";

const createdUserIds = new Set<string>();
const createdPostIds = new Set<string>();
const createdReplyIds = new Set<string>();

async function cleanupCommunityRecords() {
  if (createdReplyIds.size > 0) {
    await retryOnDeadlock(() => db.delete(fanPostReplies).where(inArray(fanPostReplies.id, [...createdReplyIds])));
    createdReplyIds.clear();
  }
  if (createdPostIds.size > 0) {
    await retryOnDeadlock(() => db.delete(fanPosts).where(inArray(fanPosts.id, [...createdPostIds])));
    createdPostIds.clear();
  }
  if (createdUserIds.size > 0) {
    await retryOnDeadlock(() => db.delete(users).where(inArray(users.id, [...createdUserIds])));
    createdUserIds.clear();
  }
}

async function ensureTestUserSchema() {
  await dbClient.execute(`
    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT UNIQUE,
      "emailVerified" TIMESTAMPTZ,
      image TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      "passwordHash" TEXT,
      avatar TEXT,
      bio TEXT,
      "createdAt" TIMESTAMPTZ
    )
  `);
  // PostgreSQL: ADD COLUMN IF NOT EXISTS (SQLite PRAGMA 불필요). 테이블은 drizzle push로 이미 존재.
  const migrations = [
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS avatar TEXT`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS bio TEXT`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ`,
  ];
  for (const sql of migrations) await dbClient.execute(sql);
}

async function createCommunityTestUser() {
  await ensureCommunityTables();
  await ensureTestUserSchema();
  const id = `test-user-${crypto.randomUUID()}`;
  createdUserIds.add(id);
  await db.insert(users).values({
    id,
    email: `${id}@example.test`,
    name: "테스트 독자",
    avatar: "#2f855a",
  });
  return id;
}

afterEach(async () => {
  if (!dbAvailable) return;
  await cleanupCommunityRecords();
});

// DB 통합 테스트는 실제 DB(로컬 docker 또는 Neon)가 있어야 동작한다. 없으면(ECONNREFUSED 등) 건너뛴다 —
// 순수 검증 테스트는 항상 실행되고, DB 가 있는 환경(CI 등)에서만 통합 테스트가 돈다.
let dbAvailable = false;
beforeAll(async () => {
  try {
    await dbClient.execute("SELECT 1");
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
});

describe("community validation", () => {
  it("팬카페 게시글 입력을 정규화한다", () => {
    const result = validatePostInput({
      scope: "title",
      targetId: "nw-183559",
      targetLabel: "신의 탑",
      kind: "theory",
      title: "  세계관 해석  ",
      text: "  좋은 글\n\n\n입니다  ",
      tags: ["#정주행", "해석", "세계관", "긴태그".repeat(20), "", "초과"],
    });

    expect(result.error).toBeUndefined();
    expect(result.value?.title).toBe("세계관 해석");
    expect(result.value?.text).toContain("좋은 글");
    expect(result.value?.tags).toHaveLength(5);
    expect(result.value?.kind).toBe("theory");
  });

  it("잘못된 scope와 빈 본문을 거부한다", () => {
    expect(validatePostInput({ scope: "bad" }).error).toBeTruthy();
    expect(
      validatePostInput({
        scope: "title",
        targetId: "t1",
        targetLabel: "작품",
        title: "a",
        text: "",
      }).error
    ).toBeTruthy();
  });

  it("답글은 1자 이상 700자 이하만 허용한다", () => {
    expect(validateReplyText("").error).toBeTruthy();
    expect(validateReplyText("좋아요").text).toBe("좋아요");
    expect(validateReplyText("x".repeat(900)).text).toHaveLength(700);
  });

  it("커뮤니티 스코프 파싱은 허용값만 통과한다", () => {
    expect(parseCommunityScope("title")).toBe("title");
    expect(parseCommunityScope("all")).toBeNull();
    expect(parseCommunityScopeWithAll("all")).toBe("all");
    expect(parseCommunityScopeWithAll("bad")).toBe("all");
  });

  it("커뮤니티 정렬 파싱은 알 수 없는 값은 인기순으로 정규화한다", () => {
    expect(parseCommunitySort("recent")).toBe("recent");
    expect(parseCommunitySort("popular")).toBe("popular");
    expect(parseCommunitySort("invalid")).toBe("popular");
  });

  it("커뮤니티 스코프 상세 라우트 링크를 안전하게 생성한다", () => {
    expect(getCommunityScopeTargetLink("title", "nw-183559", "작품명")).toBe("/title/nw-183559");
    expect(getCommunityScopeTargetLink("author", "unused", "김초월 작가")).toBe("/author/김초월%20작가");
    expect(getCommunityScopeTargetLink("pencafe", "unused", "번역자_카페")).toBe("/pencafe/%EB%B2%88%EC%97%AD%EC%9E%90_%EC%B9%B4%ED%8E%98");
    expect(getCommunityScopeTargetLink("cafe", "ro-fan-club", "로판 모임")).toBe("/community/cafes/ro-fan-club");
  });

  it("게시글 첨부는 허용된 이미지 데이터 URL만 통과한다", () => {
    const base = {
      scope: "title",
      targetId: "t1",
      targetLabel: "작품",
      title: "첨부 테스트",
      text: "본문입니다.",
    };
    const ok = validatePostInput({ ...base, images: [`data:image/webp;base64,${"A".repeat(64)}`] });
    expect(ok.error).toBeUndefined();
    expect(ok.value?.images).toHaveLength(1);

    expect(validatePostInput({ ...base, images: ["data:image/svg+xml;base64,PHN2Zy8+"] }).error).toBeTruthy();
    expect(validatePostInput({ ...base, images: ["data:text/plain;base64,aGVsbG8="] }).error).toBeTruthy();
    expect(validatePostInput({ ...base, images: ["https://example.com/a.png"] }).error).toBeTruthy();
  });

  it("카페 이름을 한글 보존 slug로 변환한다", () => {
    expect(slugifyCafeName("로판 정주행 모임")).toBe("로판-정주행-모임");
    expect(slugifyCafeName("  Hello__World!! ")).toBe("hello-world");
    expect(slugifyCafeName("###")).toBe("");
    expect(slugifyCafeName("긴이름".repeat(40)).length).toBeLessThanOrEqual(60);
  });

  it("카페 입력은 이름·소개·장르 화이트리스트를 강제한다", () => {
    expect(validateCafeInput({ name: "로", description: "소개입니다", genre: "" }, GENRES).error).toBeTruthy();
    expect(validateCafeInput({ name: "로판 모임", description: "", genre: "" }, GENRES).error).toBeTruthy();
    expect(validateCafeInput({ name: "로판 모임", description: "소개", genre: "없는장르" }, GENRES).error).toBeTruthy();
    const ok = validateCafeInput({ name: "로판 모임", description: "로판을 함께 파요", genre: "로판" }, GENRES);
    expect(ok.error).toBeUndefined();
    expect(ok.value).toEqual({ name: "로판 모임", description: "로판을 함께 파요", genre: "로판" });
  });

  it("소프트 삭제 마스킹은 본문·작성자를 비우고 deleted 플래그를 남긴다", () => {
    const reply = {
      id: "r1",
      text: "원본 댓글",
      author: { id: "u1", name: "독자", avatar: "#123456" },
    };
    const masked = maskDeletedReply(reply, true);
    expect(masked.deleted).toBe(true);
    expect(masked.text).toBe("");
    expect(masked.author.name).toBe("삭제됨");
    const intact = maskDeletedReply(reply, false);
    expect(intact.deleted).toBe(false);
    expect(intact.text).toBe("원본 댓글");
  });

  it("게시글 댓글의 대댓글을 같은 게시글 트리 아래에 저장한다", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const userId = await createCommunityTestUser();
    const post = await createFanPost(userId, {
      scope: "title",
      targetId: "test-title",
      targetLabel: "테스트 작품",
      kind: "talk",
      title: "대댓글 테스트",
      text: "대댓글 트리 저장을 검증합니다.",
      tags: [],
      images: [],
    });
    createdPostIds.add(post.id);

    const parent = await createFanPostReply({
      postId: post.id,
      userId,
      text: "첫 댓글입니다.",
    });
    createdReplyIds.add(parent.id);

    const child = await createFanPostReply({
      postId: post.id,
      parentId: parent.id,
      userId,
      text: "첫 댓글의 대댓글입니다.",
    });
    createdReplyIds.add(child.id);

    const tree = await listFanPostReplies(post.id);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe(parent.id);
    expect(tree[0].children?.map((reply) => reply.id)).toEqual([child.id]);
    expect(tree[0].children?.[0].parentId).toBe(parent.id);
  });

  it("존재하지 않는 게시글에는 댓글을 만들 수 없다", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const userId = await createCommunityTestUser();

    await expect(
      createFanPostReply({
        postId: `missing-post-${crypto.randomUUID()}`,
        userId,
        text: "고아 댓글은 생성되지 않아야 합니다.",
      })
    ).rejects.toThrow(/게시글/);
  });

  it("다른 게시글의 댓글을 부모로 지정한 대댓글은 거부한다", async (ctx) => {
    if (!dbAvailable) return ctx.skip();
    const userId = await createCommunityTestUser();
    const firstPost = await createFanPost(userId, {
      scope: "title",
      targetId: "first-title",
      targetLabel: "첫 작품",
      kind: "talk",
      title: "첫 게시글",
      text: "첫 게시글 본문입니다.",
      tags: [],
      images: [],
    });
    const secondPost = await createFanPost(userId, {
      scope: "title",
      targetId: "second-title",
      targetLabel: "두 번째 작품",
      kind: "talk",
      title: "두 번째 게시글",
      text: "두 번째 게시글 본문입니다.",
      tags: [],
      images: [],
    });
    createdPostIds.add(firstPost.id);
    createdPostIds.add(secondPost.id);

    const parent = await createFanPostReply({
      postId: firstPost.id,
      userId,
      text: "첫 게시글의 댓글입니다.",
    });
    createdReplyIds.add(parent.id);

    await expect(
      createFanPostReply({
        postId: secondPost.id,
        parentId: parent.id,
        userId,
        text: "다른 게시글 댓글에 붙으면 안 됩니다.",
      })
    ).rejects.toThrow(/상위 항목/);
  });
});
