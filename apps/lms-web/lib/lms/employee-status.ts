export interface ActiveCheckUser {
  isActiveFlag: boolean | null;
  terminationDate: string | null;
}

/** True iff the employee is currently active.
 *  Rule: is_active_flag must be on AND termination_date (if set) must be today or later. */
export function isEffectivelyActive(u: ActiveCheckUser): boolean {
  if (u.isActiveFlag === false) return false;
  if (u.terminationDate && u.terminationDate < new Date().toISOString().slice(0, 10)) {
    return false;
  }
  return true;
}
