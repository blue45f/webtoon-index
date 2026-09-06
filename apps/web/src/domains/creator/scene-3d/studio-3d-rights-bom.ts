/**
 * Studio 3D Rights BOM (Bill of Materials) & IP Compliance Engine
 *
 * 3D 에셋(메시, 텍스처, 아바타, CAD, 소품)의 원본 출처, 라이선스,
 * 상용 출판 적합성, 카피레프트 충돌, 저작권자 표기 및 파생 이력을 추적하는
 * 지식재산권(IP) 관리 및 상용 안전성 검증 레지스트리입니다.
 */

export type LicenseType =
  | "CC0"
  | "CC-BY-4.0"
  | "CC-BY-SA-4.0"
  | "CC-BY-NC-4.0"
  | "CC-BY-NC-SA-4.0"
  | "MIT"
  | "Apache-2.0"
  | "BSD-3-Clause"
  | "LGPL-2.1"
  | "LGPL-3.0"
  | "GPL-2.0"
  | "GPL-3.0"
  | "AGPL-3.0"
  | "Proprietary-Commercial"
  | "AI-Generated-Clean"
  | "custom"
  | "unknown";

export type UsageScope =
  | "personal"
  | "commercial"
  | "editorial"
  | "education"
  | "internal-only";

export interface RightsRecord {
  assetId: string;
  assetName: string;
  sourceUrl?: string;
  creator: string;
  license: LicenseType;
  usageScope: UsageScope[];
  attributionRequired: boolean;
  attributionText?: string;
  expiresAt?: string;  // ISO date
  modificationAllowed: boolean;
  redistributionAllowed: boolean;
  importDate: string;  // ISO date
  importSourceFormat: string;
  derivedFrom?: string; // parent assetId
  isAiGenerated?: boolean;
  aiModelProvenance?: string;
  commercialRoyaltyFree?: boolean;
  notes?: string;
}

export type RightsValidationSeverity = "error" | "warning" | "info";

export interface RightsValidationResult {
  assetId: string;
  assetName?: string;
  severity: RightsValidationSeverity;
  code: string;
  message: string;
  remediation?: string;
}

export interface CommercialAuditSummary {
  totalAssets: number;
  complianceScore: number; // 0 ~ 100
  isApprovedForCommercialPublish: boolean;
  byLicense: Record<string, number>;
  attributionRequiredCount: number;
  commercialBlockedCount: number;
  copyleftRiskCount: number;
  aiGeneratedCount: number;
  issues: RightsValidationResult[];
}

export class Studio3DRightsBOM {
  private records: Map<string, RightsRecord> = new Map();

  public addRecord(record: RightsRecord): void {
    this.records.set(record.assetId, record);
  }

  public getRecord(assetId: string): RightsRecord | undefined {
    return this.records.get(assetId);
  }

  public removeRecord(assetId: string): boolean {
    return this.records.delete(assetId);
  }

  public getAllRecords(): RightsRecord[] {
    return [...this.records.values()];
  }

  /**
   * 상용 출판 시 라이선스 호환성을 정밀 검증합니다.
   */
  public validateForCommercialPublish(): RightsValidationResult[] {
    const results: RightsValidationResult[] = [];

    for (const record of this.records.values()) {
      // 1. GPL / AGPL 카피레프트 충돌 검사
      if (["GPL-2.0", "GPL-3.0", "AGPL-3.0"].includes(record.license)) {
        results.push({
          assetId: record.assetId,
          assetName: record.assetName,
          severity: "error",
          code: "GPL_COPYLEFT_CONFLICT",
          message: `에셋 "${record.assetName}"은(는) ${record.license} 라이선스로, 상용 배포 시 전체 작품 소스/에셋 공개 의무가 발생합니다.`,
          remediation: "CC0, MIT, 또는 상용 라이선스 대체 에셋으로 교체하세요.",
        });
      }

      // 2. NC (비상업) 에셋의 상용 출판 충돌
      if (["CC-BY-NC-4.0", "CC-BY-NC-SA-4.0"].includes(record.license) && record.usageScope.includes("commercial")) {
        results.push({
          assetId: record.assetId,
          assetName: record.assetName,
          severity: "error",
          code: "NC_COMMERCIAL_CONFLICT",
          message: `에셋 "${record.assetName}"은(는) 비상업 전용(${record.license}) 라이선스이며 유료 웹툰 연재에 사용할 수 없습니다.`,
          remediation: "원작자에게 상용 라이선스를 구매하거나 상용 허용 에셋으로 교체하세요.",
        });
      }

      // 3. 라이선스 미확인 에셋
      if (record.license === "unknown") {
        results.push({
          assetId: record.assetId,
          assetName: record.assetName,
          severity: "warning",
          code: "LICENSE_UNKNOWN",
          message: `에셋 "${record.assetName}"의 라이선스가 미지정 상태입니다. 출판 전 원본 출처 확인이 필요합니다.`,
          remediation: "에셋 등록 정보에서 출처 URL 및 라이선스를 입력하세요.",
        });
      }

      // 4. 만료된 라이선스 확인
      if (record.expiresAt) {
        const expiry = new Date(record.expiresAt);
        if (expiry <= new Date()) {
          results.push({
            assetId: record.assetId,
            assetName: record.assetName,
            severity: "error",
            code: "LICENSE_EXPIRED",
            message: `에셋 "${record.assetName}"의 라이선스가 ${record.expiresAt}에 만료되었습니다.`,
            remediation: "에셋 라이선스 계약을 갱신하거나 대체 에셋을 사용하세요.",
          });
        }
      }

      // 5. 저작자 표기 필수 에셋
      if (record.attributionRequired && (!record.attributionText || !record.attributionText.trim())) {
        results.push({
          assetId: record.assetId,
          assetName: record.assetName,
          severity: "warning",
          code: "ATTRIBUTION_MISSING",
          message: `에셋 "${record.assetName}"은(는) 크레딧 표기가 필수이지만 표기 문구가 비어 있습니다.`,
          remediation: "후기/엔드카드에 들어갈 저작자명 및 라이선스 표기를 입력하세요.",
        });
      }
    }

    return results;
  }

