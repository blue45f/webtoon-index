import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * GNB 인증 표면은 서버 세션 기반 AuthMenuShell 하나다.
 * Firebase "회원" 버튼과 본 서비스 로그인을 나란히 두면 사용자가 같은 역할로 착각한다.
 */
describe("site header auth surface", () => {
  it("exposes a single canonical session auth control and never remounts Firebase member auth", () => {
    const header = readFileSync(join(process.cwd(), "components/site-header.tsx"), "utf8");

    expect(header).toMatch(/import\s+\{\s*AuthMenuShell\s*\}\s+from\s+"\.\/auth\/auth-menu-shell"/);
    expect(header).toMatch(/<AuthMenuShell\s*\/>/);

    expect(header).not.toMatch(/MemberAuth/);
    expect(header).not.toMatch(/member-auth/);
    expect(header).not.toMatch(/firebaseAuth/);

    const authMenuCount = (header.match(/AuthMenuShell/g) ?? []).length;
    // import + JSX 사용 2회(또는 주석 포함 여유). 중복 마운트 방지.
    expect(authMenuCount).toBeGreaterThanOrEqual(2);
    expect(authMenuCount).toBeLessThanOrEqual(3);
  });
});
