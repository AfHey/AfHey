"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiSend } from "@/lib/api";
import type { SelectOption } from "../tasks/types";

export function ProjectComposer({ areas }: { areas: SelectOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"project" | "area">("project");
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [importance, setImportance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function openFresh() {
    setKind("project");
    setName("");
    setParentId("");
    setImportance("");
    setError(null);
    setOpen(true);
  }

  if (!open) {
    return (
      <button type="button" onClick={openFresh} className="btn-ghost w-full justify-start text-ink-soft">
        + Add a project or area
      </button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/projects", "POST", {
        kind,
        name,
        parentId: kind === "project" && parentId ? parentId : null,
        importance: importance || null,
      });
      setOpen(false);
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="label">Type</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "project" | "area")}
            className="input"
          >
            <option value="project">Project</option>
            <option value="area">Area</option>
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1 sm:col-span-1">
          <span className="label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required className="input" />
        </label>
        {kind === "project" ? (
          <label className="flex flex-col gap-1">
            <span className="label">Area</span>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input">
              <option value="">None</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {kind === "project" ? (
          <label className="flex flex-col gap-1">
            <span className="label">Importance</span>
            <select value={importance} onChange={(e) => setImportance(e.target.value)} className="input">
              <option value="">Unset</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        ) : null}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary">
          Create
        </button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ProjectEditor({
  project,
  areas,
}: {
  project: {
    id: string;
    name: string;
    parentId: string | null;
    description: string | null;
    importance: string | null;
    status: string;
  };
  areas: SelectOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [parentId, setParentId] = useState(project.parentId ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [importance, setImportance] = useState(project.importance ?? "");
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

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setEditing(true)} className="btn-ghost">
          Edit
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(() => apiSend(`/api/projects/${project.id}`, "DELETE"), () =>
              router.push("/projects"),
            )
          }
          className="btn-ghost"
        >
          Archive
        </button>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            apiSend(`/api/projects/${project.id}`, "PATCH", {
              name,
              parentId: parentId || null,
              description: description.trim() || null,
              importance: importance || null,
            }),
          () => setEditing(false),
        );
      }}
      className="flex w-full flex-col gap-3 rounded-xl border border-line bg-surface p-4"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Area</span>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input">
            <option value="">None</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Importance</span>
          <select value={importance} onChange={(e) => setImportance(e.target.value)} className="input">
            <option value="">Unset</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="label">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="input resize-y"
        />
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary">
          Save changes
        </button>
        <button type="button" onClick={() => setEditing(false)} className="btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}
