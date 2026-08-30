import { redirect } from "next/navigation";
import { getPageSession } from "@/core/auth/current";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await getPageSession();
  if (session) redirect("/");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
      <div className="text-center">
        <h1 className="display text-3xl font-semibold tracking-tight">AfHey</h1>
        <p className="mt-1 text-sm text-ink-soft">Your day, kept in order.</p>
      </div>
      <LoginForm />
    </main>
  );
}
