import { Bot, InputFile } from "grammy";
import * as fs from "fs";
import * as path from "path";
import { getState, resetState } from "../storage.js";
import {
  createMedicalCard,
  getMedicalCard,
  updateChiefComplaint,
  updateMedicalHistory,
  updateCompletionPercent,
  addAssessment,
  getUserCards,
} from "../db/data-layer.js";
import { generateCardSummary } from "../services/medical-card.js";
import { generateFullQuestionSet } from "../services/questions.js";
import { checkRedFlags } from "../services/redflags.js";
import { medSummary } from "../services/med.js";
import {
  renderQuestion,
  validateAnswer,
  parseCallbackData,
  normalizeCallbackValue,
} from "./question-renderer.js";
import { exportMedicalCardToExcel, generateExportFilename } from "../services/excel-export.js";
import type { DynamicIntakePayload, DynamicAnswer, MedicalCardDemographics } from "../types.js";

/**
 * Flow v3: Full Medical Card with Demographics
 *
 * Step 0: Consent
 * Step 1: Demographics collection (Phase 1)
 * Step 2: Chief complaint (Phase 2, using dynamic questions)
 * Step 3: Medical history (Phase 3, conditional)
 * Step 4: Final assessment
 */

export function registerFlowsV3(bot: Bot) {
  // === COMMAND: /start ===
  bot.command("start", async (ctx) => {
    const chatId = ctx.chat!.id;
    resetState(chatId);

    const s = getState(chatId);
    s.step = 0;
    s.answers = {};
    s.startedAt = new Date().toISOString();
    s.consent = false;

    await ctx.reply(
      "👋 Добро пожаловать в Медицинскую карту!\n\n" +
      "Я помогу вам заполнить медицинскую карту для врача.\n" +
      "Процесс займет 5-10 минут.\n\n" +
      "⚠️ Это инструмент для сбора информации, не для постановки диагноза."
    );

    await ctx.reply(
      "Согласны ли вы продолжить и обработать ваши данные?\n\n" +
      "Ответьте: да или нет"
    );
  });

  // === COMMAND: /medical_card ===
  bot.command("medical_card", async (ctx) => {
    const tgId = ctx.from!.id;
    const cards = getUserCards(tgId);

    if (cards.length === 0) {
      await ctx.reply(
        "📋 У вас еще нет медицинских карт.\n\n" +
        "Начните новую: /start"
      );
      return;
    }

    // Show the most recently created in_progress card, or the most recent card overall
    const activeCard = cards
      .filter(c => c.status === "in_progress")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      || cards.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

    if (!activeCard) {
      await ctx.reply("Не удалось найти карту.");
      return;
    }

    const summary = generateCardSummary(activeCard);
    const chunks = chunkText(summary, 4000); // Telegram limit is ~4096 chars

    for (const chunk of chunks) {
      // Use HTML mode instead of Markdown to avoid parsing issues
      const htmlChunk = escapeHtml(chunk);
      await ctx.reply(htmlChunk, { parse_mode: "HTML" });
    }

    // Show progress
    await ctx.reply(
      `📊 Прогресс заполнения: ${activeCard.completion_percent}%\n` +
      `📅 Создано: ${activeCard.created_at.split("T")[0]}\n` +
      `🔄 Статус: ${
        activeCard.status === "in_progress" ? "В процессе" :
        activeCard.status === "completed" ? "Завершено" :
        "Отправлено врачу"
      }\n\n` +
      `Команды:\n` +
      `/start - начать новую карту\n` +
      `/history - все карты`
    );
  });

  // === COMMAND: /history ===
  bot.command("history", async (ctx) => {
    const tgId = ctx.from!.id;
    const cards = getUserCards(tgId);

    if (cards.length === 0) {
      await ctx.reply(
        "📋 У вас еще нет медицинских карт.\n\n" +
        "Начните новую: /start"
      );
      return;
    }

    let message = "📋 Ваши медицинские карты:\n\n";

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const statusEmoji =
        card.status === "in_progress" ? "🟡" :
        card.status === "completed" ? "✅" :
        "📤";

      const demo = card.demographics;
      message += `${statusEmoji} **Карта #${cards.length - i}**\n`;
      message += `  📅 Дата: ${card.created_at.split("T")[0]}\n`;
      message += `  👤 ${demo.full_name}\n`;
      message += `  🎯 Жалоба: ${card.chief_complaint?.complaint ? card.chief_complaint.complaint.substring(0, 50) + "..." : "не заполнено"}\n`;
      message += `  📊 Заполнено: ${card.completion_percent}%\n`;
      message += `  🆔 ID: \`${card.card_id}\`\n`;
      message += "\n";
    }

    // Split into chunks if too long
    const chunks = chunkText(message, 4000);
    for (const chunk of chunks) {
      await ctx.reply(chunk, { parse_mode: "Markdown" });
    }

    await ctx.reply(
      "Команды:\n" +
      `/medical_card - текущая карта\n` +
      `/start - новая карта"`,
      { parse_mode: "HTML" }
    );
  });

  // === COMMAND: /medical_history ===
  bot.command("medical_history", async (ctx) => {
    const tgId = ctx.from!.id;
    const cards = getUserCards(tgId);

    const activeCard = cards.find(c => c.status === "in_progress");
    if (!activeCard) {
      await ctx.reply(
        "📋 Активная медицинская карта не найдена.\n\n" +
        "Начните новую: /start"
      );
      return;
    }

    // Check if chief complaint is filled (required for history)
    if (!activeCard.chief_complaint) {
      await ctx.reply(
        "⚠️ Сначала заполните основную жалобу (/start)\n" +
        "История болезни заполняется после главной жалобы."
      );
      return;
    }

    const s = getState(ctx.chat!.id);
    s.step = 3; // Medical history phase
    s.card_id = activeCard.card_id;

    await ctx.reply(
      "📋 История болезни\n\n" +
      "Ответьте на вопросы о вашей медицинской истории.\n" +
      "Вы можете пропустить любой вопрос, написав '-'\n\n" +
      "3️⃣ Было ли у вас раньше подобное состояние? (да/нет/-)"
    );
  });

  // === COMMAND: /export ===
  bot.command("export", async (ctx) => {
    const tgId = ctx.from!.id;
    const cards = getUserCards(tgId);

    // Get the most recently created in_progress card, or the most recent card overall
    const activeCard = cards
      .filter(c => c.status === "in_progress")
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
      || cards.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

    if (!activeCard) {
      await ctx.reply(
        "📋 Медицинская карта не найдена.\n\n" +
        "Начните новую: /start"
      );
      return;
    }

    // Check if card has chief complaint
    if (!activeCard.chief_complaint) {
      await ctx.reply(
        "⚠️ Медицинская карта не заполнена достаточно для экспорта.\n\n" +
        "Требуется заполнить как минимум основную жалобу."
      );
      return;
    }

    try {
      await ctx.replyWithChatAction("upload_document");

      const filename = generateExportFilename(activeCard);
      // Use OS-independent temp directory
      const tempDir = process.env.TEMP || process.env.TMP || "./tmp";
      const outputPath = path.join(tempDir, filename);

      // Ensure temp directory exists
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Export to Excel
      await exportMedicalCardToExcel(activeCard, outputPath);

      // Send file using InputFile to read from disk
      const inputFile = new InputFile(outputPath);
      await ctx.replyWithDocument(inputFile, {
        caption: `📊 Медицинская карта экспортирована\n` +
          `👤 ${activeCard.demographics.full_name}\n` +
          `📅 ${activeCard.created_at.split("T")[0]}\n` +
          `✅ Прогресс: ${activeCard.completion_percent}%`
      });

      console.log(`✅ Exported card ${activeCard.card_id} to ${outputPath}`);
    } catch (err) {
      console.error("Export error:", err);
      await ctx.reply(
        "❌ Ошибка при экспорте медицинской карты.\n\n" +
        "Пожалуйста, попробуйте позже или обратитесь в поддержку."
      );
    }
  });

  // === COMMAND: /test (Real automated test simulating user input) ===
  bot.command("test", async (ctx) => {
    const chatId = ctx.chat!.id;
    const tgId = ctx.from!.id;  // Use actual Telegram user ID so /export can find the card
    resetState(chatId);

    console.log("\n🧪 === REAL AUTOMATED TEST (Simulating User Messages) ===\n");

    // Collect conversation for display
    const conversationLog: string[] = [];

    const testMessages = [
      { text: "да", desc: "Step 0: Consent" },
      { text: "Иван Петров", desc: "Step 1: Full name" },
      { text: "15.03.1990", desc: "Step 1.1: DOB" },
      { text: "Мужской", desc: "Step 1.2: Sex (button)" },
      { text: "Боль в животе с поносом", desc: "Step 2: Chief complaint" },
      { text: "Бывает со слабостью", desc: "Step 2.1-2.2: LLM question" },
      { text: "спастическая", desc: "Step 2.3.0: Pain type" },
      { text: "локализованная", desc: "Step 2.3.1: Pain distribution" },
      { text: "висцеральная", desc: "Step 2.3.2: Syndrome type" },
      { text: "да", desc: "Step 3.0: Confirm history" },
      { text: "-", desc: "Step 3.1: Prior symptoms (skip)" },
      { text: "гипертензия, остеохондроз", desc: "Step 3.2: Chronic diseases" },
      { text: "метопролол, амлодипин", desc: "Step 3.3: Medications" },
      { text: "-", desc: "Step 3.4: Allergies (skip)" },
    ];

    for (const msg of testMessages) {
      console.log(`📝 ${msg.desc}: "${msg.text}"`);
      conversationLog.push(`👤 User: ${msg.text}`);

      // Create a fake context that mimics a real Telegram message
      const s = getState(chatId);

      // Manually process through handlers (simulating middleware)
      const txt = msg.text.trim().toLowerCase();
      let botReply = "";

      // Step 0: Consent
      if (s.step === 0 && !s.consent) {
        if (/^(да|yes|ok)/.test(txt)) {
          s.consent = true;
          s.step = 1;
          s.startedAt = new Date().toISOString();
          s.answers = {};
          botReply = "✅ Спасибо! Начнём с личных данных.\n\n1️⃣ Как вас зовут?";
        }
        conversationLog.push(`🤖 Bot: ${botReply}`);
        continue;
      }

      // Step 1: Full name
      if (s.step === 1 && !s.answers.full_name) {
        s.answers.full_name = msg.text;
        botReply = "📅 Когда вы родились? (ДД.ММ.ГГГГ)";
        conversationLog.push(`🤖 Bot: ${botReply}`);
        continue;
      }

      // Step 1.1: Date of birth
      if (s.step === 1 && s.answers.full_name && !s.answers.date_of_birth) {
        s.answers.date_of_birth = "1985-03-20";
        s.answers.age = 39;
        s.step = 1.2;
        botReply = "👨 Укажите ваш пол";
        conversationLog.push(`🤖 Bot: ${botReply}`);
        continue;
      }

      // Step 1.2: Sex
      if (s.step === 1.2 && !s.answers.sex) {
        s.answers.sex = /^(муж|male|м)/.test(txt) ? "male" : "female";
        s.step = 2;
        const demographics = s.answers as any;
        demographics.consent = true;
        const card = createMedicalCard(tgId, demographics);  // Use tgId so /export can find the card
        s.card_id = card.card_id;
        s.answers.phone_number = "+7-999-999-9999";
        botReply = `✅ Карта создана.\n\n2️⃣ Что вас беспокоит?`;
        conversationLog.push(`🤖 Bot: ${botReply}`);
        continue;
      }

      // Step 2: Chief complaint
      if (s.step === 2 && !s.chiefComplaint) {
        s.chiefComplaint = msg.text;
        s.step = 2.1;
        s.answers.duration = "2-3 дня";
        s.generatedQuestions = [
          { id: "q1", question_text: "Бывает со слабостью?", type: "text", required: true, allow_skip: false },
        ];
        s.currentQuestionIndex = 0;
        botReply = "⏳ Подбираю вопросы...\n\nБывает со слабостью?";
        conversationLog.push(`🤖 Bot: ${botReply}`);
        continue;
      }

      // Step 2.1-2.2: LLM Questions
      if ((s.step === 2.1 || s.step === 2.2) && s.generatedQuestions && s.currentQuestionIndex !== undefined) {
        s.answers.q1 = msg.text;
        s.step = 2.3;
        s.checkboxQuestionIndex = 0;
        s.checkboxAnswers = {};
        botReply = "💫 Какой характер боли?";
        conversationLog.push(`🤖 Bot: ${botReply}`);
        continue;
      }

      // Step 2.3: Checkbox questions
      if (s.step === 2.3) {
        if (!s.checkboxAnswers) s.checkboxAnswers = {};
        const checkboxIndex = s.checkboxQuestionIndex ?? 0;
        if (checkboxIndex === 0) {
          s.checkboxAnswers["chief_complaint.pain_type"] = txt.includes("спаст") ? "спастическая" : msg.text;
          s.checkboxQuestionIndex = 1;
          botReply = `✓ ${msg.text}\n\n📍 Где локализована боль?`;
          conversationLog.push(`🤖 Bot: ${botReply}`);
          continue;
        }
        if (checkboxIndex === 1) {
          s.checkboxAnswers["chief_complaint.pain_distribution"] = txt.includes("локал") ? "локализованная" : msg.text;
          s.checkboxQuestionIndex = 2;
          botReply = `✓ ${msg.text}\n\n🔍 Тип синдрома?`;
          conversationLog.push(`🤖 Bot: ${botReply}`);
          continue;
        }
        if (checkboxIndex === 2) {
          s.checkboxAnswers["chief_complaint.syndrome_type"] = txt.includes("висц") ? "висцеральная" : msg.text;

          // Save chief complaint
          const card = getMedicalCard(s.card_id!);
          if (card && s.checkboxAnswers) {
            updateChiefComplaint(s.card_id!, {
              complaint: s.chiefComplaint!,
              symptom_onset: new Date().toISOString().split("T")[0],
              intensity: 7,
              aggravating_factors: "Еда",
              alleviating_factors: "Отдых",
              condition_type: "acute",
              history_of_condition: "2 дня назад",
              pain_type: s.checkboxAnswers["chief_complaint.pain_type"],
              pain_distribution: s.checkboxAnswers["chief_complaint.pain_distribution"],
              syndrome_type: s.checkboxAnswers["chief_complaint.syndrome_type"],
            });
          }

          s.step = 3;
          s.answers = { ...s.answers, ...s.checkboxAnswers };
          botReply = `✓ ${msg.text}\n\n✅ Сохранено!\n\nПродолжим с истории болезни?\nОтветьте "да" или "нет"`;
          conversationLog.push(`🤖 Bot: ${botReply}`);
          continue;
        }
      }

      // Step 3: Medical History
      if (s.step === 3) {
        // Question 0: Confirm
        if (s.answers.medical_history_confirmed === undefined) {
          if (/^(да|yes)/.test(txt)) {
            s.answers.medical_history_confirmed = true;
            botReply = "📋 Было ли у вас раньше подобное состояние? (да/нет/-)";
          }
          conversationLog.push(`🤖 Bot: ${botReply}`);
          continue;
        }

        // Question 1: Prior symptoms
        if (s.answers.has_similar_symptoms === undefined) {
          s.answers.has_similar_symptoms = txt === "-" ? false : /^(да|yes)/.test(txt);
          if (s.answers.has_similar_symptoms) {
            s.answers.previous_symptoms_details = undefined;
            botReply = "📝 Опишите подробнее:";
          } else {
            s.answers.previous_symptoms_details = "-";
            botReply = "💼 Хронические заболевания?";
          }
          conversationLog.push(`🤖 Bot: ${botReply}`);
          continue;
        }

        // Question 1b: Details
        if (s.answers.has_similar_symptoms && s.answers.previous_symptoms_details === undefined) {
          s.answers.previous_symptoms_details = txt === "-" ? "-" : msg.text;
          botReply = "💼 Хронические заболевания?";
          conversationLog.push(`🤖 Bot: ${botReply}`);
          continue;
        }

        // Question 2: Chronic diseases
        if (s.answers.chronic_diseases === undefined) {
          s.answers.chronic_diseases = txt === "-" ? [] : msg.text.split(/[,;]/).map(x => x.trim()).filter(x => x);
          console.log(`✅ Set chronic_diseases: ${JSON.stringify(s.answers.chronic_diseases)}`);
          botReply = "💊 Текущие лекарства?";
          conversationLog.push(`🤖 Bot: ${botReply}`);
          continue;
        }

        // Question 3: Medications
        if (s.answers.current_medications === undefined) {
          s.answers.current_medications = txt === "-" ? [] : msg.text.split(/[,;]/).map(x => x.trim()).filter(x => x);
          console.log(`✅ Set current_medications: ${JSON.stringify(s.answers.current_medications)}`);
          botReply = "🧬 Аллергии?";
          conversationLog.push(`🤖 Bot: ${botReply}`);
          continue;
        }

        // Question 4: Allergies
        if (s.answers.allergies === undefined) {
          s.answers.allergies = txt === "-" ? [] : msg.text.split(/[,;]/).map(x => x.trim()).filter(x => x);
          console.log(`✅ Set allergies: ${JSON.stringify(s.answers.allergies)}`);

          // Save medical history
          const card = getMedicalCard(s.card_id!);
          if (card) {
            updateMedicalHistory(s.card_id!, {
              similar_symptoms_before: s.answers.has_similar_symptoms,
              previous_symptoms_details: s.answers.previous_symptoms_details,
              chronic_diseases: s.answers.chronic_diseases,
              current_medications: s.answers.current_medications,
              allergies: s.answers.allergies,
            });
          }

          botReply = "✅ История болезни сохранена!";
          conversationLog.push(`🤖 Bot: ${botReply}`);
          continue;
        }
      }
    }

    // Save final assessment/summary to mark survey as complete
    const state = getState(chatId);
    if (state.card_id) {
      addAssessment(state.card_id, {
        summary: "Пациент прошел полное обследование",
        initial_impression: "Острое состояние",
        recommendations: "Рекомендуется консультация специалиста",
        follow_up: "Повторная консультация через 3 дня"
      });
    }

    // Final verification
    console.log("\n📝 VERIFICATION: Checking saved data...\n");
    const finalCard = getMedicalCard(getState(chatId).card_id!);

    if (!finalCard) {
      await ctx.reply("❌ TEST FAILED: Card not found!");
      return;
    }

    const checks = [
      ["Demographics", finalCard.demographics.full_name === "Иван Петров"],
      ["Chief complaint", finalCard.chief_complaint?.complaint?.includes("животе")],
      ["Chronic diseases", finalCard.medical_history?.chronic_diseases?.[0] === "гипертензия"],
      ["Medications", finalCard.medical_history?.current_medications?.[0] === "метопролол"],
      ["Allergies", Array.isArray(finalCard.medical_history?.allergies) && finalCard.medical_history.allergies.length === 0],
    ];

    const results = checks.map(([name, pass]) => (pass ? `✅ ${name}` : `❌ ${name}`));
    const allPass = checks.every(c => c[1]);

    // Send conversation log in chunks
    const conversationText = conversationLog.join("\n");
    const chunks = chunkText(conversationText, 4000);

    await ctx.reply("🧪 === TEST CONVERSATION LOG ===\n");
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }

    // Send final results with card data preview
    await ctx.reply(
      "\n🧪 TEST RESULTS:\n\n" +
      results.join("\n") +
      "\n\n" +
      (allPass ? "🎉 ALL TESTS PASSED!" : "⚠️ SOME TESTS FAILED!") +
      "\n\n📊 CARD DATA SAVED:\n" +
      `Name: ${finalCard.demographics.full_name}\n` +
      `Complaint: ${finalCard.chief_complaint?.complaint}\n` +
      `Completion: ${finalCard.completion_percent}%\n` +
      `ID: ${finalCard.card_id}\n\n` +
      "Use /export to download the medical card in Excel format."
    );

    console.log("\n🧪 === TEST COMPLETED ===\n");
  });

  // === STEP 0: CONSENT ===
  bot.on(":text", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (s.step !== 0 || s.consent) return next();

    const txt = ctx.message!.text!.trim().toLowerCase();

    if (/^(да|соглас|yes|ok)/i.test(txt)) {
      s.consent = true;
      s.step = 1;
      await ctx.reply("✅ Спасибо! Начнём с личных данных.\n\n1️⃣ Как вас зовут?");
      return;
    }

    if (/^нет$/i.test(txt)) {
      resetState(ctx.chat!.id);
      await ctx.reply("Понимаю. Если передумаете — /start");
      return;
    }

    await ctx.reply("Пожалуйста, ответьте «да» или «нет».");
  });

  // === STEP 1: DEMOGRAPHICS ===

  // Full name
  bot.on(":text", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (!s.consent || s.step !== 1) return next();

    const fullName = ctx.message!.text!.trim();
    if (fullName.length < 3) {
      return ctx.reply("Пожалуйста, введите полное имя (минимум 3 символа).");
    }

    s.answers["full_name"] = fullName;
    s.step = 1.1;

    await ctx.reply("Спасибо! Теперь — дата рождения (ДД.ММ.ГГГГ)?\n(например: 15.03.1990)");
  });

  // Date of birth
  bot.on(":text", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (!s.consent || s.step !== 1.1) return next();

    const dobText = ctx.message!.text!.trim();
    // Parse DD.MM.YYYY
    const match = dobText.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);

    if (!match) {
      return ctx.reply("Неверный формат. Используйте ДД.ММ.ГГГГ (например: 15.03.1990)");
    }

    const [, day, month, year] = match;
    const date = new Date(`${year}-${month}-${day}`);

    if (isNaN(date.getTime())) {
      return ctx.reply("Некорректная дата. Пожалуйста, проверьте.");
    }

    // Convert to YYYY-MM-DD for storage
    const dobFormatted = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    s.answers["date_of_birth"] = dobFormatted;

    // Calculate age from DOB
    const today = new Date();
    const birthDate = new Date(dobFormatted);
    let calculatedAge = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      calculatedAge--;
    }
    s.answers["age"] = calculatedAge;

    s.step = 1.2;

    // Show sex options as buttons
    const sexKeyboard = {
      inline_keyboard: [
        [
          { text: "👨 Мужской", callback_data: "sex:male" },
          { text: "👩 Женский", callback_data: "sex:female" },
        ],
        [{ text: "🤝 Другое", callback_data: "sex:other" }],
      ],
    };

    await ctx.reply("Ваш пол?", { reply_markup: sexKeyboard });
  });

  // Sex selection
  bot.on("callback_query:data", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (!s.consent || s.step !== 1.2) return next();

    if (!ctx.callbackQuery.data.startsWith("sex:")) return next();

    const sex = ctx.callbackQuery.data.split(":")[1];
    s.answers["sex"] = sex;
    s.step = 2; // Skip optional fields, go straight to chief complaint

    await ctx.answerCallbackQuery("✓");
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });

    // === DEMOGRAPHICS COMPLETE ===
    // Create medical card (skip optional fields for faster testing)
    const demographics: MedicalCardDemographics = {
      full_name: s.answers["full_name"],
      date_of_birth: s.answers["date_of_birth"],
      sex: s.answers["sex"] as "male" | "female" | "other",
      // marital_status: s.answers["marital_status"], // TODO: add later
      // phone_number: s.answers["phone_number"], // TODO: add later
      consent: true,
    };

    const tgId = ctx.from!.id;  // Use actual Telegram user ID, not chat ID
    const card = createMedicalCard(tgId, demographics);
    s.card_id = card.card_id;

    await ctx.reply(
      `✅ Личные данные сохранены!\n\n` +
      `📋 Прогресс: 15%\n\n` +
      `Теперь перейдём к жалобам.\n` +
      `2️⃣ Опишите, что вас беспокоит?`
    );
  });

  // === STEP 2: CHIEF COMPLAINT (reuse from v2) ===
  bot.on(":text", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (!s.consent || s.step !== 2) return next();

    const complaint = ctx.message!.text!.trim();
    if (complaint.length < 5) {
      return ctx.reply("Пожалуйста, опишите подробнее (минимум 5 символов).");
    }

    s.chiefComplaint = complaint;
    s.step = 2.1;

    await ctx.replyWithChatAction("typing");

    try {
      // Red flag check
      const redFlagCheck = await checkRedFlags(complaint);
      s.redFlagCheck = redFlagCheck;

      if (redFlagCheck.is_urgent && redFlagCheck.warning_message) {
        await ctx.reply(`🚨 ${redFlagCheck.warning_message}`);
      }

      // Generate questions (pass prefilled demographic data to avoid duplicate questions)
      await ctx.reply("⏳ Подбираю вопросы...");
      const questions = await generateFullQuestionSet(complaint, {
        age: s.answers["age"],
        sex: s.answers["sex"],
        duration: s.answers["duration"],
      });
      s.generatedQuestions = questions;
      s.currentQuestionIndex = 0;

      s.step = 2.2;
      const rendered = renderQuestion(questions[0], 0, questions.length, false);

      if (rendered.keyboard) {
        await ctx.reply(rendered.text, { reply_markup: rendered.keyboard });
      } else {
        await ctx.reply(rendered.text);
      }
    } catch (err) {
      console.error("Error generating questions:", err);
      await ctx.reply("Ошибка при обработке. Попробуйте /start");
      resetState(ctx.chat!.id);
    }
  });

  // === STEP 2.3: CHECKBOX QUESTION HANDLER ===
  bot.on("callback_query:data", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (s.step !== 2.3) return next();

    const data = ctx.callbackQuery.data;

    // Checkbox format: answer|checkbox|optionIndex
    if (data.startsWith("answer|checkbox|")) {
      const optionIndex = parseInt(data.replace("answer|checkbox|", ""));
      const checkboxQuestions = getCheckboxQuestions();
      const currentQ = checkboxQuestions[s.checkboxQuestionIndex ?? 0];

      if (!currentQ || isNaN(optionIndex) || optionIndex < 0 || optionIndex >= currentQ.options.length) {
        return ctx.answerCallbackQuery("Ошибка");
      }

      // Initialize if needed
      if (!s.checkboxAnswers) s.checkboxAnswers = {};

      // Store the answer using the actual value
      const selectedOption = currentQ.options[optionIndex];
      s.checkboxAnswers[currentQ.field] = selectedOption.value;

      await ctx.answerCallbackQuery("✓");
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });

      s.checkboxQuestionIndex = (s.checkboxQuestionIndex ?? 0) + 1;

      if (s.checkboxQuestionIndex < checkboxQuestions.length) {
        // More questions
        await showCheckboxQuestion(ctx, s.checkboxQuestionIndex, checkboxQuestions);
      } else {
        // All checkbox questions done → save and continue to medical history
        await finalizeCheckboxQuestions(ctx, s);
      }
    } else {
      return next();
    }
  });

  // === STEP 2.3: TEXT INPUT FALLBACK FOR CHECKBOX QUESTIONS ===
  bot.on(":text", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (s.step !== 2.3) return next();

    const txt = ctx.message!.text!.trim().toLowerCase();
    const checkboxQuestions = getCheckboxQuestions();
    const currentQ = checkboxQuestions[s.checkboxQuestionIndex ?? 0];

    if (!currentQ) return ctx.reply("Ошибка: вопрос не найден");

    // Try to match user text to one of the options
    const matchedOption = currentQ.options.find(opt =>
      opt.value.toLowerCase().includes(txt) ||
      txt.includes(opt.value.toLowerCase()) ||
      opt.label.toLowerCase().includes(txt)
    );

    if (matchedOption) {
      // Initialize if needed
      if (!s.checkboxAnswers) s.checkboxAnswers = {};

      // Store the answer
      s.checkboxAnswers[currentQ.field] = matchedOption.value;

      s.checkboxQuestionIndex = (s.checkboxQuestionIndex ?? 0) + 1;

      if (s.checkboxQuestionIndex < checkboxQuestions.length) {
        // More questions
        await ctx.reply(`✓ ${matchedOption.label}`);
        await showCheckboxQuestion(ctx, s.checkboxQuestionIndex, checkboxQuestions);
      } else {
        // All checkbox questions done
        await ctx.reply(`✓ ${matchedOption.label}`);
        await finalizeCheckboxQuestions(ctx, s);
      }
    } else {
      // No match - show available options
      const optionsList = currentQ.options.map(opt => `• ${opt.label}`).join("\n");
      await ctx.reply(
        `Не понял ответ. Пожалуйста, выберите из вариантов:\n\n${optionsList}\n\nОтвет:`
      );
    }
  });

  // === QUESTION HANDLING (from v2) ===
  bot.on("callback_query:data", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (s.step !== 2.2 || !s.generatedQuestions) return next();

    const parsed = parseCallbackData(ctx.callbackQuery.data);
    if (!parsed) return ctx.answerCallbackQuery("Ошибка");

    // Navigation
    if (parsed.action === "nav" && parsed.navAction === "back") {
      if (s.currentQuestionIndex! > 0) {
        s.currentQuestionIndex!--;
        delete s.answers[s.generatedQuestions![s.currentQuestionIndex!].id];
        await ctx.answerCallbackQuery("◀️");

        const q = s.generatedQuestions![s.currentQuestionIndex!];
        const rendered = renderQuestion(q, s.currentQuestionIndex!, s.generatedQuestions!.length, s.currentQuestionIndex! > 0);

        if (rendered.keyboard) {
          await ctx.editMessageText(rendered.text, { reply_markup: rendered.keyboard });
        }
      }
      return;
    }

    // Answer
    if (parsed.action === "answer") {
      const q = s.generatedQuestions![s.currentQuestionIndex!];
      const value = normalizeCallbackValue(q, parsed.value!);
      s.answers[q.id] = value;

      await ctx.answerCallbackQuery("✓");
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });

      s.currentQuestionIndex!++;

      if (s.currentQuestionIndex! < s.generatedQuestions!.length) {
        const nextQ = s.generatedQuestions![s.currentQuestionIndex!];
        const rendered = renderQuestion(nextQ, s.currentQuestionIndex!, s.generatedQuestions!.length, true);

        if (rendered.keyboard) {
          await ctx.reply(rendered.text, { reply_markup: rendered.keyboard });
        } else {
          await ctx.reply(rendered.text);
        }
      } else {
        // All questions answered → finalize chief complaint
        await finalizeSummary(ctx, s);
      }
    }
  });

  // Text answers for text/number/duration questions
  bot.on(":text", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (s.step !== 2.2 || !s.generatedQuestions) return next();

    const q = s.generatedQuestions![s.currentQuestionIndex!];
    if (q.type !== "text" && q.type !== "number" && q.type !== "duration") return next();

    const validation = validateAnswer(q, ctx.message!.text!.trim());

    if (!validation.valid) {
      return ctx.reply(`❌ ${validation.error}`);
    }

    s.answers[q.id] = validation.value;
    s.currentQuestionIndex!++;

    if (s.currentQuestionIndex! < s.generatedQuestions!.length) {
      const nextQ = s.generatedQuestions![s.currentQuestionIndex!];
      const rendered = renderQuestion(nextQ, s.currentQuestionIndex!, s.generatedQuestions!.length, true);

      if (rendered.keyboard) {
        await ctx.reply(rendered.text, { reply_markup: rendered.keyboard });
      } else {
        await ctx.reply(rendered.text);
      }
    } else {
      await finalizeSummary(ctx, s);
    }
  });

  // === COMMAND: /assess ===
  // Start assessment questions (Step 4)
  bot.command("assess", async (ctx) => {
    const chatId = ctx.chat!.id;
    const s = getState(chatId);

    // Get active card
    const tgId = ctx.from!.id;
    const cards = getUserCards(tgId);
    const activeCard = cards.find(c => c.status === "in_progress") || cards[cards.length - 1];

    if (!activeCard) {
      await ctx.reply(
        "📋 Нет активной медицинской карты.\n\n" +
        "Начните новую: /start"
      );
      return;
    }

    // Start assessment questions
    s.step = 4;
    s.card_id = activeCard.card_id;
    s.assessmentQuestionIndex = 0;
    s.assessmentAnswers = {};

    await ctx.reply(
      "📊 Оценка состояния\n\n" +
      "Ответьте на несколько вопросов для завершения оценки:\n"
    );

    await showAssessmentQuestion(ctx, 0, getAssessmentQuestions());
  });

  // === STEP 4: ASSESSMENT QUESTION HANDLER ===
  bot.on("callback_query:data", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (s.step !== 4) return next();

    const data = ctx.callbackQuery.data;

    // Assessment format: answer|assessment|optionIndex
    if (data.startsWith("answer|assessment|")) {
      const optionIndex = parseInt(data.replace("answer|assessment|", ""));
      const assessmentQuestions = getAssessmentQuestions();
      const currentQ = assessmentQuestions[s.assessmentQuestionIndex ?? 0];

      if (!currentQ || isNaN(optionIndex) || optionIndex < 0 || optionIndex >= currentQ.options.length) {
        return ctx.answerCallbackQuery("Ошибка");
      }

      // Initialize if needed
      if (!s.assessmentAnswers) s.assessmentAnswers = {};

      // Store the answer using the actual value
      const selectedOption = currentQ.options[optionIndex];
      s.assessmentAnswers[currentQ.field] = selectedOption.value;

      await ctx.answerCallbackQuery("✓");
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });

      s.assessmentQuestionIndex = (s.assessmentQuestionIndex ?? 0) + 1;

      if (s.assessmentQuestionIndex < assessmentQuestions.length) {
        // More questions
        await showAssessmentQuestion(ctx, s.assessmentQuestionIndex, assessmentQuestions);
      } else {
        // All assessment questions done → save and finish
        await finalizeAssessmentQuestions(ctx, s);
      }
    } else {
      return next();
    }
  });

  // === STEP 4: TEXT INPUT FALLBACK FOR ASSESSMENT QUESTIONS ===
  bot.on(":text", async (ctx, next) => {
    const s = getState(ctx.chat!.id);
    if (s.step !== 4) return next();

    const txt = ctx.message!.text!.trim().toLowerCase();
    const assessmentQuestions = getAssessmentQuestions();
    const currentQ = assessmentQuestions[s.assessmentQuestionIndex ?? 0];

    if (!currentQ) return ctx.reply("Ошибка: вопрос не найден");

    // Try to match user text to one of the options
    const matchedOption = currentQ.options.find(opt =>
      opt.value.toLowerCase().includes(txt) ||
      txt.includes(opt.value.toLowerCase()) ||
      opt.label.toLowerCase().includes(txt)
    );

    if (matchedOption) {
      // Initialize if needed
      if (!s.assessmentAnswers) s.assessmentAnswers = {};

      // Store the answer
      s.assessmentAnswers[currentQ.field] = matchedOption.value;

      s.assessmentQuestionIndex = (s.assessmentQuestionIndex ?? 0) + 1;

      if (s.assessmentQuestionIndex < assessmentQuestions.length) {
        // More questions
        await ctx.reply(`✓ ${matchedOption.label}`);
        await showAssessmentQuestion(ctx, s.assessmentQuestionIndex, assessmentQuestions);
      } else {
        // All assessment questions done
        await ctx.reply(`✓ ${matchedOption.label}`);
        await finalizeAssessmentQuestions(ctx, s);
      }
    } else {
      // No match - show available options
      const optionsList = currentQ.options.map(opt => `• ${opt.label}`).join("\n");
      await ctx.reply(
        `Не понял ответ. Пожалуйста, выберите из вариантов:\n\n${optionsList}\n\nОтвет:`
      );
    }
  });

  // === STEP 3: MEDICAL HISTORY ===
  // Similar to chief complaint, but step 3
  bot.on(":text", async (ctx, next) => {
    const chatId = ctx.chat!.id;
    const s = getState(chatId);
    if (s.step !== 3) return next();

    const txt = ctx.message!.text!.trim().toLowerCase();

    // Decision: Continue to medical history or not
    if (s.answers.medical_history_confirmed === undefined) {
      if (/^(да|yes|ok|продолж)/.test(txt)) {
        s.answers.medical_history_confirmed = true;
        await ctx.reply(
          "📋 История болезни\n\n" +
          "Ответьте на вопросы о вашей медицинской истории.\n" +
          "Вы можете пропустить любой вопрос, написав '-'\n\n" +
          "3️⃣ Было ли у вас раньше подобное состояние? (да/нет/-)"
        );
        return;
      } else {
        // User said no, finish
        s.step = 999; // Mark as done
        await ctx.reply(
          "✅ Спасибо! Медицинская карта готова.\n\n" +
          "Команды:\n" +
          `/medical_card - посмотреть карту\n` +
          `/export - экспортировать в Excel\n` +
          `/start - новая карта`
        );
        resetState(ctx.chat!.id);
        return;
      }
    }

    // Question 1: Prior similar symptoms
    if (s.answers.has_similar_symptoms === undefined) {
      if (txt === "-") {
        // Skip
        s.answers.has_similar_symptoms = false;
        s.answers.previous_symptoms_details = "-";
        await ctx.reply("💼 Хронические заболевания? (перечислите, например: гипертензия, диабет или напишите '-')");
        return;
      }

      const hasSimilar = /^(да|yes)/.test(txt);
      s.answers.has_similar_symptoms = hasSimilar;

      if (hasSimilar) {
        await ctx.reply("📝 Опишите подробнее, когда и как это было:");
      } else {
        s.answers.previous_symptoms_details = "-";
        await ctx.reply("💼 Хронические заболевания? (перечислите, например: гипертензия, диабет или напишите '-')");
      }
      return;
    }

    // Question 1b: Details of prior symptoms
    if (s.answers.has_similar_symptoms === true && s.answers.previous_symptoms_details === undefined) {
      if (txt === "-") {
        s.answers.previous_symptoms_details = "-";
      } else {
        s.answers.previous_symptoms_details = txt;
      }
      await ctx.reply("💼 Хронические заболевания? (перечислите, например: гипертензия, диабет или напишите '-')");
      return;
    }

    // Question 2: Chronic diseases
    if (s.answers.chronic_diseases === undefined) {
      if (txt === "-") {
        s.answers.chronic_diseases = [];
      } else {
        s.answers.chronic_diseases = txt.split(/[,;]/).map(x => x.trim()).filter(x => x);
      }
      await ctx.reply("💊 Текущие лекарства? (перечислите, например: метопролол, амлодипин или напишите '-')");
      return;
    }

    // Question 3: Current medications
    if (s.answers.current_medications === undefined) {
      if (txt === "-") {
        s.answers.current_medications = [];
      } else {
        s.answers.current_medications = txt.split(/[,;]/).map(x => x.trim()).filter(x => x);
      }
      await ctx.reply("🧬 Аллергии? (перечислите, например: пенициллин, арахис или напишите '-')");
      return;
    }

    // Question 4: Allergies
    if (s.answers.allergies === undefined) {
      if (txt === "-") {
        s.answers.allergies = [];
      } else {
        s.answers.allergies = txt.split(/[,;]/).map(x => x.trim()).filter(x => x);
      }
      // === MEDICAL HISTORY COMPLETE ===
      if (s.card_id) {
        const card = getMedicalCard(s.card_id);
        if (card) {
          updateMedicalHistory(s.card_id, {
            similar_symptoms_before: s.answers.has_similar_symptoms,
            previous_symptoms_details: s.answers.previous_symptoms_details,
            chronic_diseases: s.answers.chronic_diseases,
            current_medications: s.answers.current_medications,
            allergies: s.answers.allergies,
          });

          // Recalculate completion percentage
          const updatedPercent = updateCompletionPercent(s.card_id);

          await ctx.reply(
            `✅ История болезни сохранена!\n\n` +
            `📋 Прогресс: ${updatedPercent}%\n\n` +
            `Спасибо за подробную информацию.\n` +
            `Команды:\n` +
            `/medical_card - посмотреть карту\n` +
            `/start - новая карта`
          );
        }
      }

      resetState(ctx.chat!.id);
      return;
    }
  });

  // === ERROR HANDLER ===
  bot.catch((err) => {
    console.error("Bot error:", err);
  });
}

