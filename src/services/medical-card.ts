import { randomBytes } from "crypto";
import type { MedicalCard, MedicalCardDemographics, MedicalCardChiefComplaint, MedicalCardMedicalHistory } from "../types.js";

// In-memory storage for medical cards (no DB for now)
const medicalCards = new Map<string, MedicalCard>();
const userCards = new Map<number, string[]>(); // tg_id -> [card_ids]

/**
 * Generate a simple unique ID
 */
function generateCardId(): string {
  return `card_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

/**
 * Create a new medical card
 */
export function createMedicalCard(
  tg_id: number,
  demographics: MedicalCardDemographics
): MedicalCard {
  const card_id = generateCardId();
  const now = new Date().toISOString();

  const card: MedicalCard = {
    card_id,
    tg_id,
    created_at: now,
    last_updated: now,
    status: "in_progress",
    completion_percent: 15, // Demographics done

    demographics,
  };

  medicalCards.set(card_id, card);

  // Track user's cards
  if (!userCards.has(tg_id)) {
    userCards.set(tg_id, []);
  }
  userCards.get(tg_id)!.push(card_id);

  return card;
}

/**
 * Get current active medical card for user, or create one
 */
export function getOrCreateCard(
  tg_id: number,
  demographics?: MedicalCardDemographics
): MedicalCard | null {
  const userCardIds = userCards.get(tg_id);

  // Find most recent in_progress card
  if (userCardIds && userCardIds.length > 0) {
    for (const cardId of userCardIds.reverse()) {
      const card = medicalCards.get(cardId);
      if (card && card.status === "in_progress") {
        return card;
      }
    }
  }

  // Create new if no in_progress card and demographics provided
  if (demographics) {
    return createMedicalCard(tg_id, demographics);
  }

  return null;
}

/**
 * Get medical card by ID
 */
export function getMedicalCard(card_id: string): MedicalCard | null {
  return medicalCards.get(card_id) ?? null;
}

/**
 * Update chief complaint section
 */
export function updateChiefComplaint(
  card_id: string,
  complaint: MedicalCardChiefComplaint
): MedicalCard | null {
  const card = medicalCards.get(card_id);
  if (!card) return null;

  card.chief_complaint = complaint;
  card.last_updated = new Date().toISOString();
  card.completion_percent = Math.min(50, card.completion_percent + 20); // ~35% now

  medicalCards.set(card_id, card);
  return card;
}

/**
 * Update medical history section
 */
export function updateMedicalHistory(
  card_id: string,
  history: Partial<MedicalCardMedicalHistory>
): MedicalCard | null {
  const card = medicalCards.get(card_id);
  if (!card) return null;

  card.medical_history = {
    ...card.medical_history,
    ...history,
  };
  card.last_updated = new Date().toISOString();
  card.completion_percent = Math.min(75, card.completion_percent + 15); // ~50% now

  medicalCards.set(card_id, card);
  return card;
}

/**
 * Update vitals section
 */
export function updateVitals(
  card_id: string,
  vitals: Record<string, any>
): MedicalCard | null {
  const card = medicalCards.get(card_id);
  if (!card) return null;

  card.vitals = {
    ...card.vitals,
    ...vitals,
    measured_date: new Date().toISOString().split("T")[0],
  };
  card.last_updated = new Date().toISOString();

  medicalCards.set(card_id, card);
  return card;
}

/**
 * Add assessment (from LLM)
 */
export function addAssessment(
  card_id: string,
  assessment: any
): MedicalCard | null {
  const card = medicalCards.get(card_id);
  if (!card) return null;

  card.assessment = {
    ...assessment,
    date_of_assessment: new Date().toISOString().split("T")[0],
  };
  card.status = "completed";
  card.completion_percent = 100;
  card.last_updated = new Date().toISOString();

  medicalCards.set(card_id, card);
  return card;
}

/**
 * Get all cards for a user
 */
export function getUserCards(tg_id: number): MedicalCard[] {
  const cardIds = userCards.get(tg_id) ?? [];
  return cardIds
    .map(id => medicalCards.get(id))
    .filter((card): card is MedicalCard => card !== undefined);
}

/**
 * Generate markdown summary of medical card (for display/export)
 */
export function generateCardSummary(card: MedicalCard): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Медицинская карта`);
  lines.push(`**ID:** ${card.card_id}`);
  lines.push(`**Дата создания:** ${card.created_at.split("T")[0]}`);
  lines.push(`**Статус:** ${card.status}`);
  lines.push("");

  // Demographics
  const demo = card.demographics;
  lines.push(`## Личные данные`);
  lines.push(`- **Имя:** ${demo.full_name}`);
  lines.push(`- **Дата рождения:** ${demo.date_of_birth}`);
  lines.push(`- **Пол:** ${demo.sex}`);
  if (demo.marital_status) lines.push(`- **Семейное положение:** ${demo.marital_status}`);
  if (demo.phone_number) lines.push(`- **Телефон:** ${demo.phone_number}`);
  lines.push("");

  // Chief Complaint
  if (card.chief_complaint) {
    const cc = card.chief_complaint;
    lines.push(`## Основная жалоба`);
    lines.push(`- **Жалоба:** ${cc.complaint}`);
    lines.push(`- **Начало:** ${cc.symptom_onset}`);
    lines.push(`- **Интенсивность:** ${cc.intensity}/10`);
    lines.push(`- **Усугубляющие факторы:** ${cc.aggravating_factors}`);
    lines.push(`- **Облегчающие факторы:** ${cc.alleviating_factors}`);
    lines.push(`- **Тип состояния:** ${cc.condition_type}`);
    lines.push(`- **История заболевания:** ${cc.history_of_condition}`);
    lines.push("");
  }

  // Medical History
  if (card.medical_history) {
    const mh = card.medical_history;
    lines.push(`## История болезни`);
    if (mh.previous_treatment) lines.push(`- **Предыдущее лечение:** ${mh.previous_treatment}`);
    if (mh.similar_symptoms_before) {
      lines.push(`- **Похожие симптомы ранее:** Да`);
      if (mh.previous_symptoms_details) {
        lines.push(`  ${mh.previous_symptoms_details}`);
      }
    }
    if (mh.chronic_diseases && mh.chronic_diseases.length > 0) {
      lines.push(`- **Хронические заболевания:**`);
      mh.chronic_diseases.forEach(d => lines.push(`  - ${d}`));
    }
    if (mh.surgeries_or_injuries) lines.push(`- **Операции/травмы:** ${mh.surgeries_or_injuries}`);
    if (mh.allergies && mh.allergies.length > 0) {
      lines.push(`- **Аллергии:** ${mh.allergies.join(", ")}`);
    }
    if (mh.pregnancy_or_breastfeeding && mh.pregnancy_or_breastfeeding !== "not_applicable") {
      lines.push(`- **Беременность/ГВ:** ${mh.pregnancy_or_breastfeeding}`);
    }
    if (mh.current_medications && mh.current_medications.length > 0) {
      lines.push(`- **Текущие лекарства:** ${mh.current_medications.join(", ")}`);
    }
    if (mh.smoking) lines.push(`- **Курение:** Да`);
    if (mh.alcohol_use) lines.push(`- **Алкоголь:** ${mh.alcohol_use}`);
    if (mh.substance_use) lines.push(`- **ПАВ:** ${mh.substance_use}`);
    if (mh.recent_infections) lines.push(`- **Недавние инфекции:** ${mh.recent_infections}`);
    if (mh.recent_vaccinations) lines.push(`- **Недавние прививки:** ${mh.recent_vaccinations}`);
    if (mh.occupation) lines.push(`- **Профессия:** ${mh.occupation}`);
    if (mh.recent_stressors) lines.push(`- **Стрессоры:** ${mh.recent_stressors}`);
    lines.push("");
  }

  // Vitals
  if (card.vitals && Object.keys(card.vitals).length > 0) {
    const v = card.vitals;
    lines.push(`## Жизненные показатели`);
    if (v.blood_pressure) lines.push(`- **АД:** ${v.blood_pressure}`);
    if (v.temperature) lines.push(`- **Температура:** ${v.temperature}°C`);
    if (v.pulse) lines.push(`- **Пульс:** ${v.pulse} уд/мин`);
    if (v.respiratory_rate) lines.push(`- **ЧД:** ${v.respiratory_rate} уд/мин`);
    if (v.weight) lines.push(`- **Вес:** ${v.weight} кг`);
    if (v.height) lines.push(`- **Рост:** ${v.height} см`);
    if (v.blood_sugar) lines.push(`- **Глюкоза:** ${v.blood_sugar} мг/дл`);
    if (v.cholesterol) lines.push(`- **Холестерин:** ${v.cholesterol} мг/дл`);
    lines.push("");
  }

  // Assessment
  if (card.assessment) {
    const a = card.assessment;
    lines.push(`## Оценка врача`);
    if (a.preliminary_diagnosis) lines.push(`- **Предварительный диагноз:** ${a.preliminary_diagnosis}`);
    if (a.red_flags.length > 0) {
      lines.push(`- **Тревожные признаки:** ${a.red_flags.join(", ")}`);
    }
    if (a.likely_causes.length > 0) {
      lines.push(`- **Возможные причины:**`);
      a.likely_causes.forEach(c => {
        lines.push(`  - ${c.name}: ${c.rationale}`);
      });
    }
    if (a.next_steps.length > 0) {
      lines.push(`- **Следующие шаги:**`);
      a.next_steps.forEach(s => lines.push(`  - ${s}`));
    }
    lines.push(`- **Срочность:** ${a.urgency}`);
    if (a.doctor_notes) lines.push(`- **Заметки:** ${a.doctor_notes}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Calculate completion percentage based on filled sections
 */
export function updateCompletionPercent(card_id: string): number {
  const card = medicalCards.get(card_id);
  if (!card) return 0;

  let percent = 15; // Demographics (15%)

  // Chief complaint (25%)
  if (card.chief_complaint) {
    percent += 25;
  }

  // Medical history (35%)
  if (card.medical_history) {
    let historyScore = 0;
    if (card.medical_history.similar_symptoms_before !== undefined) historyScore += 5;
    if (card.medical_history.chronic_diseases && card.medical_history.chronic_diseases.length > 0) historyScore += 10;
    if (card.medical_history.current_medications && card.medical_history.current_medications.length > 0) historyScore += 10;
    if (card.medical_history.allergies && card.medical_history.allergies.length > 0) historyScore += 10;
    percent += Math.min(35, historyScore);
  }

  // Assessment (20%)
  if (card.assessment) {
    percent += 20;
  }

  // Vitals (5%)
  if (card.vitals && Object.keys(card.vitals).length > 0) {
    percent += 5;
  }

  card.completion_percent = Math.min(100, percent);
  medicalCards.set(card_id, card);

  return card.completion_percent;
}
