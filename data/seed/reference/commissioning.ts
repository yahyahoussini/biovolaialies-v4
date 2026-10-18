/**
 * Commissioning checklist (recette de mise en service) per sensor/equipment family, taken
 * verbatim from the client's BVU_TECH_ARCHITECTURE_MASTER (COMMISSIONING table). Each test
 * starts "À faire": a result only exists once someone records it with evidence.
 */
export const COMMISSIONING_REFERENCE: { code: string; equipment: string; procedure: string }[] = [
  { code: "A01", equipment: "Température / humidité", procedure: "Référence sur 3 positions" },
  { code: "A02", equipment: "CO2", procedure: "Test avec référence" },
  { code: "A03", equipment: "NH3", procedure: "Test de référence + date de mise en service" },
  { code: "A04", equipment: "H2S", procedure: "Test avec standard" },
  { code: "A05", equipment: "Pression différentielle", procedure: "Test porte ouverte/fermée + zéro" },
  { code: "A06", equipment: "Lumière", procedure: "Comparaison luxmètre" },
  { code: "C01", equipment: "Débitmètre principal", procedure: "Contrôle volumétrique" },
  { code: "C02", equipment: "Débitmètre ligne", procedure: "Test de distribution" },
  { code: "C03", equipment: "Pression eau", procedure: "Comparaison manomètre étalonné" },
  { code: "C04", equipment: "Niveau cuve", procedure: "Comparaison remplissage/vidange" },
  { code: "D01", equipment: "Cellules de charge", procedure: "Masses connues" },
  { code: "D04", equipment: "Rotation vis", procedure: "Blocage et alerte" },
  { code: "E01", equipment: "Balance automatique", procedure: "Comparaison pesée manuelle" },
  { code: "E02", equipment: "Balance mobile", procedure: "Masses de référence" },
  { code: "F02", equipment: "Caméra", procedure: "Couverture / zones aveugles / nuit" },
  { code: "H06", equipment: "Sondes incubateur", procedure: "Comparaison des sondes indépendantes" },
  { code: "H03", equipment: "Enregistreur œufs", procedure: "Test de positions sur chariot" },
  { code: "L01", equipment: "Alarme GSM", procedure: "Coupure alimentation / appel batterie" },
  { code: "L03", equipment: "Thermostat sécurité", procedure: "Test seuils" },
  { code: "O01", equipment: "Accès", procedure: "Ouverture sans badge → événement" },
];
