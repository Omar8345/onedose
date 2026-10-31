import { connection } from "next/server";
import { AppwriteException } from "node-appwrite";
import { requireCurrentUser } from "@/lib/auth/session";
import { assertCareCircleAccess, CareCircleAccessError, getCareCircle } from "@/lib/data/get-care-circle";
import { ensureTodayOccurrences } from "@/lib/data/ensure-occurrences";
import { snapshotResponse } from "@/lib/data/snapshot-response";
export async function GET() {
  await connection();
  return snapshotResponse(async()=>{
    const {user,secret}=await requireCurrentUser();
    if(!secret) throw new AppwriteException("Authentication required",401);
    if(!user.prefs.circleId) throw new CareCircleAccessError();
    const viewer={id:user.$id,name:user.name||"Caregiver",email:user.email};
    await assertCareCircleAccess(user.prefs.circleId,user.$id,secret);
    await ensureTodayOccurrences(user.prefs.circleId);
    return {circle:await getCareCircle(user.prefs.circleId,viewer),viewerId:user.$id};
  });
}
