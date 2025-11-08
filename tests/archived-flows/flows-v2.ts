import { Bot } from "grammy";
import { getState, resetState, patchState } from "../storage.js";
import { generateFullQuestionSet } from "../services/questions.js";
import { checkRedFlags } from "../services/redflags.js";
import { medSummary } from "../services/med.js";
import {
  renderQuestion,
  validateAnswer,
  parseCallbackData,
  normalizeCallbackValue
} from "./question-renderer.js";
import type { DynamicIntakePayload, DynamicAnswer } from "../types.js";

/**
 * Новый динамический флоу:
 * Step 0: Consent
 * Step 1: Chief complaint (открытый вопрос)
 * Step 2: Red flag check + генерация вопросов
 * Step 3-N: Динамические вопросы
 * Step N+1: Финальное резюме
 */

export function registerFlowsV2(bot: Bot) {
  // === КОМАНДА /start ===
  bot.command("start", async (ctx) => {
    const chatId = ctx.chat!.id;
    resetState(chatId); // Сброс старой сессии

    const s = getState(chatId);
    s.step = 0;
    s.answers = {};
    s.startedAt = new Date().toISOString();
    s.consent = false;

    await ctx.reply(
      "👋 Здравствуйте! Я помощник клиники.\n\n" +
      "Я задам несколько вопросов и подготовлю краткое резюме для врача.\n\n" +
      "⚠️ Важно: я не ставлю диагнозов и не назначаю лечение. " +
      "При ухудшении состояния обращайтесь за неотложной помощью."
    );

    await ctx.reply(
      "Согласны продолжить и передать данные врачу?\n\n" +
      "Пожалуйста, ответьте «да» или «нет»."
    );
  });

  // === СОГЛАСИЕ (Step 0) ===
  bot.on(":text", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (s.step !== 0 || s.consent) return next();

    const txt = ctx.message!.text!.trim().toLowerCase();

    if (/^(да|соглас|yes|ok)/i.test(txt)) {
      s.consent = true;
      s.step = 1;
      await ctx.reply(
        "✅ Отлично!\n\n" +
        "Шаг 1: Опишите, что вас беспокоит?\n\n" +
        "Например: «болит голова», «температура и кашель», «боль в животе» и т.д.\n" +
        "Чем подробнее, тем лучше я смогу подобрать нужные вопросы."
      );
      return;
    }

    if (/^нет$/i.test(txt)) {
      resetState(ctx.chat!.id);
      await ctx.reply("Понимаю. Если передумаете — /start");
      return;
    }

    await ctx.reply("Пожалуйста, ответьте «да» или «нет».");
  });

  // === ГЛАВНАЯ ЖАЛОБА (Step 1) ===
  bot.on(":text", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (!s.consent) return next();
    if (s.step !== 1) return next();

    const complaint = ctx.message!.text!.trim();

    if (complaint.length < 5) {
      return ctx.reply("Пожалуйста, опишите подробнее (минимум 5 символов).");
    }

    s.chiefComplaint = complaint;
    s.step = 2;

    // Показываем typing indicator
    await ctx.replyWithChatAction("typing");

    try {
      // Проверка на red flags
      const redFlagCheck = await checkRedFlags(complaint);
      s.redFlagCheck = redFlagCheck;

      // Если критичная ситуация - предупреждаем
      if (redFlagCheck.is_urgent && redFlagCheck.warning_message) {
        await ctx.reply(`🚨 ${redFlagCheck.warning_message}`);
      }

      // Генерируем вопросы
      await ctx.reply("⏳ Подбираю вопросы...");
      const questions = await generateFullQuestionSet(complaint);
      s.generatedQuestions = questions;
      s.currentQuestionIndex = 0;
      s.answerHistory = [];

      // Переходим к первому вопросу
      s.step = 3;
      await askCurrentQuestion(ctx, s);

    } catch (err) {
      console.error("Error in red flag check or question generation:", err);
      await ctx.reply(
        "😔 Извините, произошла ошибка при обработке вашего запроса.\n" +
        "Попробуйте ещё раз: /start"
      );
      resetState(ctx.chat!.id);
    }
  });

  // === ДИНАМИЧЕСКИЕ ВОПРОСЫ (Step 3+) ===

  // Обработка callback'ов (кнопки)
  bot.on("callback_query:data", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (s.step !== 3) return next();
    if (!s.generatedQuestions || s.currentQuestionIndex === undefined) return next();

    const parsed = parseCallbackData(ctx.callbackQuery.data);
    if (!parsed) return ctx.answerCallbackQuery("Ошибка обработки");

    // Навигация назад
    if (parsed.action === "nav" && parsed.navAction === "back") {
      await ctx.answerCallbackQuery("Возвращаемся...");
      await goToPreviousQuestion(ctx, s);
      return;
    }

    // Ответ на вопрос
    if (parsed.action === "answer") {
      const currentQ = s.generatedQuestions[s.currentQuestionIndex];
      if (currentQ.id !== parsed.questionId) {
        return ctx.answerCallbackQuery("Устаревший вопрос");
      }

      const value = normalizeCallbackValue(currentQ, parsed.value!);
      s.answers[currentQ.id] = value;

      await ctx.answerCallbackQuery("✓");
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });

      // Переход к следующему вопросу или финалу
      s.currentQuestionIndex++;
      if (s.currentQuestionIndex < s.generatedQuestions.length) {
        await askCurrentQuestion(ctx, s);
      } else {
        await finalizeSummary(ctx, s);
      }
    }
  });

  // Обработка текстовых ответов (для number/text типов)
  bot.on(":text", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (s.step !== 3) return next();
    if (!s.generatedQuestions || s.currentQuestionIndex === undefined) return next();

    const currentQ = s.generatedQuestions[s.currentQuestionIndex];

    // Только для text/number вопросов
    if (currentQ.type !== "text" && currentQ.type !== "number") {
      return next();
    }

    const rawInput = ctx.message!.text!.trim();
    const validation = validateAnswer(currentQ, rawInput);

    if (!validation.valid) {
      return ctx.reply(`❌ ${validation.error}\n\nПопробуйте ещё раз.`);
    }

    // Сохраняем ответ
    s.answers[currentQ.id] = validation.value;

    // Переход к следующему вопросу или финалу
    s.currentQuestionIndex++;
    if (s.currentQuestionIndex < s.generatedQuestions.length) {
      await askCurrentQuestion(ctx, s);
    } else {
      await finalizeSummary(ctx, s);
    }
  });

  // === ERROR HANDLER ===
  bot.catch((err) => {
    console.error("Bot error:", err);
  });
}

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

