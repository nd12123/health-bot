import { z } from "zod";
import { hfChat } from "../providers/llm.js";

export const RedFlagCheckSchema = z.object({
  is_urgent: z.boolean(), // требуется ли немедленная помощь
  urgency_level: z.enum(["routine", "soon", "urgent", "emergency"]),
  warning_message: z.string().optional(), // сообщение пользователю, если срочно
  reasoning: z.string() // почему определена такая срочность
});

export type RedFlagCheck = z.infer<typeof RedFlagCheckSchema>;

const RED_FLAG_PROMPT = `
Ты медицинский триаж-ассистент. Оцени жалобу пациента на предмет тревожных признаков.

Верни JSON:
{
  "is_urgent": boolean, // true если нужна НЕМЕДЛЕННАЯ помощь
  "urgency_level": "routine" | "soon" | "urgent" | "emergency",
  "warning_message": "Сообщение пациенту (только если is_urgent=true)",
  "reasoning": "Краткое обоснование оценки"
}

Уровни срочности:
- "routine" — плановая консультация (несколько дней)
- "soon" — в ближайшие 1-2 дня
- "urgent" — в течение нескольких часов
- "emergency" — НЕМЕДЛЕННО (скорая помощь)

Тревожные признаки (is_urgent=true, emergency):
- Боль в груди + одышка / потливость / иррадиация в руку/челюсть
- Внезапная сильная головная боль ("как удар") + ригидность затылка
- Одышка в покое / невозможность говорить
- Потеря сознания / обморок
- Кровохарканье
- Сильная боль в животе + рвота с кровью / черный стул
- Признаки инсульта (асимметрия лица, слабость конечностей, спутанность речи)
- Судороги впервые / длительные
- Высокая температура (>39.5°C) + ригидность затылка / сыпь не бледнеющая
- Травма с сильным кровотечением / подозрение на перелом
- Суицидальные мысли / острый психоз

Примеры:
- "Болит голова 2 дня, температура 37.5" → routine/soon
- "Внезапная сильная боль в груди, тяжело дышать" → emergency
- "Кашель неделю, температура 38" → soon
- "Сильная головная боль как удар молнии, не могу согнуть шею" → emergency

Будь осторожен: лучше переоценить срочность, чем недооценить.
Если сомневаешься — выбирай более срочный уровень.
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
    let depth = 0, inStr = false, esc = false;
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

// Быстрая проверка на критические ключевые слова (локально, без LLM)
function quickKeywordCheck(complaint: string): boolean {
  const lower = complaint.toLowerCase();
  const criticalKeywords = [
    "боль в груди",
    "не могу дышать",
    "кровохарканье",
    "кровь в рвоте",
    "потерял сознание",
    "обморок",
    "судороги",
    "парализ",
    "не могу двигать",
    "не могу говорить",
    "хочу умереть",
    "суицид",
    "черный стул",
    "сильная боль в животе",
    "травма головы"
  ];

  return criticalKeywords.some(kw => lower.includes(kw));
}

export async function checkRedFlags(chiefComplaint: string): Promise<RedFlagCheck> {
  // Быстрая проверка по ключевым словам
  const quickCheck = quickKeywordCheck(chiefComplaint);

  const messages = [
    { role: "system" as const, content: RED_FLAG_PROMPT },
    {
      role: "user" as const,
      content: `Жалоба пациента: "${chiefComplaint}"\n\nОцени срочность.`
    }
  ];

  const tryParse = (text: string): RedFlagCheck | null => {
    const extracted = extractFirstJsonObject(text);
    if (!extracted) return null;
    try {
      const json = JSON.parse(extracted);
      const parsed = RedFlagCheckSchema.safeParse(json);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };

  try {
    const raw = await hfChat(messages, 512, 0.2); // низкая температура для стабильности
    const v1 = tryParse(raw);
    if (v1) {
      console.log(`✓ Red flag check: ${v1.urgency_level} - ${v1.reasoning}`);
      return v1;
    }

    // retry
    const raw2 = await hfChat([
      { role: "system", content: RED_FLAG_PROMPT },
      { role: "user", content: `Верни ТОЛЬКО JSON. Предыдущий ответ:\n${raw}` }
    ], 512, 0);

    const v2 = tryParse(raw2);
    if (v2) return v2;
  } catch (err) {
    console.error("Red flag check failed:", err);
  }

  // fallback: если быстрая проверка нашла критическое слово
  if (quickCheck) {
    return {
      is_urgent: true,
      urgency_level: "urgent",
      warning_message: "⚠️ Обнаружены признаки, требующие внимания. Пожалуйста, ответьте на несколько вопросов, и мы оценим ситуацию.",
      reasoning: "Keyword match + LLM unavailable"
    };
  }

  // обычный случай
  return {
    is_urgent: false,
    urgency_level: "routine",
    reasoning: "No immediate red flags detected (fallback)"
  };
}
