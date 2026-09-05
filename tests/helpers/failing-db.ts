import type { PrismaClient } from "@/db/generated/client";

/**
 * Failure injection for atomicity tests: returns a client whose interactive
 * transactions expose a `tx` where `<delegate>.<method>` rejects. Everything
 * else behaves normally, so the test observes exactly what a mid-sequence
 * failure leaves behind.
 */
export function withFailingMethod(
  db: PrismaClient,
  delegateName: string,
  methodName: string,
  message = "injected failure",
): PrismaClient {
  const wrapDelegate = (delegate: object) =>
    new Proxy(delegate, {
      get(d, m) {
        if (m === methodName) return () => Promise.reject(new Error(message));
        const v = Reflect.get(d, m);
        return typeof v === "function" ? v.bind(d) : v;
      },
    });
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "$transaction") {
        return (fn: (tx: unknown) => Promise<unknown>) =>
          target.$transaction((tx) =>
            fn(
              new Proxy(tx, {
                get(t, p) {
                  const v = Reflect.get(t, p);
                  return p === delegateName ? wrapDelegate(v as object) : v;
                },
              }),
            ),
          );
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as PrismaClient;
}
