import { describe, expect, it } from "vitest";

import {
  studioVrmPoseShareUseContextConsentRequest,
  type StudioVrmPoseShareUseContextDisclosure,
} from "../studio-destructive-command-catalog";

const PRODUCT_DISCLOSURE = {
  avatarPermissionBasis: "other",
  publisherKind: "corporation",
  confirmedAttributionText: "Pose Model · Model Creator · CC_BY · https://creativecommons.org/licenses/by/4.0/",
  containsModifiedModel: true,
  excessivelyViolent: "absent",
  excessivelySexual: "absent",
  politicalOrReligious: "absent",
  antisocialOrHate: "absent",
  shareAlike: "not-satisfied",
} satisfies StudioVrmPoseShareUseContextDisclosure;

describe("studio VRM rendered-pose use-context consent", () => {
  it("presents every field that the product later seals into the typed receipt", () => {
    const request = studioVrmPoseShareUseContextConsentRequest(PRODUCT_DISCLOSURE);

    expect(request.intro).toContain("저작자도, 별도 이용 허락을 받은 사람도 아닙니다");
    expect(request.intro).toContain("ToonSpectrum 플랫폼 게시");
    expect(request.intro).toContain("게시 주체는 법인(corporation)");
    expect(request.intro).toContain("개조된 모델 표현이 포함됩니다");
    expect(request.intro).toContain("과도한 폭력: 해당하지 않음");
    expect(request.intro).toContain("과도한 성적 표현: 해당하지 않음");
    expect(request.intro).toContain("정치·종교적 이용: 해당하지 않음");
    expect(request.intro).toContain("반사회적·혐오 이용: 해당하지 않음");
    expect(request.intro).toContain("별도의 동일조건변경허락(share-alike) 이행을 주장하지 않습니다");
    expect(request.intro).toContain(
      `게시할 크레딧(변경 없이 게시): ${PRODUCT_DISCLOSURE.confirmedAttributionText}`,
    );
  });

  it("renders alternate typed values instead of silently retaining the product defaults", () => {
    const request = studioVrmPoseShareUseContextConsentRequest({
      ...PRODUCT_DISCLOSURE,
      avatarPermissionBasis: "author",
      publisherKind: "individual",
      confirmedAttributionText: "",
      containsModifiedModel: false,
      excessivelyViolent: "present",
      shareAlike: "satisfied",
    });

    expect(request.intro).toContain("나는 이 아바타의 저작자입니다");
    expect(request.intro).toContain("게시 주체는 개인(individual)");
    expect(request.intro).toContain("개조된 모델 표현이 포함되지 않습니다");
    expect(request.intro).toContain("과도한 폭력: 포함함");
    expect(request.intro).toContain("동일조건변경허락(share-alike)을 호환되는 조건으로 이행합니다");
    expect(request.intro).toContain("별도 크레딧을 요구하지 않습니다");
  });
});
