/**
 * Studio 3D Continuity Checker
 *
 * Shot 사이의 연속성(Continuity)을 검증합니다.
 * 캐릭터 위치, 손에 든 물건, 문 상태, 조명, 의상, 상처 등의
 * 속성이 컷 간에 일관성을 유지하는지 자동으로 감지합니다.
 *
 * 설계서 참조: §4.10 SHT-004 continuity compare
 */

export type ContinuityCategory =
  | "position"
  | "held-item"
  | "door-state"
  | "lighting"
  | "costume"
  | "expression"
  | "wound-mark"
  | "weather"
  | "prop-state"
  | "time-of-day";

export type ContinuitySeverity = "error" | "warning" | "info";

export interface ContinuityProperty {
  nodeId: string;
  nodeName: string;
  category: ContinuityCategory;
  key: string;
  value: unknown;
}

export interface ContinuityIssue {
  severity: ContinuitySeverity;
  category: ContinuityCategory;
  shotA: string;
  shotB: string;
  nodeId: string;
  nodeName: string;
  key: string;
  valueA: unknown;
  valueB: unknown;
  message: string;
}

export interface ShotContinuitySnapshot {
  shotId: string;
  shotName: string;
  properties: ContinuityProperty[];
}

function continuityPropertyKey(property: ContinuityProperty): string {
  return JSON.stringify([property.nodeId, property.category, property.key]);
}

function continuityValuesEqual(
  valueA: unknown,
  valueB: unknown,
  visited = new WeakMap<object, object>(),
): boolean {
  if (Object.is(valueA, valueB)) return true;
  if (
    typeof valueA !== "object"
    || valueA === null
    || typeof valueB !== "object"
    || valueB === null
  ) return false;

  const visitedPeer = visited.get(valueA);
  if (visitedPeer) return visitedPeer === valueB;
  visited.set(valueA, valueB);

  if (valueA instanceof Date || valueB instanceof Date) {
    return valueA instanceof Date
      && valueB instanceof Date
      && valueA.getTime() === valueB.getTime();
  }
  if (ArrayBuffer.isView(valueA) || ArrayBuffer.isView(valueB)) {
    if (!ArrayBuffer.isView(valueA) || !ArrayBuffer.isView(valueB)) return false;
    if (valueA.byteLength !== valueB.byteLength) return false;
    const bytesA = new Uint8Array(valueA.buffer, valueA.byteOffset, valueA.byteLength);
    const bytesB = new Uint8Array(valueB.buffer, valueB.byteOffset, valueB.byteLength);
    return bytesA.every((byte, index) => byte === bytesB[index]);
  }
  if (Array.isArray(valueA) || Array.isArray(valueB)) {
    if (!Array.isArray(valueA) || !Array.isArray(valueB) || valueA.length !== valueB.length) {
      return false;
    }
    return valueA.every((entry, index) => continuityValuesEqual(entry, valueB[index], visited));
  }

  const keysA = Object.keys(valueA).sort();
  const keysB = Object.keys(valueB).sort();
  if (keysA.length !== keysB.length || keysA.some((key, index) => key !== keysB[index])) {
    return false;
  }
  return keysA.every((key) => continuityValuesEqual(
    (valueA as Record<string, unknown>)[key],
    (valueB as Record<string, unknown>)[key],
    visited,
  ));
}

function cloneContinuityValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

export class Studio3DContinuityChecker {
  private snapshots = new Map<string, ShotContinuitySnapshot>();
  private ignoredCategories = new Set<ContinuityCategory>();

  /**
   * Shot의 연속성 스냅샷을 등록합니다.
   */
  public registerSnapshot(snapshot: ShotContinuitySnapshot): void {
    if (!snapshot.shotId.trim()) throw new Error("Shot ID는 비어 있을 수 없습니다.");
    this.snapshots.set(snapshot.shotId, this.cloneSnapshot(snapshot));
  }

  /**
   * 특정 카테고리를 연속성 검사에서 제외합니다.
   */
  public ignoreCategory(category: ContinuityCategory): void {
    this.ignoredCategories.add(category);
  }

  public includeCategory(category: ContinuityCategory): void {
    this.ignoredCategories.delete(category);
  }

