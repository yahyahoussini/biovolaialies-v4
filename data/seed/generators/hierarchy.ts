import type { Role, ScopeType } from "../../../domain/shared/enums";
import { repositories } from "../../repositories";

export const DEMO_PASSWORD = "Demo1234!";

/** Fixed, well-known emails for the 7 seeded demo accounts — the single source of truth the demo Role Switcher (services/auth/demo-switch.ts) looks up by role. */
export const DEMO_ACCOUNT_EMAIL: Record<Role, string> = {
  SUPER_ADMIN: "admin@biovolailles.demo",
  COOP_MANAGER: "coop.manager@biovolailles.demo",
  PRODUCER: "producteur@biovolailles.demo",
  FARM_MANAGER: "ferme.manager@biovolailles.demo",
  TECHNICIAN: "technicien@biovolailles.demo",
  AUDITOR: "auditeur@biovolailles.demo",
  QUALITY_MANAGER: "qualite@biovolailles.demo",
};

export interface DemoUserSpec {
  email: string;
  fullName: string;
  role: Role;
  scopeType: ScopeType;
  scopeId: string | null;
}

interface CooperativeSeed {
  name: string;
  region: string;
  producers: {
    name: string;
    contactPhone: string;
    contactEmail: string;
    farms: {
      name: string;
      city: string;
      region: string;
      geoLat: number;
      geoLng: number;
      buildings: { code: string; name: string; capacity: number }[];
    }[];
  }[];
}

/** 3 cooperatives, 7 producers, 8 farms, 12 buildings — coherent, clearly fictional Moroccan agritech data. */
const COOPERATIVES: CooperativeSeed[] = [
  {
    name: "Coopérative Avicole Al Baraka",
    region: "Rabat-Salé-Kénitra",
    producers: [
      {
        name: "Amine Benjelloun",
        contactPhone: "+212 6 00 00 00 01",
        contactEmail: "a.benjelloun@biovolailles.demo",
        farms: [
          {
            name: "Ferme Al Baraka",
            city: "Kénitra",
            region: "Rabat-Salé-Kénitra",
            geoLat: 34.261,
            geoLng: -6.5802,
            buildings: [
              { code: "BAT-01", name: "Bâtiment 1", capacity: 12000 },
              { code: "BAT-02", name: "Bâtiment 2", capacity: 12000 },
            ],
          },
        ],
      },
      {
        name: "Salma Ouazzani",
        contactPhone: "+212 6 00 00 00 02",
        contactEmail: "s.ouazzani@biovolailles.demo",
        farms: [
          {
            name: "Ferme Ouazzani",
            city: "Sidi Slimane",
            region: "Rabat-Salé-Kénitra",
            geoLat: 34.2653,
            geoLng: -5.9258,
            buildings: [{ code: "BAT-01", name: "Bâtiment 1", capacity: 8000 }],
          },
        ],
      },
      {
        name: "Karim Cherkaoui",
        contactPhone: "+212 6 00 00 00 03",
        contactEmail: "k.cherkaoui@biovolailles.demo",
        farms: [
          {
            name: "Ferme Cherkaoui",
            city: "Kénitra",
            region: "Rabat-Salé-Kénitra",
            geoLat: 34.301,
            geoLng: -6.601,
            buildings: [
              { code: "BAT-01", name: "Bâtiment 1", capacity: 10000 },
              { code: "BAT-02", name: "Bâtiment 2", capacity: 6000 },
            ],
          },
        ],
      },
    ],
  },
  {
    name: "Coopérative Avicole Souss Massa",
    region: "Souss-Massa",
    producers: [
      {
        name: "Youssef Amrani",
        contactPhone: "+212 6 00 00 00 04",
        contactEmail: "y.amrani@biovolailles.demo",
        farms: [
          {
            name: "Ferme Amrani",
            city: "Agadir",
            region: "Souss-Massa",
            geoLat: 30.4278,
            geoLng: -9.5981,
            buildings: [
              { code: "BAT-01", name: "Bâtiment 1", capacity: 15000 },
              { code: "BAT-02", name: "Bâtiment 2", capacity: 9000 },
            ],
          },
          {
            name: "Ferme Amrani — Extension",
            city: "Taroudant",
            region: "Souss-Massa",
            geoLat: 30.4703,
            geoLng: -8.8766,
            buildings: [{ code: "BAT-01", name: "Bâtiment 1", capacity: 7000 }],
          },
        ],
      },
      {
        name: "Khadija Fassi",
        contactPhone: "+212 6 00 00 00 05",
        contactEmail: "k.fassi@biovolailles.demo",
        farms: [
          {
            name: "Ferme Fassi",
            city: "Inezgane",
            region: "Souss-Massa",
            geoLat: 30.3547,
            geoLng: -9.5321,
            buildings: [{ code: "BAT-01", name: "Bâtiment 1", capacity: 9000 }],
          },
        ],
      },
    ],
  },
  {
    name: "Coopérative Avicole Al Fath",
    region: "Casablanca-Settat",
    producers: [
      {
        name: "Omar Tazi",
        contactPhone: "+212 6 00 00 00 06",
        contactEmail: "o.tazi@biovolailles.demo",
        farms: [
          {
            name: "Ferme Tazi",
            city: "Settat",
            region: "Casablanca-Settat",
            geoLat: 33.0011,
            geoLng: -7.6166,
            buildings: [
              { code: "BAT-01", name: "Bâtiment 1", capacity: 11000 },
              { code: "BAT-02", name: "Bâtiment 2", capacity: 11000 },
            ],
          },
        ],
      },
      {
        name: "Nadia El Amrani",
        contactPhone: "+212 6 00 00 00 07",
        contactEmail: "n.elamrani@biovolailles.demo",
        farms: [
          {
            name: "Ferme El Amrani",
            city: "Berrechid",
            region: "Casablanca-Settat",
            geoLat: 33.2651,
            geoLng: -7.5825,
            buildings: [{ code: "BAT-01", name: "Bâtiment 1", capacity: 8500 }],
          },
        ],
      },
    ],
  },
];