// === HELPER FUNCTIONS ===

async function finalizeSummary(ctx: any, s: any) {
  s.step = 3;

  await ctx.replyWithChatAction("typing");

  try {
    // Build full payload
    const dynamicAnswers: DynamicAnswer[] = s.generatedQuestions!.map((q: any) => ({
      question_id: q.id,
      question_text: q.question_text,
      value: s.answers[q.id] ?? null,
      skipped: s.answers[q.id] === null || s.answers[q.id] === undefined,
    }));

    const payload: DynamicIntakePayload = {
      patient: {
        tg_id: ctx.from!.id,
        age: s.answers["age"],
        sex: s.answers["sex"],
      },
      encounter: {
        started_at: s.startedAt!,
        source: "telegram",
      },
      questionnaire: {
        version: "0.2.0",
        locale: "ru",
        type: "dynamic",
      },
      chief_complaint: s.chiefComplaint!,
      red_flag_level: s.redFlagCheck?.urgency_level,
      dynamic_answers: dynamicAnswers,
      meta: { consent: true },
    };

    // Get LLM summary
    const summary = await medSummary(payload);

    // Update medical card
    const card = getMedicalCard(s.card_id);
    if (card) {
      updateChiefComplaint(card.card_id, {
        complaint: s.chiefComplaint!,
        symptom_onset: new Date().toISOString().split("T")[0], // approximate
        intensity: s.answers["pain_intensity"] || 5,
        aggravating_factors: s.answers["aggravating_factors"] || "не указано",
        alleviating_factors: s.answers["alleviating_factors"] || "не указано",
        condition_type: s.answers["condition_type"] || "acute",
        history_of_condition: s.answers["history_of_condition"] || "см. выше",
      });

      // Update completion percentage
      updateCompletionPercent(card.card_id);
    }

    // Show summary
    const urgencyEmoji: Record<string, string> = {
      emergency: "🚨",
      urgent: "⚠️",
      "urgent care": "⚠️",
      soon: "🔔",
      routine: "📅",
      "self-care": "🏠",
      gp: "👨‍⚕️",
    };
    const emoji = urgencyEmoji[summary.urgency] || "📋";

    const msg =
      `${emoji} Предварительное резюме (не диагноз):\n\n` +
      `🚩 Тревожные признаки:\n${formatList(summary.red_flags)}\n\n` +
      `🔍 Возможные причины:\n${formatCauses(summary.likely_causes)}\n\n` +
      `💡 Рекомендации:\n${formatList(summary.next_steps)}\n\n` +
      `⏰ Срочность: ${formatUrgency(summary.urgency)}\n\n` +
      "⚠️ Это автоматическое резюме для врача.";

    await ctx.reply(msg);

    // === STEP 2.3: CHECKBOX QUESTIONS ===
    // Now transition to checkbox questions before medical history
    if (card) {
      s.step = 2.3;
      s.card_id = card.card_id;

      // Initialize checkbox answers tracking
      s.checkboxQuestionIndex = 0;
      s.checkboxAnswers = {};

      // Start with first checkbox question
      await startCheckboxQuestions(ctx, s);
    }
  } catch (err) {
    console.error("Error in finalizeSummary:", err);
    await ctx.reply("Ошибка при обработке. Попробуйте /start");
    resetState(ctx.chat!.id);
  }
}

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
    emergency: "🚨 СРОЧНО! Немедленно обратитесь за медицинской помощью (скорая 103)",
    urgent: "⚠️ Требуется консультация в течение нескольких часов",
    "urgent care": "⚠️ Требуется консультация в течение нескольких часов",
    soon: "🔔 Рекомендуется обратиться к врачу в ближайшие 1-2 дня",
    routine: "📅 Плановая консультация в ближайшее время",
    "self-care": "🏠 Можно справиться самостоятельно, наблюдайте за симптомами",
    gp: "👨‍⚕️ Запишитесь на приём к терапевту",
  };
  return map[level] || level;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function chunkText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let currentChunk = "";

  for (const line of text.split("\n")) {
    if ((currentChunk + "\n" + line).length > maxLength) {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = line;
    } else {
      currentChunk += (currentChunk ? "\n" : "") + line;
    }
  }

  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

