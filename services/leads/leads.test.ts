import { beforeEach, describe, expect, it } from "vitest";
import { resetRateLimits } from "../../lib/rate-limit";
import { createTestSession } from "../production/test-support";
import { csvField } from "../../lib/csv";
import { exportLeadsCsv, listLeads, submitLead, updateLead } from "./leads";

const form = {
  company: "Abattoir du Saïss",
  contactName: "Hamza Alaoui",
  email: "hamza@saiss.ma",
  phone: "",
  activity: "ABATTAGE",
  capacity: "500 volailles/heure",
  need: "Relier les lots vifs reçus aux lots carcasses.",
  consent: true,
};

describe("submitLead", () => {
  beforeEach(() => resetRateLimits());

  it("stores a valid request", async () => {
    const result = await submitLead(form, { clientKey: "ip-1", honeypot: "" });
    expect(result).toEqual({ ok: true, value: { stored: true } });
  });

  it("pretends success but stores nothing when the honeypot is filled", async () => {
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "lead-honey");
    const before = (await listLeads(admin)).length;
    const result = await submitLead({ ...form, email: "bot@spam.test" }, { clientKey: "ip-2", honeypot: "http://spam" });
    expect(result.ok).toBe(true);
    expect((await listLeads(admin)).length).toBe(before);
  });

  it("returns field errors for invalid input", async () => {
    const result = await submitLead({ ...form, email: "x", consent: false }, { clientKey: "ip-3", honeypot: "" });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "VALIDATION") {
      expect(Object.keys(result.error.fieldErrors)).toEqual(expect.arrayContaining(["email", "consent"]));
    }
  });

  it("rate-limits bursts from one client", async () => {
    for (let i = 0; i < 5; i++) {
      await submitLead({ ...form, email: `burst${i}@saiss.ma` }, { clientKey: "ip-burst", honeypot: "" });
    }
    const sixth = await submitLead({ ...form, email: "burst6@saiss.ma" }, { clientKey: "ip-burst", honeypot: "" });
    expect(sixth.ok).toBe(false);
  });

  it("caps repeated submissions from one e-mail per day", async () => {
    for (let i = 0; i < 3; i++) {
      await submitLead({ ...form, email: "same@saiss.ma" }, { clientKey: `ip-same-${i}`, honeypot: "" });
    }
    const fourth = await submitLead({ ...form, email: "same@saiss.ma" }, { clientKey: "ip-same-x", honeypot: "" });
    expect(fourth.ok).toBe(false);
  });
});

describe("lead management", () => {
  it("is reserved to roles holding the LEADS module", async () => {
    const tech = await createTestSession("TECHNICIAN", "GLOBAL", null, "lead-tech");
    await expect(listLeads(tech)).rejects.toThrow();
  });

  it("updates status and exports a CSV", async () => {
    resetRateLimits();
    const admin = await createTestSession("SUPER_ADMIN", "GLOBAL", null, "lead-admin");
    await submitLead({ ...form, email: "export@saiss.ma", company: "=HYPERLINK(1)" }, { clientKey: "ip-exp", honeypot: "" });
    const lead = (await listLeads(admin)).find((l) => l.email === "export@saiss.ma")!;
    const updated = await updateLead({ leadId: lead.id, status: "EN_QUALIFICATION", notes: "Appel prévu" }, admin);
    expect(updated.status).toBe("EN_QUALIFICATION");
    const csv = await exportLeadsCsv(admin);
    expect(csv).toContain("'=HYPERLINK(1)");
    expect(csv).toContain("En qualification");
  });
});

describe("csvField", () => {
  it("quotes separators and neutralises formulas", () => {
    expect(csvField('a,"b"')).toBe('"a,""b"""');
    expect(csvField("+212")).toBe("'+212");
    expect(csvField(null)).toBe("");
  });
});
