// src/storage.ts
import type { DynamicQuestion } from "./services/questions.js";
import type { RedFlagCheck } from "./services/redflags.js";

export type SessionState = {
  step: number;
  answers: Record<string, any>;
  startedAt?: string;
  consent?: boolean;

  // Новые поля для динамического флоу
  chiefComplaint?: string;           // главная жалоба пользователя
  redFlagCheck?: RedFlagCheck;       // результат проверки на red flags
  generatedQuestions?: DynamicQuestion[]; // вопросы, сгенерированные LLM
  currentQuestionIndex?: number;     // индекс текущего вопроса (0-based)
  answerHistory?: string[];          // история ответов для навигации назад

  // Медицинская карта
  card_id?: string;                  // ID медицинской карты

  // Checkbox questions (Step 2.3)
  checkboxQuestionIndex?: number;    // индекс текущего вопроса о характеристиках боли
  checkboxAnswers?: Record<string, any>; // ответы на вопросы о характеристиках боли

  // Assessment questions (Step 4)
  assessmentQuestionIndex?: number;  // индекс текущего вопроса оценки состояния
  assessmentAnswers?: Record<string, any>; // ответы на вопросы оценки состояния
};

const sessions = new Map<number, SessionState>();

export function getState(chatId: number): SessionState {
  if (!sessions.has(chatId)) sessions.set(chatId, { step: 0, answers: {} });
  return sessions.get(chatId)!;
}

export function resetState(chatId: number) {
  sessions.delete(chatId);
}

export function patchState(chatId: number, patch: Partial<SessionState>) {
  const s = getState(chatId);
  Object.assign(s, patch);
  sessions.set(chatId, s);
  return s;
}
