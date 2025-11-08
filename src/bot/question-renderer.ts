import { InlineKeyboard } from "grammy";
import type { DynamicQuestion } from "../services/questions.js";

export interface RenderResult {
  text: string;           // текст вопроса с прогрессом
  keyboard?: InlineKeyboard; // клавиатура (если применимо)
  expectsTextInput: boolean; // ожидается ли текстовый ввод от пользователя
}

// Создание клавиатуры для шкалы 0-10
function createScaleKeyboard(questionId: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (let i = 0; i <= 10; i++) {
    kb.text(String(i), `answer:${questionId}:${i}`);
    if ((i + 1) % 6 === 0 && i !== 10) kb.row();
  }
  return kb;
}

// Создание клавиатуры для да/нет
function createYesNoKeyboard(questionId: string, allowSkip: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text("Да", `answer:${questionId}:yes`);
  kb.text("Нет", `answer:${questionId}:no`);
  if (allowSkip) {
    kb.text("Не знаю", `answer:${questionId}:skip`);
  }
  return kb;
}

// Создание клавиатуры для выбора из вариантов
function createMultipleChoiceKeyboard(questionId: string, options: string[], allowSkip: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  options.forEach((opt, idx) => {
    kb.text(opt, `answer:${questionId}:${idx}`);
    if (idx % 2 === 1) kb.row(); // 2 кнопки в ряд
  });
  if (allowSkip) {
    kb.row().text("Не знаю", `answer:${questionId}:skip`);
  }
  return kb;
}

// Добавление кнопки "Назад"
function addNavigationButtons(kb: InlineKeyboard, canGoBack: boolean): InlineKeyboard {
  if (canGoBack) {
    kb.row().text("◀️ Назад", "nav:back");
  }
  return kb;
}

// Рендеринг вопроса с прогрессом и UI
export function renderQuestion(
  question: DynamicQuestion,
  currentIndex: number,
  totalQuestions: number,
  canGoBack: boolean
): RenderResult {
  const progress = `Вопрос ${currentIndex + 1} из ${totalQuestions}`;
  const text = `${progress}\n\n${question.question_text}`;

  let keyboard: InlineKeyboard | undefined;
  let expectsTextInput = false;

  switch (question.type) {
    case "scale_0_10":
      keyboard = createScaleKeyboard(question.id);
      keyboard = addNavigationButtons(keyboard, canGoBack);
      break;

    case "yes_no":
      keyboard = createYesNoKeyboard(question.id, question.allow_skip);
      keyboard = addNavigationButtons(keyboard, canGoBack);
      break;

    case "multiple_choice":
      if (!question.options || question.options.length === 0) {
        throw new Error(`Question ${question.id} is multiple_choice but has no options`);
      }
      keyboard = createMultipleChoiceKeyboard(question.id, question.options, question.allow_skip);
      keyboard = addNavigationButtons(keyboard, canGoBack);
      break;

    case "duration":
    case "number":
    case "text":
      expectsTextInput = true;
      // Для текстового ввода показываем только кнопку "Назад" и "Пропустить" (если разрешено)
      keyboard = new InlineKeyboard();
      if (question.allow_skip) {
        keyboard.text("Пропустить", `answer:${question.id}:skip`);
      }
      keyboard = addNavigationButtons(keyboard, canGoBack);
      break;
  }

  // Добавляем подсказку по валидации, если есть
  const fullText = question.validation_hint
    ? `${text}\n\n💡 ${question.validation_hint}`
    : text;

  return {
    text: fullText,
    keyboard,
    expectsTextInput
  };
}

// Валидация ответа пользователя
export interface ValidationResult {
  valid: boolean;
  value?: any; // нормализованное значение
  error?: string; // сообщение об ошибке
}

export function validateAnswer(question: DynamicQuestion, rawInput: string): ValidationResult {
  const input = rawInput.trim();

  // Специальный случай: пропуск
  if (input === "skip" || input.toLowerCase() === "не знаю" || input.toLowerCase() === "пропустить") {
    if (question.allow_skip) {
      return { valid: true, value: null };
    } else {
      return { valid: false, error: "Этот вопрос обязателен для ответа." };
    }
  }

  switch (question.type) {
    case "number":
      const num = Number(input.replace(",", "."));
      if (!Number.isFinite(num)) {
        return { valid: false, error: "Пожалуйста, введите число." };
      }
      // Специальная валидация для возраста
      if (question.id === "age") {
        if (num < 1 || num > 120) {
          return { valid: false, error: "Возраст должен быть от 1 до 120 лет." };
        }
        return { valid: true, value: Math.round(num) };
      }
      // Специальная валидация для температуры
      if (question.id === "temperature") {
        if (num < 35 || num > 42) {
          return { valid: false, error: "Температура должна быть от 35 до 42°C." };
        }
        return { valid: true, value: num };
      }
      // Общая валидация
      return { valid: true, value: num };

    case "text":
      if (!question.required && input.length === 0) {
        return { valid: true, value: null };
      }
      if (input.length < 2) {
        return { valid: false, error: "Пожалуйста, введите хотя бы 2 символа." };
      }
      return { valid: true, value: input };

    case "scale_0_10":
    case "yes_no":
    case "multiple_choice":
      // Эти типы обрабатываются через callback_query, не через текст
      return { valid: false, error: "Пожалуйста, используйте кнопки для ответа." };

    case "duration":
      // Duration can be answered as text (1-3 дня, 4-7 дней, etc.)
      return { valid: true, value: input };

    default:
      return { valid: false, error: "Неизвестный тип вопроса." };
  }
}

// Парсинг callback data (answer:question_id:value)
export interface ParsedCallback {
  action: "answer" | "nav";
  questionId?: string;
  value?: string;
  navAction?: "back";
}

export function parseCallbackData(data: string): ParsedCallback | null {
  const parts = data.split(":");
  if (parts.length < 2) return null;

  const action = parts[0];

  if (action === "answer" && parts.length >= 3) {
    return {
      action: "answer",
      questionId: parts[1],
      value: parts[2]
    };
  }

  if (action === "nav" && parts[1]) {
    return {
      action: "nav",
      navAction: parts[1] as "back"
    };
  }

  return null;
}

// Нормализация значения из callback для сохранения
export function normalizeCallbackValue(question: DynamicQuestion, value: string): any {
  if (value === "skip") return null;

  switch (question.type) {
    case "scale_0_10":
      return Number(value);

    case "yes_no":
      if (value === "yes") return true;
      if (value === "no") return false;
      return null;

    case "multiple_choice":
      if (!question.options) return null;
      const idx = Number(value);
      return question.options[idx] || null;

    case "duration":
      return value; // "lt1", "1_3", etc.

    default:
      return value;
  }
}
