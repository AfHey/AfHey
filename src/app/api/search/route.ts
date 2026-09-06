import { DateTime } from "luxon";
import { z } from "zod";
import { withAuth } from "@/app/api/helpers";
import { searchRecords, SEARCH_TYPES } from "@/core/search/search";
import { getPrisma } from "@/db/client";

const querySchema = z.object({
  q: z.string().max(200).default(""),
  type: z.array(z.enum(SEARCH_TYPES)).default([]),
  project: z.uuid().optional(),
  status: z.enum(["open", "completed", "cancelled"]).optional(),
  bucket: z.enum(["active", "backlog", "someday"]).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

export function parseSearchParams(params: URLSearchParams) {
  return querySchema.parse({
    q: params.get("q") ?? "",
    type: params.getAll("type").flatMap((t) => t.split(",")).filter(Boolean),
    project: params.get("project") || undefined,
    status: params.get("status") || undefined,
    bucket: params.get("bucket") || undefined,
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
  });
}

/** GET /api/search?q=…&type=task&type=note&project=…&status=…&bucket=…&from=…&to=… */
export const GET = withAuth(async (request) => {
  const db = getPrisma();
  const p = parseSearchParams(new URL(request.url).searchParams);
  const zone = (await db.userSettings.findFirst())?.currentTimezone ?? "America/New_York";
  const due = p.from && p.to ? { start: p.from, end: p.to } : p.from ? { start: p.from, end: p.from } : undefined;
  const result = await searchRecords(db, { q: p.q, types: p.type, projectId: p.project, status: p.status, bucket: p.bucket, due }, { now: DateTime.now(), zone });
  return Response.json(result);
});
