import { describe, expect, it } from "vitest";

import {
  canonicalStudioCrdtProjection,
  setDeterministicStudioCrdtClientId,
} from "./studio-crdt-convergence-property-helper";
import { StudioCrdtDocument } from "./studio-crdt-document";
import { reconcileStudioCrdtSceneGraphPages } from "./studio-crdt-page-bridge";
import { publishStudioCrdtSceneGraphDiff } from "./studio-crdt-scene-publisher";

interface TestElement {
  id: string;
  type: string;
  groupId?: string;
  [key: string]: unknown;
}

interface TestPage {
  id: string;
  elements: TestElement[];
  bg: string;
  bgGrad: string[] | null;
  canvasH: number;
  groups?: Array<{ id: string; name: string; hidden?: boolean; locked?: boolean }>;
}

const SAMPLE_COUNT = 64;

function channel(seed: number, scale: number): number[] {
  return Array.from({ length: SAMPLE_COUNT }, (_, index) =>
    Number((((seed * 37 + index * 13) % 101) / 101 * scale).toFixed(4))
  );
}

/** A stroke carrying every parallel sample channel — the shape the defect measurement used. */
function stroke(id: string, seed: number, color = "#112233", groupId?: string): TestElement {
  return {
    id,
    type: "draw",
    kind: "free",
    mode: "pen",
    points: Array.from(
      { length: SAMPLE_COUNT * 2 },
      (_, index) => Number((((seed * 17 + index * 11) % 887) + index / 8).toFixed(3))
    ),
    stroke: color,
    strokeWidth: 8,
    pressures: channel(seed + 1, 1),
    tiltXs: channel(seed + 2, 60),
    tiltYs: channel(seed + 3, 60),
    twists: channel(seed + 4, 359),
    speeds: channel(seed + 5, 4),
    tangentialPressures: channel(seed + 6, 1),
    altitudeAngles: channel(seed + 7, 1.5),
    azimuthAngles: channel(seed + 8, 6.2),
    contactWidths: channel(seed + 9, 20),
    contactHeights: channel(seed + 10, 20),
    // 상대 시간은 단조 증가여야 한다(문서 계약).
    sampleTimeOffsets: Array.from(
      { length: SAMPLE_COUNT },
      (_, index) => index * 5 + (seed % 3)
    ),
    ...(groupId ? { groupId } : {}),
  };
}

function bubble(id: string, text: string, groupId?: string): TestElement {
  return {
    id,
    type: "text",
    text,
    x: 24,
    y: 48,
    width: 280,
    fontSize: 26,
    fill: "#101010",
    rotation: 0,
    ...(groupId ? { groupId } : {}),
  };
}

function page(id: string, elements: TestElement[], groups: TestPage["groups"] = []): TestPage {
  return { id, elements, groups, bg: "#ffffff", bgGrad: null, canvasH: 1600 };
}

function merge(document: StudioCrdtDocument, pages: TestPage[]): TestPage[] {
  return reconcileStudioCrdtSceneGraphPages(
    pages,
    document.getStrokes({ includeDeleted: true }),
    document.getSceneElements({ includeDeleted: true }),
    document.getPages(true),
    document.getLayerGroups({ includeDeleted: true })
  ).pages;
}

/** Exactly what `StudioPage.commit()` does: publish the authored diff, then merge the frontier. */
function commit(
  document: StudioCrdtDocument,
  previous: TestPage[],
  next: TestPage[]
): TestPage[] {
  publishStudioCrdtSceneGraphDiff(document, previous, next);
  return merge(document, next);
}

function elementsOf(pages: readonly TestPage[], pageId: string): TestElement[] {
  return pages.find((candidate) => candidate.id === pageId)!.elements;
}

function elementById(pages: readonly TestPage[], pageId: string, id: string): TestElement {
  return elementsOf(pages, pageId).find((element) => element.id === id)!;
}

