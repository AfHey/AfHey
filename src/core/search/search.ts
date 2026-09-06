import { DateTime } from "luxon";
import { Prisma, type PrismaClient } from "@/db/generated/client";
import { parseSearchQuery, type DueWindow, type ParsedSearch } from "./query";

/**
 * Local full-text search over the generated `search_vector` columns
 * (migration 20260905160000; spec §10.7, §10.8.6). Search never leaves the
 * machine, so `ai_excluded` records are searchable like any other; archived
 * rows and work blocks (whose task is the record) are not returned.
 */
export type SearchType = "task" | "project" | "note" | "event";
export const SEARCH_TYPES: SearchType[] = ["task", "project", "note", "event"];

export interface SearchRequest {
  q: string;
  types?: SearchType[];
  projectId?: string;
  status?: "open" | "completed" | "cancelled";
  bucket?: "active" | "backlog" | "someday";
  /** Explicit due window; overrides a date phrase in `q`. */
  due?: DueWindow;
}

export interface SearchHit {
  type: SearchType;
  id: string;
  title: string;
  snippet: string;
  rank: number;
  projectId: string | null;
  status: string | null;
  bucket: string | null;
  /** ISO date or instant the hit is anchored to (deadline, start), if any. */
  when: string | null;
  updatedAt: string;
}

export interface SearchResult {
  hits: SearchHit[];
  parsed: ParsedSearch;
  due: DueWindow | null;
}

interface Row {
  type: SearchType;
  id: string;
  title: string | null;
  snippet: string | null;
  rank: number;
  project_id: string | null;
  status: string | null;
  bucket: string | null;
  when_date: string | null;
  when_at: Date | null;
  updated_at: Date;
}

const LIMIT = 50;
/** Match markers are control characters so callers can render highlights without trusting record text as HTML. */
export const MARK_START = String.fromCharCode(1);
export const MARK_END = String.fromCharCode(2);
const HEADLINE = `MaxFragments=1, MaxWords=18, MinWords=5, StartSel=${MARK_START}, StopSel=${MARK_END}`;

