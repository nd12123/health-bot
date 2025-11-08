import { z } from "zod";
import { hfChat } from "../providers/llm.js";

function stripCodeFences(s: string): string {
  // убираем ```json ... ``` или ``` ... ```
  return s
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractFirstJsonObject(text: string): string | null {
  // быстрый путь: вдруг это уже чистый JSON
  try { JSON.parse(text); return text; } catch {}

  // попробуем убрать код-фенсы и ещё раз
  const noFences = stripCodeFences(text);
  try { JSON.parse(noFences); return noFences; } catch {}

  // скобочный парсер для первого {...} блока
  const s = noFences;
  let i = s.indexOf("{");
  while (i !== -1) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) {
        if (esc) { esc = false; }
        else if (c === "\\") { esc = true; }
        else if (c === "\"") { inStr = false; }
      } else {
        if (c === "\"") inStr = true;
        else if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            const candidate = s.slice(i, j + 1);
            try { JSON.parse(candidate); return candidate; } catch {}
            break; // ищем следующий '{'
          }
        }
      }
    }
    i = s.indexOf("{", i + 1);
  }
  return null;
}

export const MedSummarySchema = z.object({
  red_flags: z.array(z.string()).default([]),
  likely_causes: z.array(z.object({
    name: z.string(),
    rationale: z.string()
  })).default([]),
  next_steps: z.array(z.string()).default([]),
  urgency: z.enum(["self-care","gp","urgent care","emergency"]).default("gp")
}).strict();

function coerceJson<T>(raw: string): T {
  const candidate = extractFirstJsonObject(raw); // твоя функция извлечения
  if (!candidate) throw new Error("Не удалось распарсить JSON из ответа модели");
  return JSON.parse(candidate) as T;
}

// Парсинг текстового формата вместо JSON
function parseTextResponse(text: string): MedSummary | null {
  try {
    const result: MedSummary = {
      red_flags: [],
      likely_causes: [],
      next_steps: [],
      urgency: "gp"
    };

    // Парсим RED FLAGS
    const redFlagsMatch = text.match(/RED FLAGS:?\s*([\s\S]*?)(?=LIKELY CAUSES|$)/i);
    if (redFlagsMatch) {
      const lines = redFlagsMatch[1].split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('-'))
        .map(l => l.replace(/^-\s*/, '').trim())
        .filter(l => l.length > 0);
      result.red_flags = lines.length > 0 ? lines : ["no immediate red flags"];
    }

    // Парсим LIKELY CAUSES
    const causesMatch = text.match(/LIKELY CAUSES:?\s*([\s\S]*?)(?=NEXT STEPS|$)/i);
    if (causesMatch) {
      const lines = causesMatch[1].split('\n')
        .map(l => l.trim())
        .filter(l => /^\d+\./.test(l)); // строки, начинающиеся с цифры и точки

      for (const line of lines) {
        const match = line.match(/^\d+\.\s*(.+?)\s*[-–—]\s*(.+)$/);
        if (match) {
          result.likely_causes.push({
            name: match[1].trim(),
            rationale: match[2].trim()
          });
        }
      }
    }

    // Парсим NEXT STEPS
    const stepsMatch = text.match(/NEXT STEPS:?\s*([\s\S]*?)(?=URGENCY|$)/i);
    if (stepsMatch) {
      const lines = stepsMatch[1].split('\n')
        .map(l => l.trim())
        .filter(l => l.startsWith('-'))
        .map(l => l.replace(/^-\s*/, '').trim())
        .filter(l => l.length > 0);
      result.next_steps = lines;
    }

    // Парсим URGENCY
    const urgencyMatch = text.match(/URGENCY:?\s*(.+?)$/im);
    if (urgencyMatch) {
      const urg = urgencyMatch[1].trim().toLowerCase();
      if (["self-care", "gp", "urgent care", "emergency"].includes(urg)) {
        result.urgency = urg as any;
      }
    }

    // Валидация минимальных требований
    if (result.red_flags.length === 0) result.red_flags = ["no data"];
    if (result.likely_causes.length === 0) return null; // обязательно нужны причины
    if (result.next_steps.length === 0) return null; // обязательно нужны шаги

    return result;
  } catch (err) {
    console.error("Text parsing error:", err);
    return null;
  }
}

