/**
 * Where each rule (R01–R15) and acceptance test (T01–T40) of the client's specification stands
 * in THIS codebase. Written by hand and kept honest: "Automatisé" means a test in this repository
 * exercises it on every run; "Terrain" means it can only be proven on site, with real hardware
 * and people — software cannot claim it.
 */
export type CoverageStatus = "AUTOMATISE" | "IMPLEMENTE" | "PARTIEL" | "TERRAIN" | "NON_COUVERT";

export const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  AUTOMATISE: "Automatisé",
  IMPLEMENTE: "Implémenté",
  PARTIEL: "Partiel",
  TERRAIN: "Terrain (FAT/SAT)",
  NON_COUVERT: "Non couvert",
};

export const COVERAGE_TONE: Record<CoverageStatus, "success" | "info" | "warning" | "neutral" | "critical"> = {
  AUTOMATISE: "success",
  IMPLEMENTE: "info",
  PARTIEL: "warning",
  TERRAIN: "neutral",
  NON_COUVERT: "critical",
};

export const RULE_COVERAGE: Record<string, { status: CoverageStatus; where: string }> = {
  R01: { status: "AUTOMATISE", where: "Codes uniques par type d'objet, rejet explicite — testés pour lot, collecte, produit, lot d'œufs, expédition." },
  R02: { status: "IMPLEMENTE", where: "Tout lot a site (bâtiment) et événement de création ; tout dérivé a une source obligatoire." },
  R03: { status: "AUTOMATISE", where: "Graphe de relations ; contrôles d'intégrité T04/T05 ; dérivé refusé sans source." },
  R04: { status: "AUTOMATISE", where: "Bilans abattage/transformation, bilan œufs du couvoir, stock produit vs expéditions." },
  R05: { status: "IMPLEMENTE", where: "Valeur + unité + source + horodatage + statut de donnée sur chaque mesure." },
  R06: { status: "AUTOMATISE", where: "Registre d'étalonnage : résultat calculé contre la tolérance, capteur non conforme mis hors service, étalonnage échu → mesures signalées et exclues des règles, dérive repérée sur les contrôles successifs (services/telemetry/calibration.test.ts)." },
  R07: { status: "IMPLEMENTE", where: "Journal chaîné en ajout seul ; correction = nouvel événement lié (correctsEventId)." },
  R08: { status: "AUTOMATISE", where: "Clé d'idempotence : rejeu identique sans doublon ; même clé sur un autre événement ou un autre corps refusée (409)." },
  R09: { status: "AUTOMATISE", where: "Blocage propagé aux descendants ; toute dérivation depuis un objet bloqué est refusée." },
  R10: { status: "AUTOMATISE", where: "Rôle Responsable qualité, quatre yeux, justification, preuve ; refus journalisés." },
  R11: { status: "AUTOMATISE", where: "Passeport public : liste blanche de champs testée ; aucune donnée fournisseur ni client." },
  R12: { status: "PARTIEL", where: "Périmètres organisation/coopérative/producteur/ferme testés ; isolation multi-clients à valider." },
  R13: { status: "AUTOMATISE", where: "Heure de mesure et heure de réception sur chaque mesure de passerelle ; horloge de la passerelle mesurée à chaque message, dérive > 5 min → mesures signalées HORLOGE (domain/telemetry/telemetry.test.ts)." },
  R14: { status: "IMPLEMENTE", where: "Aucune identité individuelle : tout est suivi au niveau lot." },
  R15: { status: "IMPLEMENTE", where: "Aucun chemin d'écriture vers un automate : l'automate est lu seulement (catalogue PLC) ; l'alarme GSM (L01) et le thermostat de sécurité (L03) sont hors du logiciel, qui ne fait que les journaliser." },
};

