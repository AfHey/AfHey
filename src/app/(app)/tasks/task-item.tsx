"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PriorityTick } from "@/components/priority-tick";
import { apiSend } from "@/lib/api";
import { TaskForm } from "./task-form";
import type { SelectOption, TaskDto } from "./types";

const KIND_BADGE: Record<string, string | null> = {
  action: null,
  waiting_for: "Waiting",
  reminder: "Reminder",
};

export function TaskItem({
  task,
  projects,
  people,
}: {
  task: TaskDto;
  projects: SelectOption[];
  people: SelectOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const badge = KIND_BADGE[task.taskKind];

  return (
    <li className="py-2.5">
      <div className="group flex items-start gap-3">
        <span className="mt-1.5">
          <PriorityTick priority={task.effectivePriority} />
        </span>
        <input
          type="checkbox"
          checked={task.completed}
          aria-label={task.completed ? `Reopen "${task.title}"` : `Complete "${task.title}"`}
          onChange={(e) =>
            run(() =>
              apiSend(`/api/tasks/${task.id}/complete`, "POST", {
                completed: e.target.checked,
              }),
            )
          }
          className="mt-1 h-4 w-4 accent-[var(--brass)]"
        />
        <div className="min-w-0 flex-1">
          <p
            className={`text-sm leading-6 ${
              task.completed ? "text-ink-soft line-through" : ""
            }`}
          >
            {task.title}
          </p>
          <p className="flex flex-wrap gap-x-3 text-xs text-ink-soft">
            {badge ? <span className="text-brass">{badge}</span> : null}
            {task.waitingForPersonName ? <span>{task.waitingForPersonName}</span> : null}
            {task.projectName ? <span>{task.projectName}</span> : null}
            {task.deadlineLabel ? (
              <span className={task.overdue ? "font-medium text-danger" : ""}>
                {task.overdue ? "Overdue · " : "Due "}
                {task.deadlineLabel}
              </span>
            ) : null}
            {task.remainingEstimateMinutes ? (
              <span>{task.remainingEstimateMinutes} min left</span>
            ) : null}
          </p>
        </div>
        <div className="flex gap-1 opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:focus-within:opacity-100">
          <button type="button" onClick={() => setEditing((v) => !v)} className="btn-quiet">
            Edit
          </button>
          <button
            type="button"
            onClick={() => run(() => apiSend(`/api/tasks/${task.id}`, "DELETE"))}
            className="btn-quiet"
          >
            Archive
          </button>
        </div>
      </div>
      {error ? <p className="mt-1 pl-10 text-xs text-danger">{error}</p> : null}
      {editing ? (
        <div className="mt-3 pl-10">
          <TaskForm
            task={task}
            projects={projects}
            people={people}
            onDone={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : null}
    </li>
  );
}
