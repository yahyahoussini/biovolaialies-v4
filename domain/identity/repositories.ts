import type {
  Building,
  Cooperative,
  Farm,
  NewBuilding,
  NewCooperative,
  NewFarm,
  NewOrganization,
  NewProducer,
  NewUser,
  Organization,
  Producer,
  User,
  UserSecurityFields,
} from "./types";
import type { ScopeContext } from "../shared/scope";

export interface OrganizationRepository {
  findById(id: string): Promise<Organization | null>;
  list(): Promise<Organization[]>;
  create(input: NewOrganization): Promise<Organization>;
  update(id: string, patch: Partial<NewOrganization>): Promise<Organization>;
}

export interface CooperativeRepository {
  findById(id: string): Promise<Cooperative | null>;
  listByOrganization(organizationId: string): Promise<Cooperative[]>;
  /** Respects scope: an ORGANIZATION-scoped caller only sees cooperatives under their own org. */
  list(scope?: ScopeContext): Promise<Cooperative[]>;
  create(input: NewCooperative): Promise<Cooperative>;
  update(id: string, patch: Partial<NewCooperative>): Promise<Cooperative>;
}

export interface ProducerRepository {
  findById(id: string): Promise<Producer | null>;
  listByCooperative(cooperativeId: string): Promise<Producer[]>;
  /** Respects scope: a COOPERATIVE-scoped caller only sees producers under their own cooperative. */
  list(scope?: ScopeContext): Promise<Producer[]>;
  create(input: NewProducer): Promise<Producer>;
  update(id: string, patch: Partial<NewProducer>): Promise<Producer>;
}

export interface FarmRepository {
  findById(id: string): Promise<Farm | null>;
  listByProducer(producerId: string): Promise<Farm[]>;
  /** Respects scope: a PRODUCER-scoped caller only sees farms under their own producer. */
  list(scope?: ScopeContext): Promise<Farm[]>;
  create(input: NewFarm): Promise<Farm>;
  update(id: string, patch: Partial<NewFarm>): Promise<Farm>;
}

export interface BuildingRepository {
  findById(id: string): Promise<Building | null>;
  /** Respects scope: a FARM-scoped caller only sees buildings under their own farm. */
  listByFarm(farmId: string, scope?: ScopeContext): Promise<Building[]>;
  list(): Promise<Building[]>;
  create(input: NewBuilding): Promise<Building>;
  update(id: string, patch: Partial<NewBuilding>): Promise<Building>;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  list(): Promise<User[]>;
  create(input: NewUser): Promise<User>;
  update(id: string, patch: Partial<Pick<User, "role" | "scopeType" | "scopeId" | "active" | "authVersion">>): Promise<User>;
  /** Password, two-step login and session-version columns (services/identity/account-security.ts). */
  updateSecurity(id: string, patch: Partial<Pick<User, "passwordHash" | UserSecurityFields>>): Promise<User>;
  count(): Promise<number>;
  touchLastLogin(id: string, at: string): Promise<void>;
}
