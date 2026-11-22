import type { BuildingZoneType, OrganizationType, Role, ScopeType } from "../shared/enums";

export interface Organization {
  id: string;
  name: string;
  type: OrganizationType;
  createdAt: string;
}

export interface Cooperative {
  id: string;
  organizationId: string;
  name: string;
  region: string;
  createdAt: string;
}

export interface Producer {
  id: string;
  cooperativeId: string;
  name: string;
  contactPhone: string | null;
  contactEmail: string | null;
  createdAt: string;
}

export interface Farm {
  id: string;
  producerId: string;
  name: string;
  city: string;
  region: string;
  geoLat: number | null;
  geoLng: number | null;
  createdAt: string;
}

export interface Building {
  id: string;
  farmId: string;
  code: string;
  name: string;
  capacity: number;
  zoneType: BuildingZoneType;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  role: Role;
  scopeType: ScopeType;
  scopeId: string | null;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
  authVersion: number;
  totpSecret: string | null;
  totpEnabledAt: string | null;
  totpLastStep: number | null;
  recoveryCodes: string | null;
}

/** The account-security columns: set by services/identity/account-security.ts, defaulted on creation. */
export type UserSecurityFields = "mustChangePassword" | "passwordChangedAt" | "authVersion" | "totpSecret" | "totpEnabledAt" | "totpLastStep" | "recoveryCodes";

export type NewOrganization = Omit<Organization, "id" | "createdAt">;
export type NewCooperative = Omit<Cooperative, "id" | "createdAt">;
export type NewProducer = Omit<Producer, "id" | "createdAt">;
export type NewFarm = Omit<Farm, "id" | "createdAt">;
export type NewBuilding = Omit<Building, "id" | "createdAt">;
export type NewUser = Omit<User, "id" | "createdAt" | "lastLoginAt" | UserSecurityFields> & Partial<Pick<User, UserSecurityFields>>;
