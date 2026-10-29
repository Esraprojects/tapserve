export const PERMISSIONS = [
  "settings.manage",
  "staff.manage",
  "roles.manage",
  "branches.manage",
  "menu.manage",
  "order.create",
  "order.void",
  "order.discount",
  "payment.record",
  "payment.refund",
  "shift.manage",
  "inventory.manage",
  "expenses.manage",
  "reports.view",
  "reports.profit.view",
  "hotel.frontdesk",
  "hotel.housekeeping",
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLES = [
  "Owner",
  "Manager",
  "Cashier",
  "Waiter",
  "Kitchen",
  "Receptionist",
  "Housekeeping",
  "Storekeeper",
  "Accountant",
] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** Defaults given to every new business; the Owner can edit all roles except Owner. */
export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, readonly Permission[]> = {
  Owner: PERMISSIONS,
  Manager: PERMISSIONS.filter((p) => p !== "roles.manage" && p !== "settings.manage"),
  Cashier: ["order.create", "order.discount", "payment.record", "shift.manage"],
  Waiter: ["order.create"],
  Kitchen: [],
  Receptionist: ["hotel.frontdesk", "payment.record"],
  Housekeeping: ["hotel.housekeeping"],
  Storekeeper: ["inventory.manage"],
  Accountant: ["reports.view", "reports.profit.view", "expenses.manage", "audit.view"],
};

export function hasPermission(granted: readonly string[], needed: Permission): boolean {
  return granted.includes(needed);
}
