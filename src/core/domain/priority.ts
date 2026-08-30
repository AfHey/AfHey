import type { UserPriority } from "./enums";

/**
 * Effective priority (product-spec §8.3): the manual value always wins;
 * otherwise 70-100 = must, 40-69 = should, 0-39 = could. Derived, never
 * stored. AI recalculation may only touch computed_priority_score.
 */
export function effectivePriority(
  userPriority: UserPriority | null,
  computedPriorityScore: number,
): UserPriority {
  if (userPriority !== null) return userPriority;
  if (computedPriorityScore >= 70) return "must";
  if (computedPriorityScore >= 40) return "should";
  return "could";
}
