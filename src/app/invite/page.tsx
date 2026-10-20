import { Suspense } from "react";

import { AppLoading } from "@/components/app-loading";
import { InviteScreen } from "@/components/invite-screen";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function value(params: Record<string, string | string[] | undefined>, key: string) {
  const candidate = params[key];
  return typeof candidate === "string" ? candidate : null;
}

export default function InvitePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AppLoading />}>
      <InviteFromLink searchParams={searchParams} />
    </Suspense>
  );
}

async function InviteFromLink({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const teamId = value(params, "teamId");
  const membershipId = value(params, "membershipId");
  const userId = value(params, "userId");
  const secret = value(params, "secret");
  const details = teamId && membershipId && userId && secret
    ? { teamId, membershipId, userId, secret }
    : null;

  return <InviteScreen details={details} />;
}
