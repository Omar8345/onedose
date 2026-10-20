import { connection } from "next/server";
import { Suspense } from "react";

import { CareDashboard } from "@/components/care-dashboard";
import { AuthScreen } from "@/components/auth-screen";
import { OnboardingPlaceholder } from "@/components/onboarding-placeholder";
import { demoCircle } from "@/lib/demo-data";
import { getCurrentUser } from "@/lib/auth/session";
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
  const user = await getCurrentUser();
  if (!user) return <AuthScreen />;
  if (!user.prefs.primaryTeamId) return <OnboardingPlaceholder name={user.name || "there"} />;

  // The next milestone replaces this placeholder check with the user's
  // TablesDB care circle and onboarding flow.
  if (user.$id !== "demo_omar") return <OnboardingPlaceholder name={user.name || "there"} />;
  const circle = await getDemoCircle();
  return <CareDashboard circle={circle} />;
}
