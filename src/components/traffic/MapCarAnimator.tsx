'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Marker, MapRef } from 'react-map-gl/maplibre';
import { CarRoute, RouteSegment } from '@/types/traffic';
import { roadGeometries } from '@/lib/data/roadGeometries';
import { findBestPath } from '@/lib/traffic/routing';

interface CarAnimatorProps {
  carRoute: CarRoute | null;
  routes: RouteSegment[];
  onArrival: () => void;
  mapRef: React.RefObject<MapRef | null>;
}

const CAR_SPEED = 0.00012;

function interpolate(a: [number, number], b: [number, number], t: number): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function distance(a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function getDirection(from: [number, number], to: [number, number]): number {
  return Math.atan2(to[1] - from[1], to[0] - from[0]) * (180 / Math.PI);
}

export default function MapCarAnimator({ carRoute, routes, onArrival, mapRef }: CarAnimatorProps) {
  const [position, setPosition] = useState<[number, number] | null>(null);
  const [angle, setAngle] = useState(0);
  const [visible, setVisible] = useState(false);
  const [trail, setTrail] = useState<[number, number][]>([]);

  const animRef = useRef<number>(0);
  const coordsRef = useRef<[number, number][]>([]);
  const idxRef = useRef(0);
  const subRef = useRef(0);
  const routesRef = useRef(routes);
  routesRef.current = routes;
  const arrivedRef = useRef(false);
  const smoothAngleRef = useRef(0);

  const buildFullPath = useCallback((route: CarRoute, allRoutes: RouteSegment[]): [number, number][] | null => {
    const pathJunctions = findBestPath(route.from, route.to, allRoutes);
    if (!pathJunctions || pathJunctions.length < 2) return null;

    const fullCoords: [number, number][] = [];
    for (let i = 0; i < pathJunctions.length - 1; i++) {
      const key = `${pathJunctions[i]}-${pathJunctions[i + 1]}`;
      const revKey = `${pathJunctions[i + 1]}-${pathJunctions[i]}`;
      const seg = roadGeometries[key as keyof typeof roadGeometries]
        ?? roadGeometries[revKey as keyof typeof roadGeometries];
      if (!seg) continue;
      const coords = key in roadGeometries ? [...seg] : [...seg].reverse();
      for (let j = (fullCoords.length === 0 ? 0 : 1); j < coords.length; j++) {
        fullCoords.push(coords[j]);
      }
    }
    return fullCoords.length >= 2 ? fullCoords : null;
  }, []);

  useEffect(() => {
    arrivedRef.current = false;

    if (!carRoute) {
      setVisible(false);
      setPosition(null);
      setTrail([]);
      cancelAnimationFrame(animRef.current);
      return;
    }

    const coords = carRoute.fullCoords;
    if (!coords || coords.length < 2) {
      onArrival();
      return;
    }

    coordsRef.current = coords;
    idxRef.current = 0;
    subRef.current = 0;
    smoothAngleRef.current = getDirection(coords[0], coords[1]);
    setPosition(coords[0]);
    setAngle(smoothAngleRef.current);
    setVisible(true);
    setTrail([coords[0]]);

    const segmentDistances: number[] = [];
    for (let i = 0; i < coords.length - 1; i++) {
      segmentDistances.push(distance(coords[i], coords[i + 1]));
    }

    let frameCount = 0;

    const animate = () => {
      animRef.current = requestAnimationFrame(animate);
      frameCount++;

      let i = idxRef.current;
      let t = subRef.current;

      if (i >= coords.length - 1) {
        if (!arrivedRef.current) {
          arrivedRef.current = true;
          setVisible(false);
          onArrival();
        }
        return;
      }

      const segLen = segmentDistances[i] || 0.0001;
      t += CAR_SPEED / segLen;

      if (t >= 1.0) {
        t = 0;
        i++;
        if (i >= coords.length - 1) {
          setPosition(coords[coords.length - 1]);
          setTrail(prev => [...prev.slice(-200), coords[coords.length - 1]]);
          arrivedRef.current = true;
          setVisible(false);
          onArrival();
          return;
        }
      }

      idxRef.current = i;
      subRef.current = t;

      const pos = interpolate(coords[i], coords[i + 1], t);

      // Smooth direction: exponential moving average with wrap-around handling
      const rawDir = getDirection(coords[i], coords[i + 1]);
      const prev = smoothAngleRef.current;
      const diff = angleDiff(prev, rawDir);
      const smoothed = prev + diff * 0.25; // 25% weight to new direction = smooth transitions
      smoothAngleRef.current = smoothed;

      setPosition(pos);
      setAngle(smoothed);
      setTrail(prev => {
        const next = [...prev, pos];
        return next.length > 300 ? next.slice(-300) : next;
      });

      if (mapRef.current && frameCount % 20 === 0) {
        mapRef.current.panTo([pos[0], pos[1]], { duration: 800 });
      }

      // Re-routing check every 3 seconds
      if (carRoute && frameCount % 180 === 0) {
        const reroute = findBestPath(carRoute.from, carRoute.to, routesRef.current);
        if (reroute && reroute.length >= 2 && reroute.join() !== carRoute.path.join()) {
          const newCoords = buildFullPath({ ...carRoute, path: reroute }, routesRef.current);
          if (newCoords && newCoords.length >= 2) {
            let closestIdx = 0, closestDist = Infinity;
            for (let j = 0; j < newCoords.length; j++) {
              const d = distance(pos, newCoords[j]);
              if (d < closestDist) { closestDist = d; closestIdx = j; }
            }
            if (closestIdx < newCoords.length - 1) {
              coordsRef.current = newCoords;
              idxRef.current = closestIdx;
              subRef.current = 0;
              segmentDistances.length = 0;
              for (let k = 0; k < newCoords.length - 1; k++) {
                segmentDistances.push(distance(newCoords[k], newCoords[k + 1]));
              }
            }
          }
        }
      }
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [carRoute, onArrival, buildFullPath]);

  if (!visible || !position) return null;

  // Dimensions: car faces RIGHT (east) at rotate(0)
  const BL = 66; // body length
  const BW = 30; // body width
  const CL = 28; // cabin length
  const CW = 20; // cabin width
  const WS = 6;  // wheel size
  const HX = BL / 2 + 3; // headlight X offset from center
  const HY = BW * 0.18;  // headlight Y offset from center
  const TX = -(BL / 2 + 3); // tail light X offset
  const TY = BW * 0.18;

  return (
    <>
      {/* Trail dots */}
      {trail.length > 3 && trail.filter((_, i) => i % 10 === 0).slice(-15).map((t, i) => (
        <Marker key={`t${i}`} longitude={t[0]} latitude={t[1]} anchor="center">
          <div
            style={{
              width: 2 + (i / 15) * 2,
              height: 2 + (i / 15) * 2,
              borderRadius: '50%',
              background: `rgba(100,116,139,${0.05 + (i / 15) * 0.15})`,
            }}
          />
        </Marker>
      ))}

      <Marker longitude={position[0]} latitude={position[1]} anchor="center">
        <div
          style={{
            width: BL + 12,
            height: BL + 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `rotate(${angle}deg)`,
          }}
        >
          {/* Drop shadow */}
          <div style={{
            position: 'absolute',
            width: BL, height: BW,
            borderRadius: '42% 42% 38% 38% / 50% 50% 42% 42%',
            background: 'rgba(0,0,0,0.22)',
            filter: 'blur(4px)',
            transform: 'translate(2px, 2px)',
          }} />

          {/* ── CAR BODY ── */}
          <div style={{
            position: 'absolute',
            width: BL, height: BW,
            background: `
              linear-gradient(180deg,
                rgba(255,255,255,0.45) 0%,
                #A8B4C0 8%, #8B95A5 20%, #B8C4D0 40%,
                #8B95A5 55%, #717D8C 75%, #5A6575 100%
              )
            `,
            borderRadius: '42% 42% 38% 38% / 50% 50% 42% 42%',
            border: '1px solid rgba(255,255,255,0.4)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 0 6px rgba(0,0,0,0.25)',
          }}>
            {/* Front bumper */}
            <div style={{
              position: 'absolute',
              right: 1, top: '20%', width: BL * 0.07, height: '60%',
              background: 'linear-gradient(90deg, #9BA5B2, #CBD5E1)',
              borderRadius: '0 40% 40% 0 / 0 45% 45% 0',
            }} />
            {/* Rear bumper */}
            <div style={{
              position: 'absolute',
              left: 1, top: '20%', width: BL * 0.05, height: '60%',
              background: 'linear-gradient(90deg, #C0CAD6, #8B95A5)',
              borderRadius: '40% 0 0 40% / 45% 0 0 45%',
            }} />
          </div>

          {/* ── CABIN / ROOF ── */}
          <div style={{
            position: 'absolute',
            width: CL, height: CW,
            background: 'linear-gradient(180deg, #2d3748 0%, #1a202c 50%, #171923 100%)',
            borderRadius: '30% 30% 30% 30% / 40% 40% 40% 40%',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
          }}>
            {/* Front windshield */}
            <div style={{
              position: 'absolute',
              right: 1, top: '15%', width: CL * 0.22, height: '70%',
              background: 'linear-gradient(200deg, rgba(59,130,246,0.25), rgba(30,58,95,0.5), #1a202c)',
              borderRadius: '30% 8% 8% 30% / 40% 30% 30% 40%',
            }} />
            {/* Roof + side windows */}
            <div style={{
              position: 'absolute',
              left: '22%', top: '15%', width: CL * 0.52, height: '70%',
              background: 'linear-gradient(180deg, #374151, #1f2937, #111827)',
              borderRadius: '20%',
              borderLeft: '1px solid rgba(255,255,255,0.06)',
              borderRight: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ position: 'absolute', top: 1, left: '10%', width: '80%', height: '25%',
                background: 'linear-gradient(180deg, rgba(100,150,200,0.2), rgba(30,50,80,0.4))', borderRadius: '30%' }} />
              <div style={{ position: 'absolute', bottom: 1, left: '10%', width: '80%', height: '25%',
                background: 'linear-gradient(180deg, rgba(30,50,80,0.4), rgba(100,150,200,0.2))', borderRadius: '30%' }} />
            </div>
            {/* Rear windshield */}
            <div style={{
              position: 'absolute',
              left: 1, top: '15%', width: CL * 0.22, height: '70%',
              background: 'linear-gradient(20deg, rgba(59,130,246,0.2), rgba(20,40,60,0.5), #1a202c)',
              borderRadius: '8% 30% 30% 8% / 30% 40% 40% 30%',
            }} />
          </div>

          {/* ── WHEELS (4 corners, positioned with translate) ── */}
          {[
            [BL * 0.28, -(BW / 2 + 2)],   // front-right
            [BL * 0.28, BW / 2 + 2],      // front-left
            [-(BL * 0.28), -(BW / 2 + 2)], // rear-right
            [-(BL * 0.28), BW / 2 + 2],    // rear-left
          ].map(([x, y], i) => (
            <div key={`w${i}`} style={{
              position: 'absolute', width: WS, height: WS + 1,
              background: '#1a1a1a',
              borderRadius: '2px 2px 2px 2px / 3px 3px 3px 3px',
              border: '1px solid rgba(255,255,255,0.12)',
              boxShadow: 'inset 0 0 2px rgba(255,255,255,0.1)',
              transform: `translate(${x}px, ${y}px)`,
            }} />
          ))}

          {/* ── HEADLIGHTS (front-right, positioned with translate) ── */}
          <div style={{
            position: 'absolute', width: 4, height: 5,
            background: '#FEF3C7',
            borderRadius: '0 3px 3px 0',
            boxShadow: '0 0 8px #FEF08A, 0 0 14px #FDE047',
            transform: `translate(${HX}px, ${-HY}px)`,
          }} />
          <div style={{
            position: 'absolute', width: 4, height: 5,
            background: '#FEF3C7',
            borderRadius: '0 3px 3px 0',
            boxShadow: '0 0 8px #FEF08A, 0 0 14px #FDE047',
            transform: `translate(${HX}px, ${HY}px)`,
          }} />

          {/* ── TAIL LIGHTS (rear-left, positioned with translate) ── */}
          <div style={{
            position: 'absolute', width: 4, height: 5,
            background: '#DC2626',
            borderRadius: '3px 0 0 3px',
            boxShadow: '0 0 8px #EF4444, 0 0 12px #F87171',
            transform: `translate(${TX}px, ${-TY}px)`,
          }} />
          <div style={{
            position: 'absolute', width: 4, height: 5,
            background: '#DC2626',
            borderRadius: '3px 0 0 3px',
            boxShadow: '0 0 8px #EF4444, 0 0 12px #F87171',
            transform: `translate(${TX}px, ${TY}px)`,
          }} />
        </div>
      </Marker>
    </>
  );
}
