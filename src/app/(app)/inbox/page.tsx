import { PageHeader } from "@/components/page-header";
import { getPrisma } from "@/db/client";
import type { Prisma } from "@/db/generated/client";
import { Composer } from "./composer";
import { CaptureCard } from "./review";
import type { CaptureView, InboxOptions, OperationView, ProposalView } from "./types";

type ProposalRow = Prisma.ProposalGetPayload<{
  include: { operations: { include: { fieldEvidence: true } }; actionLog: true };
}>;

function toProposalView(p: ProposalRow): ProposalView {
  const ops = [...p.operations].sort((a, b) => a.sequence - b.sequence);
  const indexById = new Map(ops.map((o, i) => [o.operationId, i]));
  const operations: OperationView[] = ops.map((o) => ({
    operationId: o.operationId,
    sequence: o.sequence,
    op: o.op,
    entityType: o.entityType,
    after: (o.after ?? {}) as Record<string, unknown>,
    reason: o.reason,
    dependsOn: o.dependsOnOperationIds.map((id) => indexById.get(id)).filter((i): i is number => i !== undefined),
    evidence: o.fieldEvidence.map((e) => ({
      fieldPath: e.fieldPath,
      literalText: e.literalText,
      confidence: e.confidence,
    })),
  }));
  return { id: p.id, status: p.status, conflictDetails: p.conflictDetails, operations };
}

export default async function InboxPage() {
  const db = getPrisma();
  const [captures, projects, people, settings] = await Promise.all([
    db.capture.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: {
        notes: { select: { id: true } },
        proposals: {
          include: { operations: { include: { fieldEvidence: true } }, actionLog: true },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    db.project.findMany({
      where: { kind: "project", status: "active", archivedAt: null },
      orderBy: { name: "asc" },
    }),
    db.person.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } }),
    db.userSettings.findFirst(),
  ]);

  // Undo proposals reference actions; find any awaiting review per action.
  const actionIds = captures.flatMap((c) => c.proposals.map((p) => p.actionLog?.id)).filter((id): id is string => !!id);
  const undoProposals = actionIds.length
    ? await db.proposal.findMany({
        where: { undoesActionId: { in: actionIds }, status: { in: ["pending", "conflicted"] } },
        include: { operations: { include: { fieldEvidence: true } }, actionLog: true },
      })
    : [];
  const undoByAction = new Map(undoProposals.map((u) => [u.undoesActionId!, u]));

  const views: CaptureView[] = captures.map((c) => {
    const review = c.proposals.find((p) => ["pending", "approved", "conflicted", "failed"].includes(p.status)) ?? null;
    const appliedProposal = c.proposals.find((p) => p.status === "applied" || p.status === "reverted") ?? null;
    const applied =
      appliedProposal && appliedProposal.actionLog
        ? {
            proposalId: appliedProposal.id,
            actionId: appliedProposal.actionLog.id,
            itemCount: appliedProposal.operations.length,
            reverted: appliedProposal.status === "reverted",
          }
        : null;
    const undo = applied ? undoByAction.get(applied.actionId) ?? null : null;
    return {
      id: c.id,
      status: c.processingStatus,
      createdAt: c.createdAt.toISOString(),
      sourceExpired: c.rawText === null && c.redactedText === null && c.rawDeleteAfter !== null,
      rawText: c.rawText,
      redactedText: c.redactedText,
      noteId: c.notes[0]?.id ?? null,
      review: review ? toProposalView(review) : null,
      applied,
      undo: undo ? toProposalView(undo) : null,
    };
  });

  const options: InboxOptions = {
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    people: people.map((p) => ({ id: p.id, name: p.name })),
    timezone: settings?.currentTimezone ?? "America/New_York",
  };

  const awaiting = views.filter((v) => v.review || v.undo || ["received", "redacted"].includes(v.status));
  const settled = views.filter((v) => !awaiting.includes(v));

  return (
    <>
      <PageHeader title="Inbox" note="Throw anything in. Nothing is saved until you say so." />
      <Composer />
      {awaiting.length > 0 ? (
        <section className="mt-8">
          <h2 className="label mb-2 uppercase">Waiting for you</h2>
          <div className="flex flex-col gap-4">
            {awaiting.map((c) => (
              <CaptureCard key={c.id} capture={c} options={options} />
            ))}
          </div>
        </section>
      ) : null}
      {settled.length > 0 ? (
        <section className="mt-8">
          <h2 className="label mb-2 uppercase">Recent</h2>
          <div className="flex flex-col gap-3">
            {settled.map((c) => (
              <CaptureCard key={c.id} capture={c} options={options} />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
