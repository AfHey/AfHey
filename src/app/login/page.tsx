import { redirect } from "next/navigation";
import { getPageSession } from "@/core/auth/current";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const session = await getPageSession();
  if (session) redirect("/");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">AfHey</h1>
      <LoginForm />
    </main>
  );
}
