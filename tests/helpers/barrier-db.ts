import type { PrismaClient } from "@/db/generated/client";

export interface Barrier {
  /** Resolves the first time the wrapped method has returned its result. */
  reached: Promise<void>;
  /** Lets the wrapped call(s) continue. */
  release: () => void;
}

/**
 * Interleaving control for race tests: returns a client on which
 * `<delegate>.<method>` — at top level and inside interactive transactions —
 * performs the real call, signals `reached`, and then parks until
 * `release()` before handing the result back. A concurrent actor can commit
 * on another connection in that window, so a test exercises the exact
 * read-then-write gap a fix has to close.
 */
export function withBarrierAfter(
  db: PrismaClient,
  delegateName: string,
  methodName: string,
): { db: PrismaClient; barrier: Barrier } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signalReached!: () => void;
  const reached = new Promise<void>((resolve) => {
    signalReached = resolve;
  });

  const wrapDelegate = (delegate: object) =>
    new Proxy(delegate, {
      get(d, m) {
        const v = Reflect.get(d, m);
        if (m !== methodName) return typeof v === "function" ? v.bind(d) : v;
        return async (...args: unknown[]) => {
          const result = await (v as (...a: unknown[]) => Promise<unknown>).apply(d, args);
          signalReached();
          await gate;
          return result;
        };
      },
    });

  const wrapClient = <T extends object>(client: T): T =>
    new Proxy(client, {
      get(target, prop, receiver) {
        if (prop === delegateName) return wrapDelegate(Reflect.get(target, prop) as object);
        if (prop === "$transaction") {
          return (fn: unknown, options?: unknown) => {
            if (typeof fn !== "function") return (target as PrismaClient).$transaction(fn as never, options as never);
            return (target as PrismaClient).$transaction(
              (tx) => (fn as (t: unknown) => Promise<unknown>)(wrapClient(tx)),
              options as never,
            );
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return v;
      },
    });

  return { db: wrapClient(db), barrier: { reached, release } };
}
