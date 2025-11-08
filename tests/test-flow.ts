// Quick test script to simulate the bot flow without Telegram
import "dotenv/config";
import { generateFullQuestionSet } from "./services/questions.js";
import { checkRedFlags } from "./services/redflags.js";
import { medSummary } from "./services/med.js";
import type { DynamicIntakePayload, DynamicAnswer } from "./types.js";

async function testFlow() {
  console.log("=== TESTING DYNAMIC FLOW ===\n");

  // Симулируем жалобу пользователя
  const complaint = "Три дня болит голова и слабость, возможно давление скачет";
  console.log(`Жалоба пациента: "${complaint}"\n`);

  // 1. Проверка red flags
  console.log("1️⃣ Checking red flags...");
  const redFlags = await checkRedFlags(complaint);
  console.log(`   Urgency: ${redFlags.urgency_level}`);
  console.log(`   Is urgent: ${redFlags.is_urgent}`);
  console.log(`   Reasoning: ${redFlags.reasoning}\n`);

  // 2. Генерация вопросов
  console.log("2️⃣ Generating questions...");
  const questions = await generateFullQuestionSet(complaint);
  console.log(`   Generated ${questions.length} questions:`);
  questions.forEach((q, i) => {
    console.log(`   ${i + 1}. [${q.type}] ${q.question_text}`);
  });
  console.log();

  // 3. Симулируем ответы пользователя
  console.log("3️⃣ Simulating user answers...");
  const mockAnswers: Record<string, any> = {
    "age": 35,
    "sex": "Женский",
    "duration": "1_3",
    "temperature": 36.6,
    "pain_intensity": 7,
    "severity": 6
  };

  const dynamicAnswers: DynamicAnswer[] = questions.map(q => {
    const value = mockAnswers[q.id] ?? null;
    console.log(`   ${q.id}: ${value}`);
    return {
      question_id: q.id,
      question_text: q.question_text,
      value: value,
      skipped: value === null
    };
  });
  console.log();

  // 4. Создаем payload
  console.log("4️⃣ Creating intake payload...");
  const payload: DynamicIntakePayload = {
    patient: {
      tg_id: 123456,
      age: mockAnswers["age"],
      sex: mockAnswers["sex"]
    },
    encounter: {
      started_at: new Date().toISOString(),
      source: "telegram"
    },
    questionnaire: {
      version: "0.2.0",
      locale: "ru",
      type: "dynamic"
    },
    chief_complaint: complaint,
    red_flag_level: redFlags.urgency_level,
    dynamic_answers: dynamicAnswers,
    meta: { consent: true }
  };
  console.log("   Payload created\n");

  // 5. Получаем медицинское резюме
  console.log("5️⃣ Getting medical summary...");
  const summary = await medSummary(payload);

  console.log("\n=== FINAL SUMMARY ===");
  console.log(`🚩 Red flags (${summary.red_flags.length}):`);
  summary.red_flags.forEach(f => console.log(`   • ${f}`));

  console.log(`\n🔍 Likely causes (${summary.likely_causes.length}):`);
  summary.likely_causes.forEach(c => {
    console.log(`   • ${c.name}`);
    console.log(`     → ${c.rationale}`);
  });

  console.log(`\n💡 Next steps (${summary.next_steps.length}):`);
  summary.next_steps.forEach(s => console.log(`   • ${s}`));

  console.log(`\n⏰ Urgency: ${summary.urgency}`);

  console.log("\n=== TEST COMPLETE ===");
}

testFlow().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
