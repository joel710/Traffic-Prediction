'use client';

import { useSyncExternalStore } from 'react';
import { Junction, FlowPrediction, ModelMetrics } from '@/types/traffic';
import ThreeCarVisualizer from './ThreeCarVisualizer';
import {
  Search,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Clock,
  Target
} from 'lucide-react';
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  YAxis,
  Tooltip
} from 'recharts';

interface SidebarProps {
  junctions: Junction[];
  selectedJunction: string | null;
  onJunctionSelect: (id: string) => void;
  modelMetrics: ModelMetrics;
  onNavigateTo?: (targetId: string) => void;
  carOrigin?: string | null;
}

// Hook to safely detect client-side mounting
function useIsClient() {
  return useSyncExternalStore(
    () => () => { },
    () => true,
    () => false
  );
}

const generateSparklineData = (baseValue: number): FlowPrediction[] => {
  return Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    value: Math.max(0, baseValue + Math.sin(i / 3) * 50 + (Math.random() - 0.5) * 30),
    timestamp: `${i}:00`,
  }));
};

const getStatusColor = (status: 'fluid' | 'moderate' | 'congested') => {
  const colors = {
    fluid: 'text-emerald-600',
    moderate: 'text-amber-600',
    congested: 'text-orange-600',
  };
  return colors[status];
};

const getStatusBg = (status: 'fluid' | 'moderate' | 'congested') => {
  const colors = {
    fluid: 'bg-emerald-50',
    moderate: 'bg-amber-50',
    congested: 'bg-orange-50',
  };
  return colors[status];
};

const getTrendIcon = (trend: 'up' | 'down' | 'stable') => {
  switch (trend) {
    case 'up':
      return <TrendingUp className="w-3.5 h-3.5 text-rose-500" />;
    case 'down':
      return <TrendingDown className="w-3.5 h-3.5 text-emerald-500" />;
    default:
      return <Minus className="w-3.5 h-3.5 text-gray-400" />;
  }
};

export default function Sidebar({
  junctions,
  selectedJunction,
  onJunctionSelect,
  modelMetrics,
  onNavigateTo,
  carOrigin,
}: SidebarProps) {
  const isClient = useIsClient();

  return (
    <div className="absolute left-4 top-4 bottom-24 w-80 z-50 flex flex-col gap-4">
      {/* Search Bar */}
      <div className="backdrop-blur-xl bg-white/80 rounded-2xl shadow-lg shadow-black/5 border border-white/50 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search junctions..."
            className="w-full pl-10 pr-4 py-2.5 bg-gray-50/80 rounded-xl text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200/50 transition-all"
          />
        </div>
      </div>

      {/* Model Metrics Card (live-computed from streaming data) */}
      <div className="backdrop-blur-xl bg-white/80 rounded-2xl shadow-lg shadow-black/5 border border-white/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Model Performance
          </h3>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
            Live Metrics
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Target className="w-3.5 h-3.5 text-gray-400" />
            </div>
            <p className="text-lg font-semibold text-gray-900">{modelMetrics.mae.toFixed(2)}</p>
            <p className="text-[10px] text-gray-500">MAE</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Activity className="w-3.5 h-3.5 text-gray-400" />
            </div>
            <p className="text-lg font-semibold text-gray-900">{modelMetrics.rmse.toFixed(2)}</p>
            <p className="text-[10px] text-gray-500">RMSE</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <TrendingUp className="w-3.5 h-3.5 text-gray-400" />
            </div>
            <p className="text-lg font-semibold text-gray-900">{modelMetrics.accuracy.toFixed(1)}%</p>
            <p className="text-[10px] text-gray-500">Accuracy</p>
          </div>
        </div>
      </div>

      {/* Junction Cards */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar">
        {junctions.map((junction) => {
          const sparklineData = generateSparklineData(junction.currentFlow);
          const isSelected = selectedJunction === junction.id;

          return (
            <div
              key={junction.id}
              onClick={() => onJunctionSelect(junction.id)}
              className={`backdrop-blur-xl rounded-2xl shadow-lg shadow-black/5 border transition-all cursor-pointer
                ${isSelected
                  ? 'bg-white/90 border-gray-200/50 ring-2 ring-gray-300/50'
                  : 'bg-white/80 border-white/50 hover:bg-white/90'
                } p-4`}
            >
              {/* Junction Header */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${junction.status === 'fluid' ? 'bg-emerald-500' :
                    junction.status === 'moderate' ? 'bg-amber-500' : 'bg-orange-500'
                    }`} />
                  <h4 className="font-semibold text-sm text-gray-900">{junction.name}</h4>
                </div>
                <div className="flex items-center gap-1.5">
                  {getTrendIcon(junction.trend)}
                  {onNavigateTo && carOrigin && carOrigin !== junction.id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateTo(junction.id);
                      }}
                      className="text-[9px] font-bold px-2 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm"
                      title={`Drive from ${carOrigin} to ${junction.id}`}
                    >
                      GO
                    </button>
                  )}
                </div>
              </div>

              {/* Flow Stats */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className={`p-2.5 rounded-xl ${getStatusBg(junction.status)}`}>
                  <div className="flex items-center gap-1 mb-1">
                    <Clock className="w-3 h-3 text-gray-400" />
                    <span className="text-[10px] text-gray-500">Current</span>
                  </div>
                  <p className={`text-base font-semibold ${getStatusColor(junction.status)}`}>
                    {junction.currentFlow}
                    <span className="text-[10px] font-normal text-gray-400 ml-1">veh/h</span>
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-gray-50">
                  <div className="flex items-center gap-1 mb-1">
                    <Activity className="w-3 h-3 text-gray-400" />
                    <span className="text-[10px] text-gray-500">Predicted</span>
                  </div>
                  <p className="text-base font-semibold text-gray-700">
                    {junction.predictedFlow}
                    <span className="text-[10px] font-normal text-gray-400 ml-1">veh/h</span>
                  </p>
                </div>
              </div>

              {/* Sparkline */}
              <div className="h-12 w-full" style={{ minHeight: 0 }}>
                {isClient && (
                  <ResponsiveContainer width="100%" height={48}>
                    <AreaChart data={sparklineData}>
                      <defs>
                        <linearGradient id={`gradient-${junction.id}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={
                            junction.status === 'fluid' ? '#10B981' :
                              junction.status === 'moderate' ? '#F59E0B' : '#EA580C'
                          } stopOpacity={0.3} />
                          <stop offset="100%" stopColor={
                            junction.status === 'fluid' ? '#10B981' :
                              junction.status === 'moderate' ? '#F59E0B' : '#EA580C'
                          } stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <YAxis hide domain={['dataMin - 20', 'dataMax + 20']} />
                      <Tooltip
                        contentStyle={{
                          display: 'none'
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke={
                          junction.status === 'fluid' ? '#10B981' :
                            junction.status === 'moderate' ? '#F59E0B' : '#EA580C'
                        }
                        strokeWidth={1.5}
                        fill={`url(#gradient-${junction.id})`}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* 3D Cyber Car Visualizer (only if selected) */}
              {isSelected && (
                <div className="mt-3 h-28 w-full rounded-xl overflow-hidden bg-slate-950/20 backdrop-blur-md border border-white/10 shadow-inner relative flex items-center justify-center">
                  <ThreeCarVisualizer status={junction.status} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Custom Scrollbar Styles */}
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.1);
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.2);
        }
      `}</style>
    </div>
  );
}
