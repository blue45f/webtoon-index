import { describe, expect, it } from "vitest";

import {
  CLOUD_STORAGE_PROVIDERS,
  CloudStorageAdapter,
  type CloudStorageProvider,
} from "./cloud-storage-adapter";

describe("Cloud Storage Adapter", () => {
  it("defines Google Drive and OneDrive providers only", () => {
    const providers = Object.keys(CLOUD_STORAGE_PROVIDERS) as CloudStorageProvider[];
    expect(providers).toEqual(["google-drive", "onedrive"]);
    expect(CLOUD_STORAGE_PROVIDERS["google-drive"].name).toBe("Google Drive");
    expect(CLOUD_STORAGE_PROVIDERS.onedrive.name).toBe("Microsoft OneDrive");
  });

  it("exports .toon, .psd, .clip, .abr, .png, .jpg, .webp, .zip for both providers", () => {
    for (const config of Object.values(CLOUD_STORAGE_PROVIDERS)) {
      expect(config.supportedFileTypes).toContain(".toon");
      expect(config.supportedFileTypes).toContain(".psd");
      expect(config.supportedFileTypes).toContain(".abr");
      expect(config.supportedFileTypes).toContain(".webp");
    }
  });

  it("starts disconnected and rejects operations without auth", () => {
    const adapter = new CloudStorageAdapter();
    expect(adapter.isConnected).toBe(false);
    expect(adapter.currentProvider).toBeNull();
    expect(() => adapter.listFiles()).rejects.toThrow("클라우드 저장소에 먼저 연결해 주세요.");
  });

  it("disconnects cleanly", () => {
    const adapter = new CloudStorageAdapter();
    adapter.disconnect();
    expect(adapter.isConnected).toBe(false);
    expect(adapter.currentProvider).toBeNull();
  });

  it("rejects connect without client ID configured", async () => {
    const adapter = new CloudStorageAdapter();
    await expect(adapter.connect("google-drive")).rejects.toThrow("client ID가 설정되지 않았습니다");
    await expect(adapter.connect("onedrive")).rejects.toThrow("client ID가 설정되지 않았습니다");
  });
});
