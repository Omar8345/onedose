import "server-only";
import { AppwriteException } from "node-appwrite";

// Only an already-invalid session is equivalent to successful revocation.
// Connectivity/provider errors must leave the cookie available for a retry.
export async function revokeCurrentSession(account: { deleteSession: (params: { sessionId: string }) => Promise<unknown> }) {
  try {
    await account.deleteSession({ sessionId: "current" });
  } catch (error) {
    if (!(error instanceof AppwriteException && error.code === 401)) throw error;
  }
}
