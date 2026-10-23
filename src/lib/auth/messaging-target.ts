import "server-only";

import { AppwriteException, MessagingProviderType } from "node-appwrite";

import { getServerAppwrite } from "@/lib/appwrite/server";

export async function ensureEmailTarget(userId: string, email: string) {
  const { users } = getServerAppwrite();
  const normalizedEmail = email.trim().toLowerCase();
  const targets = await users.listTargets({ userId });
  const emailTarget = targets.targets.find(
    (target) => target.providerType === MessagingProviderType.Email,
  );

  if (emailTarget) {
    if (emailTarget.identifier.trim().toLowerCase() === normalizedEmail) return;
    await users.updateTarget({
      userId,
      targetId: emailTarget.$id,
      identifier: normalizedEmail,
      name: "OneDose email",
    });
    return;
  }

  try {
    await users.createTarget({
      userId,
      targetId: "onedose_email",
      providerType: MessagingProviderType.Email,
      identifier: normalizedEmail,
      name: "OneDose email",
    });
  } catch (error) {
    // Concurrent verification requests can both observe a missing target.
    if (error instanceof AppwriteException && error.code === 409) {
      await users.updateTarget({
        userId,
        targetId: "onedose_email",
        identifier: normalizedEmail,
        name: "OneDose email",
      });
      return;
    }
    throw error;
  }
}
