/**
 * Multi-Cloud Storage Adapter — Google Drive & Microsoft OneDrive
 *
 * Google Drive: OAuth 2.0 implicit flow → Drive API v3 (list / upload / download)
 * OneDrive:     MSAL popup flow → Microsoft Graph API (list / upload / download)
 *
 * Both providers share a uniform `CloudStorageAdapter` interface so the Studio
 * export/import UI can treat them identically.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CloudStorageProvider = "google-drive" | "onedrive";

export interface CloudStorageConfig {
  provider: CloudStorageProvider;
  name: string;
  icon: string;
  /** File extensions the provider can store. */
  supportedFileTypes: readonly string[];
  maxUploadMB: number;
  /** OAuth client-id (must come from env at build time). */
  clientId: string;
}

export interface CloudFileMetadata {
  id: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
  modifiedAt: string;
  provider: CloudStorageProvider;
  downloadUrl?: string;
  thumbnailUrl?: string;
}

export interface CloudAuthState {
  provider: CloudStorageProvider;
  accessToken: string;
  expiresAt: number;
  userEmail?: string;
  userName?: string;
}

// ---------------------------------------------------------------------------
// Provider Configs
// ---------------------------------------------------------------------------

const TOON_EXTENSIONS = [".toon", ".psd", ".clip", ".abr", ".png", ".jpg", ".webp", ".zip"] as const;

export const CLOUD_STORAGE_PROVIDERS: Record<CloudStorageProvider, CloudStorageConfig> = {
  "google-drive": {
    provider: "google-drive",
    name: "Google Drive",
    icon: "google-drive",
    supportedFileTypes: TOON_EXTENSIONS,
    maxUploadMB: 5120, // 5 GB via resumable upload
    clientId: import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID ?? "",
  },
  onedrive: {
    provider: "onedrive",
    name: "Microsoft OneDrive",
    icon: "onedrive",
    supportedFileTypes: TOON_EXTENSIONS,
    maxUploadMB: 4096, // 4 GB via upload session
    clientId: import.meta.env.VITE_ONEDRIVE_CLIENT_ID ?? "",
  },
};

// ---------------------------------------------------------------------------
// Google Drive Adapter
// ---------------------------------------------------------------------------

const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.file";
const _GOOGLE_DISCOVERY = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";

/** Lazy-load the Google Identity Services (GIS) library. */
function ensureGoogleScript(): Promise<void> {
  if (document.getElementById("gsi-script")) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = "gsi-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Identity Services 로드 실패"));
    document.head.appendChild(script);
  });
}

export async function authorizeGoogleDrive(clientId: string): Promise<CloudAuthState> {
  await ensureGoogleScript();

  return new Promise<CloudAuthState>((resolve, reject) => {
    const gis = (window as unknown as Record<string, unknown>).google as
      | { accounts: { oauth2: { initTokenClient: (c: Record<string, unknown>) => { requestAccessToken: () => void } } } }
      | undefined;

    if (!gis) {
      reject(new Error("Google Identity Services를 로드하지 못했습니다."));
      return;
    }

    const client = gis.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: GOOGLE_SCOPES,
      callback: (tokenResponse: Record<string, string>) => {
        if (tokenResponse.error) {
          reject(new Error(tokenResponse.error));
          return;
        }
        resolve({
          provider: "google-drive",
          accessToken: tokenResponse.access_token,
          expiresAt: Date.now() + Number(tokenResponse.expires_in) * 1_000,
          userEmail: tokenResponse.email,
        });
      },
    });

    client.requestAccessToken();
  });
}