export interface SeededHierarchy {
  organizationId: string;
  cooperativeIds: string[];
  /** Keyed as "<producerName>" -> producer id, for lot generation to look up farms/buildings by name. */
  farmsByKey: Map<string, { farmId: string; producerId: string; cooperativeId: string; buildingIds: Map<string, string> }>;
  heroFarmId: string;
  heroBuildingId: string;
  heroCooperativeId: string;
  heroProducerId: string;
}

export async function seedHierarchy(): Promise<SeededHierarchy> {
  const organization = await repositories.organizations.create({
    name: "Fédération des Coopératives Avicoles du Maroc",
    type: "COOPERATIVE",
  });

  const cooperativeIds: string[] = [];
  const farmsByKey: SeededHierarchy["farmsByKey"] = new Map();
  let heroFarmId = "";
  let heroBuildingId = "";
  let heroCooperativeId = "";
  let heroProducerId = "";

  for (const coopSeed of COOPERATIVES) {
    const cooperative = await repositories.cooperatives.create({
      organizationId: organization.id,
      name: coopSeed.name,
      region: coopSeed.region,
    });
    cooperativeIds.push(cooperative.id);

    for (const producerSeed of coopSeed.producers) {
      const producer = await repositories.producers.create({
        cooperativeId: cooperative.id,
        name: producerSeed.name,
        contactPhone: producerSeed.contactPhone,
        contactEmail: producerSeed.contactEmail,
      });

      for (const farmSeed of producerSeed.farms) {
        const farm = await repositories.farms.create({
          producerId: producer.id,
          name: farmSeed.name,
          city: farmSeed.city,
          region: farmSeed.region,
          geoLat: farmSeed.geoLat,
          geoLng: farmSeed.geoLng,
        });

        const buildingIds = new Map<string, string>();
        for (const buildingSeed of farmSeed.buildings) {
          const building = await repositories.buildings.create({
            farmId: farm.id,
            code: buildingSeed.code,
            name: buildingSeed.name,
            capacity: buildingSeed.capacity,
            zoneType: "ELEVAGE",
          });
          buildingIds.set(buildingSeed.code, building.id);
        }

        farmsByKey.set(farmSeed.name, { farmId: farm.id, producerId: producer.id, cooperativeId: cooperative.id, buildingIds });

        if (farmSeed.name === "Ferme Al Baraka") {
          heroFarmId = farm.id;
          heroBuildingId = buildingIds.get("BAT-01")!;
          heroCooperativeId = cooperative.id;
          heroProducerId = producer.id;
        }
      }
    }
  }

  return { organizationId: organization.id, cooperativeIds, farmsByKey, heroFarmId, heroBuildingId, heroCooperativeId, heroProducerId };
}

export function buildDemoUserSpecs(hierarchy: SeededHierarchy): DemoUserSpec[] {
  return [
    { email: DEMO_ACCOUNT_EMAIL.SUPER_ADMIN, fullName: "Admin Système", role: "SUPER_ADMIN", scopeType: "GLOBAL", scopeId: null },
    {
      email: DEMO_ACCOUNT_EMAIL.COOP_MANAGER,
      fullName: "Fatima Zahra Idrissi",
      role: "COOP_MANAGER",
      scopeType: "COOPERATIVE",
      scopeId: hierarchy.heroCooperativeId,
    },
    {
      email: DEMO_ACCOUNT_EMAIL.PRODUCER,
      fullName: "Amine Benjelloun",
      role: "PRODUCER",
      scopeType: "PRODUCER",
      scopeId: hierarchy.heroProducerId,
    },
    {
      email: DEMO_ACCOUNT_EMAIL.FARM_MANAGER,
      fullName: "Youssef Amrani",
      role: "FARM_MANAGER",
      scopeType: "FARM",
      scopeId: hierarchy.heroFarmId,
    },
    {
      email: DEMO_ACCOUNT_EMAIL.TECHNICIAN,
      fullName: "Khadija Fassi",
      role: "TECHNICIAN",
      scopeType: "FARM",
      scopeId: hierarchy.heroFarmId,
    },
    { email: DEMO_ACCOUNT_EMAIL.AUDITOR, fullName: "Omar Tazi", role: "AUDITOR", scopeType: "GLOBAL", scopeId: null },
    {
      email: DEMO_ACCOUNT_EMAIL.QUALITY_MANAGER,
      fullName: "Nadia Berrada",
      role: "QUALITY_MANAGER",
      scopeType: "GLOBAL",
      scopeId: null,
    },
  ];
}
