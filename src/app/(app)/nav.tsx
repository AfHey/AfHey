"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ICONS: Record<string, React.ReactNode> = {
  inbox: (
    <path d="M2 9.5 4.5 3h7L14 9.5V13H2V9.5Zm0 0h3.5l1 2h3l1-2H14" />
  ),
  tasks: (
    <>
      <path d="M2.5 8.5 6 12l7.5-8" />
    </>
  ),
  events: (
    <>
      <rect x="2" y="3.5" width="12" height="10.5" rx="1.5" />
      <path d="M2 6.5h12M5.5 2v3M10.5 2v3" />
    </>
  ),
  calendar: (
    <>
      <rect x="2" y="3.5" width="12" height="10.5" rx="1.5" />
      <path d="M2 6.5h12M6 6.5v7.5M10 6.5v7.5M2 10h12" />
    </>
  ),
  projects: (
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 2h4.5A1.5 1.5 0 0 1 14 6.5v5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-7Z" />
  ),
  notes: (
    <>
      <path d="M3 2.5h10v11l-3-2-2 2-2-2-3 2v-11Z" />
      <path d="M5.5 6h5M5.5 8.5h3" />
    </>
  ),
  people: (
    <>
      <circle cx="5.5" cy="5.5" r="2.25" />
      <circle cx="11" cy="6.5" r="1.75" />
      <path d="M1.5 13c.5-2.5 2-4 4-4s3.5 1.5 4 4M9.5 9.5c1.8.1 3.2 1.3 3.8 3.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2.25" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
    </>
  ),
};

const ITEMS = [
  { href: "/inbox", label: "Inbox", icon: "inbox" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/tasks", label: "Tasks", icon: "tasks" },
  { href: "/events", label: "Events", icon: "events" },
  { href: "/projects", label: "Projects", icon: "projects" },
  { href: "/notes", label: "Notes", icon: "notes" },
  { href: "/people", label: "People", icon: "people" },
  { href: "/settings", label: "Settings", icon: "settings" },
] as const;

export function Nav({ orientation }: { orientation: "vertical" | "horizontal" }) {
  const pathname = usePathname();
  const vertical = orientation === "vertical";
  return (
    <ul className={vertical ? "flex flex-col gap-1" : "flex justify-around px-1 py-1.5"}>
      {ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-label={item.label}
              aria-current={active ? "page" : undefined}
              className={
                vertical
                  ? `flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm ${
                      active
                        ? "bg-brass-soft font-medium text-ink"
                        : "text-ink-soft hover:text-ink"
                    }`
                  : `flex flex-col items-center gap-0.5 rounded-md px-2 py-1 text-[10px] ${
                      active ? "text-brass" : "text-ink-soft"
                    }`
              }
            >
              <svg
                viewBox="0 0 16 16"
                aria-hidden
                className="h-4 w-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {ICONS[item.icon]}
              </svg>
              <span className={vertical ? "" : "leading-none"}>{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
