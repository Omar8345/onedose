import { AppwriteException } from "node-appwrite";

import {
  CaregiverManagementForbiddenError,
  revokeCaregiver,
} from "@/lib/data/manage-caregivers";

export async function DELETE(
  _request: Request,
  context: RouteContext<"/api/circle/caregivers/[membershipId]">,
) {
  try {
    const { membershipId } = await context.params;
    await revokeCaregiver(membershipId);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof CaregiverManagementForbiddenError) {
      return Response.json({ message: error.message }, { status: 403 });
    }
    if (error instanceof AppwriteException && error.code === 401) {
      return Response.json({ message: "Sign in again to manage caregivers." }, { status: 401 });
    }
    console.error("Unable to revoke OneDose caregiver", error);
    return Response.json({ message: "The caregiver could not be revoked." }, { status: 500 });
  }
}
