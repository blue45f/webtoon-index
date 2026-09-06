// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addStudioProductionBibleEntry,
  createEmptyStudioProductionBible,
  mergeStudioProductionBibles,
  normalizeStudioProductionBible,
  replaceStudioProductionBiblePromisePayoffLedger,
  serializeStudioProductionBible,
  StudioProductionBibleLocalRepository,
  type StudioProductionBible,
} from "./studio-production-bible";
import {
  addStudioPromisePayoffEntry,
  createEmptyStudioPromisePayoffLedger,
} from "./studio-promise-payoff-ledger";
import { StudioProductionBiblePanelSurface } from "./StudioProductionBiblePanel";

afterEach(cleanup);

function bibleFixture(): StudioProductionBible {
  return addStudioProductionBibleEntry(createEmptyStudioProductionBible(), {
    id: "scene-rooftop",
    kind: "scene",
    name: "옥상 대치",
  });
}

function Harness({ onChange = vi.fn() }: { readonly onChange?: (next: StudioProductionBible) => void }) {
  const [bible, setBible] = useState(bibleFixture);
  return (
    <StudioProductionBiblePanelSurface
      bible={bible}
      onClose={vi.fn()}
      onChange={(next) => {
        setBible(next);
        onChange(next);
      }}
    />
  );
}

describe("Production Bible Promise·Payoff integration", () => {
  it("migrates existing v1 documents to an empty ledger without losing reference entries", () => {
    const normalized = normalizeStudioProductionBible({
      version: 1,
      entries: [{
        id: "scene-old",
        kind: "scene",
        name: "기존 장면",
      }],
    });
    expect(normalized.entries[0]?.id).toBe("scene-old");
    expect(normalized.promisePayoffLedger).toEqual(
      createEmptyStudioPromisePayoffLedger()
    );
  });

  it("round-trips the ledger in canonical Production Bible JSON", () => {
    const bible = bibleFixture();
    const ledger = addStudioPromisePayoffEntry(
      createEmptyStudioPromisePayoffLedger(12),
      {
        id: "promise-clock",
        title: "깨진 시계",
        dueEpisode: 24,
      }
    );
    const next = replaceStudioProductionBiblePromisePayoffLedger(bible, ledger);
    const restored = normalizeStudioProductionBible(
      serializeStudioProductionBible(next)
    );
    expect(restored.entries).toEqual(bible.entries);
    expect(restored.promisePayoffLedger).toEqual(ledger);
  });

  it("merges imported promise entries through the existing Bible import policy", () => {
    const current = replaceStudioProductionBiblePromisePayoffLedger(
      bibleFixture(),
      addStudioPromisePayoffEntry(createEmptyStudioPromisePayoffLedger(8), {
        id: "promise-current",
        title: "현재 약속",
      })
    );
    const incoming = replaceStudioProductionBiblePromisePayoffLedger(
      createEmptyStudioProductionBible(),
      addStudioPromisePayoffEntry(createEmptyStudioPromisePayoffLedger(10), {
        id: "promise-imported",
        title: "가져온 약속",
      })
    );
    const merged = mergeStudioProductionBibles(current, incoming);
    expect(merged.promiseAddedIds).toEqual(["promise-imported"]);
    expect(merged.bible.promisePayoffLedger?.currentEpisode).toBe(10);
    expect(merged.bible.promisePayoffLedger?.entries.map(({ id }) => id)).toEqual([
      "promise-current",
      "promise-imported",
    ]);
  });

  it("persists the ledger through the existing local repository boundary", async () => {
    const values = new Map<string, string>();
    const repository = new StudioProductionBibleLocalRepository({
      legacyDataPolicy: "import-explicit",
      indexedDB: null,
      localStorage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => {
          values.set(key, value);
        },
      },
    });
    const ledger = addStudioPromisePayoffEntry(
      createEmptyStudioPromisePayoffLedger(9),
      {
        id: "promise-key",
        title: "사라진 열쇠",
      }
    );
    const bible = replaceStudioProductionBiblePromisePayoffLedger(
      bibleFixture(),
      ledger
    );
    const saved = await repository.save("promise-test", bible);
    const loaded = await repository.load("promise-test");

    expect(saved.backend).toBe("legacy-local-storage");
    expect(saved.localOnly).toBe(true);
    expect(loaded.bible.promisePayoffLedger).toEqual(ledger);
    expect(loaded.bible.entries[0]?.id).toBe("scene-rooftop");
  });

  it("switches to the leaf ledger, reuses scene options, and saves in one Bible change", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    const viewTabs = screen.getByRole("tablist", {
      name: "프로덕션 바이블 작업 영역",
    });
    expect(viewTabs).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /약속·회수 원장/u }));
    expect(screen.getByLabelText("약속과 회수 원장")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "새 약속 등록" }));
    fireEvent.click(screen.getByRole("button", { name: "첫 약속 회차·컷 연결" }));

    expect((screen.getByLabelText("장면 바이블") as HTMLSelectElement).innerHTML)
      .toContain('<option value="scene-rooftop">옥상 대치</option>');
    const latest = onChange.mock.calls.at(-1)?.[0] as StudioProductionBible;
    expect(latest.entries[0]?.id).toBe("scene-rooftop");
    expect(latest.promisePayoffLedger?.entries[0]).toMatchObject({
      id: "promise-1",
      seed: { id: "promise-1-seed-1", episode: 1 },
    });

    fireEvent.click(screen.getByRole("tab", { name: /장면·장소·소품/u }));
    expect(screen.getAllByText("옥상 대치").length).toBeGreaterThan(0);
  });
});
