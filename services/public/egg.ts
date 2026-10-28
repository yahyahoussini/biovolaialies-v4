import { repositories } from "../../data/repositories";
import { normalizeBvuId, parseBvuId } from "../../domain/identity/bvu-id-format";
import { shellCode, type EggTray, type MarkingLine, type MarkingRun } from "../../domain/marking/marking";
import type { DataStatus } from "../../domain/shared/enums";
import { resolveShellCode, type ShellCodeFate } from "../marking/marking";
import { activeHoldsOn } from "../quality/holds";

/**
 * What the public egg page may show (document 3: "vue publique restreinte, en lecture seule, sans
 * accès aux données de gestion"). The consumer types the code printed on the shell, or scans the
 * QR of the tray. The page says what the marking proves and nothing more: a code the camera never
 * read back is said to be unproven, an egg withdrawn from sale is said to be withdrawn, and no
 * quantity, cost or person's name ever reaches it.
 */

export type PublicEggTone = "ok" | "warning" | "critical" | "neutral";

export interface PublicEggView {
  kind: "OEUF" | "PLATEAU";
  code: string;
  tone: PublicEggTone;
  title: string;
  detail: string;
  facts: { label: string; value: string }[];
  /** "Elle affiche la qualité de la preuve": the share of the run's codes the camera read back. */
  readRate: number | null;
  isDemoData: boolean;
}

export type PublicEggResult = { status: "FOUND"; egg: PublicEggView } | { status: "MISREAD" } | { status: "UNKNOWN" };

const EGG_TYPE: Record<string, string> = { BLANC: "Blanc", PISTACHE: "« Pistache »", AUTRE: "Autre" };
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Africa/Casablanca", day: "numeric", month: "long", year: "numeric" }) : "—");
const isDemo = (status: DataStatus | undefined) => status !== "REEL" && status !== "VALIDE";

export async function resolvePublicEgg(raw: string): Promise<PublicEggResult> {
  const input = (raw ?? "").trim();
  if (!input || input.length > 40) return { status: "UNKNOWN" };

  const bvu = parseBvuId(input);
  if (bvu) {
    if (!bvu.valid) return { status: "MISREAD" };
    const record = bvu.objectType === "PACKAGE" ? await repositories.bvuIds.find(normalizeBvuId(input)) : null;
    const tray = record?.objectType === "PACKAGE" ? await repositories.marking.findTray(record.objectId) : null;
    const run = tray ? await repositories.marking.findRun(tray.runId) : null;
    const line = run ? await repositories.marking.findLine(run.lineId) : null;
    if (!record || !tray || !run || !line) return { status: "UNKNOWN" };
    return { status: "FOUND", egg: await describe({ kind: "PLATEAU", code: record.bvuId, run, line, fate: "RELU", readAt: tray.packedAt, tray }) };
  }

  const resolved = await resolveShellCode(input);
  if (resolved === "MISREAD") return { status: "MISREAD" };
  if (!resolved) return { status: "UNKNOWN" };
  return { status: "FOUND", egg: await describe({ kind: "OEUF", ...resolved }) };
}

async function describe(egg: { kind: PublicEggView["kind"]; code: string; run: MarkingRun; line: MarkingLine; fate: ShellCodeFate; readAt: string | null; tray: EggTray | null }): Promise<PublicEggView> {
  const { run, line } = egg;
  const readRate = run.printed ? run.readOk / run.printed : null;

  if (run.route === "A_COUVER") {
    const eggLot = await repositories.eggLots.findById(run.sourceId);
    return {
      kind: egg.kind,
      code: egg.code,
      tone: "neutral",
      title: "Œuf à couver",
      detail: "Cet œuf a été marqué au ramassage pour le couvoir : ce n'est pas un œuf de consommation.",
      facts: [{ label: "Marqué le", value: date(egg.readAt) }],
      readRate,
      isDemoData: isDemo(eggLot?.dataStatus),
    };
  }

  const eggs = await repositories.tableEggLots.findById(run.sourceId);
  const lot = eggs ? await repositories.lots.findById(eggs.lotId) : null;
  const building = lot ? await repositories.buildings.findById(lot.buildingId) : null;
  const farm = building ? await repositories.farms.findById(building.farmId) : null;
  const held = eggs && lot ? (await activeHoldsOn("TABLE_EGG_LOT", eggs.id)).length > 0 || (await activeHoldsOn("LOT", lot.id)).length > 0 : false;

  // The worst thing that is true is said first.
  const verdict: Pick<PublicEggView, "tone" | "title" | "detail"> =
    egg.fate === "ILLISIBLE"
      ? { tone: "critical", title: "Code rejeté au contrôle de lecture", detail: "La caméra de la ligne n'a pas pu relire ce code : l'œuf aurait dû sortir par le rejet. Signalez-le à votre point de vente." }
      : egg.fate === "NON_RELU"
        ? { tone: "warning", title: "Marquage non vérifié", detail: "Ce code a été attribué, mais la caméra ne l'a jamais relu : son marquage n'est pas une preuve." }
        : eggs?.status === "RETIRE"
          ? { tone: "critical", title: "Retiré de la vente", detail: "Ces œufs ont été pondus pendant le délai d'attente d'un traitement vétérinaire : ils ne doivent être ni vendus ni consommés." }
          : eggs?.status === "DETRUIT"
            ? { tone: "critical", title: "Lot détruit", detail: "Ces œufs ont été détruits : ils ne devraient pas être en vente." }
            : held
              ? { tone: "warning", title: "Vérification qualité en cours", detail: "Ces œufs font l'objet d'une vérification par l'opérateur. Renseignez-vous auprès de votre point de vente avant consommation." }
              : { tone: "ok", title: "Origine vérifiée", detail: "Code imprimé sur la coquille et relu par la caméra de contrôle de la ligne de marquage." };

  const facts: PublicEggView["facts"] = [];
  if (eggs) facts.push({ label: "Type d'œuf", value: EGG_TYPE[eggs.eggType] ?? eggs.eggType });
  if (farm) facts.push({ label: "Ferme d'origine", value: farm.name }, { label: "Ville", value: farm.city });
  if (eggs) facts.push({ label: "Collecte", value: eggs.code }, { label: "Collecté le", value: date(eggs.collectedOn) });
  facts.push({ label: "Marqué le", value: date(egg.readAt) });
  if (egg.tray) {
    facts.push({ label: "Plateau", value: `${egg.tray.eggCount} œufs, conditionné le ${date(egg.tray.packedAt)}` });
    if (egg.kind === "PLATEAU") facts.push({ label: "Codes du plateau", value: `${shellCode(line.shellPrefix, egg.tray.firstSerial)} à ${shellCode(line.shellPrefix, egg.tray.lastSerial)}` });
  }
  return { kind: egg.kind, code: egg.code, ...verdict, facts, readRate, isDemoData: isDemo(eggs?.dataStatus) };
}
