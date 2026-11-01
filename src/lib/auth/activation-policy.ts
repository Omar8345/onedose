export const CAREGIVER_RECOVERY_MESSAGE = "Your care-circle access was revoked. Ask the owner or administrator to restore it. A new invitation alone cannot restore access.";

export class InvitationRecoveryRequiredError extends Error {
  constructor() { super(CAREGIVER_RECOVERY_MESSAGE); this.name = "InvitationRecoveryRequiredError"; }
}

export class InvitationActivationUnavailableError extends Error {
  constructor() {
    super("Your invitation could not be activated. Check that you signed in with the invited account, or ask the circle owner for help.");
    this.name = "InvitationActivationUnavailableError";
  }
}

export function requireActiveMembershipForActivation(member: { circleId: string; userId: string; status: string }, circleId: string, userId: string) {
  if (member.circleId !== circleId || member.userId !== userId) throw new InvitationActivationUnavailableError();
  if (member.status !== "active") throw new InvitationRecoveryRequiredError();
}
