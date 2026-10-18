import type { CommissioningResult } from "../shared/enums";

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

export interface CommissioningTest {
  id: string;
  code: string;
  equipment: string;
  procedure: string;
  result: CommissioningResult;
  executedBy: string | null;
  executedAt: string | null;
  evidence: string | null;
  notes: string | null;
}

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
  createTests(tests: Omit<CommissioningTest, "id">[]): Promise<void>;
  listTests(): Promise<CommissioningTest[]>;
  findTestById(id: string): Promise<CommissioningTest | null>;
  updateTest(id: string, changes: Pick<CommissioningTest, "result" | "executedBy" | "executedAt" | "evidence" | "notes">): Promise<CommissioningTest>;
}