export async function listGoogleDriveFiles(
  accessToken: string,
  folderName = "ToonSpectrum"
): Promise<CloudFileMetadata[]> {
  // 1. Find or create the app folder
  const folderQuery = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`
  );
  const folderRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${folderQuery}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const folderData = (await folderRes.json()) as { files?: { id: string; name: string }[] };
  const folder = folderData.files?.[0];
  if (!folder) return [];

  // 2. List files inside
  const q = encodeURIComponent(`'${folder.id}' in parents and trashed=false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,size,mimeType,modifiedTime,thumbnailLink,webContentLink)&pageSize=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = (await res.json()) as {
    files?: {
      id: string;
      name: string;
      size?: string;
      mimeType: string;
      modifiedTime: string;
      thumbnailLink?: string;
      webContentLink?: string;
    }[];
  };

  return (data.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    sizeBytes: Number(f.size ?? 0),
    mimeType: f.mimeType,
    modifiedAt: f.modifiedTime,
    provider: "google-drive" as const,
    downloadUrl: f.webContentLink,
    thumbnailUrl: f.thumbnailLink,
  }));
}

export async function uploadToGoogleDrive(
  accessToken: string,
  fileName: string,
  blob: Blob,
  folderName = "ToonSpectrum"
): Promise<{ fileId: string; webViewLink: string }> {
  // 1. Ensure app folder exists
  const folderQuery = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`
  );
  const folderRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${folderQuery}&fields=files(id)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const folderData = (await folderRes.json()) as { files?: { id: string }[] };
  let folderId = folderData.files?.[0]?.id;

  if (!folderId) {
    const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
      }),
    });
    const created = (await createRes.json()) as { id: string };
    folderId = created.id;
  }

  // 2. Multipart upload (simple — suitable for files < 5 MB; use resumable for larger)
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });
  const boundary = `toonspectrum-${Date.now()}`;
  const body = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`,
  ];

  const multipartBlob = new Blob([body[0], body[1], blob, `\r\n--${boundary}--`], {
    type: `multipart/related; boundary=${boundary}`,
  });

  const uploadRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: multipartBlob,
    }
  );

  const result = (await uploadRes.json()) as { id: string; webViewLink: string };
  return { fileId: result.id, webViewLink: result.webViewLink };
}

export async function downloadFromGoogleDrive(accessToken: string, fileId: string): Promise<Blob> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return res.blob();
}

// ---------------------------------------------------------------------------
// Microsoft OneDrive Adapter (Graph API)
// ---------------------------------------------------------------------------

const ONEDRIVE_SCOPES = ["Files.ReadWrite.AppFolder", "User.Read"];

/** Minimal MSAL-style popup auth (no library dependency — uses OAuth 2.0 implicit grant). */
export async function authorizeOneDrive(clientId: string): Promise<CloudAuthState> {
  const redirectUri = `${window.location.origin}/auth/onedrive/callback`;
  const state = crypto.randomUUID();
  const nonce = crypto.randomUUID();

  const authUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", ONEDRIVE_SCOPES.join(" "));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("nonce", nonce);
  authUrl.searchParams.set("response_mode", "fragment");

  return new Promise<CloudAuthState>((resolve, reject) => {
    const popup = window.open(authUrl.toString(), "onedrive-auth", "width=500,height=700");
    if (!popup) {
      reject(new Error("팝업이 차단되었습니다. 팝업 허용 후 다시 시도해 주세요."));
      return;
    }

    const interval = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(interval);
          reject(new Error("인증이 취소되었습니다."));
          return;
        }
        const hash = popup.location.hash;
        if (hash.includes("access_token")) {
          clearInterval(interval);
          popup.close();
          const params = new URLSearchParams(hash.slice(1));
          resolve({
            provider: "onedrive",
            accessToken: params.get("access_token") ?? "",
            expiresAt: Date.now() + Number(params.get("expires_in") ?? 3600) * 1_000,
          });
        }
      } catch {
        // Cross-origin — keep polling until popup redirects back
      }
    }, 300);
  });
}