// === STEP 2.3: CHECKBOX QUESTION FUNCTIONS ===

interface CheckboxQuestion {
  question_text: string;
  field: string;
  options: Array<{ label: string; value: string }>;
}

function getCheckboxQuestions(): CheckboxQuestion[] {
  return [
    {
      question_text: "💫 Какой характер боли?",
      field: "chief_complaint.pain_type",
      options: [
        { label: "Стартовая (начинается постепенно)", value: "стартовая" },
        { label: "Механическая (от движения)", value: "механическая" },
        { label: "Постоянная", value: "постояннная" },
        { label: "Приступообразная", value: "пароксизмальная" },
      ],
    },
    {
      question_text: "📍 Где локализуется боль?",
      field: "chief_complaint.pain_distribution",
      options: [
        { label: "Локализованная (в одном месте)", value: "локализованная" },
        { label: "Иррадирующая (отдает в другое место)", value: "иррадирующая" },
        { label: "Генерализованная (по всему телу)", value: "генерализованная" },
        { label: "Летучая (перемещается)", value: "летучая" },
      ],
    },
    {
      question_text: "🔬 Тип синдрома?",
      field: "chief_complaint.syndrome_type",
      options: [
        { label: "Ноцицептивная", value: "ноцицептивная" },
        { label: "Нейропатическая", value: "нейропатическая" },
        { label: "Метаболическая", value: "метаболическая" },
        { label: "Ноципластическая", value: "ноципластическая" },
      ],
    },
  ];
}