function withPatchedElement(
  pages: readonly TestPage[],
  pageId: string,
  id: string,
  patch: Partial<TestElement>
): TestPage[] {
  return pages.map((candidate) =>
    candidate.id !== pageId
      ? candidate
      : {
          ...candidate,
          elements: candidate.elements.map((element) =>
            element.id === id ? { ...element, ...patch } : element
          ),
        }
  );
}

describe("CRDT 장면 재조정 구조 공유", () => {
  it("한 요소만 바뀐 커밋은 나머지 요소 객체를 그대로 재사용한다", () => {
    const document = new StudioCrdtDocument();
    try {
      const authored = [
        page(
          "page-a",
          Array.from({ length: 30 }, (_, index) => stroke(`a-${index}`, index + 1))
        ),
        page("page-b", [
          ...Array.from({ length: 28 }, (_, index) => stroke(`b-${index}`, index + 101)),
          bubble("b-text", "대사"),
          bubble("b-text-2", "대사 2"),
        ]),
      ];
      const seeded = commit(document, [], authored);
      // 첫 커밋은 CRDT 가 처음으로 요소를 물질화하는 지점이라 새 객체가 나온다. 측정 대상은
      // 그 다음 커밋 — "한 요소만 건드린 커밋"이 나머지를 얼마나 공유하는지.
      const before = commit(document, seeded, seeded);

      const touched = withPatchedElement(before, "page-a", "a-0", { stroke: "#ff0000" });
      const after = commit(document, before, touched);

      expect(elementById(after, "page-a", "a-0")).not.toBe(
        elementById(before, "page-a", "a-0")
      );
      expect(elementById(after, "page-a", "a-0").stroke).toBe("#ff0000");

      const untouched = [
        ...elementsOf(before, "page-a").slice(1),
        ...elementsOf(before, "page-b"),
      ];
      const shared = untouched.filter((element) => {
        const pageId = element.id.startsWith("a-") ? "page-a" : "page-b";
        return elementById(after, pageId, element.id) === element;
      });
      // 결함 측정 당시: 60개 중 0개 공유.
      console.log(`[sharing] ${shared.length}/${untouched.length} objects shared`);
      expect(shared.length).toBe(untouched.length);
    } finally {
      document.destroy();
    }
  });

  it("건드리지 않은 페이지의 요소는 채널 배열까지 같은 객체다", () => {
    const document = new StudioCrdtDocument();
    try {
      const authored = [
        page("page-a", [stroke("a-0", 1), stroke("a-1", 2)]),
        page("page-b", [stroke("b-0", 3), bubble("b-text", "대사")]),
      ];
      const seeded = commit(document, [], authored);
      const before = commit(document, seeded, seeded);
      const after = commit(
        document,
        before,
        withPatchedElement(before, "page-a", "a-0", { strokeWidth: 21 })
      );

      const previousStroke = elementById(before, "page-b", "b-0");
      const nextStroke = elementById(after, "page-b", "b-0");
      expect(nextStroke).toBe(previousStroke);
      expect(nextStroke.points).toBe(previousStroke.points);
      expect(nextStroke.pressures).toBe(previousStroke.pressures);
      expect(nextStroke.sampleTimeOffsets).toBe(previousStroke.sampleTimeOffsets);
      expect(elementById(after, "page-b", "b-text")).toBe(
        elementById(before, "page-b", "b-text")
      );
    } finally {
      document.destroy();
    }
  });

  it("히스토리 항목당 유지 힙이 협업 문서에서도 단독 편집 수준에 머문다", () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (!gc) {
      console.log("[memory] --expose-gc 없이 실행되어 측정을 건너뜁니다.");
      return;
    }
    const document = new StudioCrdtDocument();
    try {
      const strokeCount = 300;
      const authored = [
        page(
          "page-a",
          Array.from({ length: strokeCount }, (_, index) => stroke(`s-${index}`, index + 1))
        ),
      ];
      let current = commit(document, [], authored);
      current = commit(document, current, current);

      const entries = 24;
      const history: TestPage[][] = [];
      const settle = () => {
        for (let round = 0; round < 6; round += 1) gc();
      };

      settle();
      const baseline = process.memoryUsage().heapUsed;
      for (let index = 0; index < entries; index += 1) {
        const next = withPatchedElement(current, "page-a", `s-${index % strokeCount}`, {
          strokeWidth: 4 + (index % 9),
        });
        current = commit(document, current, next);
        history.push(current);
      }
      settle();
      const retained = process.memoryUsage().heapUsed - baseline;
      const perEntry = retained / entries;
      console.log(
        `[memory] ${strokeCount} strokes · ${entries} entries · ${Math.round(perEntry)} B/entry`
      );
      expect(history).toHaveLength(entries);
      // 결함 측정 당시 300획 문서에서 항목당 2.53 MiB. 단독 편집 상한(2,252 B)에 여유를 둔
      // 32 KiB 를 회귀 게이트로 삼는다 — 요소 포인터 배열과 페이지 껍데기만 남아야 한다.
      expect(perEntry).toBeLessThan(32 * 1024);
    } finally {
      document.destroy();
    }
  });
});

