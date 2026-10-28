import { DrizzleActionRecordRepository } from "./action-record.repository";
import { DrizzleAlertRepository } from "./alert.repository";
import { DrizzleAnomalyRepository } from "./anomaly.repository";
import { DrizzleAuditLogRepository } from "./audit-log.repository";
import { DrizzleBuildingRepository } from "./building.repository";
import { DrizzleCollectionRepository } from "./collection.repository";
import { DrizzleCooperativeRepository } from "./cooperative.repository";
import { DrizzleDestinationRepository } from "./destination.repository";
import { DrizzleDeviceRepository } from "./device.repository";
import { DrizzleEnvironmentMeasurementRepository } from "./environment-measurement.repository";
import { DrizzleFarmRepository } from "./farm.repository";
import { DrizzleFeedUsageRepository } from "./feed-usage.repository";
import { DrizzleLeadRepository } from "./lead.repository";
import { DrizzleLedgerRepository } from "./ledger.repository";
import { DrizzleQualityCaseRepository } from "./quality-case.repository";
import {
  DrizzleChickLotRepository,
  DrizzleEggLotRepository,
  DrizzleHatchCycleRepository,
  DrizzleParentFlockRepository,
} from "./hatchery.repository";
import { DrizzleShipmentRepository } from "./shipment.repository";
import { DrizzleApiClientRepository } from "./api-client.repository";
import { DrizzleEquipmentRepository } from "./equipment.repository";
import {
  DrizzleAggregateRepository,
  DrizzleAlertNotificationRepository,
  DrizzleCalibrationRepository,
  DrizzleEggLoggerMissionRepository,
  DrizzleIngestMessageRepository,
  DrizzleReferenceBandRepository,
  DrizzleRuleSettingsRepository,
  DrizzleRuleStateRepository,
  DrizzleRuleTransitionRepository,
  DrizzleRuleWatermarkRepository,
  DrizzleSiteEventRepository,
  DrizzleTelemetryReadingRepository,
  DrizzleTelemetrySensorRepository,
  DrizzleZoneOccupationRepository,
  DrizzleZoneRepository,
} from "./telemetry.repository";
import {
  DrizzleBvuIdRepository,
  DrizzleIdentifierAliasRepository,
  DrizzleLotPhaseRepository,
  DrizzleProductionLineRepository,
  DrizzleSubjectEventRepository,
  DrizzleSubjectRepository,
  DrizzleTableEggLotRepository,
  DrizzleTransferRepository,
} from "./production-flow.repository";
import { DrizzleKpiDefinitionRepository } from "./kpi-definition.repository";
import { DrizzleKpiValueRepository } from "./kpi-value.repository";
import { DrizzleLotEventRepository } from "./lot-event.repository";
import { DrizzleLotRepository } from "./lot.repository";
import { DrizzleMeasurementRepository } from "./measurement.repository";
import { DrizzleMortalityRecordRepository } from "./mortality-record.repository";
import { DrizzleSanitaryObservationRepository } from "./sanitary-observation.repository";
import { DrizzleFieldDiscrepancyRepository, DrizzleFieldEntryRepository } from "./field.repository";
import { DrizzleOrganizationRepository } from "./organization.repository";
import { DrizzleProducerRepository } from "./producer.repository";
import { DrizzleProductRepository } from "./product.repository";
import { DrizzleQrTokenRepository } from "./qr-token.repository";
import { DrizzleRelationRepository } from "./relation.repository";
import { DrizzleRuleRepository } from "./rule.repository";
import { DrizzleSensorRepository } from "./sensor.repository";
import { DrizzleSlaughterBatchRepository } from "./slaughter-batch.repository";
import { DrizzleTransformationBatchRepository } from "./transformation-batch.repository";
import { DrizzleUserRepository } from "./user.repository";
import { DrizzleWaterUsageRepository } from "./water-usage.repository";
import { DrizzleWeightMeasurementRepository } from "./weight-measurement.repository";

/**
 * Repository factory — the single place application code (services, Server Actions)
 * gets repository instances. Components and services depend on the domain interfaces
 * (imported from domain/*\/repositories.ts), never on these Drizzle classes directly,
 * so swapping the backing store later means changing only this file.
 * No `import "server-only"` — also imported by the standalone seed script (see lib/env.ts).
 */
