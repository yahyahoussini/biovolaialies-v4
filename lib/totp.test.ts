import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateRecoveryCodes, generateTotpSecret, looksLikeRecoveryCode, otpauthUri, totpCode, totpStep, verifyTotp } from "./totp";

// RFC 6238, appendix B: the SHA-1 secret is the ASCII "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("two-step login codes (TOTP)", () => {
  it("computes the RFC 6238 reference codes (last six digits)", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    const at = (seconds: number) => totpCode(RFC_SECRET, totpStep(seconds * 1000));
    expect(at(59)).toBe("287082");
    expect(at(1111111109)).toBe("081804");
    expect(at(1111111111)).toBe("050471");
    expect(at(1234567890)).toBe("005924");
    expect(at(2000000000)).toBe("279037");
  });

  it("accepts the code of now or one step either side, once only", () => {
    const now = Date.UTC(2026, 10, 22, 12, 0, 10);
    const step = totpStep(now);
    const code = totpCode(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, now, null)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 2), now, null)).toBeNull();
    // Used once: the same code, or an older one, is refused afterwards.
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12 34 5", now, null)).toBeNull();
  });

  it("round-trips secrets through base32 and builds the URI an authenticator app reads", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    expect(otpauthUri(secret, "a@b.ma")).toBe(`otpauth://totp/BIOVOLAILLES:a%40b.ma?secret=${secret}&issuer=BIOVOLAILLES&algorithm=SHA1&digits=6&period=30`);
  });

  it("issues ten distinct recovery codes, told apart from six-digit codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-TV-Z2-9]{5}-[A-HJ-NP-TV-Z2-9]{5}$/);
    expect(looksLikeRecoveryCode(codes[0].toLowerCase().replace("-", " "))).toBe(true);
    expect(looksLikeRecoveryCode("123456")).toBe(false);
  });
});
