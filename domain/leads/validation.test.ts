import { describe, expect, it } from "vitest";
import { cleanText, leadSubmissionSchema } from "./validation";

const valid = {
  company: "Couvoir Atlas",
  contactName: "Salma Idrissi",
  email: "Contact@Couvoir-Atlas.ma",
  phone: "+212 6 00 00 00 00",
  activity: "COUVOIR",
  capacity: "5 000 œufs/jour",
  need: "Traçabilité des lots d'œufs jusqu'aux poussins.",
  consent: true,
};

describe("leadSubmissionSchema", () => {
  it("accepts a complete request and normalises the e-mail", () => {
    const parsed = leadSubmissionSchema.parse(valid);
    expect(parsed.email).toBe("contact@couvoir-atlas.ma");
  });

  it("turns blank optional fields into null", () => {
    const parsed = leadSubmissionSchema.parse({ ...valid, phone: "  ", capacity: "" });
    expect(parsed.phone).toBeNull();
    expect(parsed.capacity).toBeNull();
  });

  it("rejects a missing consent, an unknown activity and a bad e-mail", () => {
    expect(leadSubmissionSchema.safeParse({ ...valid, consent: false }).success).toBe(false);
    expect(leadSubmissionSchema.safeParse({ ...valid, activity: "PIRATE" }).success).toBe(false);
    expect(leadSubmissionSchema.safeParse({ ...valid, email: "pas-un-email" }).success).toBe(false);
  });

  it("rejects a whitespace-only required field", () => {
    expect(leadSubmissionSchema.safeParse({ ...valid, company: "   " }).success).toBe(false);
  });
});

describe("cleanText", () => {
  it("strips control characters and truncates", () => {
    expect(cleanText("a\u0000b\u0007c  ", 10)).toBe("abc");
    expect(cleanText("abcdef", 3)).toBe("abc");
    expect(cleanText(42, 3)).toBe("");
  });
});
