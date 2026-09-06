#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, content: str) -> None:
    path = ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def replace_once(relative: str, old: str, new: str) -> None:
    source = read(relative)
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one match, found {count}: {old[:120]!r}")
    write(relative, source.replace(old, new, 1))


def replace_section(relative: str, start: str, end: str, replacement: str) -> None:
    source = read(relative)
    start_index = source.index(start)
    end_index = source.index(end, start_index)
    write(relative, source[:start_index] + replacement.rstrip() + "\n\n" + source[end_index + 2 :])


# ── Configuration contracts: explicit semantic capability and open-surface budgets. ─────────────
contracts = "tools/blender/toonstudio_blender_kit/contracts.py"
replace_once(
    contracts,
    '''    max_degenerate_faces: int = 0
    max_non_manifold_edges: int = 0
    minimum_score: int = 86''',
    '''    max_degenerate_faces: int = 0
    # Boundary edges are common in intentionally open hair cards, mouth interiors, and robot panels.
    # They are audited separately from loose or >2-face non-manifold junctions.
    max_boundary_edges: int = 0
    max_non_manifold_edges: int = 0
    minimum_score: int = 86''',
)
replace_once(
    contracts,
    '''    maximum_displacement_ratio: float = 0.035
    minimum_detection_confidence: float = 0.72

    def validate(self) -> None:''',
    '''    maximum_displacement_ratio: float = 0.035
    minimum_detection_confidence: float = 0.72
    # Positive and negative shape keys are emitted in pairs. A source profile declares the
    # minimum number that can be created honestly from its actual topology.
    minimum_semantic_shape_keys: int = 2

    def validate(self) -> None:''',
)
replace_once(
    contracts,
    '''        if not 0 <= self.minimum_detection_confidence <= 1:
            raise ContractError(
                "face.minimum_detection_confidence must be between 0 and 1"
            )''',
    '''        if not 0 <= self.minimum_detection_confidence <= 1:
            raise ContractError(
                "face.minimum_detection_confidence must be between 0 and 1"
            )
        if (
            isinstance(self.minimum_semantic_shape_keys, bool)
            or not isinstance(self.minimum_semantic_shape_keys, int)
            or not 2 <= self.minimum_semantic_shape_keys <= 24
            or self.minimum_semantic_shape_keys % 2 != 0
        ):
            raise ContractError(
                "face.minimum_semantic_shape_keys must be an even integer between 2 and 24"
            )''',
)
replace_once(
    contracts,
    '''        minimum_detection_confidence=_float(
            face_source,
            "minimumDetectionConfidence",
            default_face.minimum_detection_confidence,
        ),
    )''',
    '''        minimum_detection_confidence=_float(
            face_source,
            "minimumDetectionConfidence",
            default_face.minimum_detection_confidence,
        ),
        minimum_semantic_shape_keys=_int(
            face_source,
            "minimumSemanticShapeKeys",
            default_face.minimum_semantic_shape_keys,
        ),
    )''',
)
replace_once(
    contracts,
    '''        max_non_manifold_edges=_int(
            quality_source,
            "maxNonManifoldEdges",
            default_quality.max_non_manifold_edges,
        ),''',
    '''        max_boundary_edges=_int(
            quality_source,
            "maxBoundaryEdges",
            default_quality.max_boundary_edges,
        ),
        max_non_manifold_edges=_int(
            quality_source,
            "maxNonManifoldEdges",
            default_quality.max_non_manifold_edges,
        ),''',
)

