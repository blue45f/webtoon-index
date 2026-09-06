import { describe, expect, it, vi } from "vitest";

import {
  readOrCreateStudioLiveClientInstanceId,
  readOrCreateStudioLiveGuestCredential,
  STUDIO_LIVE_CLIENT_INSTANCE_STORAGE_PREFIX,
  STUDIO_LIVE_GUEST_CREDENTIAL_STORAGE_KEY,
  type StudioLiveIdentityStorage,
} from "./studio-live-client-identity";

const STORED_GUEST_UUID = "7a75f75a-4abc-4def-8abc-04c9e58a52f1";
const REPLACEMENT_GUEST_UUID = "aaaaaaaa-4abc-4def-8abc-04c9e58a52f1";
const WORK_A_INSTANCE_ID = "bbbbbbbb-4abc-4def-8abc-04c9e58a52f1";
const WORK_B_INSTANCE_ID = "cccccccc-4abc-4def-8abc-04c9e58a52f1";

function memoryStorage(
  initial: Record<string, string> = {},
): StudioLiveIdentityStorage & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function instanceKey(workId: string): string {
  return `${STUDIO_LIVE_CLIENT_INSTANCE_STORAGE_PREFIX}${workId}`;
}

describe("studio live client identity", () => {
  it("persists a guest credential and reuses it from storage", () => {
    const storage = memoryStorage();
    const randomUUID = vi.fn()
      .mockReturnValueOnce(STORED_GUEST_UUID)
      .mockReturnValueOnce(REPLACEMENT_GUEST_UUID);

    const first = readOrCreateStudioLiveGuestCredential(storage, randomUUID);
    const second = readOrCreateStudioLiveGuestCredential(storage, randomUUID);

    expect(first).toBe(`guest:v1:${STORED_GUEST_UUID}`);
    expect(second).toBe(first);
    expect(storage.getItem(STUDIO_LIVE_GUEST_CREDENTIAL_STORAGE_KEY)).toBe(first);
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("replaces an invalid stored guest credential", () => {
    const storage = memoryStorage({
      [STUDIO_LIVE_GUEST_CREDENTIAL_STORAGE_KEY]: "guest:v1:not-a-uuid",
    });

    const created = readOrCreateStudioLiveGuestCredential(
      storage,
      () => REPLACEMENT_GUEST_UUID,
    );

    expect(created).toBe(`guest:v1:${REPLACEMENT_GUEST_UUID}`);
    expect(storage.getItem(STUDIO_LIVE_GUEST_CREDENTIAL_STORAGE_KEY)).toBe(created);
  });

  it("reuses the client instance id per workId in the provided session storage", () => {
    const storage = memoryStorage();
    const randomUUID = vi.fn()
      .mockReturnValueOnce(WORK_A_INSTANCE_ID)
      .mockReturnValueOnce(WORK_B_INSTANCE_ID);

    const first = readOrCreateStudioLiveClientInstanceId("work-1", storage, randomUUID);
    const second = readOrCreateStudioLiveClientInstanceId("work-1", storage, randomUUID);

    expect(first).toBe(WORK_A_INSTANCE_ID);
    expect(second).toBe(first);
    expect(storage.getItem(instanceKey("work-1"))).toBe(first);
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("mints distinct client instance ids for different workIds", () => {
    const storage = memoryStorage();
    const randomUUID = vi.fn()
      .mockReturnValueOnce(WORK_A_INSTANCE_ID)
      .mockReturnValueOnce(WORK_B_INSTANCE_ID);

    const first = readOrCreateStudioLiveClientInstanceId("work-1", storage, randomUUID);
    const second = readOrCreateStudioLiveClientInstanceId("work-2", storage, randomUUID);

    expect(first).toBe(WORK_A_INSTANCE_ID);
    expect(second).toBe(WORK_B_INSTANCE_ID);
    expect(first).not.toBe(second);
    expect(storage.getItem(instanceKey("work-1"))).toBe(first);
    expect(storage.getItem(instanceKey("work-2"))).toBe(second);
  });
});
