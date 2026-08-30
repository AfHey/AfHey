import { describe, expect, it } from "vitest";
import { isUuid, newUuid } from "./ids";

describe("newUuid", () => {
  it("produces valid v4 UUIDs", () => {
    const id = newUuid();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe("4");
  });

  it("produces unique values", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newUuid()));
    expect(ids.size).toBe(1000);
  });
});

describe("isUuid", () => {
  it("rejects non-UUID identifiers such as titles or short handles", () => {
    expect(isUuid("evt_2911")).toBe(false);
    expect(isUuid("Manuscript work")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});
