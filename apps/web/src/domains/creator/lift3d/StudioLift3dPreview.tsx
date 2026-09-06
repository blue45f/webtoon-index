import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import type { StudioLift3dRenderBuffers } from "./studio-lift3d-render-buffers";

/**
 * 리프트 결과 3D 뷰포트.
 *
 * 내보낼 GLB 와 **같은 버퍼**를 그린다. 미리보기 전용 지오메트리를 따로 만들면 화면에서는
 * 멀쩡하고 파일에서만 뒤집힌 형상이 나오는 부류의 차이를 못 잡는다.
 *
 * 궤도 조작은 three-stdlib 의 OrbitControls 대신 포인터 이벤트로 직접 처리한다. 요·피치·거리
 * 세 값이면 충분한 화면에 컨트롤러 의존성과 그 번들을 얹을 이유가 없다.
 */
export interface StudioLift3dPreviewProps {
  readonly buffers: StudioLift3dRenderBuffers;
  /** 원본 이미지 blob URL. 없으면 무채색으로 형태만 보여준다. */
  readonly textureUrl: string | null;
  /** 내보내기 재질과 같은 조명 없는 표현. 끄면 명암으로 입체를 확인할 수 있다. */
  readonly unlit: boolean;
}

const MIN_DISTANCE_FACTOR = 0.6;
const MAX_DISTANCE_FACTOR = 6;

export function StudioLift3dPreview({ buffers, textureUrl, unlit }: StudioLift3dPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, canvas });
    } catch {
      setUnsupported(true);
      return;
    }
    setUnsupported(false);
    renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(buffers.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(buffers.normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(buffers.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));
    geometry.computeBoundingSphere();

    let dirty = true;
    let texture: THREE.Texture | null = null;
    if (textureUrl !== null) {
      // 텍스처는 비동기로 도착한다. 도착을 알리지 않으면 루프가 이미 한 프레임을 그리고
      // 멈춘 뒤라, 사용자가 드래그하기 전까지 모델이 무채색으로 남는다.
      texture = new THREE.TextureLoader().load(textureUrl, () => {
        dirty = true;
      });
      texture.colorSpace = THREE.SRGBColorSpace;
      // 이 파이프라인의 UV 는 glTF 규약(좌상단 원점)이라 three 의 기본 뒤집기를 꺼야 맞는다.
      texture.flipY = false;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
    }

    const material = unlit
      ? new THREE.MeshBasicMaterial({ color: 0xffffff, map: texture })
      : new THREE.MeshStandardMaterial({
        color: texture === null ? 0xc9c4bc : 0xffffff,
        map: texture,
        metalness: 0,
        roughness: 0.85,
      });

    const mesh = new THREE.Mesh(geometry, material);
    const pivot = new THREE.Group();
    pivot.add(mesh);

    const scene = new THREE.Scene();
    scene.add(pivot);
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 3, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.8);
    fill.position.set(-3, 1, -2);
    scene.add(fill);

    const sphere = geometry.boundingSphere ?? new THREE.Sphere(new THREE.Vector3(), 1);
    const radius = Math.max(0.001, sphere.radius);
    // 모델 중심을 원점으로 옮겨 회전이 화면 밖으로 튀지 않게 한다.
    mesh.position.set(-sphere.center.x, -sphere.center.y, -sphere.center.z);

    const camera = new THREE.PerspectiveCamera(38, 1, radius / 100, radius * 100);
    let distance = radius * 2.6;
    let yaw = 0;
    let pitch = 0.12;

    const applyCamera = () => {
      camera.position.set(
        Math.sin(yaw) * Math.cos(pitch) * distance,
        Math.sin(pitch) * distance,
        Math.cos(yaw) * Math.cos(pitch) * distance,
      );
      camera.lookAt(0, 0, 0);
    };

    let frame = 0;
    const render = () => {
      frame = globalThis.requestAnimationFrame(render);
      if (!dirty) return;
      dirty = false;
      applyCamera();
      renderer.render(scene, camera);
    };

    const resize = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      dirty = true;
    };

    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(resize)
      : null;
    observer?.observe(canvas);
    resize();
    frame = globalThis.requestAnimationFrame(render);

    let dragPointer: number | null = null;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (event: PointerEvent) => {
      if (dragPointer !== null) return;
      dragPointer = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (dragPointer !== event.pointerId) return;
      yaw -= (event.clientX - lastX) * 0.01;
      pitch = Math.max(-1.4, Math.min(1.4, pitch + (event.clientY - lastY) * 0.01));
      lastX = event.clientX;
      lastY = event.clientY;
      dirty = true;
    };
    const endDrag = (event: PointerEvent) => {
      if (dragPointer !== event.pointerId) return;
      dragPointer = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      distance = Math.max(
        radius * MIN_DISTANCE_FACTOR,
        Math.min(radius * MAX_DISTANCE_FACTOR, distance * (event.deltaY > 0 ? 1.12 : 0.9)),
      );
      dirty = true;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const step = event.shiftKey ? 0.3 : 0.12;
      if (event.key === "ArrowLeft") yaw -= step;
      else if (event.key === "ArrowRight") yaw += step;
      else if (event.key === "ArrowUp") pitch = Math.min(1.4, pitch + step);
      else if (event.key === "ArrowDown") pitch = Math.max(-1.4, pitch - step);
      else return;
      event.preventDefault();
      dirty = true;
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKeyDown);

    return () => {
      globalThis.cancelAnimationFrame(frame);
      observer?.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", endDrag);
      canvas.removeEventListener("pointercancel", endDrag);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
      geometry.dispose();
      material.dispose();
      texture?.dispose();
      renderer.dispose();
    };
  }, [buffers, textureUrl, unlit]);

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label="변환된 3D 모델 미리보기. 끌어서 회전, 휠로 확대, 방향키로도 회전할 수 있습니다."
        role="img"
        className="h-full w-full cursor-grab touch-none rounded-lg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:cursor-grabbing"
      />
      {unsupported ? (
        <p className="absolute inset-0 grid place-items-center px-4 text-center text-xs text-fg-3">
          이 브라우저에서는 3D 미리보기를 열 수 없습니다. GLB 파일 저장은 그대로 사용할 수 있습니다.
        </p>
      ) : null}
    </div>
  );
}
