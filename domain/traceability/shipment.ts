import type { ProvenanceFields } from "../shared/provenance";

/** A commercial dispatch of a packaged product to a customer/channel (client spec phase 13, COMMERCIAL_EVENT). */
export interface Shipment extends ProvenanceFields {
  id: string;
  code: string;
  productId: string;
  destinationId: string;
  quantity: number;
  unit: string;
  shippedAt: string;
  createdAt: string;
}

export type NewShipment = Omit<Shipment, "id" | "createdAt">;

export interface ShipmentRepository {
  findById(id: string): Promise<Shipment | null>;
  findByCode(code: string): Promise<Shipment | null>;
  list(): Promise<Shipment[]>;
  listByProduct(productId: string): Promise<Shipment[]>;
  create(input: NewShipment): Promise<Shipment>;
}