  /**
   * 두 Shot 사이의 연속성 이슈를 검출합니다.
   */
  public compareShots(shotIdA: string, shotIdB: string): ContinuityIssue[] {
    const snapA = this.snapshots.get(shotIdA);
    const snapB = this.snapshots.get(shotIdB);
    if (!snapA || !snapB) return [];

    const issues: ContinuityIssue[] = [];

    const propertiesA = new Map(
      snapA.properties
        .filter((property) => !this.ignoredCategories.has(property.category))
        .map((property) => [continuityPropertyKey(property), property]),
    );
    const propertiesB = new Map(
      snapB.properties
        .filter((property) => !this.ignoredCategories.has(property.category))
        .map((property) => [continuityPropertyKey(property), property]),
    );
    const propertyKeys = new Set([...propertiesA.keys(), ...propertiesB.keys()]);

    for (const propertyKey of propertyKeys) {
      const propA = propertiesA.get(propertyKey);
      const propB = propertiesB.get(propertyKey);

      if (!propA && propB) {
        issues.push({
          severity: this.getSeverity(propB.category),
          category: propB.category,
          shotA: shotIdA,
          shotB: shotIdB,
          nodeId: propB.nodeId,
          nodeName: propB.nodeName,
          key: propB.key,
          valueA: undefined,
          valueB: cloneContinuityValue(propB.value),
          message: `"${propB.nodeName}"의 ${propB.key} 속성이 Shot "${snapA.shotName}"에서 누락됨`,
        });
        continue;
      }

      if (propA && !propB) {
        issues.push({
          severity: this.getSeverity(propA.category),
          category: propA.category,
          shotA: shotIdA,
          shotB: shotIdB,
          nodeId: propA.nodeId,
          nodeName: propA.nodeName,
          key: propA.key,
          valueA: cloneContinuityValue(propA.value),
          valueB: undefined,
          message: `"${propA.nodeName}"의 ${propA.key} 속성이 Shot "${snapB.shotName}"에서 누락됨`,
        });
        continue;
      }

      if (propA && propB && !continuityValuesEqual(propA.value, propB.value)) {
        const severity = this.getSeverity(propA.category);
        issues.push({
          severity,
          category: propA.category,
          shotA: shotIdA,
          shotB: shotIdB,
          nodeId: propA.nodeId,
          nodeName: propA.nodeName,
          key: propA.key,
          valueA: cloneContinuityValue(propA.value),
          valueB: cloneContinuityValue(propB.value),
          message: `"${propA.nodeName}"의 ${propA.key}가 Shot 간 불일치: "${String(propA.value)}" → "${String(propB.value)}"`,
        });
      }
    }

    return issues;
  }

  /**
   * 전체 Shot 시퀀스의 연속성을 순차적으로 검증합니다.
   */
  public checkSequence(shotIds: string[]): ContinuityIssue[] {
    const allIssues: ContinuityIssue[] = [];
    for (let i = 0; i < shotIds.length - 1; i++) {
      const issues = this.compareShots(shotIds[i], shotIds[i + 1]);
      allIssues.push(...issues);
    }
    return allIssues;
  }

  /**
   * 연속성 보고서를 생성합니다.
   */
  public generateReport(shotIds: string[]): {
    totalShots: number;
    totalIssues: number;
    errors: number;
    warnings: number;
    infos: number;
    byCategoryCount: Record<string, number>;
    issues: ContinuityIssue[];
  } {
    const issues = this.checkSequence(shotIds);
    const byCategoryCount: Record<string, number> = {};

    for (const issue of issues) {
      byCategoryCount[issue.category] = (byCategoryCount[issue.category] ?? 0) + 1;
    }

    return {
      totalShots: shotIds.length,
      totalIssues: issues.length,
      errors: issues.filter((i) => i.severity === "error").length,
      warnings: issues.filter((i) => i.severity === "warning").length,
      infos: issues.filter((i) => i.severity === "info").length,
      byCategoryCount,
      issues,
    };
  }

  public getSnapshot(shotId: string): ShotContinuitySnapshot | undefined {
    const snapshot = this.snapshots.get(shotId);
    return snapshot ? this.cloneSnapshot(snapshot) : undefined;
  }

  public removeSnapshot(shotId: string): boolean {
    return this.snapshots.delete(shotId);
  }

  private getSeverity(category: ContinuityCategory): ContinuitySeverity {
    switch (category) {
      case "held-item":
      case "wound-mark":
      case "costume":
        return "error";
      case "door-state":
      case "prop-state":
      case "position":
        return "warning";
      default:
        return "info";
    }
  }

  private cloneSnapshot(snapshot: ShotContinuitySnapshot): ShotContinuitySnapshot {
    return {
      shotId: snapshot.shotId,
      shotName: snapshot.shotName,
      properties: snapshot.properties.map((property) => ({
        ...property,
        value: cloneContinuityValue(property.value),
      })),
    };
  }
}
