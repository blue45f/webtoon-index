import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import styles from "./IntroSplash.module.css";

const SESSION_KEY = "toonspectrum-intro-shown";

export interface IntroSplashProps {
  /**
   * 세션당 1회만 노출(sessionStorage). 기본 true(현행 웹 동작).
   * false 면 마운트마다 노출한다.
   */
  once?: boolean;
}

export function IntroSplash({ once = true }: IntroSplashProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isInitialized = useRef(false);
  // once=true: 세션 기준 최초 사이트 진입 시에만 인트로 노출. once=false: 매 마운트 노출.
  const isFirstVisit =
    !once || (typeof window !== "undefined" && !sessionStorage.getItem(SESSION_KEY));
  const [isVisible, setIsVisible] = useState(isFirstVisit);
  const [isFading, setIsFading] = useState(false);

  useEffect(() => {
    if (!isFirstVisit) return;

    // once 일 때만 방문 기록 세션에 플래그 저장(이후 마운트에서 스킵).
    if (once && typeof window !== "undefined") {
      sessionStorage.setItem(SESSION_KEY, "true");
    }

    const fadeTimer = setTimeout(() => {
      setIsFading(true);
    }, 2000);

    const removeTimer = setTimeout(() => {
      setIsVisible(false);
    }, 2800);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [isFirstVisit, once]);

  useEffect(() => {
    if (!isVisible) return;
    if (isInitialized.current) return;
    if (!canvasRef.current) return;

    isInitialized.current = true;

    const width = window.innerWidth;
    const height = window.innerHeight;

    // 1. Scene & Camera
    const scene = new THREE.Scene();
    // Deep black/indigo theme with fog for depth
    scene.fog = new THREE.FogExp2(0x060309, 0.05);

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.set(0, 0, 15);

    // 2. WebGL Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: true,
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // 3. Create Spectrum Wave
    const group = new THREE.Group();
    scene.add(group);

    // Wave parameters
    const colors = [
      0xff3b30, // Red
      0xff9500, // Orange
      0xffcc00, // Yellow
      0x4cd964, // Green
      0x5ac8fa, // Light Blue
      0x5856d6, // Indigo
      0xff2d55, // Pink/Magenta
    ];

    const waves: {
      points: THREE.Points;
      geometry: THREE.BufferGeometry;
      positions: Float32Array;
      phase: number;
      speed: number;
      amplitude: number;
      yOffset: number;
    }[] = [];

    const particleCount = 70;
    const segmentWidth = 0.35;

    // Custom glow texture using Canvas
    const createParticleTexture = () => {
      const size = 64;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const grad = ctx.createRadialGradient(
          size / 2,
          size / 2,
          0,
          size / 2,
          size / 2,
          size / 2,
        );
        grad.addColorStop(0, "rgba(255, 255, 255, 1)");
        grad.addColorStop(0.2, "rgba(255, 255, 255, 0.8)");
        grad.addColorStop(0.5, "rgba(255, 255, 255, 0.2)");
        grad.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, size, size);
      }
      return new THREE.CanvasTexture(canvas);
    };
    const texture = createParticleTexture();

    // Generate multiple wave ribbons (spectrum lines)
    colors.forEach((color, index) => {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(particleCount * 3);

      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(positions, 3),
      );

      const material = new THREE.PointsMaterial({
        color: color,
        size: 0.55 - index * 0.03,
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      const points = new THREE.Points(geometry, material);
      group.add(points);

      waves.push({
        points,
        geometry,
        positions,
        phase: index * 0.5, // staggered start
        speed: 1.5 + Math.random() * 0.5, // NOSONAR S2245 비암호화 용도(시각효과/ID 생성)
        amplitude: 1.2 + index * 0.15,
        yOffset: (index - (colors.length - 1) / 2) * 0.4, // spread out on Y axis
      });
    });

    // Slow ambient stars background
    const bgStarsCount = 200;
    const bgStarsGeometry = new THREE.BufferGeometry();
    const bgStarsPositions = new Float32Array(bgStarsCount * 3);
    for (let i = 0; i < bgStarsCount; i++) {
      bgStarsPositions[i * 3] = (Math.random() - 0.5) * 50; // NOSONAR S2245 비암호화 용도(시각효과/ID 생성)
      bgStarsPositions[i * 3 + 1] = (Math.random() - 0.5) * 50; // NOSONAR S2245 비암호화 용도(시각효과/ID 생성)
      bgStarsPositions[i * 3 + 2] = (Math.random() - 0.5) * 50; // NOSONAR S2245 비암호화 용도(시각효과/ID 생성)
    }
    bgStarsGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(bgStarsPositions, 3),
    );
    const bgStarsMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.15,
      transparent: true,
      opacity: 0.35,
    });
    const bgStars = new THREE.Points(bgStarsGeometry, bgStarsMaterial);
    scene.add(bgStars);

    // 4. Animation loop
    // THREE.Clock 은 deprecated(콘솔 경고) — 후속 THREE.Timer 로 교체(매 프레임 update 필요).
    let animationFrameId = 0;
    const timer = new THREE.Timer();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      timer.update();
      const elapsed = timer.getElapsed();

      // Slow overall rotation
      group.rotation.y = elapsed * 0.12;
      group.rotation.x = Math.sin(elapsed * 0.2) * 0.15;

      bgStars.rotation.y = -elapsed * 0.015;

      // Update positions along waves
      waves.forEach((wave) => {
        const positions = wave.positions;
        const phase = wave.phase + elapsed * wave.speed;

        for (let i = 0; i < particleCount; i++) {
          // X goes from left to right (-width/2 to width/2)
          const x = (i - particleCount / 2) * segmentWidth;

          // Y is a sine wave plus Y offset
          const y = Math.sin(x * 0.5 + phase) * wave.amplitude + wave.yOffset;

          // Z twists slightly in depth
          const z = Math.cos(x * 0.4 + phase) * 2;

          positions[i * 3] = x;
          positions[i * 3 + 1] = y;
          positions[i * 3 + 2] = z;
        }

        wave.geometry.attributes.position.needsUpdate = true;
      });

      renderer.render(scene, camera);
    };

    animate();

    // 5. Resize handler
    const handleResize = () => {
      if (!canvasRef.current) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    // 6. Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", handleResize);
      waves.forEach((wave) => {
        wave.geometry.dispose();
        if (wave.points.material instanceof THREE.Material) {
          wave.points.material.dispose();
        }
      });
      bgStarsGeometry.dispose();
      bgStarsMaterial.dispose();
      texture.dispose();
      renderer.dispose();
    };
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div
      className={`${styles.splashOverlay} ${isFading ? styles.hidden : ""}`}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className={styles.webglCanvas} />

      <div className={styles.splashContent}>
        {/* Animated Spectrum Dot */}
        <div className={styles.logoContainer}>
          <div className={styles.spectrumRing}>
            <div className={`${styles.colorDot} ${styles.dotRed}`} />
            <div className={`${styles.colorDot} ${styles.dotOrange}`} />
            <div className={`${styles.colorDot} ${styles.dotGreen}`} />
            <div className={`${styles.colorDot} ${styles.dotBlue}`} />
          </div>
          <svg
            className={styles.logoSvg}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
            <path d="M6 6h10M6 10h10M6 14h10" />
          </svg>
        </div>

        <h1 className={styles.splashTitle}>
          TOON<span className={styles.accentText}>SPECTRUM</span>
        </h1>
        <div className={styles.splashLine} />
        <span className={styles.splashSubtitle}>
          WEBTOON CATALOG & CREATOR STUDIO
        </span>
        <span className={styles.betaBadge}>Beta Service</span>
      </div>
    </div>
  );
}
