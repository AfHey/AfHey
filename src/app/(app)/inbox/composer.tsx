"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiSend } from "@/lib/api";

interface Preview {
  payloadText: string;
  redactions: Array<{ type: string; placeholder: string }>;
  mentions: Array<{
    placeholder: string;
    entityType: string;
    candidates: Array<{ id: string; name: string }>;
    confidence: string;
  }>;
}

type SubmitOutcome =
  | { mode: "preview"; capture: { id: string }; preview: Preview }
  | { mode: "no_ai"; capture: { id: string }; note: { id: string } };

type ExtractOutcome =
  | { status: "proposed" | "nothing_actionable"; skipped: Array<{ itemRef: string; reason: string }>; warnings: Array<{ message: string }> }
  | { status: "failed"; reason: string };

/**
 * The universal input (spec §3, §10.3): capture on receipt, show exactly
 * what would leave the machine, let the user edit it (re-guarded server
 * side), then interpret — or keep it private, or throw it away.
 */
export function Composer() {
  const router = useRouter();
  const params = useSearchParams();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [noAi, setNoAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<{ captureId: string; preview: Preview; edited: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (params.get("focus")) textareaRef.current?.focus();
  }, [params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const outcome = await apiSend<SubmitOutcome>("/api/captures", "POST", {
        text,
        sourceType: text.includes("\n") ? "pasted" : "typed",
        noAi,
      });
      if (outcome.mode === "no_ai") {
        setText("");
        setNotice("Kept as a private note. No AI call was made.");
        router.refresh();
      } else {
        setStage({ captureId: outcome.capture.id, preview: outcome.preview, edited: outcome.preview.payloadText });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function interpret() {
    if (!stage) return;
    setBusy(true);
    setError(null);
    try {
      const body = stage.edited !== stage.preview.payloadText ? { editedPayloadText: stage.edited } : {};
      const outcome = await apiSend<ExtractOutcome>(`/api/captures/${stage.captureId}/extract`, "POST", body);
      if (outcome.status === "failed") {
        setError(`Interpretation failed: ${outcome.reason}. The capture is kept; try again or keep it as a note.`);
        return;
      }
      const parts = [
        outcome.status === "nothing_actionable" ? "Nothing actionable was found." : "Review the items below.",
        ...outcome.skipped.map((s) => `Skipped ${s.itemRef}: ${s.reason}.`),
      ];
      setNotice(parts.join(" "));
      setStage(null);
      setText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function keepPrivate() {
    if (!stage) return;
    setBusy(true);
    try {
      await apiSend(`/api/captures/${stage.captureId}/no-ai`, "POST");
      setStage(null);
      setText("");
      setNotice("Kept as a private note. No AI call was made.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    if (!stage) return;
    setBusy(true);
    try {
      await apiSend(`/api/captures/${stage.captureId}/reject`, "POST");
      setStage(null);
      setNotice("Discarded.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (stage) {
    const { preview } = stage;
    return (
      <section className="rounded-xl border border-brass/40 bg-surface p-4" aria-label="Redaction preview">
        <p className="label uppercase">Before anything leaves this machine</p>
        <p className="mt-1 text-sm text-ink-soft">
          This is exactly what the model would receive. Sensitive-looking parts are masked; known people and projects
          are replaced by opaque placeholders. Edit freely — the guard runs again on whatever you send.
        </p>
        <textarea
          value={stage.edited}
          onChange={(e) => setStage({ ...stage, edited: e.target.value })}
          rows={Math.min(12, Math.max(3, stage.edited.split("\n").length + 1))}
          className="input mt-3 font-mono text-xs"
          aria-label="Text to send"
        />
        {preview.redactions.length > 0 || preview.mentions.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2 text-xs">
            {preview.mentions.map((m) => (
              <li key={m.placeholder} className="rounded-full bg-brass-soft px-2 py-0.5">
                <span className="font-mono">{m.placeholder}</span> → {m.candidates.map((c) => c.name).join(" or ")}
                {m.candidates.length > 1 ? " (ambiguous)" : ""}
              </li>
            ))}
            {preview.redactions.map((r) => (
              <li key={r.placeholder} className="rounded-full border border-line px-2 py-0.5 text-ink-soft">
                <span className="font-mono">{r.placeholder}</span> masked {r.type}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-ink-soft">Nothing was masked.</p>
        )}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={interpret} disabled={busy} className="btn-primary">
            {busy ? "Interpreting…" : "Interpret with AI"}
          </button>
          <button type="button" onClick={keepPrivate} disabled={busy} className="btn-ghost">
            Keep as private note
          </button>
          <button type="button" onClick={discard} disabled={busy} className="btn-quiet">
            Discard
          </button>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-line bg-surface p-4">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        required
        placeholder="Paste an email, type a brain dump, dictate a list… one line per thing works too."
        className="input resize-y"
        aria-label="Capture"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={noAi} onChange={(e) => setNoAi(e.target.checked)} />
          Keep private — store as a note, no AI
        </label>
        <button type="submit" disabled={busy || text.trim() === ""} className="btn-primary">
          {busy ? "Capturing…" : noAi ? "Keep note" : "Capture"}
        </button>
      </div>
      {notice ? <p className="mt-3 text-sm text-ink-soft">{notice}</p> : null}
      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
    </form>
  );
}
