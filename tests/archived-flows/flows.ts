import { Bot } from "grammy";
import { getState, resetState } from "../storage.js";
import {
  scaleKeyboard, bucketKeyboard, bucketHuman,
  sexKeyboard, assocKeyboard, comorbKeyboard
} from "../questioannaire.js";
import { intakeSchema } from "../schema.js";
import { medSummary } from "../services/med.js";
import { buildIntakeFromState } from "../utils/intake.js";
import { bullets, formatUrgency } from "../utils/format.js";

export function registerFlows(bot: Bot) {
  // /start
  bot.command("start", async (ctx) => {
    const s = getState(ctx.chat!.id);
    s.step = 0; s.answers = {}; s.startedAt = new Date().toISOString(); s.consent = false;
    await ctx.reply(
      "Это помощник клиники. Я задам несколько вопросов и подготовлю краткое резюме для врача.\n\n" +
      "Важно: я не ставлю диагнозов и не назначаю лечение."
    );
    await ctx.reply("Согласны продолжить и передать данные врачу? (да/нет)");
  });

  // согласие
 // согласие на шаге 0
bot.on(":text", async (ctx, next) => {
  const s = getState(ctx.chat!.id);
  // интересуемся только когда ещё не начато и нет согласия
  if (s.step !== 0 || s.consent) return next();

  const txt = ctx.message!.text!.trim().toLowerCase();
  if (/^(да|соглас)/i.test(txt)) {
    s.consent = true;
    s.step = 1;
    await ctx.reply("1) Опишите главную жалобу (что беспокоит больше всего?)");
    return; // не зовём next — мы уже обработали
  }
  if (/^нет$/i.test(txt)) {
    resetState(ctx.chat!.id);
    await ctx.reply("Понимаю. Если передумаете — /start");
    return;
  }
  // любое другое — просим подтвердить да/нет
  await ctx.reply("Пожалуйста, ответьте «да» или «нет». Либо /start, чтобы начать заново.");
});


  // шаг 1: жалоба (текст)
  bot.on(":text", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (!s.consent) return next();
    if (s.step !== 1) return next();
    const txt = ctx.message!.text!.trim();
    if (txt.length < 3) return ctx.reply("Немного подробнее, пожалуйста (минимум 3 символа).");

    s.answers["chief_complaint"] = txt;
    s.step = 2;
    await ctx.reply("2) Оцените интенсивность боли/недомогания (0–10):", { reply_markup: scaleKeyboard("pain") });
  });

  // шаг 2: шкала боли
  bot.callbackQuery(/^pain:(\d+)$/, async (ctx) => {
    const s = getState(ctx.chat!.id);
    if (s.step !== 2) return ctx.answerCallbackQuery();
    s.answers["pain_score"] = Number(ctx.match![1]);
    s.step = 3;
    await ctx.answerCallbackQuery("Принято");
    await ctx.editMessageReplyMarkup();
    await ctx.reply("3) Сколько длится текущее состояние?", { reply_markup: bucketKeyboard("dur") });
  });

  // шаг 3: длительность
  bot.callbackQuery(/^dur:(.+)$/, async (ctx) => {
    const s = getState(ctx.chat!.id);
    if (s.step !== 3) return ctx.answerCallbackQuery();
    s.answers["duration_days"] = ctx.match![1];
    s.step = 4;
    await ctx.answerCallbackQuery("Принято");
    await ctx.editMessageReplyMarkup();
    await ctx.reply("4) Какая сейчас температура? (например 37.5)");
  });

  // шаг 4: температура
  bot.on(":text", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (!s.consent) return next();
    if (s.step !== 4) return next();
    const v = Number(ctx.message!.text!.replace(",", "."));
    if (!Number.isFinite(v) || v < 30 || v > 45) {
      return ctx.reply("Пожалуйста, укажите корректное значение (например 37.2).");
    }
    s.answers["fever_c"] = v;
    s.step = 5;
    await ctx.reply("5) Оцените одышку (0–10):", { reply_markup: scaleKeyboard("sob") });
  });

  // шаг 5: одышка
  bot.callbackQuery(/^sob:(\d+)$/, async (ctx) => {
    const s = getState(ctx.chat!.id);
    if (s.step !== 5) return ctx.answerCallbackQuery();
    s.answers["breath_shortness"] = Number(ctx.match![1]);
    s.step = 6;
    await ctx.answerCallbackQuery("Принято");
    await ctx.editMessageReplyMarkup();
    await ctx.reply("6) Укажите возраст (полных лет):");
  });

  // шаг 6: возраст
  bot.on(":text", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (!s.consent) return next();
    if (s.step !== 6) return next();
    const age = Number(ctx.message!.text!.trim());
    if (!Number.isFinite(age) || age < 1 || age > 120) {
      return ctx.reply("Введите возраст числом (1–120).");
    }
    s.answers["age"] = Math.round(age);
    s.step = 7;
    await ctx.reply("7) Укажите пол:", { reply_markup: sexKeyboard() });
  });

  // шаг 7: пол
  bot.callbackQuery(/^sex:(male|female|other)$/, async (ctx) => {
    const s = getState(ctx.chat!.id);
    if (s.step !== 7) return ctx.answerCallbackQuery();
    s.answers["sex"] = ctx.match![1];
    s.step = 8;
    await ctx.answerCallbackQuery("Принято");
    await ctx.editMessageReplyMarkup();
    s.answers["assoc"] = [];
    await ctx.reply("8) Отметьте сопутствующие симптомы, затем «Готово».", {
      reply_markup: assocKeyboard(new Set())
    });
  });

  // шаг 8: сопутствующие симптомы (чекбокс)
  bot.callbackQuery(/^assoc:(.+)$/, async (ctx) => {
    const s = getState(ctx.chat!.id);
    if (s.step !== 8) return ctx.answerCallbackQuery();
    const val = ctx.match![1];
    if (val === "done") {
      s.step = 9;
      await ctx.answerCallbackQuery("Принято");
      await ctx.editMessageReplyMarkup();
      s.answers["comorb"] = [];
      return ctx.reply("9) Отметьте сопутствующие заболевания (если есть), затем «Готово».", {
        reply_markup: comorbKeyboard(new Set())
      });
    }
    const set = new Set<string>(Array.isArray(s.answers["assoc"]) ? s.answers["assoc"] : []);
    set.has(val) ? set.delete(val) : set.add(val);
    s.answers["assoc"] = Array.from(set);
    await ctx.answerCallbackQuery("Ок");
    await ctx.editMessageReplyMarkup({ reply_markup: assocKeyboard(set) });
  });

  // шаг 9: коморбидности (чекбокс)
  bot.callbackQuery(/^co:(.+)$/, async (ctx) => {
    const s = getState(ctx.chat!.id);
    if (s.step !== 9) return ctx.answerCallbackQuery();
    const val = ctx.match![1];
    if (val === "done") {
      s.step = 10;
      await ctx.answerCallbackQuery("Принято");
      await ctx.editMessageReplyMarkup();
      return ctx.reply("10) Принимаете лекарства? Если да — перечислите через запятую. Если нет — напишите «нет».");
    }
    const set = new Set<string>(Array.isArray(s.answers["comorb"]) ? s.answers["comorb"] : []);
    set.has(val) ? set.delete(val) : set.add(val);
    s.answers["comorb"] = Array.from(set);
    await ctx.answerCallbackQuery("Ок");
    await ctx.editMessageReplyMarkup({ reply_markup: comorbKeyboard(set) });
  });

  // шаг 10: лекарства → финал (LLM)
  bot.on(":text", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (!s.consent) return next();
    if (s.step !== 10) return next();

    const txt = ctx.message!.text!.trim();
    s.answers["meds_text"] = /^нет$/i.test(txt) ? "" : txt;
    s.step = 11;

    const payload = {
      patient: {
        tg_id: ctx.from!.id,
        age: s.answers["age"],
        sex: s.answers["sex"],
      },
      encounter: { started_at: s.startedAt!, source: "telegram" as const },
      questionnaire: { version: "0.1.0" as const, locale: "ru" as const },
      responses: [
        { code: "chief_complaint",   type: "text" as const,       value: s.answers["chief_complaint"] },
        { code: "pain_score",        type: "scale_0_10" as const, value: s.answers["pain_score"] },
        { code: "duration_days",     type: "bucket" as const,     value: s.answers["duration_days"] },
        { code: "fever_c",           type: "number" as const,     value: s.answers["fever_c"] },
        { code: "breath_shortness",  type: "scale_0_10" as const, value: s.answers["breath_shortness"] },
        { code: "age",               type: "number" as const,     value: s.answers["age"] },
        { code: "sex",               type: "text" as const,       value: s.answers["sex"] },
        { code: "assoc_symptoms",    type: "list" as const,       value: s.answers["assoc"] || [] },
        { code: "comorbidities",     type: "list" as const,       value: s.answers["comorb"] || [] },
        { code: "meds_text",         type: "text" as const,       value: s.answers["meds_text"] || "" },
      ],
      meta: { consent: true }
    };

    const parsed = intakeSchema.safeParse(payload);
    if (!parsed.success) {
      console.error(parsed.error.flatten());
      await ctx.reply("Произошла ошибка при сборе данных. Попробуйте /start заново.");
      return resetState(ctx.chat!.id);
    }

    try {
      await ctx.replyWithChatAction("typing");

      const intake = buildIntakeFromState(s);
      const summary = await medSummary(intake);

      await ctx.reply(
        "✔️ Спасибо! Анкета отправлена врачу.\n\n" +
        "— Жалоба: " + s.answers["chief_complaint"] + "\n" +
        "— Интенсивность (0–10): " + s.answers["pain_score"] + "\n" +
        "— Длительность: " + bucketHuman(s.answers["duration_days"]) + "\n" +
        "— Температура: " + s.answers["fever_c"] + " °C\n" +
        "— Одышка (0–10): " + s.answers["breath_shortness"] + "\n" +
        "— Возраст: " + s.answers["age"] + "\n" +
        "— Пол: " + (s.answers["sex"] === "male" ? "мужской" : s.answers["sex"] === "female" ? "женский" : "—") + "\n" +
        "— Симптомы доп.: " + ((s.answers["assoc"] || []).join(", ") || "—") + "\n" +
        "— Сопутствующие болезни: " + ((s.answers["comorb"] || []).join(", ") || "—") + "\n" +
        "— Лекарства: " + (s.answers["meds_text"] || "—")
      );

      const msg =
        "⚕️ Предварительное резюме (не диагноз):\n\n" +
        `◼️ Тревожные признаки:\n${bullets(summary.red_flags)}\n\n` +
        `◼️ Возможные причины:\n${
          summary.likely_causes.length
            ? "• " + summary.likely_causes.map(x => `${x.name} — ${x.rationale}`).join("\n• ")
            : "—"
        }\n\n` +
        `◼️ Что можно сделать сейчас:\n${bullets(summary.next_steps)}\n\n` +
        `◼️ Срочность: ${formatUrgency(summary.urgency)}\n\n` +
        "Важно: это автоматическое резюме для врача. При ухудшении состояния обращайтесь за неотложной помощью.";

      await ctx.reply(msg);
    } catch (e) {
      console.error("medSummary error:", e);
      await ctx.reply("Извините, не удалось сформировать резюме. Попробуйте ещё раз командой /start.");
    }

    resetState(ctx.chat!.id);
  });

  bot.catch((err) => {
    console.error("Bot error:", err);
  });
}
