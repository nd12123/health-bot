export type Scale0to10 = 0|1|2|3|4|5|6|7|8|9|10;

// === DATABASE TYPES ===

/**
 * AppUser - Application user identity (separate from Telegram)
 * Supports multi-channel future extension
 */
export interface AppUser {
  id: string; // UUID
  tgUserId?: number; // Telegram user ID (optional for multi-channel)
  email?: string;
  displayName?: string;
  identityVerifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, any>;
}

// Старые типы (для совместимости)
export type Answer =
  | { code: "chief_complaint"; type: "text"; value: string }
  | { code: "pain_score"; type: "scale_0_10"; value: Scale0to10 }
  | { code: "duration_days"; type: "bucket"; value: "lt1" | "1_3" | "4_7" | "gt7" }
  | { code: "fever_c"; type: "number"; value: number }
  | { code: "breath_shortness"; type: "scale_0_10"; value: Scale0to10 };

export interface IntakePayload {
  patient: { tg_id: number; age?: number; sex?: "male"|"female"|"other" };
  encounter: { started_at: string; source: "telegram" };
  questionnaire: { version: "0.1.0" | "0.2.0"; locale: "ru" };
  responses: Answer[];
  meta: { consent: boolean };
}

// Новые типы для динамического флоу
export interface DynamicAnswer {
  question_id: string;
  question_text: string;
  value: any; // может быть null если пропущено
  skipped: boolean;
}

// Расширенный payload с динамическими вопросами
export interface DynamicIntakePayload {
  patient: { tg_id: number; age?: number; sex?: string };
  encounter: { started_at: string; source: "telegram" };
  questionnaire: { version: "0.2.0"; locale: "ru"; type: "dynamic" };
  chief_complaint: string; // главная жалоба
  red_flag_level?: string; // результат триажа
  dynamic_answers: DynamicAnswer[]; // ответы на динамические вопросы
  meta: { consent: boolean };
}

// === MEDICAL CARD TYPES ===

export interface MedicalCardDemographics {
  full_name: string;
  date_of_birth: string; // YYYY-MM-DD
  sex: "male" | "female" | "other";
  marital_status?: string;
  phone_number?: string;
  consent: boolean;
}

export interface MedicalCardChiefComplaint {
  complaint: string;
  symptom_onset: string; // YYYY-MM-DD
  intensity: Scale0to10;
  aggravating_factors: string;
  alleviating_factors: string;
  condition_type: "acute" | "chronic" | "post-operative" | "trauma" | "other";
  history_of_condition: string;

  // Checkbox selections (for Excel form)
  symptom_duration?: "до 2 недель" | "более 2 недель" | "более 4 месяцев";
  pain_type?: "стартовая" | "механическая" | "постояннная" | "пароксизмальная";
  pain_distribution?: "локализованная" | "иррадирующая" | "генерализованная" | "летучая";
  syndrome_type?: "ноцицептивная" | "нейропатическая" | "метаболическая" | "ноципластическая";
}

export interface MedicalCardMedicalHistory {
  previous_treatment?: string;
  similar_symptoms_before?: boolean;
  previous_symptoms_details?: string;
  chronic_diseases?: string[];
  surgeries_or_injuries?: string;
  allergies?: string[];
  pregnancy_or_breastfeeding?: "not_applicable" | "pregnant" | "breastfeeding" | "no";
  current_medications?: string[];
  smoking?: boolean;
  alcohol_use?: string; // "never" | "occasionally" | "regularly" | "heavy"
  substance_use?: string;
  recent_infections?: string;
  recent_vaccinations?: string;
  occupation?: string;
  recent_stressors?: string;
}

export interface MedicalCardVitals {
  blood_pressure?: string; // "120/80"
  blood_sugar?: number;
  cholesterol?: number;
  temperature?: number;
  pulse?: number;
  respiratory_rate?: number;
  weight?: number;
  height?: number;
  measured_date?: string; // YYYY-MM-DD
}

export interface MedicalCardAssessment {
  preliminary_diagnosis?: string;
  red_flags: string[];
  likely_causes: Array<{ name: string; rationale: string }>;
  next_steps: string[];
  urgency: "self-care" | "gp" | "urgent care" | "emergency";
  doctor_notes?: string;
  date_of_assessment: string; // YYYY-MM-DD

  // Checkbox selections (for Excel form)
  severity?: "Умеренное" | "Выраженное" | "Запущенное";
  changes?: "хуже" | "лучше" | "нейтрально";
  discharge_status?: "есть эффект" | "нет эффекта" | "будет наблюдать";
  follow_up_timing?: "ч/з 2 недели" | "ч/з 1 месяц" | "ч/з 3 месяца";
}

export interface MedicalCard {
  card_id: string; // unique ID
  tg_id: number;
  created_at: string; // ISO timestamp
  last_updated: string; // ISO timestamp
  status: "in_progress" | "completed" | "submitted_to_doctor";
  completion_percent: number; // 0-100

  // Phases
  demographics: MedicalCardDemographics;
  chief_complaint?: MedicalCardChiefComplaint;
  chiefComplaint?: MedicalCardChiefComplaint; // Camel case variant
  medical_history?: MedicalCardMedicalHistory;
  medicalHistory?: MedicalCardMedicalHistory; // Camel case variant
  vitals?: MedicalCardVitals;
  assessment?: MedicalCardAssessment;

  // Database fields
  completionPercent?: number; // Camel case variant of completion_percent
  deletedAt?: Date; // Soft delete timestamp
}
