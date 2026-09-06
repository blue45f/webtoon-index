import { Circle, Group, Line } from "react-konva/lib/ReactKonvaCore";

import {
  createStudioConcentricGuideRadii,
  createStudioParallelGuideSegments,
  createStudioRadialGuideSegments,
} from "./studio-advanced-ruler-guide-snap";
import { sampleStudioCurveParallelOffset } from "./studio-curve-ruler";
import {
  createStudioFisheyeGuideCurves,
  sampleStudioFisheyeGuideCurve,
} from "./studio-fisheye-ruler";

import type {
  StudioAdvancedRuler,
  StudioAdvancedRulerDocument,
} from "./studio-advanced-ruler-document";
import type { ReactElement } from "react";

/** Screen-space distance from the parallel origin to its rotation handle. */
const PARALLEL_ANGLE_HANDLE_DISTANCE = 96;

/** Wraps a drag vector into the canonical parallel-line angle range [0, 180). */
function parallelAngleFromDrag(dx: number, dy: number): number {
  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  return ((degrees % 180) + 180) % 180;
}

export interface StudioAdvancedRulerOverlayProps {
  document: StudioAdvancedRulerDocument;
  effScale: number;
  disabled?: boolean;
  onPreviewRuler: (id: string, patch: Partial<StudioAdvancedRuler>) => void;
  onCommitRuler: (id: string, patch: Partial<StudioAdvancedRuler>) => void;
  onCancelPreview: () => void;
}

function flatPoints(points: readonly { x: number; y: number }[]): number[] {
  return points.flatMap(({ x, y }) => [x, y]);
}

