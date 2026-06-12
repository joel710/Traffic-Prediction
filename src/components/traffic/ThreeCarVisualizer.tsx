'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface ThreeCarVisualizerProps {
  status: 'fluid' | 'moderate' | 'congested';
}

export default function ThreeCarVisualizer({ status }: ThreeCarVisualizerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Get current container dimensions
    const width = containerRef.current.clientWidth || 280;
    const height = containerRef.current.clientHeight || 128;

    // ─── Scene & Camera Setup ──────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = null; // Transparent background for glassmorphism integration

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(4, 2.2, 4);

    // ─── Renderer Setup ────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);

    // ─── Lights ────────────────────────────────────────────────
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const pointLight = new THREE.PointLight(0xffffff, 0.8, 10);
    pointLight.position.set(0, 3, 0);
    scene.add(pointLight);

    // ─── Determine Neon Glow Color based on Status ──────────────
    let glowColorStr = 0x10B981; // default fluid (green)
    if (status === 'moderate') {
      glowColorStr = 0xF59E0B; // amber
    } else if (status === 'congested') {
      glowColorStr = 0xEF4444; // congested (vibrant red)
    }
    const glowColor = new THREE.Color(glowColorStr);

    // ─── Procedural Sleek Cyber Car Model ───────────────────────
    const carGroup = new THREE.Group();

    // Body (Main Chassis) - Matte Metallic Black/Grey
    const bodyGeom = new THREE.BoxGeometry(2.0, 0.35, 0.95);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.8,
      roughness: 0.2,
    });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.3;
    body.castShadow = true;
    body.receiveShadow = true;
    carGroup.add(body);

    // Cabin (Windshield & Roof) - Glossy Dark Glass
    const cabinGeom = new THREE.BoxGeometry(1.0, 0.35, 0.85);
    const cabinMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.9,
      roughness: 0.05,
      transparent: true,
      opacity: 0.85,
    });
    const cabin = new THREE.Mesh(cabinGeom, cabinMat);
    cabin.position.set(-0.15, 0.6, 0);
    cabin.castShadow = true;
    carGroup.add(cabin);

    // Underglow Neon Plate
    const neonGeom = new THREE.PlaneGeometry(1.6, 0.85);
    const neonMat = new THREE.MeshBasicMaterial({
      color: glowColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
    });
    const neonPlate = new THREE.Mesh(neonGeom, neonMat);
    neonPlate.rotation.x = Math.PI / 2;
    neonPlate.position.y = 0.08;
    carGroup.add(neonPlate);

    // Point Light for Real-time Floor Underglow Projection
    const underglowLight = new THREE.PointLight(glowColor, 2.5, 2.0);
    underglowLight.position.set(0, 0.1, 0);
    carGroup.add(underglowLight);

    // Headlights (Neon white/cyan)
    const headlightGeom = new THREE.BoxGeometry(0.05, 0.05, 0.25);
    const headlightMat = new THREE.MeshBasicMaterial({
      color: 0xe2e8f0,
    });
    const leftHeadlight = new THREE.Mesh(headlightGeom, headlightMat);
    leftHeadlight.position.set(1.01, 0.35, 0.3);
    const rightHeadlight = leftHeadlight.clone();
    rightHeadlight.position.z = -0.3;
    carGroup.add(leftHeadlight);
    carGroup.add(rightHeadlight);

    // Headlight Flares (PointLights pointing forward)
    const leftFlare = new THREE.PointLight(0xe2e8f0, 0.8, 2);
    leftFlare.position.set(1.2, 0.35, 0.3);
    const rightFlare = leftFlare.clone();
    rightFlare.position.z = -0.3;
    carGroup.add(leftFlare);
    carGroup.add(rightFlare);

    // Taillights (Status glow colors!)
    const taillightGeom = new THREE.BoxGeometry(0.05, 0.05, 0.35);
    const taillightMat = new THREE.MeshBasicMaterial({
      color: glowColor,
    });
    const taillight = new THREE.Mesh(taillightGeom, taillightMat);
    taillight.position.set(-1.01, 0.35, 0);
    carGroup.add(taillight);

    // Wheels (4 cylinders rotating)
    const wheelGeom = new THREE.CylinderGeometry(0.24, 0.24, 0.16, 24);
    const wheelMat = new THREE.MeshStandardMaterial({
      color: 0x090d16,
      roughness: 0.8,
      metalness: 0.1,
    });

    const wheels: THREE.Mesh[] = [];
    const wheelPositions = [
      { x: 0.6, z: 0.48 },   // Front Right
      { x: 0.6, z: -0.48 },  // Front Left
      { x: -0.6, z: 0.48 },  // Rear Right
      { x: -0.6, z: -0.48 }, // Rear Left
    ];

    wheelPositions.forEach((pos) => {
      const wheel = new THREE.Mesh(wheelGeom, wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(pos.x, 0.24, pos.z);
      wheel.castShadow = true;
      carGroup.add(wheel);
      wheels.push(wheel);
    });

    scene.add(carGroup);

    // Camera targets car center
    camera.lookAt(0, 0.35, 0);

    // ─── Animation Loop ────────────────────────────────────────
    let animationId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animationId = requestAnimationFrame(animate);

      const elapsedTime = clock.getElapsedTime();

      // Spin the car group for full 360-degree interactive preview
      carGroup.rotation.y = elapsedTime * 0.4;

      // Animate wheels rotating (as if car is moving forward)
      wheels.forEach((w) => {
        w.rotation.y = elapsedTime * 3.5;
      });

      // Subtle hover/suspension vibration bounce
      carGroup.position.y = Math.sin(elapsedTime * 4) * 0.03;

      // Pulse neon underglow light intensity
      underglowLight.intensity = 2.0 + Math.sin(elapsedTime * 6) * 0.5;

      renderer.render(scene, camera);
    };

    animate();

    // ─── Resize Handler ────────────────────────────────────────
    const handleResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    // ─── Cleanup ───────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (containerRef.current && renderer.domElement.parentNode) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [status]);

  return (
    <div className="relative w-full h-full">
      {/* Three.js Container */}
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      
      {/* Decorative High-tech Corner Overlays */}
      <div className="absolute top-2 left-2 border-t-2 border-l-2 border-white/20 w-3 h-3 pointer-events-none" />
      <div className="absolute top-2 right-2 border-t-2 border-r-2 border-white/20 w-3 h-3 pointer-events-none" />
      <div className="absolute bottom-2 left-2 border-b-2 border-l-2 border-white/20 w-3 h-3 pointer-events-none" />
      <div className="absolute bottom-2 right-2 border-b-2 border-r-2 border-white/20 w-3 h-3 pointer-events-none" />
    </div>
  );
}
