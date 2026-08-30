"use client";

import { useState } from "react";
import { TaskForm } from "./task-form";
import type { SelectOption } from "./types";

export function TaskComposer({
  projects,
  people,
}: {
  projects: SelectOption[];
  people: SelectOption[];
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost w-full justify-start text-ink-soft">
        + Add a task
      </button>
    );
  }
  return (
    <TaskForm
      projects={projects}
      people={people}
      onDone={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    />
  );
}
