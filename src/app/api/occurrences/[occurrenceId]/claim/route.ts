import { AppwriteException } from "node-appwrite";

import { requireCurrentUser } from "@/lib/auth/session";
import {
  claimOccurrence,
  ClaimForbiddenError,
  releaseOccurrenceClaim,
} from "@/lib/data/manage-occurrence-claim";

function response(result: Awaited<ReturnType<typeof claimOccurrence>>) {
  return Response.json({
    kind: result.kind,
    occurrence: {
      id: result.occurrence.$id,
      status: result.occurrence.status,
      claimedBy: result.occurrence.claimedBy,
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
    return response(await action(occurrenceId, user.$id));
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
