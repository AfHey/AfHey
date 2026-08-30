"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiSend } from "@/lib/api";

interface PersonDto {
  id: string;
  name: string;
  role: string | null;
  notes: string | null;
  aliases: Array<{ id: string; alias: string }>;
  waitingCount: number;
}

export function PersonComposer() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [aliases, setAliases] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openFresh() {
    setName("");
    setRole("");
    setAliases("");
    setError(null);
    setOpen(true);
  }

  if (!open) {
    return (
      <button type="button" onClick={openFresh} className="btn-ghost w-full justify-start text-ink-soft">
        + Add a person
      </button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/people", "POST", {
        name,
        role: role.trim() || null,
        aliases: aliases
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
      });
      setOpen(false);
      setName("");
      setRole("");
      setAliases("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Role or relationship</span>
          <input value={role} onChange={(e) => setRole(e.target.value)} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Aliases (comma-separated)</span>
          <input value={aliases} onChange={(e) => setAliases(e.target.value)} className="input" />
        </label>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary">
          Add person
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function PersonItem({ person }: { person: PersonDto }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person.name);
  const [role, setRole] = useState(person.role ?? "");
  const [newAlias, setNewAlias] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-2.5">
      <div className="group flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm">
            {person.name}
            {person.role ? <span className="text-ink-soft"> · {person.role}</span> : null}
          </p>
          <p className="flex flex-wrap items-center gap-1.5 pt-1 text-xs text-ink-soft">
            {person.aliases.map((a) => (
              <span key={a.id} className="rounded-full border border-line px-2 py-0.5">
                {a.alias}
              </span>
            ))}
            <input
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newAlias.trim()) {
                  e.preventDefault();
                  run(
                    () => apiSend(`/api/people/${person.id}/aliases`, "POST", { alias: newAlias }),
                    () => setNewAlias(""),
                  );
                }
              }}
              placeholder="+ alias ⏎"
              className="w-20 rounded-full border border-dashed border-line bg-transparent px-2 py-0.5 outline-none focus:border-brass"
            />
            {person.waitingCount > 0 ? (
              <span className="text-brass">owes you {person.waitingCount}</span>
            ) : null}
          </p>
        </div>
        <div className="flex gap-1 opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:focus-within:opacity-100">
          <button type="button" onClick={() => setEditing((v) => !v)} className="btn-quiet">
            Edit
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => apiSend(`/api/people/${person.id}`, "DELETE"))}
            className="btn-quiet"
          >
            Archive
          </button>
        </div>
      </div>
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                apiSend(`/api/people/${person.id}`, "PATCH", {
                  name,
                  role: role.trim() || null,
                }),
              () => setEditing(false),
            );
          }}
          className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4"
        >
          <label className="flex flex-col gap-1">
            <span className="label">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required className="input" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label">Role</span>
            <input value={role} onChange={(e) => setRole(e.target.value)} className="input" />
          </label>
          <button type="submit" disabled={busy} className="btn-primary">
            Save changes
          </button>
          <button type="button" onClick={() => setEditing(false)} className="btn-ghost">
            Cancel
          </button>
        </form>
      ) : null}
    </li>
  );
}
