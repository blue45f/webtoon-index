// 내 정보(/api/me) 프로필 갱신 전용 ky 헬퍼.
// 공유 클라이언트가 HttpOnly 세션 쿠키와 CSRF 헤더를 처리한다.
import { mergeCurrentSessionProfile } from "@/src/compat/auth-session-state";
import { api, toApiError } from "@/src/infrastructure/api";

export interface MeProfile {
  id: string;
  name: string | null;
  image: string | null;
  avatar: string | null;
  email: string | null;
  bio: string | null;
}

export interface UpdateProfilePayload {
  name?: string;
  bio?: string;
  image?: string | null; // dataURL(webp/png/jpeg) 또는 null(제거). 미포함 시 변경 없음.
}

// 프로필(name·bio·image) 갱신. 성공 시 갱신된 프로필을 반환.
export async function updateMyProfile(payload: UpdateProfilePayload): Promise<MeProfile> {
  let data: { profile?: MeProfile } | undefined;
  try {
    data = await api.patch<{ profile?: MeProfile }>("/me/profile", payload);
  } catch (err) {
    throw await toApiError(err, "프로필을 저장하지 못했어요.");
  }
  if (!data?.profile) throw new Error("프로필을 저장하지 못했어요.");
  mergeCurrentSessionProfile(data.profile);
  return data.profile;
}

export async function deleteMyAccount(): Promise<{ ok: true; deletedAt: string }> {
  let data: { ok?: boolean; deletedAt?: string } | undefined;
  try {
    data = await api.delete<{ ok?: boolean; deletedAt?: string }>("/me/account");
  } catch (err) {
    throw await toApiError(err, "계정을 탈퇴 처리하지 못했어요.");
  }
  if (!data?.ok || !data.deletedAt) throw new Error("계정을 탈퇴 처리하지 못했어요.");
  return { ok: true, deletedAt: data.deletedAt };
}
