"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiSend } from "@/lib/api";
import type { SelectOption } from "../tasks/types";

interface NoteDto {
  id: string;
  title: string | null;
  body: string;
  projectId: string | null;
  projectName: string | null;
}

function NoteForm({
  note,
  projects,
  onDone,
  onCancel,
}: {
  note?: NoteDto;
  projects: SelectOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [projectId, setProjectId] = useState(note?.projectId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = { title: title.trim() || null, body, projectId: projectId || null };
      if (note) await apiSend(`/api/notes/${note.id}`, "PATCH", payload);
      else await apiSend("/api/notes", "POST", payload);
      router.refresh();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="label">Title (optional)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label">Project</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="input">
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="label">Note</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          required
          className="input resize-y"
        />
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary">
          {note ? "Save changes" : "Keep note"}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function NoteComposer({ projects }: { projects: SelectOption[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost w-full justify-start text-ink-soft">
        + Keep a note
      </button>
    );
  }
  return <NoteForm projects={projects} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />;
}

export function NoteItem({ note, projects }: { note: NoteDto; projects: SelectOption[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    setError(null);
    try {
      await apiSend(`/api/notes/${note.id}`, "DELETE");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <li className="py-2.5">
      <div className="group flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {note.title ? <p className="text-sm font-medium">{note.title}</p> : null}
          <p className="text-sm whitespace-pre-wrap text-ink-soft">{note.body}</p>
          {note.projectName ? (
            <p className="mt-0.5 text-xs text-ink-soft">{note.projectName}</p>
          ) : null}
        </div>
        <div className="flex gap-1 opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:focus-within:opacity-100">
          <button type="button" onClick={() => setEditing((v) => !v)} className="btn-quiet">
            Edit
          </button>
          <button type="button" onClick={archive} className="btn-quiet">
            Archive
          </button>
        </div>
      </div>
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      {editing ? (
        <div className="mt-3">
          <NoteForm
            note={note}
            projects={projects}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : null}
    </li>
  );
}
