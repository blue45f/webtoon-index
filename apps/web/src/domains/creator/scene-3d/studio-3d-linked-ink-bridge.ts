/**
 * Studio 3D Linked Ink Bridge
 *
 * 3D 오브젝트의 edge/face/vertex와 2D 만화 선화(ink stroke) 사이의
 * provenance(출처) 연결을 관리하는 Live 2D↔3D Bridge 엔진입니다.
 *
 * 3D 카메라 회전이나 배경 변경 시에도 작가의 수동 2D 보정(authoredDelta)을
 * 파괴하지 않고 정확한 원근 투영(Perspective Projection)으로 추적 유지합니다.
 */

export type RegenerationPolicy = "follow-3d" | "screen-space" | "freeze";

export interface LinkedInkAnchor {
  sourceNodeId: string;
  sourcePrimitiveId?: string;
  faceId?: string;
  edgeId?: string;
  vertexId?: string;
  barycentric?: [number, number, number];
  objectLocalPoint?: [number, number, number];
  worldPoint?: [number, number, number];
  normal?: [number, number, number];
  cameraId?: string;
  sourceRevision?: string;
}

export interface StrokeDelta {
  offsetPixels: [number, number][];
  thicknessScale: number;
  smoothingLevel: number;
  pressureCurve?: number[];
}

export interface LinkedInkStroke {
  id: string;
  name?: string;
  anchors: LinkedInkAnchor[];
  authoredDelta: StrokeDelta;
  regenerationPolicy: RegenerationPolicy;
  confidence: number;
  colorHex?: string;
  baseThickness?: number;
  lastProjected2DPoints?: [number, number][];
}

export interface CameraPerspectiveView {
  position: [number, number, number];
  target: [number, number, number];
  fovDeg: number;
  viewportWidth: number;
  viewportHeight: number;
  near: number;
  far: number;
  projection: "perspective" | "orthographic";
}

export interface StrokeHealthReport {
  strokeId: string;
  confidence: number;
  status: "healthy" | "degraded" | "severed";
  issueCodes: Array<"backface-culled" | "out-of-frustum" | "stale-anchor" | "low-confidence">;
  suggestedAction: "keep" | "re-anchor" | "freeze";
}

export class Studio3DLinkedInkBridge {
  private strokes: Map<string, LinkedInkStroke> = new Map();
  private nextId = 1;

  /**
   * 새 Linked Ink 스트로크를 등록합니다.
   */
  public registerStroke(
    anchors: LinkedInkAnchor[],
    policy: RegenerationPolicy = "follow-3d",
    authoredDelta?: StrokeDelta,
    options: { name?: string; colorHex?: string; baseThickness?: number } = {},
  ): LinkedInkStroke {
    const id = `ink-${this.nextId++}`;
    const stroke: LinkedInkStroke = {
      id,
      name: options.name ?? `Linked Ink ${id}`,
      anchors,
      authoredDelta: authoredDelta ?? { offsetPixels: [], thicknessScale: 1, smoothingLevel: 0 },
      regenerationPolicy: policy,
      confidence: anchors.length > 0 ? 1.0 : 0,
      colorHex: options.colorHex ?? "#000000",
      baseThickness: options.baseThickness ?? 1.5,
    };
    this.strokes.set(id, stroke);
    return stroke;
  }

  /**
   * 3D 수정 발생 시 영향 받는 스트로크 목록을 반환합니다.
   */
  public findAffectedStrokes(modifiedNodeIds: string[]): LinkedInkStroke[] {
    const idSet = new Set(modifiedNodeIds);
    const affected: LinkedInkStroke[] = [];
    for (const stroke of this.strokes.values()) {
      if (stroke.regenerationPolicy === "freeze") continue;
      const isAffected = stroke.anchors.some((a) => idSet.has(a.sourceNodeId));
      if (isAffected) affected.push(stroke);
    }
    return affected;
  }

  /**
   * 스트로크의 재생성 정책을 변경합니다.
   */
  public setPolicy(strokeId: string, policy: RegenerationPolicy): boolean {
    const stroke = this.strokes.get(strokeId);
    if (!stroke) return false;
    stroke.regenerationPolicy = policy;
    return true;
  }

  /**
   * 3D 카메라 구도 아래에서 모든 Linked Ink의 2D 화면 좌표를 재투영(Re-project)합니다.
   */
  public reprojectAllStrokes(camera: CameraPerspectiveView): Map<string, [number, number][]> {
    const results = new Map<string, [number, number][]>();

    for (const stroke of this.strokes.values()) {
      if (stroke.regenerationPolicy === "freeze" && stroke.lastProjected2DPoints) {
        results.set(stroke.id, stroke.lastProjected2DPoints);
        continue;
      }

      const projectedPoints: [number, number][] = [];

      for (let i = 0; i < stroke.anchors.length; i += 1) {
        const anchor = stroke.anchors[i];
        const worldPt = anchor.worldPoint ?? [0, 0, 0];

        const screen2D = project3DPointToScreen(worldPt, camera);

        // 작가 수동 보정 Delta offset 합성
        const delta = stroke.authoredDelta.offsetPixels[i] ?? [0, 0];
        const finalX = screen2D[0] + delta[0];
        const finalY = screen2D[1] + delta[1];

        projectedPoints.push([Math.round(finalX * 10) / 10, Math.round(finalY * 10) / 10]);
      }

      stroke.lastProjected2DPoints = projectedPoints;
      results.set(stroke.id, projectedPoints);
    }

    return results;
  }

