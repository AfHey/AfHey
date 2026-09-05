import type { SelectOption } from "../tasks/types";

export interface EvidenceView {
  fieldPath: string;
  literalText: string | null;
  confidence: string;
}

export interface OperationView {
  operationId: string;
  sequence: number;
  op: string;
  entityType: "task" | "event" | "note" | "person" | "project";
  after: Record<string, unknown>;
  reason: string | null;
  dependsOn: number[];
  evidence: EvidenceView[];
}

export interface ProposalView {
  id: string;
  status: string;
  conflictDetails: unknown;
  operations: OperationView[];
}

export interface CaptureView {
  id: string;
  status: string;
  createdAt: string;
  sourceExpired: boolean;
  rawText: string | null;
  redactedText: string | null;
  noteId: string | null;
  /** The live review proposal (pending/approved/conflicted/failed). */
  review: ProposalView | null;
  /** The applied proposal's action, when the batch has been applied. */
  applied: { proposalId: string; actionId: string; itemCount: number; reverted: boolean } | null;
  /** A pending or conflicted undo proposal awaiting the user. */
  undo: ProposalView | null;
}

export interface InboxOptions {
  projects: SelectOption[];
  people: SelectOption[];
  timezone: string;
}
