import { describe, expect, it } from "vitest";
import { repositories } from "../../data/repositories";
import { generateTemporaryPassword, mfaRequired, passwordProblem } from "../../domain/identity/password-policy";
import { verifyPassword } from "../../lib/password";
import { totpCode, totpStep } from "../../lib/totp";
import { nextRestriction } from "../auth/login";
import { openTotpSecret } from "../auth/mfa-secret";
import { consumeRecoveryCode } from "../auth/recovery-codes";
import { sessionStillValid } from "../auth/session";
import { createTestSession } from "../production/test-support";
import {
  accountOverview,
  adminResetMfa,
  adminResetPassword,
  beginMfaEnrollment,
  changeOwnPassword,
  confirmMfaEnrollment,
  disableMfa,
  regenerateRecoveryCodes,
  replaceTemporaryPassword,
} from "./account-security";
import { createUserAccount, setUserActive, updateUserRole } from "./user-management";

const STRONG = "Sel-de-Guerande-2026";

describe("password rules", () => {
  it("refuses short, common, repetitive passwords and those that repeat the e-mail", () => {
    expect(passwordProblem("court", "a@b.ma")).toMatch(/10 caractères/);
    expect(passwordProblem("Demo1234!", "a@b.ma")).toMatch(/10 caractères/);
    expect(passwordProblem("motdepasse123", "a@b.ma")).toMatch(/courant/);
    expect(passwordProblem("aaaaabbbbb", "a@b.ma")).toMatch(/répétitif/);
    expect(passwordProblem("karim.tazi-2026", "karim.tazi@ferme.ma")).toMatch(/adresse e-mail/);
    expect(passwordProblem(STRONG, "karim@ferme.ma")).toBeNull();
    expect(generateTemporaryPassword(() => new Uint8Array(12))).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  });

  it("demands two-step login of the deciding roles on a real installation only", () => {
    expect(mfaRequired("SUPER_ADMIN", false)).toBe(true);
    expect(mfaRequired("QUALITY_MANAGER", false)).toBe(true);
    expect(mfaRequired("DIRECTION", false)).toBe(true);
    expect(mfaRequired("PRODUCER", false)).toBe(false);
    expect(mfaRequired("SUPER_ADMIN", true)).toBe(false);
  });
});

