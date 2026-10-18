"use server";

import { revalidatePath } from "next/cache";
import type { FormActionResult } from "@/components/domain/FormDialog";
import { handleActionError } from "@/lib/handle-error";
import { iso, num, opt } from "@/lib/form-values";
import { requireSession } from "@/services/auth/session";
import { createShipment } from "@/services/traceability/shipment";

export async function createShipmentAction(v: Record<string, string>): Promise<FormActionResult> {
  try {
    const session = await requireSession();
    await createShipment(
      {
        code: v.code,
        productId: v.productId,
        destinationId: v.destinationId,
        quantity: num(v.quantity),
        unit: v.unit || "kg",
        shippedAt: iso(v.shippedAt),
        dataStatus: v.dataStatus,
        documentId: opt(v.documentId),
      },
      session
    );
    revalidatePath("/expeditions");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: handleActionError("server-action", error) };
  }
}
