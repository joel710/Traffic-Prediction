// src/app/dashboard/page.tsx
'use client';

import { useSearchParams } from 'next/navigation';
import { TrafficDashboard } from '@/components/traffic/TrafficDashboard';
import { Suspense } from 'react';

function DashboardContent() {
  const searchParams = useSearchParams();
  const junction = searchParams.get('junction');

  return <TrafficDashboard initialJunction={junction ? parseInt(junction) : undefined} />;
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <DashboardContent />
    </Suspense>
  );
}
