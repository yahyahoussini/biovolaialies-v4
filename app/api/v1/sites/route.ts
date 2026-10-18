import { apiRoute, json } from "@/services/api/http";
import { apiListSites } from "@/services/api/operations";

/** Discovery — building and sensor ids needed by POST /lots (LOT) and POST /measurements. */
export const GET = apiRoute("lots:read", async ({ correlationId }) => json(await apiListSites(), 200, correlationId));