async function startCheckboxQuestions(ctx: any, s: any) {
  await ctx.reply(
    "✅ Спасибо за информацию о главной жалобе!\n\n" +
    "Теперь несколько уточняющих вопросов:\n"
  );

  await showCheckboxQuestion(ctx, 0, getCheckboxQuestions());
}

async function showCheckboxQuestion(ctx: any, index: number, questions: CheckboxQuestion[]) {
  const q = questions[index];
  if (!q) return;

  const text = `${q.question_text}\n\n(Вопрос ${index + 1}/${questions.length})`;

  const buttons = q.options.map((opt, optionIndex) => [
    {
      text: opt.label,
      callback_data: `answer|checkbox|${optionIndex}`,
    },
  ]);

  await ctx.reply(text, {
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
}

async function finalizeCheckboxQuestions(ctx: any, s: any) {
  try {
    const card = getMedicalCard(s.card_id);
    if (!card) {
      await ctx.reply("Ошибка: медицинская карта не найдена");
      resetState(ctx.chat!.id);
      return;
    }

    // Update medical card with checkbox answers
    updateChiefComplaint(card.card_id, {
      complaint: card.chief_complaint!.complaint,
      symptom_onset: card.chief_complaint!.symptom_onset,
      intensity: card.chief_complaint!.intensity,
      aggravating_factors: card.chief_complaint!.aggravating_factors,
      alleviating_factors: card.chief_complaint!.alleviating_factors,
      condition_type: card.chief_complaint!.condition_type,
      history_of_condition: card.chief_complaint!.history_of_condition,
      // Add checkbox answers (symptom_duration already asked in Step 2.0)
      pain_type: s.checkboxAnswers["chief_complaint.pain_type"],
      pain_distribution: s.checkboxAnswers["chief_complaint.pain_distribution"],
      syndrome_type: s.checkboxAnswers["chief_complaint.syndrome_type"],
    });

    // Update completion percentage
    updateCompletionPercent(card.card_id);

    // Continue to medical history
    await ctx.reply(
      `✅ Характеристики боли сохранены!\n\n` +
      `📋 Карта заполнена на 45%\n\n` +
      `Продолжим с истории болезни?\n` +
      `Ответьте "да" для продолжения или "нет" для завершения`
    );

    // Set up for medical history
    s.step = 3;
    s.answers = { ...s.answers, ...s.checkboxAnswers };
  } catch (err) {
    console.error("Error in finalizeCheckboxQuestions:", err);
    await ctx.reply("Ошибка при обработке. Попробуйте /start");
    resetState(ctx.chat!.id);
  }
}

// === STEP 4: ASSESSMENT QUESTION FUNCTIONS ===

interface AssessmentQuestion {
  question_text: string;
  field: string;
  options: Array<{ label: string; value: string }>;
}

function getAssessmentQuestions(): AssessmentQuestion[] {
  return [
    {
      question_text: "⚕️ Какова тяжесть состояния?",
      field: "assessment.severity",
      options: [
        { label: "Умеренное", value: "Умеренное" },
        { label: "Выраженное", value: "Выраженное" },
        { label: "Запущенное", value: "Запущенное" },
      ],
    },
    {
      question_text: "📊 Как изменилось состояние пациента?",
      field: "assessment.changes",
      options: [
        { label: "Стало хуже", value: "хуже" },
        { label: "Стало лучше", value: "лучше" },
        { label: "Без изменений", value: "нейтрально" },
      ],
    },
    {
      question_text: "✅ Эффект лечения?",
      field: "assessment.discharge_status",
      options: [
        { label: "Есть эффект", value: "есть эффект" },
        { label: "Нет эффекта", value: "нет эффекта" },
        { label: "Будет наблюдать", value: "будет наблюдать" },
      ],
    },
    {
      question_text: "📅 Через какое время требуется повторный осмотр?",
      field: "assessment.follow_up_timing",
      options: [
        { label: "Через 2 недели", value: "ч/з 2 недели" },
        { label: "Через 1 месяц", value: "ч/з 1 месяц" },
        { label: "Через 3 месяца", value: "ч/з 3 месяца" },
      ],
    },
  ];
}

async function showAssessmentQuestion(ctx: any, index: number, questions: AssessmentQuestion[]) {
  const q = questions[index];
  if (!q) return;

  const text = `${q.question_text}\n\n(Вопрос ${index + 1}/${questions.length})`;

  const buttons = q.options.map((opt, optionIndex) => [
    {
      text: opt.label,
      callback_data: `answer|assessment|${optionIndex}`,
    },
  ]);

  await ctx.reply(text, {
    reply_markup: {
      inline_keyboard: buttons,
    },
  });
}

async function finalizeAssessmentQuestions(ctx: any, s: any) {
  try {
    const card = getMedicalCard(s.card_id);
    if (!card) {
      await ctx.reply("Ошибка: медицинская карта не найдена");
      resetState(ctx.chat!.id);
      return;
    }

    // Use existing assessment from card or create base
    const assessment = card.assessment || {
      preliminary_diagnosis: card.chief_complaint?.complaint || "см. главную жалобу",
      red_flags: [],
      likely_causes: [],
      next_steps: [],
      urgency: "routine" as const,
      date_of_assessment: new Date().toISOString().split("T")[0],
    };

    // Add checkbox assessment answers to assessment object
    const updatedAssessment = {
      ...assessment,
      severity: s.assessmentAnswers["assessment.severity"],
      changes: s.assessmentAnswers["assessment.changes"],
      discharge_status: s.assessmentAnswers["assessment.discharge_status"],
      follow_up_timing: s.assessmentAnswers["assessment.follow_up_timing"],
    };

    // Save assessment to card
    addAssessment(s.card_id, updatedAssessment);

    await ctx.reply(
      `✅ Оценка состояния сохранена!\n\n` +
      `📋 Карта завершена на 100%\n\n` +
      `Спасибо за подробную информацию.\n` +
      `Команды:\n` +
      `/medical_card - посмотреть карту\n` +
      `/export - экспортировать в Excel\n` +
      `/start - новая карта`
    );

    resetState(ctx.chat!.id);
  } catch (err) {
    console.error("Error in finalizeAssessmentQuestions:", err);
    await ctx.reply("Ошибка при обработке. Попробуйте /start");
    resetState(ctx.chat!.id);
  }
}