# ── Quality audit: official VRM mappings first, boundary/junction topology separated. ─────────────
quality = "tools/blender/toonstudio_blender_kit/quality.py"
replace_section(
    quality,
    "_REQUIRED_HUMANOID_GROUPS:",
    "\n\ndef _normalize",
    '''_REQUIRED_HUMANOID_GROUPS: tuple[
    tuple[str, tuple[str, ...], tuple[str, ...]], ...
] = (
    ("hips", ("hips",), ("hips",)),
    ("spine", ("spine",), ("spine",)),
    ("chest", ("chest", "upper_chest"), ("chest", "upperchest", "spine2")),
    ("neck", ("neck",), ("neck",)),
    ("head", ("head",), ("head",)),
    ("leftupperarm", ("left_upper_arm",), ("leftupperarm", "leftarm")),
    ("leftlowerarm", ("left_lower_arm",), ("leftlowerarm", "leftforearm")),
    ("lefthand", ("left_hand",), ("lefthand",)),
    ("rightupperarm", ("right_upper_arm",), ("rightupperarm", "rightarm")),
    ("rightlowerarm", ("right_lower_arm",), ("rightlowerarm", "rightforearm")),
    ("righthand", ("right_hand",), ("righthand",)),
    ("leftupperleg", ("left_upper_leg",), ("leftupperleg", "leftupleg", "leftthigh")),
    ("leftlowerleg", ("left_lower_leg",), ("leftlowerleg", "leftleg", "leftshin")),
    ("leftfoot", ("left_foot",), ("leftfoot",)),
    ("rightupperleg", ("right_upper_leg",), ("rightupperleg", "rightupleg", "rightthigh")),
    ("rightlowerleg", ("right_lower_leg",), ("rightlowerleg", "rightleg", "rightshin")),
    ("rightfoot", ("right_foot",), ("rightfoot",)),
)''',
)
replace_section(
    quality,
    "def _mesh_topology_metrics",
    "\n\ndef _vertex_influence_metrics",
    '''def _mesh_topology_metrics(obj: bpy.types.Object) -> tuple[int, int, int]:
    """Return boundary, invalid-junction, and degenerate counts separately.

    An edge with one linked face is an open-surface boundary. It can be intentional and is
    controlled by a source-specific budget. Loose edges and edges shared by more than two faces
    are actual non-manifold junction defects and remain a strict zero-by-default gate.
    """

    mesh = obj.data
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.normal_update()
        boundary = sum(1 for edge in bm.edges if len(edge.link_faces) == 1)
        invalid_junction = sum(
            1 for edge in bm.edges if len(edge.link_faces) == 0 or len(edge.link_faces) > 2
        )
        scale = max(1e-8, obj.dimensions.length)
        area_epsilon = scale * scale * 1e-12
        degenerate = sum(1 for face in bm.faces if face.calc_area() <= area_epsilon)
        return boundary, invalid_junction, degenerate
    finally:
        bm.free()''',
)
replace_section(
    quality,
    "def _armature_bone_coverage",
    "\n\ndef _issue",
    '''def _vrm1_humanoid_mapping(armature: bpy.types.Object | None) -> dict[str, str]:
    if armature is None or armature.type != "ARMATURE":
        return {}
    extension = getattr(armature.data, "vrm_addon_extension", None)
    if extension is None:
        return {}
    spec_version = str(getattr(extension, "spec_version", ""))
    is_vrm1 = spec_version == "1.0"
    checker = getattr(extension, "is_vrm1", None)
    if not is_vrm1 and callable(checker):
        try:
            is_vrm1 = bool(checker())
        except (RuntimeError, TypeError):
            is_vrm1 = False
    if not is_vrm1:
        return {}
    try:
        human_bones = extension.vrm1.humanoid.human_bones
    except AttributeError:
        return {}

    mapped: dict[str, str] = {}
    for semantic, properties, _aliases in _REQUIRED_HUMANOID_GROUPS:
        for property_name in properties:
            human_bone = getattr(human_bones, property_name, None)
            node = getattr(human_bone, "node", None)
            bone_name = str(getattr(node, "bone_name", "") or "")
            if bone_name and armature.data.bones.get(bone_name) is not None:
                mapped[semantic] = bone_name
                break
    return mapped


def _armature_bone_coverage(
    armature: bpy.types.Object | None,
) -> tuple[int, list[str], str]:
    if armature is None or armature.type != "ARMATURE":
        return 0, [group[0] for group in _REQUIRED_HUMANOID_GROUPS], "unavailable"
    mapped = _vrm1_humanoid_mapping(armature)
    names = {_normalize(bone.name) for bone in armature.data.bones}
    missing: list[str] = []
    covered = 0
    for semantic, _properties, aliases in _REQUIRED_HUMANOID_GROUPS:
        name_fallback = any(
            any(alias in name or name.endswith(alias) for name in names)
            for alias in aliases
        )
        if semantic in mapped or name_fallback:
            covered += 1
        else:
            missing.append(semantic)
    source = "vrm1-addon+name-fallback" if mapped else "name-fallback"
    return covered, missing, source''',
)
replace_once(
    quality,
    '''    non_manifold_total = 0
    degenerate_total = 0
    unapplied_objects: list[str] = []''',
    '''    boundary_total = 0
    non_manifold_total = 0
    degenerate_total = 0
    boundary_objects: list[str] = []
    unapplied_objects: list[str] = []''',
)
replace_once(
    quality,
    '''        non_manifold, degenerate = _mesh_topology_metrics(obj)
        non_manifold_total += non_manifold
        degenerate_total += degenerate''',
    '''        boundary, non_manifold, degenerate = _mesh_topology_metrics(obj)
        boundary_total += boundary
        non_manifold_total += non_manifold
        degenerate_total += degenerate
        if boundary:
            boundary_objects.append(f"{obj.name}:{boundary}")''',
)
replace_once(
    quality,
    '''    covered_bones, missing_bones = _armature_bone_coverage(armature)''',
    '''    covered_bones, missing_bones, humanoid_mapping_source = _armature_bone_coverage(armature)''',
)
replace_section(
    quality,
    "    if non_manifold_total > budget.max_non_manifold_edges:",
    "\n    if degenerate_total > budget.max_degenerate_faces:",
    '''    if boundary_total > budget.max_boundary_edges:
        issues.append(_issue(
            "topology.boundary.exceeded", "error",
            "Open-surface boundary edges exceed the authored source profile.",
            metric=boundary_total, limit=budget.max_boundary_edges,
            repair_hint=(
                "Close accidental holes, or explicitly budget reviewed hair cards, mouth interiors, "
                "and hard-surface panel seams in the character profile."
            ),
        ))
    elif boundary_total:
        issues.append(_issue(
            "topology.boundary.profiled", "info",
            "Reviewed open-surface boundaries are within the authored source profile.",
            metric=boundary_total, limit=budget.max_boundary_edges,
        ))
    if non_manifold_total > budget.max_non_manifold_edges:
        issues.append(_issue(
            "topology.non_manifold", "error",
            "The package contains loose edges or edges shared by more than two faces.",
            metric=non_manifold_total, limit=budget.max_non_manifold_edges,
            repair_hint="Remove loose edges and split or retopologize multi-face junctions before release.",
        ))''',
)
replace_once(
    quality,
    '''        elif face.confidence < config.face.minimum_detection_confidence:
            issues.append(_issue(''',
    '''        elif len(face.created_shape_keys) < config.face.minimum_semantic_shape_keys:
            issues.append(_issue(
                "face.semantic_shapes.below_minimum", "error",
                "The source did not produce the minimum reviewed semantic face-shape capability.",
                metric=len(face.created_shape_keys),
                limit=config.face.minimum_semantic_shape_keys,
                repair_hint=(
                    "Provide explicit face topology metadata or lower the source profile only after "
                    "reviewing which positive/negative controls are genuinely supported."
                ),
            ))
        elif face.confidence < config.face.minimum_detection_confidence:
            issues.append(_issue(''',
)
replace_once(
    quality,
    '''        "nonManifoldEdges": non_manifold_total,
        "degenerateFaces": degenerate_total,''',
    '''        "boundaryEdges": boundary_total,
        "boundaryEdgesByObject": sorted(boundary_objects),
        "nonManifoldEdges": non_manifold_total,
        "degenerateFaces": degenerate_total,''',
)
replace_once(
    quality,
    '''        "missingHumanoidBoneGroups": missing_bones,
        "shapeKeyCount": shape_key_count,''',
    '''        "missingHumanoidBoneGroups": missing_bones,
        "humanoidMappingSource": humanoid_mapping_source,
        "shapeKeyCount": shape_key_count,''',
)
replace_once(
    quality,
    '''        "semanticFaceShapeCount": len(face.created_shape_keys) if face else 0,
        "faceDetectionConfidence": round(face.confidence, 4) if face else 0.0,''',
    '''        "semanticFaceShapeCount": len(face.created_shape_keys) if face else 0,
        "semanticFaceShapeMinimum": config.face.minimum_semantic_shape_keys,
        "faceDetectionConfidence": round(face.confidence, 4) if face else 0.0,''',
)

