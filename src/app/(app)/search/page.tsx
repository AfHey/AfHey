import { DateTime } from "luxon";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-header";
import { parseSearchParams } from "@/app/api/search/route";
import { MARK_END, MARK_START, searchRecords, SEARCH_TYPES, type SearchHit, type SearchType } from "@/core/search/search";
import { getPrisma } from "@/db/client";
import { formatDateOnly, formatInstant } from "@/lib/format";

/**
 * Search (spec §10.7, §10.8.6; Phase 2 Step 10): keywords over Tasks,
 * Projects, Notes, and Events with filters, and date phrases resolved by the
 * deterministic temporal resolver. A plain GET form: shareable URL, no JS.
 */
const TYPE_LABEL: Record<SearchType, string> = { task: "Task", project: "Project", note: "Note", event: "Event" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) for (const value of Array.isArray(v) ? v : v ? [v] : []) params.append(k, value);
  const p = parseSearchParams(params);
  const db = getPrisma();
  const zone = (await db.userSettings.findFirst())?.currentTimezone ?? "America/New_York";
  const projects = await db.project.findMany({ where: { archivedAt: null }, orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true } });
  const asked = p.q.trim().length > 0 || !!p.project || !!p.status || !!p.bucket || !!p.from;
  const due = p.from && p.to ? { start: p.from, end: p.to } : p.from ? { start: p.from, end: p.from } : undefined;
  const result = asked
    ? await searchRecords(db, { q: p.q, types: p.type, projectId: p.project, status: p.status, bucket: p.bucket, due }, { now: DateTime.now(), zone })
    : null;

  return (
    <>
      <PageHeader title="Search" note="Keywords across tasks, projects, notes, and events. Date phrases like “due Friday” become a due window." />
      <form role="search" action="/search" method="get" className="space-y-3 rounded-xl border border-line bg-surface p-4 text-sm">
        <input type="search" name="q" aria-label="Search" placeholder="e.g. ledger, things due Friday" defaultValue={p.q} autoComplete="off" className="field w-full" />
        <div className="flex flex-wrap items-center gap-3">
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">Types</legend>
            {SEARCH_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-1">
                <input type="checkbox" name="type" value={t} defaultChecked={p.type.includes(t)} className="accent-[var(--brass)]" /> {TYPE_LABEL[t]}s
              </label>
            ))}
          </fieldset>
          <select name="project" aria-label="Project" defaultValue={p.project ?? ""} className="field w-auto">
            <option value="">Any project</option>
            {projects.map((pr) => (
              <option key={pr.id} value={pr.id}>{pr.kind === "area" ? `${pr.name} (area)` : pr.name}</option>
            ))}
          </select>
          <select name="status" aria-label="Task status" defaultValue={p.status ?? ""} className="field w-auto">
            <option value="">Any status</option>
            <option value="open">Open</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select name="bucket" aria-label="Task bucket" defaultValue={p.bucket ?? ""} className="field w-auto">
            <option value="">Any bucket</option>
            <option value="active">Active</option>
            <option value="backlog">Backlog</option>
            <option value="someday">Someday</option>
          </select>
          <label className="flex items-center gap-1">Due from <input type="date" name="from" aria-label="Due from" defaultValue={p.from ?? ""} className="field w-auto" /></label>
          <label className="flex items-center gap-1">to <input type="date" name="to" aria-label="Due to" defaultValue={p.to ?? ""} className="field w-auto" /></label>
          <button type="submit" className="btn-primary">Search</button>
        </div>
      </form>

      {result ? (
        <section aria-label="Results" className="mt-6">
          <p className="mb-2 text-sm text-ink-soft" role="status">
            {result.hits.length === 0 ? "No matches." : `${result.hits.length} match${result.hits.length === 1 ? "" : "es"}`}
            {result.due ? ` · due ${result.due.start === result.due.end ? formatDateOnly(new Date(`${result.due.start}T00:00:00Z`)) : `${result.due.start} to ${result.due.end}`}` : ""}
            {result.parsed.phrase && !due ? ` (from “${result.parsed.phrase}”)` : ""}
            {result.parsed.note ? ` ${result.parsed.note}` : ""}
          </p>
          {result.hits.length === 0 ? <EmptyState line="Nothing matched." hint="Try fewer words, or a date phrase such as “due Friday”." /> : (
            <ul className="divide-y divide-line border-y border-line">
              {result.hits.map((h) => (
                <li key={`${h.type}-${h.id}`} className="py-2 text-sm">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="label uppercase">{TYPE_LABEL[h.type]}</span>
                    <Link href={hrefFor(h, zone)} className="font-medium underline-offset-2 hover:underline">{h.title}</Link>
                    {whenLabel(h, zone) ? <span className="text-ink-soft">{whenLabel(h, zone)}</span> : null}
                    {h.status && h.type === "task" ? <span className="text-ink-soft">· {h.status}{h.bucket ? ` · ${h.bucket}` : ""}</span> : null}
                  </div>
                  {h.snippet ? <p className="text-ink-soft">{renderSnippet(h.snippet)}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}

function whenLabel(h: SearchHit, zone: string): string | null {
  if (!h.when) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(h.when)) return formatDateOnly(new Date(`${h.when}T00:00:00Z`));
  return formatInstant(new Date(h.when), zone);
}

function hrefFor(h: SearchHit, zone: string): string {
  switch (h.type) {
    case "task":
      return "/tasks";
    case "project":
      return "/projects";
    case "note":
      return "/notes";
    case "event": {
      const day = h.when ? (/^\d{4}-\d{2}-\d{2}$/.test(h.when) ? h.when : DateTime.fromISO(h.when).setZone(zone).toISODate()) : null;
      return day ? `/calendar?date=${day}&view=day` : "/events";
    }
  }
}

/** Highlights come back as control-character markers, never as HTML. */
function renderSnippet(snippet: string): React.ReactNode[] {
  return snippet.split(MARK_START).flatMap((part, i) => {
    if (i === 0) return [part];
    const [hit, rest] = part.split(MARK_END);
    return [<mark key={i} className="rounded bg-brass-soft px-0.5 text-ink">{hit}</mark>, rest ?? ""];
  });
}
