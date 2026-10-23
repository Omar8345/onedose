import type { MemberRow } from "@/lib/domain/schema";

export type TeamMembershipForPolicy = {
  userId: string;
  roles: string[];
  confirm: boolean;
};

export function canRevokeMembership(
  owner: MemberRow,
  target: TeamMembershipForPolicy,
  ownerId: string,
) {
  return owner.userId === ownerId
    && owner.role === "owner"
    && owner.status === "active"
    && target.userId !== ownerId
    && !target.roles.includes("owner");
}

export function canReadOrRecordCircle(member: Pick<MemberRow, "userId" | "status" | "role">, userId: string) {
  return member.userId === userId && member.status === "active" && member.role !== "viewer";
}
