import { getServerAppwrite } from "@/lib/appwrite/server";
import { AppwriteException, Query } from "node-appwrite";

import { requireCurrentUser } from "@/lib/auth/session";
import {
  claimOccurrence,
  getOccurrenceClaimState,
  ClaimForbiddenError,
  releaseOccurrenceClaim,
} from "@/lib/data/manage-occurrence-claim";

async function response(result: Awaited<ReturnType<typeof claimOccurrence>>) {
  const { teams } = getServerAppwrite();
  const holder = result.occurrence.claimedBy;
  const memberships = holder ? await teams.listMemberships({ teamId: result.occurrence.teamId, queries: [Query.equal("userId", [holder])] }) : null;
  const name = memberships?.memberships.find((member) => member.confirm)?.userName.trim();
  return Response.json({
    kind: result.kind,
    occurrence: {
      id: result.occurrence.$id,
      status: result.occurrence.status,
      claimedBy: result.occurrence.claimedBy,
      claimedByName: name || null,
      claimedAt: result.occurrence.claimedAt,
      claimExpiresAt: result.occurrence.claimExpiresAt,
    },
  });
}

async function handle(
  context: RouteContext<"/api/occurrences/[occurrenceId]/claim">,
  action: typeof claimOccurrence,
) {
  try {
    const [{ occurrenceId }, { user }] = await Promise.all([context.params, requireCurrentUser()]);
    const result = await action(occurrenceId, user.$id);
    const fresh = await getOccurrenceClaimState(occurrenceId, user.$id);
    return await response({ ...fresh, kind: result.kind === "claimed" && fresh.occurrence.claimedBy === user.$id ? "claimed" : fresh.kind });
  } catch (error) {
    if (error instanceof AppwriteException && error.code === 401) {
      return Response.json({ message: "Sign in to coordinate this action." }, { status: 401 });
    }
    if (error instanceof ClaimForbiddenError) {
      return Response.json({ message: error.message }, { status: 403 });
    }
    console.error("Unable to update occurrence claim", error);
    return Response.json({ message: "The care action could not be updated. Please try again." }, { status: 500 });
  }
}

export async function POST(
  _request: Request,
  context: RouteContext<"/api/occurrences/[occurrenceId]/claim">,
) {
  return handle(context, claimOccurrence);
}

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/occurrences/[occurrenceId]/claim">,
) {
  return handle(context, releaseOccurrenceClaim);
}
