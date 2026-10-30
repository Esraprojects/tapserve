import type { Permission } from "@tapserve/core";

/** Who is acting: the business, the user, and the permissions their role grants. */
export interface Actor {
  tenantId: string;
  userId: string;
  permissions: readonly string[];
}

export class DomainError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
  }
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!actor.permissions.includes(permission)) throw new DomainError("forbidden", `Missing permission ${permission}`);
}

export type Station = "kitchen" | "bar" | "barista";
export const STATIONS: readonly Station[] = ["kitchen", "bar", "barista"];
