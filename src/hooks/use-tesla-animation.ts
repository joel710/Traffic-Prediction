// src/hooks/use-tesla-animation.ts
import { useEffect, useState, useRef } from 'react';

export interface TeslaPosition {
  lat: number;
  lng: number;
  heading: number;
  timestamp: Date;
}

export interface TeslaJourney {
  id: string;
  startJunction: number;
  endJunction: number;
  positions: TeslaPosition[];
  isComplete: boolean;
}

export function useTeslaAnimation(journeyCount: number) {
  const [teslas, setTeslas] = useState<TeslaJourney[]>([]);
  const animationRef = useRef<number>();

  useEffect(() => {
    // Générer des trajets Tesla simulés
    const newTeslas: TeslaJourney[] = Array.from({ length: journeyCount }, (_, i) => ({
      id: `tesla-${i}`,
      startJunction: Math.floor(Math.random() * 12) + 1,
      endJunction: Math.floor(Math.random() * 12) + 1,
      positions: [],
      isComplete: false,
    }));

    setTeslas(newTeslas);
  }, [journeyCount]);

  // Animer les Teslas le long des routes
  useEffect(() => {
    const animate = () => {
      setTeslas(prev => 
        prev.map(tesla => {
          // Simuler le mouvement - en prod, ce serait basé sur les données réelles
          const newLat = 48.85 + (Math.random() - 0.5) * 0.01;
          const newLng = 2.35 + (Math.random() - 0.5) * 0.01;

          return {
            ...tesla,
            positions: [
              ...tesla.positions,
              {
                lat: newLat,
                lng: newLng,
                heading: Math.random() * 360,
                timestamp: new Date(),
              }
            ].slice(-50), // Garder seulement les 50 dernières positions
          };
        })
      );

      animationRef.current = requestAnimationFrame(animate);
    };

    if (journeyCount > 0) {
      animationRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [journeyCount]);

  return teslas;
}
