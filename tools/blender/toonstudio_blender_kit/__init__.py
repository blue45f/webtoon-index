"""ToonStudio Character Pipeline Blender extension.

Pure contract modules remain importable under ordinary CPython so CI can verify
configuration without bundling Blender. Blender UI registration is activated
only when ``bpy`` is available.
"""
from __future__ import annotations

try:
    import bpy
except ModuleNotFoundError:  # Ordinary CPython contract tests.
    bpy = None  # type: ignore[assignment]


if bpy is None:
    def register() -> None:
        raise RuntimeError("ToonStudio Blender extension registration requires Blender")

    def unregister() -> None:
        return None

    __all__ = ["register", "unregister"]
else:
    from pathlib import Path

    from bpy.props import StringProperty
    from bpy.types import Operator, Panel

    from .mcp import dispatch

    bl_info = {
        "name": "ToonStudio Character Pipeline",
        "author": "ToonSpectrum",
        "version": (1, 0, 0),
        "blender": (5, 2, 0),
        "location": "View3D > Sidebar > ToonStudio",
        "description": "Validated authored hair, semantic face shapes, QA renders, and VRM/GLB packages",
        "category": "Import-Export",
    }

    def _find_project_root(path: Path) -> Path:
        current = path.resolve()
        if current.is_file():
            current = current.parent
        for candidate in (current, *current.parents):
            if (candidate / "package.json").is_file() and (candidate / "scripts").is_dir():
                return candidate
        return Path.cwd().resolve()

    def _run_operator(operator: Operator, command: str) -> set[str]:
        scene = bpy.context.scene
        config_path = Path(bpy.path.abspath(scene.toonstudio_character_pipeline_config))
        root = _find_project_root(config_path)
        result = dispatch(command, {"configPath": str(config_path), "projectRoot": str(root)})
        scene.toonstudio_character_pipeline_last_result = str(result)
        if result.get("ok"):
            operator.report({"INFO"}, f"ToonStudio {command} completed")
            return {"FINISHED"}
        operator.report({"ERROR"}, str(result.get("error", "unknown pipeline error")))
        return {"CANCELLED"}

    class ToonstudioOtRunCharacterPipeline(Operator):
        bl_idname = "toonstudio.run_character_pipeline"
        bl_label = "Run Character Pipeline"
        bl_options = {"REGISTER", "UNDO"}

        def execute(self, _context):
            return _run_operator(self, "run_pipeline")

    class ToonstudioOtInspectCharacter(Operator):
        bl_idname = "toonstudio.inspect_character"
        bl_label = "Inspect Current Character"
        bl_options = {"REGISTER"}

        def execute(self, _context):
            return _run_operator(self, "inspect_character")

    class ToonstudioOtBuildAuthoredHair(Operator):
        bl_idname = "toonstudio.build_authored_hair"
        bl_label = "Build Authored Toon Hair"
        bl_options = {"REGISTER", "UNDO"}

        def execute(self, _context):
            return _run_operator(self, "build_authored_hair")

    class ToonstudioOtCreateSemanticFaceShapes(Operator):
        bl_idname = "toonstudio.create_semantic_face_shapes"
        bl_label = "Create Semantic Face Shapes"
        bl_options = {"REGISTER", "UNDO"}

        def execute(self, _context):
            return _run_operator(self, "create_semantic_face_shapes")

    class ToonstudioOtValidateCharacter(Operator):
        bl_idname = "toonstudio.validate_character"
        bl_label = "Validate Character"
        bl_options = {"REGISTER"}

        def execute(self, _context):
            return _run_operator(self, "validate_character")

    class ToonstudioPtCharacterPipeline(Panel):
        bl_label = "Character Pipeline"
        bl_idname = "TOONSTUDIO_PT_character_pipeline"
        bl_space_type = "VIEW_3D"
        bl_region_type = "UI"
        bl_category = "ToonStudio"

        def draw(self, context):
            layout = self.layout
            scene = context.scene
            layout.prop(scene, "toonstudio_character_pipeline_config", text="Config")
            row = layout.row(align=True)
            row.operator("toonstudio.inspect_character", icon="VIEWZOOM")
            row.operator("toonstudio.validate_character", icon="CHECKMARK")
            layout.operator("toonstudio.build_authored_hair", icon="CURVES_DATA")
            layout.operator("toonstudio.create_semantic_face_shapes", icon="SHAPEKEY_DATA")
            layout.separator()
            layout.operator("toonstudio.run_character_pipeline", icon="EXPORT")
            if scene.toonstudio_character_pipeline_last_result:
                box = layout.box()
                box.label(text="Last result stored on scene", icon="INFO")

    _CLASSES = (
        ToonstudioOtRunCharacterPipeline,
        ToonstudioOtInspectCharacter,
        ToonstudioOtBuildAuthoredHair,
        ToonstudioOtCreateSemanticFaceShapes,
        ToonstudioOtValidateCharacter,
        ToonstudioPtCharacterPipeline,
    )

    def register() -> None:
        for cls in _CLASSES:
            bpy.utils.register_class(cls)
        bpy.types.Scene.toonstudio_character_pipeline_config = StringProperty(
            name="ToonStudio character config",
            description="Path to a versioned ToonStudio Blender pipeline JSON config",
            subtype="FILE_PATH",
            default="//config/blender/reference-character.json",
        )
        bpy.types.Scene.toonstudio_character_pipeline_last_result = StringProperty(
            name="Last ToonStudio pipeline result",
            default="",
            options={"HIDDEN"},
        )

    def unregister() -> None:
        if hasattr(bpy.types.Scene, "toonstudio_character_pipeline_last_result"):
            del bpy.types.Scene.toonstudio_character_pipeline_last_result
        if hasattr(bpy.types.Scene, "toonstudio_character_pipeline_config"):
            del bpy.types.Scene.toonstudio_character_pipeline_config
        for cls in reversed(_CLASSES):
            bpy.utils.unregister_class(cls)

    __all__ = ["dispatch", "register", "unregister"]