describe("account security", () => {
  it("gives a new account a temporary password that must be replaced at the first sign-in", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "acc-admin-1");
    const { user, temporaryPassword } = await createUserAccount({ email: "nouvel.eleveur@ferme.ma", fullName: "Nouvel Éleveur", role: "PRODUCER", scopeType: "GLOBAL" }, admin);
    expect(temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(user.mustChangePassword).toBe(true);
    expect(verifyPassword(temporaryPassword!, user.passwordHash)).toBe(true);
    expect(nextRestriction(user, false, false)).toBe("PASSWORD_CHANGE");

    await expect(replaceTemporaryPassword(user.id, "court")).rejects.toThrow(/10 caractères/);
    await expect(replaceTemporaryPassword(user.id, temporaryPassword!)).rejects.toThrow();
    const replaced = await replaceTemporaryPassword(user.id, STRONG);
    expect(replaced.mustChangePassword).toBe(false);
    expect(replaced.authVersion).toBe(user.authVersion + 1);
    expect(verifyPassword(STRONG, replaced.passwordHash)).toBe(true);
    expect(nextRestriction(replaced, false, false)).toBeNull();
    await expect(replaceTemporaryPassword(user.id, "Autre-Mot-2026x")).rejects.toThrow(/provisoire/);
  });

  it("lets a user change their own password only with the current one, and ends their other sessions", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "acc-admin-2");
    const { user, temporaryPassword } = await createUserAccount({ email: "tech.change@ferme.ma", fullName: "Tech Change", role: "TECHNICIAN", scopeType: "GLOBAL" }, admin);
    const settled = await replaceTemporaryPassword(user.id, STRONG);
    const session = { userId: user.id, role: user.role, scopeType: user.scopeType, scopeId: null, isDemoSwitch: false };
    await expect(changeOwnPassword({ currentPassword: temporaryPassword!, newPassword: "Nouveau-Mot-2027" }, session)).rejects.toThrow(/actuel incorrect/);
    const { authVersion } = await changeOwnPassword({ currentPassword: STRONG, newPassword: "Nouveau-Mot-2027" }, session);
    expect(authVersion).toBe(settled.authVersion + 1);
    const after = (await repositories.users.findById(user.id))!;
    // A session opened before the change no longer holds.
    expect(sessionStillValid(after, settled.authVersion)).toBe(false);
    expect(sessionStillValid(after, authVersion)).toBe(true);
  });

  it("lets an administrator reset someone else's password, never their own, and nobody else at all", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "acc-admin-3");
    const farmer = await createTestSession("PRODUCER", "GLOBAL", null, "acc-farmer-3");
    const { temporaryPassword } = await adminResetPassword(farmer.userId, admin);
    const reset = (await repositories.users.findById(farmer.userId))!;
    expect(reset.mustChangePassword).toBe(true);
    expect(verifyPassword(temporaryPassword, reset.passwordHash)).toBe(true);
    await expect(adminResetPassword(admin.userId, admin)).rejects.toThrow(/Mon compte/);
    await expect(adminResetPassword(admin.userId, farmer)).rejects.toThrow(/droits/);
  });

  it("sets up two-step login with a first code, then accepts each recovery code once", async () => {
    const quality = await createTestSession("QUALITY_MANAGER", "GLOBAL", null, "acc-quality-4");
    const before = (await repositories.users.findById(quality.userId))!;
    expect(nextRestriction(before, false, false)).toBe("MFA_SETUP");

    const { secret, uri } = await beginMfaEnrollment(quality.userId);
    expect(uri).toContain(`secret=${secret}`);
    // Resuming the set-up shows the same key: the QR code already scanned stays valid.
    expect((await beginMfaEnrollment(quality.userId)).secret).toBe(secret);
    // Stored encrypted, never in clear.
    const stored = (await repositories.users.findById(quality.userId))!.totpSecret!;
    expect(stored).not.toContain(secret);
    expect(openTotpSecret(stored)).toBe(secret);

    const now = Date.now();
    await expect(confirmMfaEnrollment(quality.userId, "000000", now)).rejects.toThrow(/Code incorrect/);
    const { user, recoveryCodes } = await confirmMfaEnrollment(quality.userId, totpCode(secret, totpStep(now)), now);
    expect(user.totpEnabledAt).not.toBeNull();
    expect(user.authVersion).toBe(before.authVersion + 1);
    expect(recoveryCodes).toHaveLength(10);
    expect(nextRestriction(user, false, false)).toBeNull();
    await expect(beginMfaEnrollment(quality.userId)).rejects.toThrow(/déjà activée/);

    const once = consumeRecoveryCode(user.recoveryCodes, recoveryCodes[3].toLowerCase());
    expect(once?.left).toBe(9);
    expect(consumeRecoveryCode(once!.json, recoveryCodes[3])).toBeNull();
    expect((await accountOverview(quality)).mfaEnabled).toBe(true);
  });

  it("keeps two-step login on for roles that require it, and lets others manage theirs with the password", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "acc-admin-5");
    const { user } = await createUserAccount({ email: "vet.mfa@ferme.ma", fullName: "Vét MFA", role: "VETERINARIAN", scopeType: "GLOBAL", password: "provisoire-1" }, admin);
    await replaceTemporaryPassword(user.id, STRONG);
    const vet = { userId: user.id, role: user.role, scopeType: user.scopeType, scopeId: null, isDemoSwitch: false };
    const { secret } = await beginMfaEnrollment(user.id);
    const now = Date.now();
    await confirmMfaEnrollment(user.id, totpCode(secret, totpStep(now)), now);
    await expect(regenerateRecoveryCodes("faux", vet)).rejects.toThrow(/incorrect/);
    expect((await regenerateRecoveryCodes(STRONG, vet)).recoveryCodes).toHaveLength(10);
    await disableMfa(STRONG, vet);
    expect((await repositories.users.findById(user.id))!.totpEnabledAt).toBeNull();

    // An administrator clears a lost phone; never their own.
    const { secret: again } = await beginMfaEnrollment(user.id);
    await confirmMfaEnrollment(user.id, totpCode(again, totpStep(now)), now);
    await adminResetMfa(user.id, admin);
    const cleared = (await repositories.users.findById(user.id))!;
    expect([cleared.totpSecret, cleared.totpEnabledAt, cleared.recoveryCodes]).toEqual([null, null, null]);
    await expect(adminResetMfa(admin.userId, admin)).rejects.toThrow(/autre administrateur/);
  });

  it("ends a user's sessions when the administrator changes their role or disables them", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "acc-admin-6");
    const tech = await createTestSession("TECHNICIAN", "GLOBAL", null, "acc-tech-6");
    const v0 = (await repositories.users.findById(tech.userId))!.authVersion;
    await updateUserRole(tech.userId, "FARM_MANAGER", admin, "Promotion");
    const v1 = (await repositories.users.findById(tech.userId))!;
    expect(sessionStillValid(v1, v0)).toBe(false);
    await setUserActive(tech.userId, false, admin, "Départ");
    const off = (await repositories.users.findById(tech.userId))!;
    expect(sessionStillValid(off, off.authVersion)).toBe(false);
  });
});
