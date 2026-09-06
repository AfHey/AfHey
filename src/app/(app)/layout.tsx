import Link from "next/link";
import { requirePageSession } from "@/core/auth/current";
import { SearchBox } from "@/components/search-box";
import { Nav } from "./nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requirePageSession();
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Desktop rail */}
      <aside className="hidden w-52 shrink-0 flex-col border-r border-line px-4 py-6 md:flex">
        <span className="display px-2 pb-6 text-xl font-semibold tracking-tight">
          AfHey
        </span>
        <Link href="/inbox?focus=1" className="btn-ghost mb-3 justify-start">
          + Add
        </Link>
        <SearchBox className="mb-6" />
        <Nav orientation="vertical" />
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
        <span className="display text-lg font-semibold tracking-tight">AfHey</span>
        <div className="flex items-center gap-1">
          <Link href="/search" aria-label="Search" className="btn-quiet">
            <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 14 14" />
            </svg>
          </Link>
          <Link href="/inbox?focus=1" className="btn-quiet">+ Add</Link>
        </div>
      </header>

      <div className="flex-1 pb-20 md:pb-0">
        <div className="mx-auto w-full max-w-2xl px-4 py-8 md:px-8 md:py-12">
          {children}
        </div>
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 backdrop-blur md:hidden"
      >
        <Nav orientation="horizontal" />
      </nav>
    </div>
  );
}