export const TEST_COVERAGE: Record<string, { status: CoverageStatus; where: string }> = {
  T01: { status: "AUTOMATISE", where: "services/production/lot.test.ts" },
  T02: { status: "AUTOMATISE", where: "services/production/lot.test.ts — code de lot dupliqué refusé" },
  T03: { status: "AUTOMATISE", where: "services/quality/full-chain.test.ts — produit → troupeau reproducteur" },
  T04: { status: "AUTOMATISE", where: "services/quality/full-chain.test.ts — lot d'œufs → produits, expéditions, destinations" },
  T05: { status: "AUTOMATISE", where: "services/quality/full-chain.test.ts — propagation et refus d'expédition" },
  T06: { status: "AUTOMATISE", where: "services/quality/full-chain.test.ts — levée par responsable qualité" },
  T07: { status: "AUTOMATISE", where: "services/quality/full-chain.test.ts — refus + journal" },
  T08: { status: "PARTIEL", where: "Journal chaîné et journal d'audit : toute altération détectée (tests). Tables métier (quantités, statuts) non hachées : une modification directe en base n'y est pas détectée." },
  T09: { status: "PARTIEL", where: "Serveur prêt (rejeu idempotent) ; application mobile hors ligne non développée" },
  T10: { status: "AUTOMATISE", where: "services/api/api.test.ts ; services/telemetry/telemetry.test.ts — 40 h de tampon passerelle renvoyées d'un coup : aucune perte, aucun doublon, alertes horodatées à leur instant réel" },
  T11: { status: "PARTIEL", where: "Même clé, contenu différent → 409 ; conflit entre deux clés distinctes non détecté" },
  T12: { status: "TERRAIN", where: "Lecture QR sur équipement réel" },
  T13: { status: "IMPLEMENTE", where: "Durée de calcul mesurée et affichée à chaque rappel ; non mesurée sur un jeu de données étalon" },
  T14: { status: "IMPLEMENTE", where: "Événements : lots de 500. Télémétrie : rattrapage de ≈1 200 messages (≈55 000 mesures) en moins de 30 s dans le test de rattrapage ; non mesuré sur l'infrastructure cible" },
  T15: { status: "TERRAIN", where: "Mesure de disponibilité sur l'infrastructure du pilote" },
  T16: { status: "TERRAIN", where: "Comparaison sur site avec un instrument étalon ; le registre d'étalonnage enregistre l'écart, la tolérance et la preuve (/telemetrie/etalonnage)" },
  T17: { status: "AUTOMATISE", where: "Contrôle de silence contre l'horloge : capteur silencieux ou passerelle entière silencieuse → alerte, une seule pour la passerelle (domain/telemetry/rules/rules.test.ts, services/telemetry/telemetry.test.ts)" },
  T18: { status: "AUTOMATISE", where: "Dérive d'horloge de passerelle > 5 min, horodatage futur ou antérieur au tampon de 30 jours → mesures signalées HORLOGE, exclues des moyennes et des règles (domain/telemetry/telemetry.test.ts, services/telemetry/telemetry.test.ts)" },
  T19: { status: "TERRAIN", where: "Aucun connecteur OPC UA/Modbus : dépend des machines réellement installées" },
  T20: { status: "PARTIEL", where: "Politique d'erreur API (codes, Correlation-ID, quotas) ; pas de connecteur sortant à tester" },
  T21: { status: "TERRAIN", where: "Masses étalons sur balance réelle" },
  T22: { status: "AUTOMATISE", where: "domain/production/quantity-integrity.test.ts, reconciliation.test.ts" },
  T23: { status: "TERRAIN", where: "Impression et relecture d'étiquette réelle" },
  T24: { status: "PARTIEL", where: "Accès hors périmètre refusés (tests) ; isolation multi-clients complète à valider" },
  T25: { status: "AUTOMATISE", where: "domain/shared/permissions.test.ts" },
  T26: { status: "PARTIEL", where: "Clés API stockées en empreinte uniquement ; clé d'ancrage obligatoire en production ; scan de secrets à intégrer à la CI" },
  T27: { status: "PARTIEL", where: "npm run db:backup / db:restore-check : chaque sauvegarde est restaurée sur une copie isolée et prouvée — empreinte, intégrité SQLite, références, lignes, journal chaîné, migrations (services/ops/backup.test.ts ; 3,4 s sur la base de démonstration). RPO/RTO à faire approuver par le client (sauvegarde quotidienne → RPO 24 h)" },
  T28: { status: "TERRAIN", where: "Boîtier réel à redémarrer sur site. Côté plateforme : compteur de messages réinitialisé détecté et signalé, tampon renvoyé sans doublon (testé)" },
  T29: { status: "PARTIEL", where: "Panne de passerelle injectée → alerte de silence ouverte (services/telemetry/telemetry.test.ts) ; prise en compte des alertes testée (services/intelligence/alerts.test.ts) ; schéma en retard et tâches planifiées arrêtées détectés sur Administration → Exploitation (services/ops/status.test.ts) ; /api/v1/health/ready pour la surveillance externe, à brancher par l'exploitant" },
  T30: { status: "TERRAIN", where: "Procédure exécutée avec un opérateur" },
  T31: { status: "AUTOMATISE", where: "domain/hatchery/balance.test.ts, services/quality/full-chain.test.ts" },
  T32: { status: "AUTOMATISE", where: "domain/intelligence/kpi-calculations.test.ts" },
  T33: { status: "AUTOMATISE", where: "services/traceability/slaughter.test.ts" },
  T34: { status: "NON_COUVERT", where: "Une transformation n'a aujourd'hui qu'une seule source" },
  T35: { status: "PARTIEL", where: "Équipement reproductible d'un bâtiment selon le cas de référence du document 2 (zones, passerelle, capteurs) ; pas encore de gabarit versionné multi-site" },
  T36: { status: "IMPLEMENTE", where: "Par conception : aucune écriture automate" },
  T37: { status: "IMPLEMENTE", where: "Journal en ajout seul ; correction liée, original conservé" },
  T38: { status: "TERRAIN", where: "Formation par rôle" },
  T39: { status: "TERRAIN", where: "PV FAT signé" },
  T40: { status: "TERRAIN", where: "PV SAT signé sur site pilote" },
};
