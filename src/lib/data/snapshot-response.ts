import { AppwriteException } from "node-appwrite";
import { CareCircleAccessError } from "@/lib/data/get-care-circle";
import type { CareCircle } from "@/lib/types";
export async function snapshotResponse(load:()=>Promise<{circle:CareCircle;viewerId:string}>) {
  const headers={"Cache-Control":"private, no-store"};
  try { return Response.json(await load(),{headers}); }
  catch(error) {
    if(error instanceof AppwriteException && error.code===401) return Response.json({message:"Sign in again."},{status:401,headers});
    if(error instanceof CareCircleAccessError) return Response.json({message:"Care circle access changed."},{status:403,headers});
    const cause=(error as {cause?:{code?:string}})?.cause;
    console.error("Circle snapshot unavailable",{name:error instanceof Error?error.name:"Error",status:error instanceof AppwriteException?error.code:undefined,networkCode:cause?.code});
    return Response.json({message:"Cannot refresh right now. Showing your last confirmed data."},{status:503,headers});
  }
}
