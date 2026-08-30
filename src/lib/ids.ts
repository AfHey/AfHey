import { randomUUID } from "node:crypto";

/**
 * Every entity, operation, and audit identifier in AfHey is an opaque v4 UUID
 * (product-spec §9, §12.4). Titles and display handles are never identifiers.
 */
export function newUuid(): string {
  return randomUUID();
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