  /**
   * 상용 출판 심사 종합 보고서 생성
   */
  public generateCommercialAuditSummary(): CommercialAuditSummary {
    const issues = this.validateForCommercialPublish();
    const byLicense: Record<string, number> = {};
    let attributionRequiredCount = 0;
    let commercialBlockedCount = 0;
    let copyleftRiskCount = 0;
    let aiGeneratedCount = 0;

    for (const record of this.records.values()) {
      byLicense[record.license] = (byLicense[record.license] ?? 0) + 1;
      if (record.attributionRequired) attributionRequiredCount += 1;
      if (record.isAiGenerated) aiGeneratedCount += 1;
      if (["GPL-2.0", "GPL-3.0", "AGPL-3.0"].includes(record.license)) {
        copyleftRiskCount += 1;
        commercialBlockedCount += 1;
      } else if (["CC-BY-NC-4.0", "CC-BY-NC-SA-4.0"].includes(record.license)) {
        commercialBlockedCount += 1;
      }
    }

    const total = this.records.size;
    const errors = issues.filter((i) => i.severity === "error").length;
    const warnings = issues.filter((i) => i.severity === "warning").length;

    let score = 100;
    if (total > 0) {
      score = Math.max(0, Math.round(100 - (errors * 35 + warnings * 10)));
    }

    return {
      totalAssets: total,
      complianceScore: score,
      isApprovedForCommercialPublish: errors === 0,
      byLicense,
      attributionRequiredCount,
      commercialBlockedCount,
      copyleftRiskCount,
      aiGeneratedCount,
      issues,
    };
  }

  /**
   * 에셋 파생 이력 체인을 조회합니다.
   */
  public getDerivationChain(assetId: string): RightsRecord[] {
    const chain: RightsRecord[] = [];
    let current = this.records.get(assetId);
    const visited = new Set<string>();
    while (current && !visited.has(current.assetId)) {
      chain.push(current);
      visited.add(current.assetId);
      if (current.derivedFrom) {
        current = this.records.get(current.derivedFrom);
      } else {
        break;
      }
    }
    return chain;
  }

  /**
   * 웹툰 플랫폼용 자동 엔드카드(End Card / Credits) 마크다운 생성
   */
  public generateWebtoonEndCardCredits(): string {
    const attributionRecords = this.getAllRecords().filter(
      (r) => r.attributionRequired || r.isAiGenerated,
    );

    if (attributionRecords.length === 0) {
      return "## 🎨 3D 에셋 크레딧\n본 화에 사용된 모든 3D 에셋은 자체 제작 및 자유 상용 라이선스를 준수합니다.\n";
    }

    let md = "## 🎨 3D 에셋 & 라이선스 크레딧\n\n";
    md += "| 에셋명 | 제작자 | 라이선스 | 표기 문구 |\n";
    md += "|---|---|---|---|\n";

    for (const r of attributionRecords) {
      const text = r.attributionText ?? `${r.assetName} by ${r.creator} (${r.license})`;
      md += `| ${r.assetName} | ${r.creator} | ${r.license} | ${text} |\n`;
    }

    return md;
  }

  public serializeToJSON(): string {
    return JSON.stringify([...this.records.values()], null, 2);
  }

  public loadFromJSON(json: string): void {
    const parsed = JSON.parse(json) as RightsRecord[];
    this.records.clear();
    for (const r of parsed) {
      this.records.set(r.assetId, r);
    }
  }
}