export function StudioAdvancedRulerOverlay({
  document,
  effScale,
  disabled = false,
  onPreviewRuler,
  onCommitRuler,
  onCancelPreview,
}: StudioAdvancedRulerOverlayProps): ReactElement {
  const scale = Math.max(0.001, effScale);
  return (
    <>
      {document.rulers.filter((ruler) => ruler.visible).map((ruler) => {
        const selected = ruler.id === document.selectedRulerId;
        const active = ruler.id === document.activeSnapRulerId;
        const stroke = active ? "#f97316" : selected ? "#38bdf8" : "#94a3b8";
        if (ruler.type === "curve") {
          const points = sampleStudioCurveParallelOffset(ruler, 0, 72);
          const controls = [ruler.p0, ruler.p1, ruler.p2, ruler.p3];
          return (
            <Group key={ruler.id}>
              <Line
                points={flatPoints(points)}
                stroke={stroke}
                strokeWidth={(active ? 2 : 1.25) / scale}
                dash={active ? undefined : [6 / scale, 4 / scale]}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
              {selected ? (
                <>
                  <Line
                    points={flatPoints(controls)}
                    stroke="#64748b"
                    strokeWidth={1 / scale}
                    dash={[4 / scale, 4 / scale]}
                    listening={false}
                  />
                  {controls.map((point, index) => {
                    const key = `p${index}` as "p0" | "p1" | "p2" | "p3";
                    return (
                      <Circle
                        key={key}
                        x={point.x}
                        y={point.y}
                        radius={6 / scale}
                        fill={index === 0 || index === 3 ? stroke : "#ffffff"}
                        stroke="#0f172a"
                        strokeWidth={1.5 / scale}
                        draggable={!disabled}
                        name={`advanced-ruler-${key}-handle`}
                        onDragMove={(event) => onPreviewRuler(ruler.id, {
                          [key]: { x: event.target.x(), y: event.target.y() },
                        } as Partial<StudioAdvancedRuler>)}
                        onDragEnd={(event) => onCommitRuler(ruler.id, {
                          [key]: { x: event.target.x(), y: event.target.y() },
                        } as Partial<StudioAdvancedRuler>)}
                        onPointerCancel={onCancelPreview}
                      />
                    );
                  })}
                </>
              ) : null}
            </Group>
          );
        }

        if (ruler.type === "parallel") {
          const [centerSegment, ...faintSegments] = createStudioParallelGuideSegments(ruler);
          const angleRadians = (ruler.angleDeg * Math.PI) / 180;
          const handleDistance = PARALLEL_ANGLE_HANDLE_DISTANCE / scale;
          const angleHandleX = ruler.originX + Math.cos(angleRadians) * handleDistance;
          const angleHandleY = ruler.originY + Math.sin(angleRadians) * handleDistance;
          return (
            <Group key={ruler.id}>
              {centerSegment ? (
                <Line
                  points={[centerSegment.x1, centerSegment.y1, centerSegment.x2, centerSegment.y2]}
                  stroke={stroke}
                  strokeWidth={(active ? 2 : 1.25) / scale}
                  dash={active ? undefined : [6 / scale, 4 / scale]}
                  lineCap="round"
                  listening={false}
                />
              ) : null}
              {faintSegments.map((segment, index) => (
                <Line
                  key={`parallel-${index}`}
                  points={[segment.x1, segment.y1, segment.x2, segment.y2]}
                  stroke={stroke}
                  strokeWidth={0.8 / scale}
                  opacity={0.55}
                  lineCap="round"
                  listening={false}
                />
              ))}
              {selected ? (
                <>
                  <Line
                    points={[ruler.originX, ruler.originY, angleHandleX, angleHandleY]}
                    stroke="#64748b"
                    strokeWidth={1 / scale}
                    dash={[4 / scale, 4 / scale]}
                    listening={false}
                  />
                  <Circle
                    x={ruler.originX}
                    y={ruler.originY}
                    radius={6 / scale}
                    fill={stroke}
                    stroke="#0f172a"
                    strokeWidth={1.5 / scale}
                    draggable={!disabled}
                    name="advanced-ruler-origin-handle"
                    onDragMove={(event) => onPreviewRuler(ruler.id, {
                      originX: event.target.x(),
                      originY: event.target.y(),
                    })}
                    onDragEnd={(event) => onCommitRuler(ruler.id, {
                      originX: event.target.x(),
                      originY: event.target.y(),
                    })}
                    onPointerCancel={onCancelPreview}
                  />
                  <Circle
                    x={angleHandleX}
                    y={angleHandleY}
                    radius={6 / scale}
                    fill="#ffffff"
                    stroke={stroke}
                    strokeWidth={2 / scale}
                    draggable={!disabled}
                    name="advanced-ruler-angle-handle"
                    onDragMove={(event) => onPreviewRuler(ruler.id, {
                      angleDeg: parallelAngleFromDrag(
                        event.target.x() - ruler.originX,
                        event.target.y() - ruler.originY
                      ),
                    })}
                    onDragEnd={(event) => onCommitRuler(ruler.id, {
                      angleDeg: parallelAngleFromDrag(
                        event.target.x() - ruler.originX,
                        event.target.y() - ruler.originY
                      ),
                    })}
                    onPointerCancel={onCancelPreview}
                  />
                </>
              ) : null}
            </Group>
          );
        }

        if (ruler.type === "concentric" || ruler.type === "radial") {
          const guideRadii = ruler.type === "concentric"
            ? createStudioConcentricGuideRadii(ruler)
            : [];
          const raySegments = ruler.type === "radial"
            ? createStudioRadialGuideSegments(ruler)
            : [];
          return (
            <Group key={ruler.id}>
              {guideRadii.map((radius, index) => (
                <Circle
                  key={`concentric-${index}`}
                  x={ruler.centerX}
                  y={ruler.centerY}
                  radius={radius}
                  stroke={stroke}
                  strokeWidth={(index === 0 && active ? 2 : 0.8) / scale}
                  opacity={index === 0 ? 1 : 0.55}
                  dash={active ? undefined : [6 / scale, 4 / scale]}
                  listening={false}
                />
              ))}
              {raySegments.map((segment, index) => (
                <Line
                  key={`radial-${index}`}
                  points={[segment.x1, segment.y1, segment.x2, segment.y2]}
                  stroke={stroke}
                  strokeWidth={(index === 0 && active ? 2 : 0.8) / scale}
                  opacity={index === 0 ? 1 : 0.55}
                  dash={active ? undefined : [6 / scale, 4 / scale]}
                  lineCap="round"
                  listening={false}
                />
              ))}
              {selected ? (
                <Circle
                  x={ruler.centerX}
                  y={ruler.centerY}
                  radius={6 / scale}
                  fill={stroke}
                  stroke="#0f172a"
                  strokeWidth={1.5 / scale}
                  draggable={!disabled}
                  name="advanced-ruler-center-handle"
                  onDragMove={(event) => onPreviewRuler(ruler.id, {
                    centerX: event.target.x(),
                    centerY: event.target.y(),
                  })}
                  onDragEnd={(event) => onCommitRuler(ruler.id, {
                    centerX: event.target.x(),
                    centerY: event.target.y(),
                  })}
                  onPointerCancel={onCancelPreview}
                />
              ) : null}
            </Group>
          );
        }

        const guides = createStudioFisheyeGuideCurves(ruler).filter((guide) => (
          ruler.guideFamily === "auto" || guide.family === ruler.guideFamily
        ));
        const rotation = ruler.rotationDeg * Math.PI / 180;
        const handleX = ruler.centerX + Math.cos(rotation) * ruler.radius;
        const handleY = ruler.centerY + Math.sin(rotation) * ruler.radius;
        return (
          <Group key={ruler.id}>
            <Circle
              x={ruler.centerX}
              y={ruler.centerY}
              radius={ruler.radius}
              stroke={stroke}
              strokeWidth={(active ? 2 : 1.25) / scale}
              dash={active ? undefined : [6 / scale, 4 / scale]}
              listening={false}
            />
            {guides.map((guide) => (
              <Line
                key={`${guide.family}:${guide.index}`}
                points={flatPoints(sampleStudioFisheyeGuideCurve(ruler, guide, 96))}
                stroke={stroke}
                strokeWidth={0.8 / scale}
                opacity={0.55}
                lineCap="round"
                listening={false}
              />
            ))}
            {selected ? (
              <>
                <Line
                  points={[ruler.centerX, ruler.centerY, handleX, handleY]}
                  stroke="#64748b"
                  strokeWidth={1 / scale}
                  dash={[4 / scale, 4 / scale]}
                  listening={false}
                />
                <Circle
                  x={ruler.centerX}
                  y={ruler.centerY}
                  radius={6 / scale}
                  fill={stroke}
                  stroke="#0f172a"
                  strokeWidth={1.5 / scale}
                  draggable={!disabled}
                  name="advanced-ruler-center-handle"
                  onDragMove={(event) => onPreviewRuler(ruler.id, {
                    centerX: event.target.x(),
                    centerY: event.target.y(),
                  })}
                  onDragEnd={(event) => onCommitRuler(ruler.id, {
                    centerX: event.target.x(),
                    centerY: event.target.y(),
                  })}
                  onPointerCancel={onCancelPreview}
                />
                <Circle
                  x={handleX}
                  y={handleY}
                  radius={6 / scale}
                  fill="#ffffff"
                  stroke={stroke}
                  strokeWidth={2 / scale}
                  draggable={!disabled}
                  name="advanced-ruler-radius-handle"
                  onDragMove={(event) => {
                    const dx = event.target.x() - ruler.centerX;
                    const dy = event.target.y() - ruler.centerY;
                    onPreviewRuler(ruler.id, {
                      radius: Math.max(8, Math.hypot(dx, dy)),
                      rotationDeg: (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360,
                    });
                  }}
                  onDragEnd={(event) => {
                    const dx = event.target.x() - ruler.centerX;
                    const dy = event.target.y() - ruler.centerY;
                    onCommitRuler(ruler.id, {
                      radius: Math.max(8, Math.hypot(dx, dy)),
                      rotationDeg: (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360,
                    });
                  }}
                  onPointerCancel={onCancelPreview}
                />
              </>
            ) : null}
          </Group>
        );
      })}
    </>
  );
}