export async function searchRecords(db: PrismaClient, request: SearchRequest, ctx: { now: DateTime; zone: string }): Promise<SearchResult> {
  const parsed = parseSearchQuery(request.q, { now: ctx.now.setZone(ctx.zone) });
  const due = request.due ?? parsed.due;
  const keywords = parsed.keywords;
  const hasKeywords = keywords.length > 0;
  const types = new Set(request.types && request.types.length > 0 ? request.types : SEARCH_TYPES);
  // A due window only makes sense for records that have a date.
  if (due) {
    types.delete("project");
    types.delete("note");
  }
  if (!hasKeywords && !due && !request.projectId && !request.status && !request.bucket) return { hits: [], parsed, due };

  const tsq = Prisma.sql`websearch_to_tsquery('english', ${keywords})`;
  const match = (vector: Prisma.Sql) => (hasKeywords ? Prisma.sql`AND ${vector} @@ ${tsq}` : Prisma.empty);
  const rank = (vector: Prisma.Sql) => (hasKeywords ? Prisma.sql`ts_rank(${vector}, ${tsq})` : Prisma.sql`0::float4`);
  const headline = (text: Prisma.Sql) => (hasKeywords ? Prisma.sql`ts_headline('english', ${text}, ${tsq}, ${HEADLINE})` : Prisma.sql`left(${text}, 160)`);
  const project = request.projectId ? Prisma.sql`AND project_id = ${request.projectId}::uuid` : Prisma.empty;

  let dueStart: Date | null = null;
  let dueEndExclusive: Date | null = null;
  if (due) {
    dueStart = DateTime.fromISO(due.start, { zone: ctx.zone }).startOf("day").toJSDate();
    dueEndExclusive = DateTime.fromISO(due.end, { zone: ctx.zone }).plus({ days: 1 }).startOf("day").toJSDate();
  }

  const queries: Prisma.Sql[] = [];
  if (types.has("task")) {
    const status = request.status ? Prisma.sql`AND status = ${request.status}::"TaskStatus"` : Prisma.empty;
    const bucket = request.bucket ? Prisma.sql`AND bucket = ${request.bucket}::"TaskBucket"` : Prisma.empty;
    const dueClause = due
      ? Prisma.sql`AND ((deadline_date >= ${due.start}::date AND deadline_date <= ${due.end}::date) OR (deadline_at >= ${dueStart} AND deadline_at < ${dueEndExclusive}))`
      : Prisma.empty;
    queries.push(Prisma.sql`
      SELECT 'task' AS type, id::text AS id, title, ${headline(Prisma.sql`coalesce(description, '') || ' ' || coalesce(notes, '')`)} AS snippet,
             ${rank(Prisma.sql`search_vector`)} AS rank, project_id::text AS project_id, status::text AS status, bucket::text AS bucket,
             deadline_date::text AS when_date, deadline_at AS when_at, updated_at
      FROM task WHERE archived_at IS NULL ${match(Prisma.sql`search_vector`)} ${project} ${status} ${bucket} ${dueClause}
      ORDER BY rank DESC, updated_at DESC LIMIT ${LIMIT}`);
  }
  if (types.has("project") && !request.status && !request.bucket) {
    queries.push(Prisma.sql`
      SELECT 'project' AS type, id::text AS id, name AS title, ${headline(Prisma.sql`coalesce(description, '')`)} AS snippet,
             ${rank(Prisma.sql`search_vector`)} AS rank, parent_id::text AS project_id, status::text AS status, NULL::text AS bucket,
             NULL::text AS when_date, NULL::timestamptz AS when_at, updated_at
      FROM project WHERE archived_at IS NULL ${match(Prisma.sql`search_vector`)} ${request.projectId ? Prisma.sql`AND (id = ${request.projectId}::uuid OR parent_id = ${request.projectId}::uuid)` : Prisma.empty}
      ORDER BY rank DESC, updated_at DESC LIMIT ${LIMIT}`);
  }
  if (types.has("note") && !request.status && !request.bucket) {
    queries.push(Prisma.sql`
      SELECT 'note' AS type, id::text AS id, coalesce(title, left(body, 80)) AS title, ${headline(Prisma.sql`body`)} AS snippet,
             ${rank(Prisma.sql`search_vector`)} AS rank, project_id::text AS project_id, NULL::text AS status, NULL::text AS bucket,
             NULL::text AS when_date, NULL::timestamptz AS when_at, updated_at
      FROM note WHERE archived_at IS NULL ${match(Prisma.sql`search_vector`)} ${project}
      ORDER BY rank DESC, updated_at DESC LIMIT ${LIMIT}`);
  }
  if (types.has("event") && !request.status && !request.bucket) {
    const dueClause = due
      ? Prisma.sql`AND ((start_at >= ${dueStart} AND start_at < ${dueEndExclusive}) OR (all_day_start_date <= ${due.end}::date AND all_day_end_date > ${due.start}::date))`
      : Prisma.empty;
    queries.push(Prisma.sql`
      SELECT 'event' AS type, id::text AS id, title, ${headline(Prisma.sql`coalesce(description, '') || ' ' || coalesce(location, '')`)} AS snippet,
             ${rank(Prisma.sql`search_vector`)} AS rank, project_id::text AS project_id, NULL::text AS status, NULL::text AS bucket,
             all_day_start_date::text AS when_date, start_at AS when_at, updated_at
      FROM event WHERE archived_at IS NULL AND kind <> 'block' ${match(Prisma.sql`search_vector`)} ${project} ${dueClause}
      ORDER BY rank DESC, updated_at DESC LIMIT ${LIMIT}`);
  }
  if (queries.length === 0) return { hits: [], parsed, due };

  const rows = await db.$queryRaw<Row[]>(Prisma.sql`${Prisma.join(queries.map((q) => Prisma.sql`(${q})`), " UNION ALL ")}`);
  const hits = rows
    .map<SearchHit>((r) => ({
      type: r.type,
      id: r.id,
      title: r.title ?? "",
      snippet: (r.snippet ?? "").trim(),
      rank: Number(r.rank),
      projectId: r.project_id,
      status: r.status,
      bucket: r.bucket,
      when: r.when_at ? r.when_at.toISOString() : r.when_date,
      updatedAt: r.updated_at.toISOString(),
    }))
    .sort((a, b) => b.rank - a.rank || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, LIMIT);
  return { hits, parsed, due };
}
