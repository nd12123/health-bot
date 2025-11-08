import { z } from "zod";
import { hfChat } from "../providers/llm.js";

// Типы вопросов
export const DynamicQuestionSchema = z.object({
  id: z.string(),
  question_text: z.string(),
  type: z.enum([
    "text",
    "scale_0_10",
    "yes_no",
    "multiple_choice",
    "number",
    "duration"
  ]),
  options: z.array(z.string()).optional(),
  required: z.boolean().default(true),
  validation_hint: z.string().optional(),
  allow_skip: z.boolean().default(false) // можно ли ответить "Не знаю"
});

export type DynamicQuestion = z.infer<typeof DynamicQuestionSchema>;

export const QuestionSetSchema = z.object({
  questions: z.array(DynamicQuestionSchema),
  reasoning: z.string().optional().default("Вопросы подобраны на основе жалобы пациента")
});

export type QuestionSet = z.infer<typeof QuestionSetSchema>;

// Обязательные вопросы - но могут быть пропущены если уже заполнены
function getDefaultQuestions(prefilled?: Record<string, any>): DynamicQuestion[] {
  const questions: DynamicQuestion[] = [];

  // Age - только если не заполнен
  if (!prefilled?.age) {
    questions.push({
      id: "age",
      question_text: "Укажите ваш возраст (полных лет):",
      type: "number",
      required: true,
      validation_hint: "число от 1 до 120",
      allow_skip: false
    });
  }

  // Sex - только если не заполнен
  if (!prefilled?.sex) {
    questions.push({
      id: "sex",
      question_text: "Укажите ваш пол:",
      type: "multiple_choice",
      options: ["Мужской", "Женский", "Другое"],
      required: true,
      allow_skip: false
    });
  }

  // Duration - только если не заполнен
  if (!prefilled?.duration) {
    questions.push({
      id: "duration",
      question_text: "Сколько длится текущее состояние?",
      type: "duration",
      required: true,
      allow_skip: false
    });
  }

  return questions;
}

const SYSTEM_PROMPT = `
You are a clinical assistant. Generate 3-5 ADDITIONAL clarifying questions based on patient complaint.

IMPORTANT:
- Respond in RUSSIAN ONLY. Use Cyrillic (Кириллица). Do NOT use Chinese characters (中文).
- DO NOT include basic questions (age, sex, duration) - they are already included
- Questions should be specific to the complaint
- Use simple Russian language (простой русский язык)
- Priority: questions that help identify red flags and emergency conditions
- Focus on clinical assessment, differential diagnosis, and red flag detection

Доступные типы:
- "text" — свободный текст
- "scale_0_10" — шкала 0-10 (боль, недомогание)
- "yes_no" — да/нет/не знаю
- "multiple_choice" — выбор из списка (укажи options)
- "number" — число (температура, пульс, давление)

Верни JSON:
{
  "questions": [
    {
      "id": "уникальный_код",
      "question_text": "Текст вопроса",
      "type": "тип",
      "options": ["вариант1", "вариант2"], // только для multiple_choice
      "required": true/false,
      "allow_skip": true/false, // можно ли ответить "Не знаю"
      "validation_hint": "подсказка" // опционально
    }
  ],
  "reasoning": "Почему выбраны эти вопросы"
}

Примеры адаптации:
- "Головная боль" → локализация, характер (пульсирующая/давящая), светобоязнь, тошнота, ригидность затылка
- "Кашель" → сухой/влажный, температура, одышка, боль в груди
- "Боль в животе" → локализация, характер, рвота, стул, кровь в стуле
- "Температура" → значение, озноб, сыпь, другие симптомы
- "Боль в груди" → локализация, иррадиация, одышка, связь с нагрузкой

Генерируй 3-5 вопросов. Фокус на тревожные признаки и дифференциальную диагностику.
`;

function extractFirstJsonObject(text: string): string | null {
  const stripCodeFences = (s: string) =>
    s.replace(/^```json\s*/i, "")
     .replace(/^```\s*/i, "")
     .replace(/\s*```$/i, "")
     .trim();

  try { JSON.parse(text); return text; } catch {}

  const noFences = stripCodeFences(text);
  try { JSON.parse(noFences); return noFences; } catch {}

  let i = noFences.indexOf("{");
  while (i !== -1) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < noFences.length; j++) {
      const c = noFences[j];
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
            const candidate = noFences.slice(i, j + 1);
            try { JSON.parse(candidate); return candidate; } catch {}
            break;
          }
        }
      }
    }
    i = noFences.indexOf("{", i + 1);
  }
  return null;
}

// Генерация дополнительных вопросов на основе жалобы
export async function generateContextualQuestions(chiefComplaint: string): Promise<DynamicQuestion[]> {
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: `Жалоба пациента: "${chiefComplaint}"\n\nСгенерируй 3-5 дополнительных вопросов.`
    }
  ];

  const tryParse = (text: string): QuestionSet | null => {
    const extracted = extractFirstJsonObject(text);
    if (!extracted) return null;
    try {
      const json = JSON.parse(extracted);
      const parsed = QuestionSetSchema.safeParse(json);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };

  try {
    let raw = await hfChat(messages, 1024, 0.5);
    console.log("🔍 Question generation response (attempt 1):\n", raw);

    const v1 = tryParse(raw);
    if (v1) {
      console.log(`✅ Generated ${v1.questions.length} contextual questions:`, v1.reasoning);
      return v1.questions;
    }

    // retry
    console.log("⚠️ Question generation failed, retrying...");
    const raw2 = await hfChat([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Верни ТОЛЬКО валидный JSON. Предыдущий ответ:\n${raw}` }
    ], 800, 0);

    console.log("🔍 Question generation response (attempt 2):\n", raw2);

    const v2 = tryParse(raw2);
    if (v2) {
      console.log(`✅ Generated ${v2.questions.length} contextual questions (retry):`, v2.reasoning);
      return v2.questions;
    }
  } catch (err) {
    console.error("❌ Failed to generate contextual questions:", err);
  }

  // fallback: базовые общие вопросы
  console.warn("Using fallback contextual questions");
  return [
    {
      id: "temperature",
      question_text: "Какая сейчас температура? (например 37.5)",
      type: "number",
      required: false,
      validation_hint: "число от 35 до 42",
      allow_skip: true
    },
    {
      id: "severity",
      question_text: "Оцените общее недомогание (0 — нормально, 10 — очень плохо):",
      type: "scale_0_10",
      required: true,
      allow_skip: false
    },
    {
      id: "other_symptoms",
      question_text: "Есть ли другие симптомы? Опишите:",
      type: "text",
      required: false,
      allow_skip: true
    }
  ];
}

// Полный набор вопросов: обязательные (если не заполнены) + контекстные
export async function generateFullQuestionSet(
  chiefComplaint: string,
  prefilled?: Record<string, any>
): Promise<DynamicQuestion[]> {
  const contextual = await generateContextualQuestions(chiefComplaint);
  const defaults = getDefaultQuestions(prefilled);
  return [...defaults, ...contextual];
}
