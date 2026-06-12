export interface Junction {
  id: string;
  name: string;
  lat: number;
  lng: number;
  currentFlow: number;
  predictedFlow: number;
  trend: 'up' | 'down' | 'stable';
  status: 'fluid' | 'moderate' | 'congested';
}

export interface FlowPrediction {
  hour: number;
  value: number;
  timestamp: string;
}

export interface ModelMetrics {
  mae: number;
  rmse: number;
  accuracy: number;
}

export interface TrafficData {
  junctions: Junction[];
  predictions: FlowPrediction[];
  modelMetrics: ModelMetrics;
  modelType: 'global' | 'specific';
}

export interface RouteSegment {
  from: string;
  to: string;
  flow: number;
  status: 'fluid' | 'moderate' | 'congested';
}

export interface CarRoute {
  path: string[]; // junction IDs in order
  fullCoords: [number, number][]; // all coordinates along the path
  from: string;
  to: string;
}
