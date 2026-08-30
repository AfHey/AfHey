/** Draft/structure problems found while building or validating a Proposal. */
export class ProposalValidationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Proposal is invalid: ${problems.join("; ")}`);
    this.name = "ProposalValidationError";
    this.problems = problems;
  }
}

export interface ConflictDetail {
  operationId?: string;
  entityType?: string;
  entityId?: string;
  reason: string;
  expectedRevision?: number;
  actualRevision?: number | null;
}

/**
 * A precondition failed at apply time (stale revision, acquired dependents,
 * violated business rule). The apply transaction rolls back and the Proposal
 * becomes `conflicted` with these reviewable details (spec §11.2 rule 4).
 */
export class ProposalConflictError extends Error {
  readonly details: ConflictDetail[];

  constructor(details: ConflictDetail[]) {
    super(`Proposal conflicted: ${details.map((d) => d.reason).join("; ")}`);
    this.name = "ProposalConflictError";
    this.details = details;
  }
}

/** Illegal lifecycle transition (apply without approval, approve applied, …). */
export class ProposalStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProposalStateError";
  }
}