# ── Face authoring: do not export zero-delta placeholders or overwrite authored keys. ─────────────
face_path = "tools/blender/toonstudio_blender_kit/face.py"
old_face_loop = '''    for obj in detection.objects:
        for spec in specs:
            for name, label, direction in (
                (spec.positive_name, spec.positive_label, 1.0),
                (spec.negative_name, spec.negative_label, -1.0),
            ):
                if options.preserve_expression_shape_keys and is_expression_shape_key(name):
                    skipped.append(name)
                    continue
                key = _shape_key(obj, name)
                key.name = name
                obj[f"toonstudio_shape_{_normalize(name)}_label"] = label
                changed = _write_shape(obj, key, frame, spec, direction)
                if changed >= 8:
                    created.append(f"{obj.name}:{name}")
                else:
                    key.value = 0.0
                    skipped.append(f"{obj.name}:{name}")
        obj["toonstudio_face_shape_profile"] = "semantic-v1"
        obj["toonstudio_face_detection_confidence"] = detection.confidence
'''
new_face_loop = '''    for obj in detection.objects:
        for spec in specs:
            for name, label, direction in (
                (spec.positive_name, spec.positive_label, 1.0),
                (spec.negative_name, spec.negative_label, -1.0),
            ):
                if options.preserve_expression_shape_keys and is_expression_shape_key(name):
                    skipped.append(name)
                    continue
                marker = f"toonstudio_shape_{_normalize(name)}"
                existing = (
                    obj.data.shape_keys.key_blocks.get(name)
                    if obj.data.shape_keys is not None
                    else None
                )
                if existing is not None and not bool(obj.get(f"{marker}_generated", False)):
                    skipped.append(f"{obj.name}:{name}:authored-name-collision")
                    continue
                key = _shape_key(obj, name)
                key.name = name
                obj[f"{marker}_label"] = label
                changed = _write_shape(obj, key, frame, spec, direction)
                if changed >= 8:
                    created.append(f"{obj.name}:{name}")
                else:
                    key.value = 0.0
                    obj.shape_key_remove(key)
                    for suffix in ("label", "semantic_id", "direction", "generated"):
                        property_name = f"{marker}_{suffix}"
                        if property_name in obj:
                            del obj[property_name]
                    skipped.append(f"{obj.name}:{name}:insufficient-vertices")
        obj["toonstudio_face_shape_profile"] = "semantic-v1"
        obj["toonstudio_face_detection_confidence"] = detection.confidence
'''
replace_once(face_path, old_face_loop, new_face_loop)

