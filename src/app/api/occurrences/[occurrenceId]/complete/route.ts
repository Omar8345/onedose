import { AppwriteException } from "node-appwrite";
import { z } from "zod";

import { requireCurrentUser } from "@/lib/auth/session";
import {
  completeOccurrence,
  CompletionForbiddenError,
  CompletionInputConflictError,
} from "@/lib/data/complete-occurrence";

const bodySchema = z.object({
  idempotencyKey: z.string().min(16).max(200),
  note: z.string().trim().max(500).optional(),
});

export async function POST(
  request: Request,
  context: RouteContext<"/api/occurrences/[occurrenceId]/complete">,
) {
  try {
    const [{ occurrenceId }, body, { user }] = await Promise.all([
      context.params,
      request.json().then((value) => bodySchema.parse(value)),
      requireCurrentUser(),
    ]);
    const result = await completeOccurrence({
      occurrenceId,
      actorId: user.$id,
      idempotencyKey: body.idempotencyKey,
      outcome: "completed",
      note: body.note,
      occurredAt: new Date().toISOString(),
    });

    return Response.json({
      kind: result.kind,
      occurrence: {
        id: result.occurrence.$id,
        status: result.occurrence.status,
        completedBy: result.occurrence.completedBy,
        completedAt: result.occurrence.completedAt,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ message: "The completion request is invalid." }, { status: 400 });
    }
    if (error instanceof AppwriteException && error.code === 401) {
      return Response.json({ message: "Sign in to record this outcome." }, { status: 401 });
    }
    if (error instanceof CompletionForbiddenError) {
      return Response.json({ message: error.message }, { status: 403 });
    }
    if (error instanceof CompletionInputConflictError) {
      return Response.json({ message: error.message }, { status: 409 });
    }

    console.error("Unable to complete occurrence", error);
    return Response.json({ message: "The outcome could not be recorded. Please try again." }, { status: 500 });
  }
}