  /**
   * 3D topology 및 카메라 시점에 따른 스트로크 신뢰도 정밀 검사
   */
  public diagnoseStrokeHealth(
    strokeId: string,
    camera: CameraPerspectiveView,
    validNodeIds: Set<string>,
  ): StrokeHealthReport | null {
    const stroke = this.strokes.get(strokeId);
    if (!stroke) return null;

    const issues: Array<"backface-culled" | "out-of-frustum" | "stale-anchor" | "low-confidence"> = [];
    let validAnchors = 0;

    for (const anchor of stroke.anchors) {
      if (!validNodeIds.has(anchor.sourceNodeId)) {
        issues.push("stale-anchor");
        continue;
      }
      validAnchors += 1;

      // 카메라 뷰 프러스텀 바깥인지 검사
      const worldPt = anchor.worldPoint ?? [0, 0, 0];
      const screen = project3DPointToScreen(worldPt, camera);
      if (
        screen[0] < -100 || screen[0] > camera.viewportWidth + 100 ||
        screen[1] < -100 || screen[1] > camera.viewportHeight + 100
      ) {
        if (!issues.includes("out-of-frustum")) issues.push("out-of-frustum");
      }

      // 후면(Backface) 여부 검사
      if (anchor.normal) {
        const camDir = [
          camera.position[0] - worldPt[0],
          camera.position[1] - worldPt[1],
          camera.position[2] - worldPt[2],
        ];
        const dot = anchor.normal[0] * camDir[0] + anchor.normal[1] * camDir[1] + anchor.normal[2] * camDir[2];
        if (dot < 0 && !issues.includes("backface-culled")) {
          issues.push("backface-culled");
        }
      }
    }

    const confidence = stroke.anchors.length > 0
      ? Math.round((validAnchors / stroke.anchors.length) * 100) / 100
      : 0;

    stroke.confidence = confidence;

    let status: "healthy" | "degraded" | "severed" = "healthy";
    let suggestedAction: "keep" | "re-anchor" | "freeze" = "keep";

    if (confidence === 0 || issues.includes("stale-anchor")) {
      status = "severed";
      suggestedAction = "freeze";
    } else if (confidence < 0.6 || issues.length > 0) {
      status = "degraded";
      suggestedAction = "re-anchor";
    }

    return {
      strokeId,
      confidence,
      status,
      issueCodes: issues,
      suggestedAction,
    };
  }

  public freezeStroke(strokeId: string): boolean {
    return this.setPolicy(strokeId, "freeze");
  }

  public getStroke(id: string): LinkedInkStroke | undefined {
    return this.strokes.get(id);
  }

  public getAllStrokes(): LinkedInkStroke[] {
    return [...this.strokes.values()];
  }

  public removeStroke(id: string): boolean {
    return this.strokes.delete(id);
  }

  public getLowConfidenceStrokes(threshold = 0.5): LinkedInkStroke[] {
    return [...this.strokes.values()].filter(
      (s) => s.confidence < threshold && s.regenerationPolicy !== "freeze",
    );
  }

  /**
   * 2D 작화 레이어와 합성 가능한 SVG 마크업 생성
   */
  public generateSvgOverlay(viewportWidth: number, viewportHeight: number): string {
    let svg = `<svg viewBox="0 0 ${viewportWidth} ${viewportHeight}" xmlns="http://www.w3.org/2000/svg">\n`;

    for (const stroke of this.strokes.values()) {
      const pts = stroke.lastProjected2DPoints;
      if (!pts || pts.length < 2) continue;

      let d = `M ${pts[0][0]} ${pts[0][1]}`;
      for (let i = 1; i < pts.length; i += 1) {
        d += ` L ${pts[i][0]} ${pts[i][1]}`;
      }

      const thickness = (stroke.baseThickness ?? 1.5) * (stroke.authoredDelta.thicknessScale ?? 1);
      svg += `  <path id="${stroke.id}" d="${d}" fill="none" stroke="${stroke.colorHex ?? "#000000"}" stroke-width="${thickness}" stroke-linecap="round" stroke-linejoin="round"/>\n`;
    }

    svg += "</svg>";
    return svg;
  }
}

/**
 * 3D 월드 좌표 -> 2D 화면 픽셀 좌표 투영 수학 헬퍼
 */
function project3DPointToScreen(
  point: [number, number, number],
  camera: CameraPerspectiveView,
): [number, number] {
  const px = point[0] - camera.position[0];
  const py = point[1] - camera.position[1];
  const pz = point[2] - camera.position[2];

  // Camera look vector
  const fwdX = camera.target[0] - camera.position[0];
  const fwdY = camera.target[1] - camera.position[1];
  const fwdZ = camera.target[2] - camera.position[2];
  const fwdLen = Math.hypot(fwdX, fwdY, fwdZ) || 1;

  // Simple pinhole camera projection
  const fovRad = (camera.fovDeg * Math.PI) / 180;
  const f = (camera.viewportHeight / 2) / Math.tan(fovRad / 2);

  // Depth along camera forward
  const depth = (px * fwdX + py * fwdY + pz * fwdZ) / fwdLen;
  const safeDepth = Math.max(camera.near, depth);

  // Screen space centered
  const screenX = (px * f) / safeDepth + camera.viewportWidth / 2;
  const screenY = (-py * f) / safeDepth + camera.viewportHeight / 2;

  return [screenX, screenY];
}
