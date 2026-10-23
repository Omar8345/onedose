import "server-only";

import { createHash } from "node:crypto";

import { AppwriteException, MessagingProviderType } from "node-appwrite";

import { getServerAppwrite } from "@/lib/appwrite/server";

function emailTargetId(userId: string) {
  const userHash = createHash("sha256").update(userId).digest("hex").slice(0, 22);
  return `onedose_email_${userHash}`;
}

export async function ensureEmailTarget(userId: string, email: string) {
  const { users } = getServerAppwrite();
  const normalizedEmail = email.trim().toLowerCase();
  const targetId = emailTargetId(userId);
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
      targetId,
      providerType: MessagingProviderType.Email,
      identifier: normalizedEmail,
      name: "OneDose email",
    });
  } catch (error) {
    // Concurrent verification requests can both observe a missing target.
    if (error instanceof AppwriteException && error.code === 409) {
      await users.updateTarget({
        userId,
        targetId,
        identifier: normalizedEmail,
        name: "OneDose email",
      });
      return;
    }
    throw error;
  }
}