# ── VRM custom expressions: one expression can safely bind the same semantic control on many meshes. ─
vrm_path = "tools/blender/toonstudio_blender_kit/vrm.py"
old_vrm = '''    existing = {
        str(custom.custom_name): custom
        for custom in expressions.custom
        if str(custom.custom_name)
    }
    created: list[str] = []
    for receipt in face.created_shape_keys:
        object_name, separator, shape_key_name = receipt.partition(":")
        if not separator or not object_name or not shape_key_name:
            continue
        obj = bpy.data.objects.get(object_name)
        shape_keys = getattr(getattr(obj, "data", None), "shape_keys", None) if obj else None
        if shape_keys is None or shape_keys.key_blocks.get(shape_key_name) is None:
            continue
        custom_name = _custom_expression_name(shape_key_name)
        expression = existing.get(custom_name)
        if expression is None:
            expression = expressions.custom.add()
            expression.custom_name = custom_name
            existing[custom_name] = expression
        else:
            expression.morph_target_binds.clear()
            expression.material_color_binds.clear()
            expression.texture_transform_binds.clear()
        expression.is_binary = False
        expression.override_blink = "none"
        expression.override_look_at = "none"
        expression.override_mouth = "none"
        expression["toonstudio_generated"] = True
        bind = expression.morph_target_binds.add()
        bind.node.mesh_object_name = object_name
        bind.index = shape_key_name
        bind.weight = 1.0
        created.append(custom_name)
'''
new_vrm = '''    existing = {
        str(custom.custom_name): custom
        for custom in expressions.custom
        if str(custom.custom_name)
    }
    bindings: dict[str, set[tuple[str, str]]] = {}
    for receipt in face.created_shape_keys:
        object_name, separator, shape_key_name = receipt.partition(":")
        if not separator or not object_name or not shape_key_name:
            continue
        obj = bpy.data.objects.get(object_name)
        shape_keys = getattr(getattr(obj, "data", None), "shape_keys", None) if obj else None
        if shape_keys is None or shape_keys.key_blocks.get(shape_key_name) is None:
            continue
        custom_name = _custom_expression_name(shape_key_name)
        bindings.setdefault(custom_name, set()).add((object_name, shape_key_name))

    created: list[str] = []
    for custom_name, targets in sorted(bindings.items()):
        expression = existing.get(custom_name)
        if expression is None:
            expression = expressions.custom.add()
            expression.custom_name = custom_name
            existing[custom_name] = expression
        expression.morph_target_binds.clear()
        expression.material_color_binds.clear()
        expression.texture_transform_binds.clear()
        expression.is_binary = False
        expression.override_blink = "none"
        expression.override_look_at = "none"
        expression.override_mouth = "none"
        expression["toonstudio_generated"] = True
        for object_name, shape_key_name in sorted(targets):
            bind = expression.morph_target_binds.add()
            bind.node.mesh_object_name = object_name
            bind.index = shape_key_name
            bind.weight = 1.0
        created.append(custom_name)
'''
replace_once(vrm_path, old_vrm, new_vrm)

