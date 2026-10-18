import type { LeadActivity, LeadStatus } from "../shared/enums";

export interface Lead {
  id: string;
  company: string;
  contactName: string;
  email: string;
  phone: string | null;
  activity: LeadActivity;
  capacity: string | null;
  need: string;
  consent: boolean;
  consentVersion: string;
  status: LeadStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export type NewLead = Omit<Lead, "id" | "createdAt" | "updatedAt" | "status" | "notes">;

export interface LeadRepository {
  create(input: NewLead): Promise<Lead>;
  findById(id: string): Promise<Lead | null>;
  list(): Promise<Lead[]>;
  update(id: string, changes: { status?: LeadStatus; notes?: string | null }): Promise<Lead>;
  countSince(email: string, sinceIso: string): Promise<number>;
}