export async function listOneDriveFiles(
  accessToken: string,
  folderPath = "/ToonSpectrum"
): Promise<CloudFileMetadata[]> {
  const encodedPath = encodeURIComponent(folderPath.replace(/^\//, ""));
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}:/children?$select=id,name,size,file,lastModifiedDateTime,@microsoft.graph.downloadUrl&$top=200`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    if (res.status === 404) return []; // Folder doesn't exist yet
    throw new Error(`OneDrive API ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as {
    value?: {
      id: string;
      name: string;
      size: number;
      file?: { mimeType: string };
      lastModifiedDateTime: string;
      "@microsoft.graph.downloadUrl"?: string;
    }[];
  };

  return (data.value ?? [])
    .filter((item) => item.file) // Only files, not sub-folders
    .map((item) => ({
      id: item.id,
      name: item.name,
      sizeBytes: item.size,
      mimeType: item.file?.mimeType ?? "application/octet-stream",
      modifiedAt: item.lastModifiedDateTime,
      provider: "onedrive" as const,
      downloadUrl: item["@microsoft.graph.downloadUrl"],
    }));
}

export async function uploadToOneDrive(
  accessToken: string,
  fileName: string,
  blob: Blob,
  folderPath = "/ToonSpectrum"
): Promise<{ fileId: string; webUrl: string }> {
  const safePath = folderPath.replace(/^\//, "");
  const encodedName = encodeURIComponent(fileName);

  // Simple upload (< 4 MB) — use upload session for larger files
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/root:/${safePath}/${encodedName}:/content`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": blob.type || "application/octet-stream",
      },
      body: blob,
    }
  );

  if (!res.ok) throw new Error(`OneDrive upload failed: ${res.status}`);
  const result = (await res.json()) as { id: string; webUrl: string };
  return { fileId: result.id, webUrl: result.webUrl };
}

export async function downloadFromOneDrive(accessToken: string, fileId: string): Promise<Blob> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return res.blob();
}

// ---------------------------------------------------------------------------
// Unified Adapter
// ---------------------------------------------------------------------------

export class CloudStorageAdapter {
  private authState: CloudAuthState | null = null;

  get currentProvider(): CloudStorageProvider | null {
    return this.authState?.provider ?? null;
  }

  get isConnected(): boolean {
    return this.authState !== null && this.authState.expiresAt > Date.now();
  }

  async connect(provider: CloudStorageProvider): Promise<CloudAuthState> {
    const config = CLOUD_STORAGE_PROVIDERS[provider];
    if (!config.clientId) {
      throw new Error(`${config.name} client ID가 설정되지 않았습니다. 환경변수를 확인해 주세요.`);
    }

    this.authState =
      provider === "google-drive"
        ? await authorizeGoogleDrive(config.clientId)
        : await authorizeOneDrive(config.clientId);

    return this.authState;
  }

  disconnect(): void {
    this.authState = null;
  }

  private requireAuth(): CloudAuthState {
    if (!this.authState || this.authState.expiresAt <= Date.now()) {
      throw new Error("클라우드 저장소에 먼저 연결해 주세요.");
    }
    return this.authState;
  }

  async listFiles(folderPath?: string): Promise<CloudFileMetadata[]> {
    const auth = this.requireAuth();
    return auth.provider === "google-drive"
      ? listGoogleDriveFiles(auth.accessToken, folderPath)
      : listOneDriveFiles(auth.accessToken, folderPath);
  }

  async upload(fileName: string, blob: Blob, folderPath?: string): Promise<{ fileId: string; url: string }> {
    const auth = this.requireAuth();
    if (auth.provider === "google-drive") {
      const r = await uploadToGoogleDrive(auth.accessToken, fileName, blob, folderPath);
      return { fileId: r.fileId, url: r.webViewLink };
    }
    const r = await uploadToOneDrive(auth.accessToken, fileName, blob, folderPath);
    return { fileId: r.fileId, url: r.webUrl };
  }

  async download(fileId: string): Promise<Blob> {
    const auth = this.requireAuth();
    return auth.provider === "google-drive"
      ? downloadFromGoogleDrive(auth.accessToken, fileId)
      : downloadFromOneDrive(auth.accessToken, fileId);
  }
}

export const cloudStorage = new CloudStorageAdapter();
