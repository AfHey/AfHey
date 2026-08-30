import { EmptyState, PageHeader } from "@/components/page-header";

export default function InboxPage() {
  return (
    <>
      <PageHeader
        title="Inbox"
        note="One place to throw anything in; AfHey sorts out the rest."
      />
      <div className="rounded-xl border border-line bg-surface p-4">
        <textarea
          disabled
          rows={3}
          placeholder="Capture arrives with the extraction step — paste or type anything here soon."
          className="input resize-none opacity-60"
        />
      </div>
      <EmptyState
        line="Nothing captured yet."
        hint="AI extraction, redaction preview, and review land in a later step of Phase 1."
      />
    </>
  );
}
