import { describe, expect, it } from "vitest";
import { isPublicPath } from "./public-paths";

describe("isPublicPath", () => {
  it("treats the home page as public", () => {
    expect(isPublicPath("/")).toBe(true);
  });

  it("treats /login and its sub-paths as public", () => {
    expect(isPublicPath("/login")).toBe(true);
  });

  it("treats /tracabilite/:token as public (QR passport)", () => {
    expect(isPublicPath("/tracabilite/abc123")).toBe(true);
  });

  it("treats the site's legal pages as public", () => {
    expect(isPublicPath("/mentions-legales")).toBe(true);
    expect(isPublicPath("/confidentialite")).toBe(true);
    expect(isPublicPath("/prospects")).toBe(false);
  });

  it("treats everything else as protected, including near-miss prefixes", () => {
    expect(isPublicPath("/dashboard")).toBe(false);
    expect(isPublicPath("/lots/42")).toBe(false);
    expect(isPublicPath("/logindecoy")).toBe(false);
  });
});
