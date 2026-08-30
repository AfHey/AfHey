"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  return (
    <button
      type="button"
      onClick={logout}
      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
    >
      Sign out
    </button>
  );
}
