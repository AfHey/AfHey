import type { UserPriority } from "@/core/domain/enums";

/**
 * The signature "priority gauge": a small vertical brass tick whose height
 * encodes effective priority. Information, not ornament — brass is reserved
 * for must, quieter metal for the rest.
 */
export function PriorityTick({ priority }: { priority: UserPriority }) {
  const style = {
    must: "h-4 bg-brass",
    should: "h-2.5 bg-brass/60",
    could: "h-1.5 bg-ink-soft/40",
  }[priority];
  return (
    <span className="flex h-4 w-[3px] flex-col justify-end" title={`Priority: ${priority}`}>
      <span className={`w-full rounded-full ${style}`} />
      <span className="sr-only">{`Priority ${priority}`}</span>
    </span>
  );
}
