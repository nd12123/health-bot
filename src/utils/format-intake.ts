import type { DynamicIntakePayload } from "../types.js";

/**
 * Форматирует динамический intake в читаемый формат для LLM
 */
export function formatIntakeForLLM(intake: DynamicIntakePayload): string {
  const parts: string[] = [];

  // Базовая информация
  parts.push(`ГЛАВНАЯ ЖАЛОБА: ${intake.chief_complaint}`);
  parts.push("");

  // Пациент
  const age = intake.patient.age || "не указан";
  const sex = intake.patient.sex || "не указан";
  parts.push(`ПАЦИЕНТ:`);
  parts.push(`- Возраст: ${age}`);
  parts.push(`- Пол: ${sex}`);
  parts.push("");

  // Ответы на вопросы
  parts.push(`ОТВЕТЫ НА ВОПРОСЫ:`);

  intake.dynamic_answers.forEach((answer) => {
    if (answer.skipped || answer.value === null || answer.value === undefined) {
      parts.push(`- ${answer.question_text}: [не указано]`);
    } else {
      // Форматируем значение в зависимости от типа
      let formattedValue = answer.value;

      // Если это булево значение
      if (typeof answer.value === "boolean") {
        formattedValue = answer.value ? "Да" : "Нет";
      }

      // Если это массив
      if (Array.isArray(answer.value)) {
        formattedValue = answer.value.join(", ") || "[нет]";
      }

      // Специальные форматы для некоторых вопросов
      if (answer.question_id === "duration") {
        const durationMap: Record<string, string> = {
          "lt1": "менее 1 дня",
          "1_3": "1-3 дня",
          "4_7": "4-7 дней",
          "gt7": "более 7 дней"
        };
        formattedValue = durationMap[answer.value] || answer.value;
      }

      if (answer.question_id === "temperature" && typeof answer.value === "number") {
        formattedValue = `${answer.value}°C`;
      }

      if (answer.question_id === "age" && typeof answer.value === "number") {
        formattedValue = `${answer.value} лет`;
      }

      parts.push(`- ${answer.question_text}: ${formattedValue}`);
    }
  });

  parts.push("");

  // Уровень триажа (если есть)
  if (intake.red_flag_level) {
    parts.push(`ПЕРВИЧНАЯ ОЦЕНКА СРОЧНОСТИ: ${intake.red_flag_level}`);
    parts.push("");
  }

  return parts.join("\n");
}

/**
 * Извлекает структурированные данные из динамических ответов для быстрого доступа
 */
export function extractStructuredData(intake: DynamicIntakePayload) {
  const data: Record<string, any> = {
    chief_complaint: intake.chief_complaint,
    age: intake.patient.age,
    sex: intake.patient.sex
  };

  intake.dynamic_answers.forEach((answer) => {
    if (!answer.skipped && answer.value !== null && answer.value !== undefined) {
      data[answer.question_id] = answer.value;
    }
  });

  return data;
}
