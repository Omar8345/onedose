import { z } from "zod";

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
  context: RouteContext<"/api/demo/occurrences/[occurrenceId]/complete">,
) {
  try {
    const { occurrenceId } = await context.params;
    const body = bodySchema.parse(await request.json());
    const result = await completeOccurrence({
      occurrenceId,
      actorId: "demo_omar",
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
    if (error instanceof CompletionForbiddenError) {
      return Response.json({ message: error.message }, { status: 403 });
    }
    if (error instanceof CompletionInputConflictError) {
      return Response.json({ message: error.message }, { status: 409 });
    }

    console.error("Unable to complete demo occurrence", error);
    return Response.json({ message: "The outcome could not be recorded. Please try again." }, { status: 500 });
  }
}
