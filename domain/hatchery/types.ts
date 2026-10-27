import type { ChickGrade, HatchCycleStatus } from "../shared/enums";
import type { ProvenanceFields } from "../shared/provenance";

export interface ParentFlock extends ProvenanceFields {
  id: string;
  code: string;
  buildingId: string;
  strain: string;
  geneticSupplier: string;
  originCountry: string;
  importReference: string | null;
  placedAt: string;
  femaleCount: number;
  maleCount: number;
  createdAt: string;
  /** The lot carrying the flock's population, phases, feed and sensors; null on flocks recorded before. */
  lotId?: string | null;
  productionLine?: string | null;
}

export interface EggLot extends ProvenanceFields {
  id: string;
  code: string;
  parentFlockId: string;
  collectedAt: string;
  quantity: number;
  storageBuildingId: string | null;
  createdAt: string;
}

export interface HatchCycle extends ProvenanceFields {
  id: string;
  code: string;
  buildingId: string;
  incubatorRef: string;
  setAt: string;
  eggsSet: number;
  status: HatchCycleStatus;
  candledAt: string | null;
  clearsRemoved: number | null;
  hatchedAt: string | null;
  chicksHatched: number | null;
  unhatched: number | null;
  culls: number | null;
  createdAt: string;
}

export interface ChickLot extends ProvenanceFields {
  id: string;
  code: string;
  hatchCycleId: string;
  quantity: number;
  grade: ChickGrade;
  dispatchedAt: string;
  createdAt: string;
}

export type NewParentFlock = Omit<ParentFlock, "id" | "createdAt">;
export type NewEggLot = Omit<EggLot, "id" | "createdAt">;
export type NewHatchCycle = Omit<HatchCycle, "id" | "createdAt">;
export type NewChickLot = Omit<ChickLot, "id" | "createdAt">;

export interface CodedRepository<T, N> {
  findById(id: string): Promise<T | null>;
  findByCode(code: string): Promise<T | null>;
  list(): Promise<T[]>;
  create(input: N): Promise<T>;
}

export interface HatchCycleRepository extends CodedRepository<HatchCycle, NewHatchCycle> {
  update(id: string, changes: Partial<Pick<HatchCycle, "status" | "candledAt" | "clearsRemoved" | "hatchedAt" | "chicksHatched" | "unhatched" | "culls">>): Promise<HatchCycle>;
}

export interface ChickLotRepository extends CodedRepository<ChickLot, NewChickLot> {
  listByCycle(hatchCycleId: string): Promise<ChickLot[]>;
}

export interface EggLotRepository extends CodedRepository<EggLot, NewEggLot> {
  listByParentFlock(parentFlockId: string): Promise<EggLot[]>;
  /** Where the eggs are now — moved only by a received transfer. */
  updateStorage(id: string, storageBuildingId: string): Promise<EggLot>;
}
