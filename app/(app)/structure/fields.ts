import type { StructureLevel } from "@/services/identity/structure";

/** The fields of each level's form, shared by the create and edit forms. */
export interface FieldSpec {
  key: string;
  label: string;
  kind: "text" | "number" | "decimal" | "select";
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
}

export const LEVEL_FIELDS: Record<StructureLevel, FieldSpec[]> = {
  organization: [
    { key: "name", label: "Nom", kind: "text", required: true },
    {
      key: "type",
      label: "Type",
      kind: "select",
      required: true,
      options: [
        { value: "INTERNAL", label: "Interne" },
        { value: "COOPERATIVE", label: "Coopérative" },
        { value: "PRODUCER_GROUP", label: "Groupement de producteurs" },
      ],
    },
  ],
  cooperative: [
    { key: "name", label: "Nom", kind: "text", required: true },
    { key: "region", label: "Région", kind: "text", required: true },
  ],
  producer: [
    { key: "name", label: "Nom", kind: "text", required: true },
    { key: "contactPhone", label: "Téléphone", kind: "text" },
    { key: "contactEmail", label: "Email", kind: "text" },
  ],
  farm: [
    { key: "name", label: "Nom", kind: "text", required: true },
    { key: "city", label: "Ville", kind: "text", required: true },
    { key: "region", label: "Région", kind: "text", required: true },
    { key: "geoLat", label: "Latitude", kind: "decimal", hint: "ex. 33,93" },
    { key: "geoLng", label: "Longitude", kind: "decimal", hint: "ex. -5,21" },
  ],
  building: [
    { key: "code", label: "Code", kind: "text", required: true, hint: "unique, sans espace (ex. FER-B01)" },
    { key: "name", label: "Nom", kind: "text", required: true },
    { key: "capacity", label: "Capacité (sujets)", kind: "number", required: true },
    {
      key: "zoneType",
      label: "Type",
      kind: "select",
      required: true,
      options: [
        { value: "ELEVAGE", label: "Élevage" },
        { value: "COUVOIR", label: "Couvoir" },
        { value: "STOCKAGE", label: "Stockage" },
        { value: "AUTRE", label: "Autre" },
      ],
    },
  ],
};

export const LEVEL_LABEL: Record<StructureLevel, string> = {
  organization: "organisation",
  cooperative: "coopérative",
  producer: "producteur",
  farm: "ferme",
  building: "bâtiment",
};

export const CHILD_OF: Partial<Record<StructureLevel, StructureLevel>> = {
  organization: "cooperative",
  cooperative: "producer",
  producer: "farm",
  farm: "building",
};
