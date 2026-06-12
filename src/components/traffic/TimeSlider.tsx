'use client';

import { useState, useEffect } from 'react';
import { Clock, ChevronLeft, ChevronRight } from 'lucide-react';

interface TimeSliderProps {
  currentTime: number;
  onTimeChange: (hour: number) => void;
}

export default function TimeSlider({ currentTime, onTimeChange }: TimeSliderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [displayTime, setDisplayTime] = useState(currentTime);

  useEffect(() => {
    setDisplayTime(currentTime);
  }, [currentTime]);

  const formatTime = (hour: number) => {
    const h = Math.floor(hour);
    const m = Math.round((hour - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  const getHourLabel = (hour: number) => {
    if (hour === 0 || hour === 24) return 'Now';
    if (hour === 6) return '6AM';
    if (hour === 12) return 'Noon';
    if (hour === 18) return '6PM';
    return '';
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    setDisplayTime(value);
    onTimeChange(value);
  };

  const incrementTime = () => {
    const newTime = Math.min(24, displayTime + 1);
    setDisplayTime(newTime);
    onTimeChange(newTime);
  };

  const decrementTime = () => {
    const newTime = Math.max(0, displayTime - 1);
    setDisplayTime(newTime);
    onTimeChange(newTime);
  };

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-2xl px-4">
      <div className="backdrop-blur-xl bg-white/80 rounded-2xl shadow-lg shadow-black/5 border border-white/50 p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              Prediction Timeline
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={decrementTime}
              className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-gray-500" />
            </button>
            <span className="text-sm font-semibold text-gray-900 min-w-15 text-center">
              {formatTime(displayTime)}
            </span>
            <button
              onClick={incrementTime}
              className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Slider Container */}
        <div className="relative">
          {/* Hour markers */}
          <div className="absolute top-0 left-0 right-0 flex justify-between px-0.5 -translate-y-1">
            {[0, 6, 12, 18, 24].map((hour) => (
              <div
                key={hour}
                className="flex flex-col items-center"
              >
                <div className="w-0.5 h-1.5 bg-gray-300 rounded-full" />
                {getHourLabel(hour) && (
                  <span className="text-[10px] text-gray-400 mt-1">
                    {getHourLabel(hour)}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Custom Slider */}
          <div className="relative pt-5 pb-1">
            <input
              type="range"
              min="0"
              max="24"
              step="0.5"
              value={displayTime}
              onChange={handleSliderChange}
              onMouseDown={() => setIsDragging(true)}
              onMouseUp={() => setIsDragging(false)}
              onTouchStart={() => setIsDragging(true)}
              onTouchEnd={() => setIsDragging(false)}
              className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer
                [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:w-4
                [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-gray-900
                [&::-webkit-slider-thumb]:shadow-md
                [&::-webkit-slider-thumb]:cursor-pointer
                [&::-webkit-slider-thumb]:transition-transform
                [&::-webkit-slider-thumb]:hover:scale-110
                [&::-moz-range-thumb]:w-4
                [&::-moz-range-thumb]:h-4
                [&::-moz-range-thumb]:rounded-full
                [&::-moz-range-thumb]:bg-gray-900
                [&::-moz-range-thumb]:shadow-md
                [&::-moz-range-thumb]:cursor-pointer
                [&::-moz-range-thumb]:border-none"
              style={{
                background: `linear-gradient(to right, #10B981 0%, #F59E0B ${displayTime / 24 * 50}%, #EA580C ${displayTime / 24 * 100}%, #E5E7EB ${displayTime / 24 * 100}%)`
              }}
            />
          </div>
        </div>

        {/* Prediction Status */}
        <div className="flex items-center justify-center gap-4 mt-2">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-[10px] text-gray-500">Fluid</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-[10px] text-gray-500">Moderate</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-orange-500" />
            <span className="text-[10px] text-gray-500">Congested</span>
          </div>
        </div>
      </div>
    </div>
  );
}
