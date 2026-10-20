import { createHash } from "node:crypto";

export function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableRowId(prefix: string, value: string) {
  return `${prefix}_${stableHash(value).slice(0, 30)}`;
}