# ── Manifest/runtime contract: publish the reviewed source-specific minimum. ─────────────────────
pipeline_path = "tools/blender/toonstudio_blender_kit/pipeline.py"
replace_once(
    pipeline_path,
    '''                "objects": list(face.object_names) if face else [],
                "shapeKeys": list(face.created_shape_keys) if face else [],''',
    '''                "objects": list(face.object_names) if face else [],
                "shapeKeys": list(face.created_shape_keys) if face else [],
                "minimumRequired": config.face.minimum_semantic_shape_keys,''',
)

ts_path = "apps/web/src/domains/creator/vrm/studio-vrm-blender-character-package.ts"
replace_once(
    ts_path,
    '''      objects: readonly string[];
      shapeKeys: readonly string[];
    }>;''',
    '''      objects: readonly string[];
      shapeKeys: readonly string[];
      minimumRequired: number;
    }>;''',
)
replace_once(
    ts_path,
    '''        objects: stringArray(faceSource.objects, "package.capabilities.semanticFaceShapes.objects"),
        shapeKeys: stringArray(faceSource.shapeKeys, "package.capabilities.semanticFaceShapes.shapeKeys"),''',
    '''        objects: stringArray(faceSource.objects, "package.capabilities.semanticFaceShapes.objects"),
        shapeKeys: stringArray(faceSource.shapeKeys, "package.capabilities.semanticFaceShapes.shapeKeys"),
        minimumRequired: (() => {
          const value = finiteNumber(
            faceSource.minimumRequired ?? 0,
            "package.capabilities.semanticFaceShapes.minimumRequired",
          );
          if (!Number.isSafeInteger(value) || value > 24 || value % 2 !== 0) {
            throw new Error(
              "package.capabilities.semanticFaceShapes.minimumRequired must be an even safe integer <= 24",
            );
          }
          return value;
        })(),''',
)

ts_test = "apps/web/src/domains/creator/vrm/studio-vrm-blender-character-package.test.ts"
replace_once(
    ts_test,
    '''      objects: ["Face"],
      shapeKeys: ["Face:faceEyeSizeBig"],''',
    '''      objects: ["Face"],
      shapeKeys: ["Face:faceEyeSizeBig", "Face:faceEyeSizeSmall"],
      minimumRequired: 2,''',
)
replace_once(
    ts_test,
    '''    expect(parsed.capabilities.vrmCustomExpressions.names).toContain("tsFaceEyeSizeBig");''',
    '''    expect(parsed.capabilities.vrmCustomExpressions.names).toContain("tsFaceEyeSizeBig");
    expect(parsed.capabilities.semanticFaceShapes.minimumRequired).toBe(2);''',
)
replace_once(
    ts_test,
    '''    expect(() => parseStudioVrmBlenderCharacterPackage({ ...PACKAGE, configDigest: "broken" })).toThrow(/configDigest/u);''',
    '''    expect(() => parseStudioVrmBlenderCharacterPackage({ ...PACKAGE, configDigest: "broken" })).toThrow(/configDigest/u);
    expect(() => parseStudioVrmBlenderCharacterPackage({
      ...PACKAGE,
      capabilities: {
        ...PACKAGE.capabilities,
        semanticFaceShapes: {
          ...PACKAGE.capabilities.semanticFaceShapes,
          minimumRequired: 3,
        },
      },
    })).toThrow(/even safe integer/u);''',
)

