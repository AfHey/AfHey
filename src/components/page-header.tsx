export function PageHeader({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-8 flex items-end justify-between gap-4">
      <div>
        <h1 className="display text-3xl font-semibold tracking-tight">{title}</h1>
        {note ? <p className="mt-1 text-sm text-ink-soft">{note}</p> : null}
      </div>
      {children}
    </header>
  );
}

export function EmptyState({ line, hint }: { line: string; hint?: string }) {
  return (
    <div className="py-14 text-center">
      <p className="empty-line">{line}</p>
      {hint ? <p className="mt-2 text-sm text-ink-soft">{hint}</p> : null}
    </div>
  );
}