async function askCurrentQuestion(ctx: any, s: any) {
  const currentQ = s.generatedQuestions![s.currentQuestionIndex!];
  const totalQuestions = s.generatedQuestions!.length;
  const canGoBack = s.currentQuestionIndex! > 0;

  const rendered = renderQuestion(currentQ, s.currentQuestionIndex!, totalQuestions, canGoBack);

  if (rendered.keyboard) {
    await ctx.reply(rendered.text, { reply_markup: rendered.keyboard });
  } else {
    await ctx.reply(rendered.text);
  }
}

async function goToPreviousQuestion(ctx: any, s: any) {
  if (s.currentQuestionIndex! <= 0) {
    return ctx.reply("Вы уже на первом вопросе.");
  }

  s.currentQuestionIndex!--;

  // Удаляем предыдущий ответ
  const prevQ = s.generatedQuestions![s.currentQuestionIndex!];
  delete s.answers[prevQ.id];

  await askCurrentQuestion(ctx, s);
}

async function finalizeSummary(ctx: any, s: any) {
  s.step = 4; // финальный этап

  await ctx.replyWithChatAction("typing");

  try {
    // Собираем ответы в структурированный формат
    const dynamicAnswers: DynamicAnswer[] = s.generatedQuestions!.map((q: any) => ({
      question_id: q.id,
      question_text: q.question_text,
      value: s.answers[q.id] ?? null,
      skipped: s.answers[q.id] === null || s.answers[q.id] === undefined
    }));

    const payload: DynamicIntakePayload = {
      patient: {
        tg_id: ctx.from!.id,
        age: s.answers["age"],
        sex: s.answers["sex"]
      },
      encounter: {
        started_at: s.startedAt!,
        source: "telegram"
      },
      questionnaire: {
        version: "0.2.0",
        locale: "ru",
        type: "dynamic"
      },
      chief_complaint: s.chiefComplaint!,
      red_flag_level: s.redFlagCheck?.urgency_level,
      dynamic_answers: dynamicAnswers,
      meta: { consent: true }
    };

    // Вызываем LLM для финального резюме
    const summary = await medSummary(payload);

    // Показываем краткий саммари ответов
    await ctx.reply(
      "✅ Спасибо! Анкета заполнена.\n\n" +
      `📋 Главная жалоба: ${s.chiefComplaint}\n` +
      `📊 Ответов получено: ${dynamicAnswers.filter((a: any) => !a.skipped).length} из ${dynamicAnswers.length}`
    );

    // Финальное резюме
    const urgencyEmoji: Record<string, string> = {
      "emergency": "🚨",
      "urgent": "⚠️",
      "urgent care": "⚠️",
      "soon": "🔔",
      "routine": "📅",
      "self-care": "🏠",
      "gp": "👨‍⚕️"
    };
    const emoji = urgencyEmoji[summary.urgency] || "📋";

    const msg =
      `${emoji} Предварительное резюме (не диагноз):\n\n` +
      `🚩 Тревожные признаки:\n${formatList(summary.red_flags)}\n\n` +
      `🔍 Возможные причины:\n${formatCauses(summary.likely_causes)}\n\n` +
      `💡 Рекомендации:\n${formatList(summary.next_steps)}\n\n` +
      `⏰ Срочность: ${formatUrgency(summary.urgency)}\n\n` +
      "⚠️ Это автоматическое резюме для врача. При ухудшении состояния обращайтесь за неотложной помощью.";

    await ctx.reply(msg);

  } catch (err) {
    console.error("Error in finalizeSummary:", err);
    await ctx.reply(
      "😔 Извините, не удалось сформировать резюме.\n" +
      "Попробуйте ещё раз: /start"
    );
  }

  resetState(ctx.chat!.id);
}

// === ФОРМАТИРОВАНИЕ ===

function formatList(items: string[]): string {
  if (!items || items.length === 0) return "  • Нет данных";
  return items.map(i => `  • ${i}`).join("\n");
}

function formatCauses(causes: Array<{ name: string; rationale: string }>): string {
  if (!causes || causes.length === 0) return "  • Нет данных";
  return causes.map(c => `  • ${c.name}\n    ${c.rationale}`).join("\n");
}

function formatUrgency(level: string): string {
  const map: Record<string, string> = {
    "emergency": "🚨 СРОЧНО! Немедленно обратитесь за медицинской помощью (скорая 103)",
    "urgent": "⚠️ Требуется консультация в течение нескольких часов",
    "urgent care": "⚠️ Требуется консультация в течение нескольких часов",
    "soon": "🔔 Рекомендуется обратиться к врачу в ближайшие 1-2 дня",
    "routine": "📅 Плановая консультация в ближайшее время",
    "self-care": "🏠 Можно справиться самостоятельно, наблюдайте за симптомами",
    "gp": "👨‍⚕️ Запишитесь на приём к терапевту"
  };
  return map[level] || level;
}
