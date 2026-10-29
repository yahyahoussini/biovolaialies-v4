import type { NomenclatureArticle } from "./nomenclature";
import type { CommissioningRecord } from "./recipes";

export interface EquipmentItem {
  id: string;
  unitCode: string;
  unitLabel: string;
  category: string;
  reference: string | null;
  name: string;
  quantityRef: number | null;
  quantityMax: number | null;
  status: string | null;
  function: string | null;
  characteristics: string | null;
  decisionRule: string | null;
  candidates: string | null;
  sortOrder: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export type NewEquipmentItem = Omit<EquipmentItem, "id" | "updatedAt" | "updatedBy">;

/** The client's status legend (xlsx "LisezMoi"). */
export const EQUIPMENT_STATUS_LABEL: Record<string, string> = {
  C: "Conserver",
  I: "Interfacer",
  A: "Adapter",
  R: "Remplacer",
  H: "Hors périmètre",
  N: "Neuf BVU Tech",
  O: "Option",
  S: "Consommable",
};

export interface EquipmentRepository {
  createMany(items: NewEquipmentItem[]): Promise<void>;
  list(): Promise<EquipmentItem[]>;
  findById(id: string): Promise<EquipmentItem | null>;
  update(id: string, changes: Pick<EquipmentItem, "quantityRef" | "quantityMax" | "status" | "decisionRule" | "updatedAt" | "updatedBy">): Promise<EquipmentItem>;
}

export type NewNomenclatureArticle = Omit<NomenclatureArticle, "id" | "updatedAt" | "updatedBy">;
export type NomenclatureChanges = Partial<Omit<NomenclatureArticle, "id" | "ref" | "family" | "sortOrder" | "origin">> & Pick<NomenclatureArticle, "updatedAt" | "updatedBy">;

export interface NomenclatureRepository {
  createMany(articles: NewNomenclatureArticle[]): Promise<void>;
  list(): Promise<NomenclatureArticle[]>;
  findByRef(ref: string): Promise<NomenclatureArticle | null>;
  update(id: string, changes: NomenclatureChanges): Promise<NomenclatureArticle>;
}

export interface CommissioningRepository {
  create(record: Omit<CommissioningRecord, "id">): Promise<CommissioningRecord>;
  listByBuilding(buildingId: string): Promise<CommissioningRecord[]>;
  listAll(): Promise<CommissioningRecord[]>;
}