/** Stable, order-insensitive projection of everything an artist can observe on a page. */
function canonicalPages(pages: readonly TestPage[]): string {
  const sortKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (!value || typeof value !== "object") return value;
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, item]) => [key, sortKeys(item)]));
  };
  return JSON.stringify(sortKeys(pages));
}

interface Peer {
  document: StudioCrdtDocument;
  pages: TestPage[];
}

function peer(clientId: number, seedUpdate?: Uint8Array, seedPages?: TestPage[]): Peer {
  const document = new StudioCrdtDocument();
  setDeterministicStudioCrdtClientId(document, clientId);
  if (seedUpdate) document.applyUpdate(seedUpdate);
  return { document, pages: seedPages ? merge(document, seedPages) : [] };
}

/** One local authoring transaction, exactly as `commit()` performs it. */
function author(target: Peer, next: TestPage[]): void {
  target.pages = commit(target.document, target.pages, next);
}

/** Delivers everything `from` knows and `to` does not, then re-merges the receiver's snapshot. */
function deliver(from: Peer, to: Peer): void {
  to.document.applyUpdate(from.document.encodeStateAsUpdate(to.document.encodeStateVector()));
  to.pages = merge(to.document, to.pages);
}

function grouped(pages: readonly TestPage[], pageId: string, id: string, groupId: string): TestPage[] {
  return pages.map((candidate) =>
    candidate.id !== pageId
      ? candidate
      : {
          ...candidate,
          groups: [
            ...(candidate.groups ?? []),
            ...(candidate.groups?.some((group) => group.id === groupId)
              ? []
              : [{ id: groupId, name: `그룹 ${groupId}` }]),
          ],
          elements: candidate.elements.map((element) =>
            element.id === id ? { ...element, groupId } : element
          ),
        }
  );
}

function withoutElement(pages: readonly TestPage[], pageId: string, id: string): TestPage[] {
  return pages.map((candidate) =>
    candidate.id !== pageId
      ? candidate
      : { ...candidate, elements: candidate.elements.filter((element) => element.id !== id) }
  );
}

function authoredScene(): TestPage[] {
  return [
    page("page-a", [
      stroke("s-0", 11),
      stroke("s-1", 22),
      stroke("s-2", 33),
      stroke("s-3", 44),
      bubble("t-0", "원본 대사"),
    ]),
    page("page-b", [stroke("s-4", 55), bubble("t-1", "다른 페이지")]),
  ];
}

