import { connection } from "next/server";
import { Suspense } from "react";

import { CareDashboard } from "@/components/care-dashboard";
import { AccessRevokedScreen } from "@/components/access-revoked-screen";
import { AuthScreen } from "@/components/auth-screen";
import { AppLoading } from "@/components/app-loading";
import { OnboardingScreen } from "@/components/onboarding-screen";
import { getCurrentUser, getSessionSecret } from "@/lib/auth/session";
import { ensurePrimaryTeam } from "@/lib/auth/team";
import { assertCareCircleAccess, CareCircleAccessError, getCareCircle } from "@/lib/data/get-care-circle";
import { ensureTodayOccurrences } from "@/lib/data/ensure-occurrences";

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
  const secret = await getSessionSecret();
  if (!secret) return <AuthScreen />;
  const viewer = { id: user.$id, name: user.name || "Caregiver", email: user.email };
  let circle: Awaited<ReturnType<typeof getCareCircle>>;
  try {
    await assertCareCircleAccess(user.prefs.circleId, user.$id, secret);
    await ensureTodayOccurrences(user.prefs.circleId);
    circle = await getCareCircle(user.prefs.circleId, viewer);
  } catch (error) {
    if (error instanceof CareCircleAccessError) return <AccessRevokedScreen />;
    throw error;
  }
  return <CareDashboard circle={circle} viewer={viewer} />;
}
