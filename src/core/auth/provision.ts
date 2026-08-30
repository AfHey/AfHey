/**
 * Single-user provisioning (spec §9.5): exactly one User row, no
 * registration flow. Re-running with a new password replaces the password
 * credential (this is also the password-reset path). The `passkey`
 * Credential kind is reserved in the schema for later (decisions.md
 * 2026-08-30 "Password-first Phase 1 authentication").
 */
import type { PrismaClient } from "@/db/generated/client";
import { hashPassword } from "./passwords";

export async function provisionUser(db: PrismaClient, password: string) {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  const secretHash = await hashPassword(password);
  return db.$transaction(async (tx) => {
    const user =
      (await tx.user.findFirst()) ?? (await tx.user.create({ data: {} }));
    const existing = await tx.credential.findFirst({
      where: { userId: user.id, kind: "password" },
    });
    if (existing) {
      await tx.credential.update({
        where: { id: existing.id },
        data: { secretHash },
      });
    } else {
      await tx.credential.create({
        data: { userId: user.id, kind: "password", secretHash },
      });
    }
    await tx.userSettings.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });
    return user;
  });
}
