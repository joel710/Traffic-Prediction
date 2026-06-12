import { NextResponse } from 'next/server';

// Simulated prediction data for traffic flow
const generatePredictions = (modelType: 'global' | 'specific', junctionId?: string) => {
  const baseFlows: Record<string, number> = {
    J1: 3420,
    J2: 2840,
    J3: 4120,
    J4: 2680,
  };

  const junctions = junctionId ? [junctionId] : ['J1', 'J2', 'J3', 'J4'];
  
  return junctions.map(jId => {
    const baseFlow = baseFlows[jId] || 3000;
    const predictions = Array.from({ length: 24 }, (_, i) => {
      const hour = i;
      const rushHourFactor = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19) ? 1.3 : 1;
      const nightFactor = hour >= 0 && hour <= 5 ? 0.5 : 1;
      const randomness = modelType === 'specific' ? 0.1 : 0.15; // Specific model is more accurate
      
      return {
        hour,
        value: Math.round(baseFlow * rushHourFactor * nightFactor * (1 + (Math.random() - 0.5) * randomness)),
        timestamp: `${hour.toString().padStart(2, '0')}:00`,
      };
    });

    return {
      junctionId: jId,
      predictions,
    };
  });
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const modelType = (searchParams.get('modelType') as 'global' | 'specific') || 'global';
  const junctionId = searchParams.get('junctionId') || undefined;

  const predictions = generatePredictions(modelType, junctionId);
  
  const metrics = modelType === 'global' 
    ? { mae: 3.24, rmse: 4.15, accuracy: 87.5 }
    : { mae: 2.17, rmse: 3.08, accuracy: 91.2 };

  return NextResponse.json({
    predictions,
    modelMetrics: metrics,
    modelType,
    timestamp: new Date().toISOString(),
  });
}
