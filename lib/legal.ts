/**
 * The company details of the public site's legal pages, set on the server as LEGAL_* variables
 * (deploy/vps.env.example) and read at request time: filling one needs a restart, not a release.
 * Until set, the page says plainly what is missing ("À compléter").
 */
export const LEGAL_FIELDS = ["ADDRESS", "RC", "ICE", "CAPITAL", "DIRECTOR", "CONTACT", "HOST", "PRIVACY_EMAIL", "CNDP_REF", "PROCESSORS", "LEAD_RETENTION"] as const;
export type LegalField = (typeof LEGAL_FIELDS)[number];

export function legalValue(field: LegalField): string | null {
  const value = process.env[`LEGAL_${field}`]?.trim();
  return value ? value : null;
}

export function missingLegalFields(): LegalField[] {
  return LEGAL_FIELDS.filter((field) => !legalValue(field));
}