export const repositories = {
  organizations: new DrizzleOrganizationRepository(),
  cooperatives: new DrizzleCooperativeRepository(),
  producers: new DrizzleProducerRepository(),
  farms: new DrizzleFarmRepository(),
  buildings: new DrizzleBuildingRepository(),
  users: new DrizzleUserRepository(),
  lots: new DrizzleLotRepository(),
  lotEvents: new DrizzleLotEventRepository(),
  auditLog: new DrizzleAuditLogRepository(),
  feedUsage: new DrizzleFeedUsageRepository(),
  waterUsage: new DrizzleWaterUsageRepository(),
  weightMeasurements: new DrizzleWeightMeasurementRepository(),
  mortalityRecords: new DrizzleMortalityRecordRepository(),
  sanitaryObservations: new DrizzleSanitaryObservationRepository(),
  environmentMeasurements: new DrizzleEnvironmentMeasurementRepository(),
  devices: new DrizzleDeviceRepository(),
  sensors: new DrizzleSensorRepository(),
  measurements: new DrizzleMeasurementRepository(),
  kpiDefinitions: new DrizzleKpiDefinitionRepository(),
  kpiValues: new DrizzleKpiValueRepository(),
  rules: new DrizzleRuleRepository(),
  anomalies: new DrizzleAnomalyRepository(),
  alerts: new DrizzleAlertRepository(),
  actionRecords: new DrizzleActionRecordRepository(),
  collections: new DrizzleCollectionRepository(),
  slaughterBatches: new DrizzleSlaughterBatchRepository(),
  transformationBatches: new DrizzleTransformationBatchRepository(),
  products: new DrizzleProductRepository(),
  destinations: new DrizzleDestinationRepository(),
  relations: new DrizzleRelationRepository(),
  qrTokens: new DrizzleQrTokenRepository(),
  leads: new DrizzleLeadRepository(),
  ledger: new DrizzleLedgerRepository(),
  qualityCases: new DrizzleQualityCaseRepository(),
  parentFlocks: new DrizzleParentFlockRepository(),
  eggLots: new DrizzleEggLotRepository(),
  hatchCycles: new DrizzleHatchCycleRepository(),
  chickLots: new DrizzleChickLotRepository(),
  shipments: new DrizzleShipmentRepository(),
  apiClients: new DrizzleApiClientRepository(),
  equipment: new DrizzleEquipmentRepository(),
  zones: new DrizzleZoneRepository(),
  zoneOccupations: new DrizzleZoneOccupationRepository(),
  readings: new DrizzleTelemetryReadingRepository(),
  telemetrySensors: new DrizzleTelemetrySensorRepository(),
  ingestMessages: new DrizzleIngestMessageRepository(),
  siteEvents: new DrizzleSiteEventRepository(),
  aggregates: new DrizzleAggregateRepository(),
  bands: new DrizzleReferenceBandRepository(),
  ruleSettings: new DrizzleRuleSettingsRepository(),
  ruleStates: new DrizzleRuleStateRepository(),
  ruleWatermarks: new DrizzleRuleWatermarkRepository(),
  ruleTransitions: new DrizzleRuleTransitionRepository(),
  alertNotifications: new DrizzleAlertNotificationRepository(),
  calibrations: new DrizzleCalibrationRepository(),
  eggLoggerMissions: new DrizzleEggLoggerMissionRepository(),
  productionLines: new DrizzleProductionLineRepository(),
  lotPhases: new DrizzleLotPhaseRepository(),
  transfers: new DrizzleTransferRepository(),
  subjects: new DrizzleSubjectRepository(),
  subjectEvents: new DrizzleSubjectEventRepository(),
  tableEggLots: new DrizzleTableEggLotRepository(),
  bvuIds: new DrizzleBvuIdRepository(),
  identifierAliases: new DrizzleIdentifierAliasRepository(),
  fieldEntries: new DrizzleFieldEntryRepository(),
  fieldDiscrepancies: new DrizzleFieldDiscrepancyRepository(),
};
