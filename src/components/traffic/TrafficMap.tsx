'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import Map, { Source, Layer, Marker, Popup, MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Junction, RouteSegment } from '@/types/traffic';
import { roadGeometries } from '@/lib/data/roadGeometries';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, Moon, Crosshair, Plus, Minus } from 'lucide-react';

interface TrafficMapProps {
  junctions: Junction[];
  routes: RouteSegment[];
  selectedJunction: string | null;
  onJunctionSelect: (id: string) => void;
  children?: React.ReactNode;
  mapRef?: React.RefObject<MapRef | null>;
}

type MapStyle = 'dark' | 'light';

const MAP_STYLES: Record<MapStyle, string> = {
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
};

const COLORS = {
  fluid: '#10B981',
  moderate: '#F59E0B',
  congested: '#EA580C',
} as const;

export default function TrafficMap({ junctions, routes, selectedJunction, onJunctionSelect, children, mapRef: externalMapRef }: TrafficMapProps) {
  const internalMapRef = useRef<MapRef>(null);
  const mapRef = externalMapRef ?? internalMapRef;
  const [popupInfo, setPopupInfo] = useState<Junction | null>(null);
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');
  const [styleLoaded, setStyleLoaded] = useState(false);

  // ─── Routes → Real GeoJSON ──────────────────────────────────
  const routesGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: routes.map((route) => {
      const key = `${route.from}-${route.to}` as keyof typeof roadGeometries;
      const coords = roadGeometries[key] || [
        [junctions.find((j) => j.id === route.from)?.lng ?? 0, junctions.find((j) => j.id === route.from)?.lat ?? 0],
        [junctions.find((j) => j.id === route.to)?.lng ?? 0, junctions.find((j) => j.id === route.to)?.lat ?? 0],
      ];
      return {
        type: 'Feature' as const,
        properties: { status: route.status, color: COLORS[route.status], flow: route.flow },
        geometry: { type: 'LineString' as const, coordinates: coords },
      };
    }),
  }), [routes, junctions]);

  const prevSelectedRef = useRef<string | null>(null);

  // ─── Camera transitions (only when selected junction changes) ──
  useEffect(() => {
    if (!mapRef.current) return;
    // Only fly when selection actually changes, not on every junction update
    if (selectedJunction === prevSelectedRef.current) return;
    prevSelectedRef.current = selectedJunction;

    if (selectedJunction) {
      const j = junctions.find((j) => j.id === selectedJunction);
      if (j) {
        const bearings: Record<string, number> = { J1: -30, J2: 25, J3: 40, J4: -15 };
        mapRef.current.flyTo({
          center: [j.lng, j.lat],
          zoom: 15.5,
          pitch: 58,
          bearing: bearings[j.id] ?? -20,
          duration: 2600,
          essential: true,
        });
        setPopupInfo(j);
      }
    } else {
      mapRef.current.flyTo({
        center: [2.3522, 48.8566],
        zoom: 12.5,
        pitch: 0,
        bearing: 0,
        duration: 2000,
      });
      setPopupInfo(null);
    }
  }, [selectedJunction, junctions]);

  const handleStyleToggle = useCallback(() => {
    setMapStyle((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const handleResetView = useCallback(() => {
    mapRef.current?.flyTo({
      center: [2.3522, 48.8566],
      zoom: 12.5,
      pitch: 0,
      bearing: 0,
      duration: 1500,
    });
    onJunctionSelect('');
  }, [onJunctionSelect]);

  const panelBg = mapStyle === 'dark'
    ? 'bg-black/40 backdrop-blur-xl border-white/10'
    : 'bg-white/85 backdrop-blur-xl border-gray-200/60 shadow-lg shadow-black/5';
  const labelBg = mapStyle === 'dark' ? 'bg-black/80 text-white border-white/10' : 'bg-white/90 text-gray-900 border-gray-200/50';
  const popupBg = mapStyle === 'dark' ? 'bg-gray-900/95 text-white' : 'bg-white/95 text-gray-900';

  return (
    <div className="w-full h-full relative">
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: 2.3522,
          latitude: 48.8566,
          zoom: 12.5,
          pitch: 0,
          bearing: 0,
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={MAP_STYLES[mapStyle]}
        onLoad={() => setStyleLoaded(true)}
        maxPitch={85}
      >

        {/* ── Road Layers ───────────────────────────────────── */}
        <Source id="traffic-routes" type="geojson" data={routesGeoJSON}>
          {/* Outer soft glow — wide blur */}
          <Layer
            id="route-glow-outer"
            type="line"
            paint={{
              'line-color': ['get', 'color'],
              'line-width': 14,
              'line-blur': 10,
              'line-opacity': 0.3,
            }}
          />
          {/* Mid glow */}
          <Layer
            id="route-glow-mid"
            type="line"
            paint={{
              'line-color': ['get', 'color'],
              'line-width': 8,
              'line-blur': 5,
              'line-opacity': 0.45,
            }}
          />
          {/* Main solid line */}
          <Layer
            id="route-main"
            type="line"
            layout={{ 'line-join': 'round', 'line-cap': 'round' }}
            paint={{
              'line-color': ['get', 'color'],
              'line-width': 3.5,
              'line-opacity': 0.92,
            }}
          />
          {/* Animated flow dashes */}
          <Layer
            id="route-flow"
            type="line"
            paint={{
              'line-color': '#fff',
              'line-width': 1.5,
              'line-dasharray': [3, 6],
              'line-opacity': 0.4,
            }}
          />
        </Source>

        {/* ── Junction Markers ───────────────────────────────── */}
        {junctions.map((junction) => (
          <Marker
            key={junction.id}
            longitude={junction.lng}
            latitude={junction.lat}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              onJunctionSelect(junction.id);
            }}
          >
            <div className="relative flex items-center justify-center group cursor-pointer">
              {/* Large soft halo */}
              <motion.div
                animate={{ scale: [1, 2.2], opacity: [0.35, 0] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: 'easeOut' }}
                className="absolute w-10 h-10 rounded-full"
                style={{
                  background: `radial-gradient(circle, ${COLORS[junction.status]}50 0%, transparent 70%)`,
                }}
              />
              <motion.div
                animate={{ scale: [1, 1.8], opacity: [0.25, 0] }}
                transition={{ duration: 2.5, repeat: Infinity, delay: 0.8, ease: 'easeOut' }}
                className="absolute w-10 h-10 rounded-full"
                style={{
                  background: `radial-gradient(circle, ${COLORS[junction.status]}40 0%, transparent 70%)`,
                }}
              />
              {/* Outer ring */}
              <motion.div
                animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
                transition={{ duration: 2, repeat: Infinity, delay: 0.3 }}
                className="absolute w-7 h-7 rounded-full border-2"
                style={{ borderColor: COLORS[junction.status] }}
              />
              {/* Central dot with glow */}
              <div
                className="w-3.5 h-3.5 rounded-full z-10 transition-transform duration-200 group-hover:scale-130"
                style={{
                  backgroundColor: COLORS[junction.status],
                  boxShadow: `0 0 20px ${COLORS[junction.status]}80, 0 0 40px ${COLORS[junction.status]}40`,
                }}
              />
              {/* Label on hover */}
              <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none translate-y-1 group-hover:translate-y-0">
                <span className={`text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm border ${labelBg}`}>
                  {junction.name}
                </span>
              </div>
            </div>
          </Marker>
        ))}

        {/* ── Car Animation Layer ────────────────────────────── */}
        {children}

        {/* ── Popup ──────────────────────────────────────────── */}
        <AnimatePresence>
          {popupInfo && (
            <Popup
              longitude={popupInfo.lng}
              latitude={popupInfo.lat}
              anchor="bottom"
              offset={18}
              closeButton={false}
              onClose={() => setPopupInfo(null)}
              className="custom-popup"
            >
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.95 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className={`p-3.5 min-w-48 backdrop-blur-xl rounded-xl shadow-2xl border ${popupBg}`}
                style={{ borderColor: mapStyle === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
              >
                <h3 className={`font-bold text-sm border-b pb-1.5 mb-2 ${mapStyle === 'dark' ? 'border-white/10' : 'border-gray-100'}`}>
                  {popupInfo.name}
                </h3>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="opacity-60">Live Flow</span>
                    <span className="font-bold font-mono">{popupInfo.currentFlow} veh/h</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="opacity-60">Predicted</span>
                    <span className="font-bold font-mono text-emerald-500">{popupInfo.predictedFlow} veh/h</span>
                  </div>
                  <div
                    className={`text-[10px] font-semibold mt-1.5 px-1.5 py-0.5 rounded-full inline-block ${popupInfo.status === 'congested'
                      ? 'bg-orange-500/20 text-orange-500'
                      : popupInfo.status === 'moderate'
                        ? 'bg-amber-500/20 text-amber-500'
                        : 'bg-emerald-500/20 text-emerald-500'
                      }`}
                  >
                    {popupInfo.status.toUpperCase()}
                  </div>
                </div>
              </motion.div>
            </Popup>
          )}
        </AnimatePresence>
      </Map>

      {/* ── Map Controls ────────────────────────────────────── */}
      <div className="absolute bottom-8 right-6 flex flex-col gap-2.5 z-50">
        {/* Style Toggle (Dark/Light) */}
        <button
          onClick={handleStyleToggle}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105 ${panelBg}`}
          title={mapStyle === 'dark' ? 'Switch to light map' : 'Switch to dark map'}
        >
          {mapStyle === 'dark' ? <Sun className="w-4 h-4 text-white" /> : <Moon className="w-4 h-4 text-gray-700" />}
        </button>

        {/* Reset View */}
        <button
          onClick={handleResetView}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105 ${panelBg}`}
          title="Reset view"
        >
          <Crosshair className={`w-4 h-4 ${mapStyle === 'dark' ? 'text-white' : 'text-gray-700'}`} />
        </button>

        {/* Zoom In */}
        <button
          onClick={() => mapRef.current?.zoomIn()}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105 ${panelBg}`}
        >
          <Plus className={`w-4 h-4 ${mapStyle === 'dark' ? 'text-white' : 'text-gray-700'}`} />
        </button>

        {/* Zoom Out */}
        <button
          onClick={() => mapRef.current?.zoomOut()}
          className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105 ${panelBg}`}
        >
          <Minus className={`w-4 h-4 ${mapStyle === 'dark' ? 'text-white' : 'text-gray-700'}`} />
        </button>
      </div>

      <style>{`
        .maplibregl-popup-content {
          padding: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
          border: none !important;
        }
        .maplibregl-popup-tip {
          display: none !important;
        }
        .maplibregl-popup {
          pointer-events: none;
        }
        .maplibregl-popup > * {
          pointer-events: auto;
        }
      `}</style>
    </div>
  );
}
