import type { SessionState } from "../storage.js";
import { ASSOC_SYMPTOMS, COMORBIDITIES } from "../questioannaire.js";

export type LlmIntake = {
  age?: number;
  sex?: "male" | "female";
  symptoms: string[];
  onset_days: number;
  comorbidities: string[];
  meds: string[];
};

const assocDict = Object.fromEntries(ASSOC_SYMPTOMS.map(([label, code]) => [code, label]));
const comorbDict = Object.fromEntries(COMORBIDITIES.map(([label, code]) => [code, label]));

export function buildIntakeFromState(s: SessionState): LlmIntake {
  const dur = s.answers["duration_days"]; // lt1 | 1_3 | 4_7 | gt7
  const onsetDays =
    dur === "lt1" ? 0.5 :
    dur === "1_3" ? 2 :
    dur === "4_7" ? 5.5 : 8;

  const symptoms: string[] = [];
  const cc = String(s.answers["chief_complaint"] || "").trim();
  if (cc) symptoms.push(cc);

  const t = Number(s.answers["fever_c"]);
  if (Number.isFinite(t)) symptoms.push(`температура ${t} °C`);

  const pain = Number(s.answers["pain_score"]);
  if (Number.isFinite(pain)) symptoms.push(`интенсивность ${pain}/10`);

  const sob = Number(s.answers["breath_shortness"]);
  if (Number.isFinite(sob)) symptoms.push(`одышка ${sob}/10`);

  const assocSel: string[] = Array.isArray(s.answers["assoc"]) ? s.answers["assoc"] : [];
  for (const code of assocSel) {
    const label = assocDict[code];
    if (label) symptoms.push(label);
  }

  const comorbSel: string[] = Array.isArray(s.answers["comorb"]) ? s.answers["comorb"] : [];
  const comorbidities = comorbSel.map(c => comorbDict[c]).filter(Boolean);

  const medsText: string = String(s.answers["meds_text"] || "").trim();
  const meds = medsText ? medsText.split(/[,;]\s*|\n+/).slice(0, 10) : [];

  return {
    age: typeof s.answers["age"] === "number" ? s.answers["age"] : undefined,
    sex: s.answers["sex"] === "male" || s.answers["sex"] === "female" ? s.answers["sex"] : undefined,
    symptoms,
    onset_days: onsetDays,
    comorbidities,
    meds
  };
}
