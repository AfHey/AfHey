"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiSend } from "@/lib/api";
import { TimezoneSelect } from "../tasks/task-form";

export function SettingsForm({ currentTimezone }: { currentTimezone: string }) {
  const router = useRouter();
  const [timezone, setTimezone] = useState(currentTimezone);
  const [state, setState] = useState<"idle" | "busy" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setError(null);
    try {
      await apiSend("/api/settings", "PATCH", { currentTimezone: timezone });
      setState("saved");
      router.refresh();
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <div className="min-w-56">
        <TimezoneSelect label="Current timezone" value={timezone} onChange={setTimezone} />
      </div>
      <button type="submit" disabled={state === "busy"} className="btn-primary">
        Save timezone
      </button>
      {state === "saved" ? <span className="text-sm text-ink-soft">Saved</span> : null}
      {error ? <span className="text-sm text-danger">{error}</span> : null}
    </form>
  );
}

interface GlossaryDto {
  id: string;
  term: string;
  expandsTo: string;
  entityType: string | null;
  entityId: string | null;
}

interface EntityOption {
  value: string;
  label: string;
}

function GlossaryForm({
  entry,
  entityOptions,
  onDone,
  onCancel,
}: {
  entry?: GlossaryDto;
  entityOptions: EntityOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [term, setTerm] = useState(entry?.term ?? "");
  const [expandsTo, setExpandsTo] = useState(entry?.expandsTo ?? "");
  const [entity, setEntity] = useState(
    entry?.entityType && entry.entityId ? `${entry.entityType}:${entry.entityId}` : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const [entityType, entityId] = entity ? entity.split(":") : [null, null];
      const payload = { term, expandsTo, entityType, entityId };
      if (entry) await apiSend(`/api/glossary/${entry.id}`, "PATCH", payload);
      else await apiSend("/api/glossary", "POST", payload);
      router.refresh();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
      <label className="flex flex-col gap-1">
        <span className="label">Term</span>
        <input value={term} onChange={(e) => setTerm(e.target.value)} required className="input" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">Expands to</span>
        <input
          value={expandsTo}
          onChange={(e) => setExpandsTo(e.target.value)}
          required
          className="input"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">Links to</span>
        <select value={entity} onChange={(e) => setEntity(e.target.value)} className="input">
          <option value="">Nothing</option>
          {entityOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={busy} className="btn-primary">
        {entry ? "Save changes" : "Add term"}
      </button>
      <button type="button" onClick={onCancel} className="btn-ghost">
        Cancel
      </button>
      {error ? <p className="w-full text-sm text-danger">{error}</p> : null}
    </form>
  );
}

export function GlossarySection({
  entries,
  entityOptions,
}: {
  entries: GlossaryDto[];
  entityOptions: EntityOption[];
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function archive(id: string) {
    setError(null);
    try {
      await apiSend(`/api/glossary/${id}`, "DELETE");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {adding ? (
        <GlossaryForm
          entityOptions={entityOptions}
          onDone={() => setAdding(false)}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="btn-ghost w-full justify-start text-ink-soft">
          + Add a shorthand term
        </button>
      )}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <ul className="divide-y divide-line border-y border-line">
        {entries.length === 0 ? (
          <li className="py-2.5 text-sm text-ink-soft">
            No terms yet — add the abbreviations you actually type.
          </li>
        ) : (
          entries.map((g) => (
            <li key={g.id} className="py-2.5">
              <div className="group flex items-center gap-3">
                <p className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{g.term}</span>
                  <span className="text-ink-soft"> → {g.expandsTo}</span>
                </p>
                <div className="flex gap-1 opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => setEditingId(editingId === g.id ? null : g.id)}
                    className="btn-quiet"
                  >
                    Edit
                  </button>
                  <button type="button" onClick={() => archive(g.id)} className="btn-quiet">
                    Archive
                  </button>
                </div>
              </div>
              {editingId === g.id ? (
                <div className="mt-3">
                  <GlossaryForm
                    entry={g}
                    entityOptions={entityOptions}
                    onDone={() => setEditingId(null)}
                    onCancel={() => setEditingId(null)}
                  />
                </div>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export function SignOutButton() {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  return (
    <button type="button" onClick={signOut} className="btn-ghost">
      Sign out
    </button>
  );
}
