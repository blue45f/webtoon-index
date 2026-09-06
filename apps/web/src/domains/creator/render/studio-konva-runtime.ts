/**
 * Studio Konva runtime — minimal Core plus every shape used by the editor.
 *
 * `react-konva/lib/ReactKonvaCore` exports node names but deliberately does not register the
 * corresponding Konva constructors. Keep that side-effect ownership in one eager module so an
 * editor node can never silently fall back to Group because a shape import was forgotten.
 * Heavy pixel filters remain intent-loaded by StudioKonvaImageNode/StudioPage and must not be
 * imported here.
 */
import KonvaCore from "konva/lib/Core";
import "konva/lib/shapes/Arrow";
import "konva/lib/shapes/Circle";
import "konva/lib/shapes/Ellipse";
import "konva/lib/shapes/Image";
import "konva/lib/shapes/Line";
import "konva/lib/shapes/Path";
import "konva/lib/shapes/Rect";
import "konva/lib/shapes/Star";
import "konva/lib/shapes/Text";
import "konva/lib/shapes/TextPath";
import "konva/lib/shapes/Transformer";

import type Konva from "konva";

export const studioKonvaRuntime = KonvaCore as unknown as typeof Konva;
studioKonvaRuntime.Filters = studioKonvaRuntime.Filters ?? {};
