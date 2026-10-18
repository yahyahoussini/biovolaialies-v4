import { describe, expect, it } from "vitest";
import {
  GENESIS_HASH,
  canonicalJson,
  computeEventHash,
  hashPayload,
  isAnchorSignatureValid,
  signAnchor,
  verifyChain,
} from "./hash-chain";
import type { LedgerEvent } from "./types";

function build(payloads: Record<string, unknown>[]): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  let prevHash = GENESIS_HASH;
  payloads.forEach((payload, i) => {
    const base = {
      id: `e${i + 1}`,
      seq: i + 1,
      eventType: "TEST",
      objectType: "LOT",
      objectId: "lot-1",
      actorKind: "SYSTEM" as const,
      actorId: null,
      source: "test",
      occurredAt: "2026-10-01T00:00:00.000Z",
      recordedAt: "2026-10-01T00:00:00.000Z",
      schemaVersion: 1,
      idempotencyKey: null,
      payloadHash: hashPayload(payload),
      correctsEventId: null,
      prevHash,
    };
    const hash = computeEventHash(base);
    events.push({ ...base, payload, hash });
    prevHash = hash;
  });
  return events;
}

describe("canonicalJson", () => {
  it("ignores key order at every depth", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(canonicalJson({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }));
  });
});

describe("verifyChain", () => {
  it("accepts an intact chain and an empty one", () => {
    expect(verifyChain(build([{ a: 1 }, { b: 2 }, { c: 3 }])).ok).toBe(true);
    expect(verifyChain([])).toMatchObject({ ok: true, count: 0, headHash: GENESIS_HASH });
  });

  it("detects an edited payload", () => {
    const events = build([{ qty: 100 }, { qty: 200 }]);
    events[0] = { ...events[0], payload: { qty: 90 } };
    expect(verifyChain(events)).toMatchObject({ ok: false, brokenAtSeq: 1 });
  });

  it("detects an edited protected field even when the payload is untouched", () => {
    const events = build([{ a: 1 }, { b: 2 }]);
    events[1] = { ...events[1], objectId: "lot-2" };
    expect(verifyChain(events)).toMatchObject({ ok: false, brokenAtSeq: 2 });
  });

  it("detects a deleted event", () => {
    const events = build([{ a: 1 }, { b: 2 }, { c: 3 }]);
    expect(verifyChain([events[0], events[2]])).toMatchObject({ ok: false, brokenAtSeq: 3 });
  });

  it("detects a rewritten link", () => {
    const events = build([{ a: 1 }, { b: 2 }]);
    events[1] = { ...events[1], prevHash: GENESIS_HASH };
    expect(verifyChain(events).ok).toBe(false);
  });
});

describe("anchors", () => {
  it("validates its own signature and rejects a forged head", () => {
    const anchor = signAnchor(3, "a".repeat(64), "2026-10-01T00:00:00.000Z", "k".repeat(32));
    expect(isAnchorSignatureValid(anchor, "k".repeat(32))).toBe(true);
    expect(isAnchorSignatureValid({ ...anchor, headSeq: 4 }, "k".repeat(32))).toBe(false);
    expect(isAnchorSignatureValid(anchor, "x".repeat(32))).toBe(false);
  });
});
