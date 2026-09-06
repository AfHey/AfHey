import { describe, expect, it } from "vitest";
import { parseDevOrigins } from "./dev-origins";

describe("parseDevOrigins", () => {
  it("returns no origins when the variable is unset or blank", () => {
    expect(parseDevOrigins(undefined)).toEqual([]);
    expect(parseDevOrigins("")).toEqual([]);
    expect(parseDevOrigins(" , ")).toEqual([]);
  });

  it("splits a comma list into trimmed, deduplicated hostnames", () => {
    expect(parseDevOrigins(" 100.110.160.140, lan.test ,lan.test")).toEqual(["100.110.160.140", "lan.test"]);
  });

  it("reduces full origins to the hostname Next expects", () => {
    expect(parseDevOrigins("http://100.110.160.140:3000/login, https://phone.tail.ts.net")).toEqual([
      "100.110.160.140",
      "phone.tail.ts.net",
    ]);
  });

  it("keeps wildcard patterns intact", () => {
    expect(parseDevOrigins("*.tail.ts.net")).toEqual(["*.tail.ts.net"]);
  });
});
