// 손가락 굽힘의 공용 계약 — 런타임(useStudioVrmPoserPoseEdit)과 셰이퍼 인스펙터가 같은 이름·같은
// 본 접두사·같은 읽기 규칙을 쓰게 한다. three 의존이 없어 노드에서 그대로 테스트된다.
//
// 왜 따로 두나: 굽힘 각도를 화면에 되읽는 코드가 여기저기서 `leftIndexProximal[2]` 를 직접 파던
// 탓에, 손가락을 하나씩 다루기 시작하면 읽는 쪽과 쓰는 쪽이 서로 다른 본을 볼 위험이 있다.

export type StudioVrmFingerName = "thumb" | "index" | "middle" | "ring" | "little";

export const STUDIO_VRM_FINGER_NAMES: readonly StudioVrmFingerName[] = [
  "thumb",
  "index",
  "middle",
  "ring",
  "little",
] as const;

export const STUDIO_VRM_FINGER_LABELS: Readonly<Record<StudioVrmFingerName, string>> = Object.freeze({
  thumb: "엄지",
  index: "검지",
  middle: "중지",
  ring: "약지",
  little: "새끼",
});

/** VRM humanoid 본 이름의 손가락 조각. 엄지는 축이 달라 굽힘 계산이 따로다. */
export const STUDIO_VRM_FINGER_BONE_PREFIX: Readonly<
  Record<Exclude<StudioVrmFingerName, "thumb">, "Index" | "Middle" | "Ring" | "Little">
> = Object.freeze({
  index: "Index",
  middle: "Middle",
  ring: "Ring",
  little: "Little",
});

/** 굽힘 각도를 되읽을 때 보는 본과 축. 쓰는 쪽과 같은 자리를 봐야 슬라이더가 진실을 보여 준다. */
function curlProbe(
  side: "left" | "right",
  finger: StudioVrmFingerName,
): { readonly bone: string; readonly axis: 0 | 1 | 2 } {
  return finger === "thumb"
    // 엄지 근위 마디는 [0, y*0.6, z*0.5] 로 쓰이므로 y 축을 0.6 으로 되나눠 각도를 얻는다.
    ? { bone: `${side}ThumbProximal`, axis: 1 }
    : { bone: `${side}${STUDIO_VRM_FINGER_BONE_PREFIX[finger]}Proximal`, axis: 2 };
}

const THUMB_PROXIMAL_YAW_RATIO = 0.6;

/**
 * 현재 편집 상태에서 그 손가락의 굽힘 각도(도, 0 이상)를 읽는다. 편집이 없으면 0이다.
 * 부호는 손 방향이 결정하므로 절댓값으로 돌려준다 — 화면의 슬라이더는 굽힘의 크기만 다룬다.
 */
export function readStudioVrmFingerCurlDegrees(
  fingerEdits: Readonly<Record<string, readonly number[] | undefined>>,
  side: "left" | "right",
  finger: StudioVrmFingerName,
): number {
  const { bone, axis } = curlProbe(side, finger);
  const rotation = fingerEdits[bone];
  if (!Array.isArray(rotation)) return 0;
  const radians = typeof rotation[axis] === "number" ? rotation[axis] : 0;
  if (!Number.isFinite(radians)) return 0;
  const scaled = finger === "thumb" ? radians / THUMB_PROXIMAL_YAW_RATIO : radians;
  return Math.round(Math.abs((scaled * 180) / Math.PI));
}