# ── JSON schema/configs: explicit reviewed capabilities, no hidden test relaxation. ───────────────
schema_path = ROOT / "config/blender/toonstudio-character-pipeline.schema.json"
schema = json.loads(schema_path.read_text(encoding="utf-8"))
schema["properties"]["face"]["properties"]["minimumSemanticShapeKeys"] = {
    "type": "integer",
    "minimum": 2,
    "maximum": 24,
    "multipleOf": 2,
}
schema["properties"]["quality"]["properties"]["maxBoundaryEdges"] = {
    "type": "integer",
    "minimum": 0,
}
schema_path.write_text(json.dumps(schema, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

for relative, face_minimum in (
    ("config/blender/reference-character.json", 14),
    ("config/blender/avatar-orion-production.json", 4),
):
    path = ROOT / relative
    data = json.loads(path.read_text(encoding="utf-8"))
    data["face"]["minimumSemanticShapeKeys"] = face_minimum
    data["quality"].setdefault("maxBoundaryEdges", 0)
    if "avatar-orion" in relative:
        data["quality"]["maxBoundaryEdges"] = 12000
        data["quality"]["maxNonManifoldEdges"] = 0
        data["provenance"]["topologyProfile"] = "reviewed-open-robot-panels-v1"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# ── Workflow: validate the manifest's reviewed minimum instead of inventing a universal count. ──
workflow = ".github/workflows/blender-character-pipeline.yml"
replace_once(
    workflow,
    '''            const semanticFace = manifest.capabilities.semanticFaceShapes;
            const minimumSemanticShapes = id === "reference-character" ? 14 : 16;
            if (semanticFace.mode !== "semantic-shape-keys" || semanticFace.shapeKeys.length < minimumSemanticShapes) {
              throw new Error(`semantic face profile is incomplete for ${id}: expected at least ${minimumSemanticShapes}, found ${semanticFace.shapeKeys.length}`);
            }
            if (id === "avatar-orion-authored") {
              const custom = manifest.capabilities.vrmCustomExpressions;
              if (custom.status !== "ready" || custom.names.length < 16) {
                throw new Error(`VRM custom semantic expressions are incomplete: ${JSON.stringify(custom)}`);
              }
            }''',
    '''            const semanticFace = manifest.capabilities.semanticFaceShapes;
            const minimumSemanticShapes = Number(semanticFace.minimumRequired);
            if (!Number.isSafeInteger(minimumSemanticShapes) || minimumSemanticShapes < 2 || minimumSemanticShapes > 24 || minimumSemanticShapes % 2 !== 0) {
              throw new Error(`semantic face minimum is invalid for ${id}: ${semanticFace.minimumRequired}`);
            }
            if (semanticFace.mode !== "semantic-shape-keys" || semanticFace.shapeKeys.length < minimumSemanticShapes) {
              throw new Error(`semantic face profile is incomplete for ${id}: expected at least ${minimumSemanticShapes}, found ${semanticFace.shapeKeys.length}`);
            }
            if (id === "avatar-orion-authored") {
              const custom = manifest.capabilities.vrmCustomExpressions;
              if (custom.status !== "ready" || custom.names.length < minimumSemanticShapes) {
                throw new Error(`VRM custom semantic expressions are incomplete: ${JSON.stringify(custom)}`);
              }
            }''',
)

# ── Tests and static verifier. ───────────────────────────────────────────────────────────────────
contract_test = "tests/blender/test_contracts.py"
replace_once(
    contract_test,
    '''        self.assertTrue(config.export.vrm)
        self.assertEqual(config.input_path, "apps/web/public/vrm/Avatar_Orion.vrm")''',
    '''        self.assertTrue(config.export.vrm)
        self.assertEqual(config.input_path, "apps/web/public/vrm/Avatar_Orion.vrm")
        self.assertEqual(config.face.minimum_semantic_shape_keys, 4)
        self.assertEqual(config.quality.max_boundary_edges, 12000)
        self.assertEqual(config.quality.max_non_manifold_edges, 0)''',
)
replace_once(
    contract_test,
    '''        with self.assertRaisesRegex(ContractError, "between 0.005 and 0.08"):
            parse_config(raw)''',
    '''        with self.assertRaisesRegex(ContractError, "between 0.005 and 0.08"):
            parse_config(raw)
        raw["face"]["maximumDisplacementRatio"] = 0.032
        raw["face"]["minimumSemanticShapeKeys"] = 3
        with self.assertRaisesRegex(ContractError, "even integer"):
            parse_config(raw)''',
)

regression_test = "tests/blender/test_pipeline_regressions.py"
replace_once(
    regression_test,
    '''        self.assertNotIn("replace(report", source)


if __name__ == "__main__":''',
    '''        self.assertNotIn("replace(report", source)

    def test_topology_and_humanoid_audits_use_semantic_boundaries(self) -> None:
        quality = (KIT / "quality.py").read_text(encoding="utf-8")
        contracts = (KIT / "contracts.py").read_text(encoding="utf-8")
        self.assertIn("len(edge.link_faces) == 1", quality)
        self.assertIn("len(edge.link_faces) == 0 or len(edge.link_faces) > 2", quality)
        self.assertIn("max_boundary_edges", contracts)
        self.assertIn("vrm_addon_extension", quality)
        self.assertIn('(\"chest\", \"upper_chest\")', quality)
        self.assertIn('"spine2"', quality)

    def test_empty_semantic_keys_are_removed_and_minimum_is_published(self) -> None:
        face = (KIT / "face.py").read_text(encoding="utf-8")
        pipeline = (KIT / "pipeline.py").read_text(encoding="utf-8")
        vrm = (KIT / "vrm.py").read_text(encoding="utf-8")
        self.assertIn("obj.shape_key_remove(key)", face)
        self.assertIn('"minimumRequired": config.face.minimum_semantic_shape_keys', pipeline)
        self.assertIn("bindings.setdefault(custom_name, set())", vrm)


if __name__ == "__main__":''',
)

verifier = "scripts/verify-blender-character-pipeline.mjs"
replace_once(
    verifier,
    '''if (orion.provenance.sourceGitBlob !== "b244cf74aa845e75b33a4e48a962ebd880ec2210") {
  throw new Error("Orion repaired source Git object changed");
}
console.log''',
    '''if (orion.provenance.sourceGitBlob !== "b244cf74aa845e75b33a4e48a962ebd880ec2210") {
  throw new Error("Orion repaired source Git object changed");
}
if (orion.face.minimumSemanticShapeKeys !== 4 || orion.quality.maxBoundaryEdges !== 12000 || orion.quality.maxNonManifoldEdges !== 0) {
  throw new Error("Orion capability-aware topology/face profile changed");
}
for (const marker of ["max_boundary_edges", "_vrm1_humanoid_mapping", "obj.shape_key_remove(key)", "minimumRequired"]) {
  if (!combined.includes(marker)) throw new Error(`quality audit marker missing: ${marker}`);
}
console.log''',
)

# Final sanity checks before CI spends time installing Blender.
combined = "\n".join(
    read(path)
    for path in (
        contracts,
        quality,
        face_path,
        vrm_path,
        pipeline_path,
        ts_path,
        workflow,
    )
)
required_markers = (
    "max_boundary_edges",
    "_vrm1_humanoid_mapping",
    "obj.shape_key_remove(key)",
    '"minimumRequired": config.face.minimum_semantic_shape_keys',
    "bindings.setdefault(custom_name, set())",
)
for marker in required_markers:
    if marker not in combined:
        raise RuntimeError(f"missing required marker: {marker}")
for stale in (
    'const minimumSemanticShapes = id === "reference-character" ? 14 : 16;',
    'custom.names.length < 16',
):
    if stale in combined:
        raise RuntimeError(f"stale universal capability gate remains: {stale}")

print("Applied capability-aware Orion topology, humanoid, and semantic-face audit fixes")
