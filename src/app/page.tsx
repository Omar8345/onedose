import { connection } from "next/server";
import { Suspense } from "react";

import { CareDashboard } from "@/components/care-dashboard";
import { AuthScreen } from "@/components/auth-screen";
import { AppLoading } from "@/components/app-loading";
import { OnboardingScreen } from "@/components/onboarding-screen";
import { getCurrentUser, getSessionSecret } from "@/lib/auth/session";
import { ensurePrimaryTeam } from "@/lib/auth/team";
import { getCareCircle } from "@/lib/data/get-care-circle";

export default function Home() {
  return (
    <Suspense fallback={<AppLoading />}>
      <LiveDashboard />
    </Suspense>
  );
}

async function LiveDashboard() {
  await connection();
  const user = await getCurrentUser();
  if (!user) return <AuthScreen />;
  if (!user.name) return <AuthScreen initialStep="profile" />;
  if (!user.prefs.primaryTeamId) {
    const secret = await getSessionSecret();
    if (!secret) return <AuthScreen />;
    await ensurePrimaryTeam(secret, user.name);
  }
  if (!user.prefs.circleId) return <OnboardingScreen name={user.name || "there"} />;
  const viewer = { id: user.$id, name: user.name || "Caregiver" };
  const circle = await getCareCircle(user.prefs.circleId, viewer);
  return <CareDashboard circle={circle} viewer={viewer} />;
}
