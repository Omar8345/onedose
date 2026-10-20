import { connection } from "next/server";
import { Suspense } from "react";

import { CareDashboard } from "@/components/care-dashboard";
import { demoCircle } from "@/lib/demo-data";
import { getDemoCircle } from "@/lib/data/get-demo-circle";

export default function Home() {
  return (
    <Suspense fallback={<CareDashboard circle={demoCircle} />}>
      <LiveDashboard />
    </Suspense>
  );
}

async function LiveDashboard() {
  await connection();
  const circle = await getDemoCircle();
  return <CareDashboard circle={circle} />;
}
