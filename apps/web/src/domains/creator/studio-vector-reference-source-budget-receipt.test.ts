import { describe, expect, it } from "vitest";

import {
  createStudioVectorReferenceSourceBudgetReceipt,
  readStudioVectorReferenceSourceBudgetReceipt,
} from "./studio-vector-reference-source-budget-receipt";

describe("Studio vector source budget receipt", () => {
  it("binds a CJK-aware byte measurement to exact root, element order and budget identity", () => {
    const first = { id: "첫 획", points: [0, 1] };
    const second = { id: "둘째 획", points: [2, 3] };
    const elements = [first, second];
    const maxSourceBytes = 4_096;
    const exact = createStudioVectorReferenceSourceBudgetReceipt(
      elements,
      maxSourceBytes,
    );

    expect(exact.sourceByteLength)
      .toBe(new TextEncoder().encode(JSON.stringify(elements)).byteLength);
    expect(exact.sourceByteLength).toBeGreaterThan(JSON.stringify(elements).length);
    expect(readStudioVectorReferenceSourceBudgetReceipt(
      exact.receipt,
      elements,
      maxSourceBytes,
    )).toBe(exact.sourceByteLength);
    expect(readStudioVectorReferenceSourceBudgetReceipt(
      exact.receipt,
      elements,
      maxSourceBytes,
    )).toBeNull();

    const clonedArray = createStudioVectorReferenceSourceBudgetReceipt(elements, maxSourceBytes);
    expect(readStudioVectorReferenceSourceBudgetReceipt(
      clonedArray.receipt,
      [...elements],
      maxSourceBytes,
    )).toBeNull();

    const reordered = createStudioVectorReferenceSourceBudgetReceipt(elements, maxSourceBytes);
    elements.reverse();
    expect(readStudioVectorReferenceSourceBudgetReceipt(
      reordered.receipt,
      elements,
      maxSourceBytes,
    )).toBeNull();
    elements.reverse();

    const changedBudget = createStudioVectorReferenceSourceBudgetReceipt(
      elements,
      maxSourceBytes,
    );
    expect(readStudioVectorReferenceSourceBudgetReceipt(
      changedBudget.receipt,
      elements,
      maxSourceBytes - 1,
    )).toBeNull();
    expect(readStudioVectorReferenceSourceBudgetReceipt(
      changedBudget.receipt,
      elements,
      maxSourceBytes,
    )).toBeNull();
  });

  it("expires before an in-place mutation can cross a later microtask", async () => {
    const elements = [{ id: "line", points: [0, 1, 2, 3] }];
    const expired = createStudioVectorReferenceSourceBudgetReceipt(elements, 4_096);
    elements[0]!.points[2] = 2_000_000;
    await Promise.resolve();
    expect(readStudioVectorReferenceSourceBudgetReceipt(
      expired.receipt,
      elements,
      4_096,
    )).toBeNull();
  });

  it("rejects forged receipts and preserves undefined and circular JSON semantics", () => {
    const elements = [undefined];
    const created = createStudioVectorReferenceSourceBudgetReceipt(
      elements,
      128,
    );
    expect(created.sourceByteLength).toBe(new TextEncoder().encode("[null]").byteLength);
    expect(readStudioVectorReferenceSourceBudgetReceipt(
      {} as typeof created.receipt,
      elements,
      128,
    )).toBeNull();

    const circular: { owner?: unknown } = {};
    circular.owner = circular;
    expect(() => createStudioVectorReferenceSourceBudgetReceipt([circular], 128)).toThrow(TypeError);
  });
});