describe("CRDT 요소 재사용과 수렴", () => {
  it("두 피어가 서로 다른 순서로 조작을 적용해도 같은 문서에 도달한다", () => {
    // 조작 셋 — (1) 재사용 대상 획의 본문 편집, (2) 본문은 그대로인 요소의 그룹 소속 변경,
    // (3) 툼스톤, (4) 다른 페이지 텍스트 편집.
    const applyPeerAOps = (target: Peer) => {
      author(target, withPatchedElement(target.pages, "page-a", "s-1", { strokeWidth: 27 }));
      author(target, withoutElement(target.pages, "page-a", "s-3"));
    };
    const applyPeerBOps = (target: Peer) => {
      author(target, grouped(target.pages, "page-a", "s-2", "g-1"));
      author(target, withPatchedElement(target.pages, "page-b", "t-1", { text: "고친 대사" }));
    };

    const run = (order: "a-first" | "b-first") => {
      const origin = new StudioCrdtDocument();
      setDeterministicStudioCrdtClientId(origin, 1);
      const seededPages = commit(origin, [], authoredScene());
      const seedUpdate = origin.encodeStateAsUpdate();

      const alpha = peer(2, seedUpdate, seededPages.map((candidate) => ({ ...candidate })));
      const beta = peer(3, seedUpdate, authoredScene());
      // 두 피어 모두 씨앗 문서를 이미 렌더한 상태에서 출발한다.
      beta.pages = merge(beta.document, beta.pages);

      if (order === "a-first") {
        applyPeerAOps(alpha);
        applyPeerBOps(beta);
        deliver(alpha, beta);
        deliver(beta, alpha);
      } else {
        applyPeerBOps(beta);
        applyPeerAOps(alpha);
        deliver(beta, alpha);
        deliver(alpha, beta);
      }
      // 마지막 왕복 — 양쪽 모두 상대의 최신 상태까지 흡수한다.
      deliver(alpha, beta);
      deliver(beta, alpha);

      const result = {
        alphaDocument: canonicalStudioCrdtProjection(alpha.document),
        betaDocument: canonicalStudioCrdtProjection(beta.document),
        alphaPages: canonicalPages(alpha.pages),
        betaPages: canonicalPages(beta.pages),
        // 메모가 완전히 식은 제3의 피어 — 모든 요소를 처음부터 물질화한다.
        coldPages: (() => {
          const cold = peer(4, alpha.document.encodeStateAsUpdate(), authoredScene());
          const projection = canonicalPages(cold.pages);
          cold.document.destroy();
          return projection;
        })(),
      };
      origin.destroy();
      alpha.document.destroy();
      beta.document.destroy();
      return result;
    };

    const first = run("a-first");
    const second = run("b-first");

    // 1) 두 피어의 CRDT 문서가 같다.
    expect(first.alphaDocument).toBe(first.betaDocument);
    expect(second.alphaDocument).toBe(second.betaDocument);
    // 2) 적용 순서가 달라도 같은 문서에 도달한다.
    expect(second.alphaDocument).toBe(first.alphaDocument);
    // 3) 재조정된 페이지(요소 재사용 경로)도 같다 — 그리고 메모가 식은 피어가 처음부터
    //    물질화한 결과와도 같다. 이 마지막 비교가 "재사용이 편집을 삼키지 않는다"의 증거다.
    expect(first.alphaPages).toBe(first.betaPages);
    expect(first.alphaPages).toBe(first.coldPages);
    expect(second.alphaPages).toBe(second.betaPages);
    expect(second.alphaPages).toBe(first.alphaPages);
  });

  it("원격 편집은 재사용 중이던 획에도 반드시 반영된다", () => {
    const origin = new StudioCrdtDocument();
    setDeterministicStudioCrdtClientId(origin, 1);
    const seededPages = commit(origin, [], authoredScene());
    const seedUpdate = origin.encodeStateAsUpdate();

    const alpha = peer(2, seedUpdate, seededPages.map((candidate) => ({ ...candidate })));
    const beta = peer(3, seedUpdate, authoredScene());
    beta.pages = merge(beta.document, beta.pages);

    // alpha 는 몇 번 커밋하면서 s-1 을 계속 재사용 상태로 만든다.
    for (let index = 0; index < 3; index += 1) {
      author(alpha, withPatchedElement(alpha.pages, "page-a", "s-0", { strokeWidth: 3 + index }));
    }
    const reused = elementById(alpha.pages, "page-a", "s-1");
    expect(elementById(alpha.pages, "page-a", "s-1")).toBe(reused);

    // beta 가 그 s-1 을 고친다.
    author(beta, withPatchedElement(beta.pages, "page-a", "s-1", { stroke: "#00ccff", strokeWidth: 33 }));
    deliver(beta, alpha);

    const merged = elementById(alpha.pages, "page-a", "s-1");
    expect(merged).not.toBe(reused);
    expect(merged.stroke).toBe("#00ccff");
    expect(merged.strokeWidth).toBe(33);

    origin.destroy();
    alpha.document.destroy();
    beta.document.destroy();
  });

  it("본문이 그대로인 요소도 그룹 소속 변경은 그대로 받는다", () => {
    const document = new StudioCrdtDocument();
    try {
      const authored = [page("page-a", [stroke("s-0", 7), stroke("s-1", 8)])];
      let pages = commit(document, [], authored);
      pages = commit(document, pages, pages);
      const before = elementById(pages, "page-a", "s-1");
      expect(before.groupId).toBeUndefined();

      // 본문은 손대지 않고 그룹에만 넣는다.
      // 소속이 바뀌면 레코드의 layerId 자체가 바뀌므로 보수적으로 완전히 새로 만든다.
      pages = commit(document, pages, grouped(pages, "page-a", "s-1", "g-1"));
      const joined = elementById(pages, "page-a", "s-1");
      expect(joined.groupId).toBe("g-1");
      expect(joined).not.toBe(before);
      expect(joined.points).toEqual(before.points);

      // 한 번 더 커밋해 s-1 을 재사용 상태로 만든 뒤, 요소 조작 없이 그룹만 툼스톤한다.
      pages = commit(document, pages, pages);
      const memoized = elementById(pages, "page-a", "s-1");
      expect(memoized.groupId).toBe("g-1");

      expect(document.deleteLayerGroup("page-a", "g-1")).toBe(true);
      pages = merge(document, pages);
      const orphaned = elementById(pages, "page-a", "s-1");
      // 본문이 그대로여도 소속 판정은 반드시 다시 돈다…
      expect(orphaned.groupId).toBeUndefined();
      expect(orphaned).not.toBe(memoized);
      // …그리고 그때도 본문(채널 배열)은 구조 공유된다.
      expect(orphaned.points).toBe(memoized.points);
      expect(orphaned.pressures).toBe(memoized.pressures);

      // 그룹이 되살아나면 소속도 되살아난다.
      expect(document.restoreLayerGroup("page-a", "g-1")).toBe(true);
      pages = merge(document, pages);
      const rejoined = elementById(pages, "page-a", "s-1");
      expect(rejoined.groupId).toBe("g-1");
      expect(rejoined.points).toBe(memoized.points);
    } finally {
      document.destroy();
    }
  });

  it("툼스톤된 요소는 재사용 캐시가 있어도 사라진다", () => {
    const document = new StudioCrdtDocument();
    try {
      const authored = [page("page-a", [stroke("s-0", 7), stroke("s-1", 8), bubble("t-0", "대사")])];
      let pages = commit(document, [], authored);
      pages = commit(document, pages, pages);
      expect(elementsOf(pages, "page-a").map(({ id }) => id)).toEqual(["s-0", "s-1", "t-0"]);

      pages = commit(document, pages, withoutElement(pages, "page-a", "s-1"));
      expect(elementsOf(pages, "page-a").map(({ id }) => id)).toEqual(["s-0", "t-0"]);

      pages = commit(document, pages, withoutElement(pages, "page-a", "t-0"));
      expect(elementsOf(pages, "page-a").map(({ id }) => id)).toEqual(["s-0"]);
    } finally {
      document.destroy();
    }
  });
});
