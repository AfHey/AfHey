import { requirePageSession } from "@/core/auth/current";
import { LogoutButton } from "./logout-button";

export default async function Home() {
  await requirePageSession();
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">AfHey</h1>
      <LogoutButton />
    </main>
  );
}