export type MedSummary = z.infer<typeof MedSummarySchema>;
const SYSTEM_PROMPT = `You are a clinical assistant. Analyze patient data and provide a medical summary.

IMPORTANT: Respond in RUSSIAN or ENGLISH ONLY. Do NOT use Chinese characters (中文).

Use EXACTLY this format (plain text, no JSON):

RED FLAGS:
- [list concerning signs, or write "no immediate red flags"]

LIKELY CAUSES:
1. [Name in English or Russian] - [rationale based on provided data]
2. [Name in English or Russian] - [rationale based on provided data]

NEXT STEPS:
- [recommendation 1]
- [recommendation 2]
- [recommendation 3]

URGENCY: [self-care OR gp OR urgent care OR emergency]

Example (Russian complaint):
RED FLAGS:
- no immediate red flags

LIKELY CAUSES:
1. Головная боль напряжения - 3 дня длительность, нет температуры
2. Возможная гипертония - пациент упоминает проблемы с давлением, возраст 35

NEXT STEPS:
- Мониторить давление два раза в день
- Покой и достаточное потребление воды
- Обратиться к врачу если симптомы сохраняются более 5 дней

URGENCY: gp`;


export async function medSummary(intake: Record<string, any>): Promise<MedSummary> {
  // Проверяем формат: если это новый динамический формат, форматируем его
  let patientData: string;

  if (intake.questionnaire?.type === "dynamic" && intake.dynamic_answers) {
    // Новый формат - форматируем для LLM
    const parts: string[] = [];
    parts.push(`ЖАЛОБА: ${intake.chief_complaint}`);
    parts.push("");

    if (intake.patient?.age) parts.push(`Возраст: ${intake.patient.age} лет`);
    if (intake.patient?.sex) parts.push(`Пол: ${intake.patient.sex}`);
    parts.push("");

    parts.push("ДАННЫЕ ОСМОТРА/ОПРОСА:");
    intake.dynamic_answers.forEach((a: any) => {
      if (!a.skipped && a.value !== null && a.value !== undefined) {
        let val = a.value;
        if (typeof val === "boolean") val = val ? "Да" : "Нет";
        if (Array.isArray(val)) val = val.join(", ") || "нет";
        if (a.question_id === "duration") {
          const map: Record<string, string> = {
            "lt1": "< 1 дня", "1_3": "1-3 дня", "4_7": "4-7 дней", "gt7": "> 7 дней"
          };
          val = map[val] || val;
        }
        if (a.question_id === "temperature") val = `${val}°C`;
        parts.push(`• ${a.question_text.replace(/[?:]/g, "")}: ${val}`);
      }
    });

    patientData = parts.join("\n");
  } else {
    // Старый формат - как есть
    patientData = JSON.stringify(intake);
  }

  console.log("📤 Formatted data for LLM:\n", patientData);

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: patientData }
  ];

  // 1) первый ответ
  // forceJson = false чтобы получить текстовый формат
  let text = await hfChat(messages, 1536, 0.7, false);

  console.log("🔍 RAW LLM response (attempt 1):\n", text);

  // Пытаемся распарсить как текст (новый формат)
  const textParsed = parseTextResponse(text);
  if (textParsed) {
    console.log("✅ Successfully parsed text response");
    return textParsed;
  }

  // 2) ремонтный прогон
  console.log("⚠️ First attempt failed, retrying...");
  const raw2 = await hfChat([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Please provide the analysis again following the exact format shown in the example. Previous response was incomplete:\n${text}` }
  ], 1024, 0.5, false);

  console.log("🔍 RAW LLM response (attempt 2):\n", raw2);

  const textParsed2 = parseTextResponse(raw2);
  if (textParsed2) {
    console.log("✅ Successfully parsed text response on retry");
    return textParsed2;
  }

  // 3) фоллбек, чтобы не падало
  console.error("❌ All parsing attempts failed, using fallback");
  return {
    red_flags: ["Невозможно оценить — требуется консультация врача"],
    likely_causes: [],
    next_steps: ["Обратитесь к врачу для очной консультации", "Наблюдайте за симптомами", "При ухудшении — срочная помощь"],
    urgency: "gp"
  };
}

