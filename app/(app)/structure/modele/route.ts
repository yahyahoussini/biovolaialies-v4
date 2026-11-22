import { getCurrentSession } from "@/services/auth/session";
import { STRUCTURE_COLUMNS } from "@/services/identity/structure";

/** The import template: the exact columns the importer reads, and one example line it skips. BOM so Excel shows the accents. */
export async function GET() {
  if (!(await getCurrentSession())) return new Response("Connexion requise.", { status: 401 });
  const example = ["EXEMPLE Organisation", "Interne", "EXEMPLE Coopérative", "Fès-Meknès", "EXEMPLE Producteur", "06 00 00 00 00", "contact@example.com", "EXEMPLE Ferme", "Meknès", "Fès-Meknès", "", "", "EX-B01", "Poulailler 1", "5000", "Élevage"];
  const body = `﻿${STRUCTURE_COLUMNS.join(";")}\r\n${example.join(";")}\r\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="structure-elevages.csv"',
      "Cache-Control": "no-store",
    },
  });
}
