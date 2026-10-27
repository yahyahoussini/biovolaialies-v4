"use server";

import type { FormActionResult } from "@/components/domain/FormDialog";
import { dispatchTransferAction } from "../lots/flow-actions";

/** The departure form posts "TYPE:id" for what leaves; the service takes them apart. */
export async function dispatchFromFormAction(v: Record<string, string>): Promise<FormActionResult> {
  const [objectType, objectId] = (v.object ?? "").split(":");
  return dispatchTransferAction({ ...v, objectType: objectType ?? "", objectId: objectId ?? "" });
}
