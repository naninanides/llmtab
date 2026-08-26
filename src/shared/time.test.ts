import { describe, expect, it } from "vitest";
import { BUCKET_MS, bucketStart, bucketStartIso, eachDay, parseRange, toRange } from "./time.js";

describe("bucketStart", () => {
  it("floors to 30-minute UTC buckets", () => {
    // 14:37:22 → 14:30
    const ts = Date.UTC(2026, 7, 26, 14, 37, 22);
    expect(bucketStart(ts)).toBe(Date.UTC(2026, 7, 26, 14, 30));
  });

  it("is exact on bucket boundaries", () => {
    const boundary = Date.UTC(2026, 7, 26, 15, 0);
    expect(bucketStart(boundary)).toBe(boundary);
    expect(boundary % BUCKET_MS).toBe(0);
  });

  it("returns ISO strings", () => {
    expect(bucketStartIso("2026-08-26T00:17:00Z")).toBe("2026-08-26T00:00:00.000Z");
  });
});

describe("parseRange", () => {
  const now = Date.UTC(2026, 7, 26, 12, 0); // Aug 26 2026 12:00 UTC

  it("handles named ranges", () => {
    expect(parseRange("all", now)).toEqual({ fromMs: null, toMs: now });
    expect(parseRange("today", now)?.fromMs).toBe(Date.UTC(2026, 7, 26));
    expect(parseRange("7d", now)?.fromMs).toBe(now - 7 * 86400_000);
    expect(parseRange("30d", now)?.fromMs).toBe(now - 30 * 86400_000);
  });

  it("parses custom from,to", () => {
    const r = parseRange("2026-08-01,2026-08-07", now);
    expect(r?.fromMs).toBe(Date.UTC(2026, 7, 1));
    // bare end-date becomes inclusive end-of-day
    expect(r?.toMs).toBeGreaterThanOrEqual(Date.UTC(2026, 7, 7));
  });

  it("rejects invalid input", () => {
    expect(parseRange("nonsense", now)).toBeNull();
    expect(parseRange("2026-08-07,2026-08-01", now)).toBeNull(); // inverted
    expect(parseRange("2026-13-40,2026-09-01", now)).toBeNull();
  });
});

describe("toRange", () => {
  it("maps named ranges to the union", () => {
    expect(toRange("7d")).toEqual({ kind: "7d" });
    expect(toRange("bogus")).toBeNull();
  });

  it("maps custom ranges", () => {
    const r = toRange("2026-08-01,2026-08-02");
    expect(r?.kind).toBe("custom");
  });
});

describe("eachDay", () => {
  it("expands to UTC day starts inclusively", () => {
    const days = eachDay(Date.UTC(2026, 7, 1), Date.UTC(2026, 7, 3, 12));
    expect(days).toEqual([
      Date.UTC(2026, 7, 1),
      Date.UTC(2026, 7, 2),
      Date.UTC(2026, 7, 3),
    ]);
  });

  it("returns empty for all-time", () => {
    expect(eachDay(null, Date.now())).toEqual([]);
  });
});
