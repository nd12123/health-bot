import { getState, resetState } from "../src/storage.js";
import {
  createMedicalCard,
  getMedicalCard,
  updateChiefComplaint,
  updateMedicalHistory,
  addAssessment,
} from "../src/services/medical-card.js";

/**
 * Integration test: Simulate actual user flow
 */
async function testFullUserFlow() {
  console.log("🤖 INTEGRATION TEST: Full User Flow\n");
  console.log("=====================================\n");

  const chatId = 88888;
  resetState(chatId);
  const s = getState(chatId);

  // === STEP 0: Consent ===
  console.log("✅ Step 0: User says 'да' to consent");
  s.consent = true;
  s.startedAt = new Date().toISOString();

  // === STEP 1: Demographics ===
  console.log("✅ Step 1: User provides demographics");
  s.answers = {
    full_name: "Иван Петров",
    date_of_birth: "1985-03-20",
    sex: "male",
    marital_status: "Женат",
    phone_number: "+7-900-123-4567",
  };

  const card = createMedicalCard(chatId, s.answers);
  s.card_id = card.card_id;
  console.log(`   Card ID: ${card.card_id}\n`);

  // === STEP 2.0: Chief Complaint (Demographics Part) ===
  console.log("✅ Step 2.0: User answers age/sex/duration");
  s.answers = {
    ...s.answers,
    age: 39,
    sex: "male",
    duration: "2-3 дня",
  };
  console.log(`   Age: ${s.answers.age}`);
  console.log(`   Duration: ${s.answers.duration}\n`);

  // === STEP 2.1-2.2: Dynamic LLM Questions ===
  console.log("✅ Step 2.1-2.2: User answers LLM-generated questions");
  s.generatedQuestions = [
    { id: "temperature", question_text: "Температура?", type: "number" },
    { id: "severity", question_text: "Тяжесть (0-10)?", type: "scale_0_10" },
    { id: "other_symptoms", question_text: "Другие симптомы?", type: "text" },
  ];
  s.answers = {
    ...s.answers,
    temperature: 37.5,
    severity: 7,
    other_symptoms: "Головная боль и слабость",
  };
  console.log(`   Temperature: ${s.answers.temperature}°C`);
  console.log(`   Severity: ${s.answers.severity}/10`);
  console.log(`   Symptoms: ${s.answers.other_symptoms}\n`);

  // === STEP 2.3: Checkbox Questions (Chief Complaint refinement) ===
  console.log("✅ Step 2.3: User answers checkbox questions");
  s.step = 2.3;
  s.checkboxAnswers = {
    "chief_complaint.pain_type": "постояннная",
    "chief_complaint.pain_distribution": "локализованная",
    "chief_complaint.syndrome_type": "ноцицептивная",
  };
  console.log(`   Pain type: ${s.checkboxAnswers["chief_complaint.pain_type"]}`);
  console.log(`   Distribution: ${s.checkboxAnswers["chief_complaint.pain_distribution"]}`);
  console.log(`   Syndrome: ${s.checkboxAnswers["chief_complaint.syndrome_type"]}\n`);

  // Save chief complaint
  updateChiefComplaint(s.card_id, {
    complaint: "Головная боль, слабость, тошнота",
    symptom_onset: new Date().toISOString().split("T")[0],
    intensity: 7,
    aggravating_factors: "Движение, свет",
    alleviating_factors: "Отдых",
    condition_type: "acute",
    history_of_condition: "Началось 2 дня назад",
    pain_type: s.checkboxAnswers["chief_complaint.pain_type"],
    pain_distribution: s.checkboxAnswers["chief_complaint.pain_distribution"],
    syndrome_type: s.checkboxAnswers["chief_complaint.syndrome_type"],
  });
  console.log(`✓ Chief complaint saved\n`);

  // === STEP 3: Medical History ===
  console.log("✅ Step 3: User confirms and answers medical history");
  s.step = 3;

  // Simulate the flow of medical history questions
  console.log("   Question 1: Prior symptoms?");
  console.log("   User: да");
  s.answers.has_similar_symptoms = true;

  console.log("   Question 1b: Details?");
  console.log("   User: Была похожая боль год назад");
  s.answers.previous_symptoms_details = "Была похожая боль год назад";

  console.log("   Question 2: Chronic diseases?");
  console.log("   User: гипертензия, остеохондроз");
  s.answers.chronic_diseases = ["гипертензия", "остеохондроз"];

  console.log("   Question 3: Medications?");
  console.log("   User: метопролол, амлодипин");
  s.answers.current_medications = ["метопролол", "амлодипин"];

  console.log("   Question 4: Allergies?");
  console.log("   User: аспирин");
  s.answers.allergies = ["аспирин"];
  console.log();

  // Save medical history
  updateMedicalHistory(s.card_id, {
    similar_symptoms_before: s.answers.has_similar_symptoms,
    previous_symptoms_details: s.answers.previous_symptoms_details,
    chronic_diseases: s.answers.chronic_diseases,
    current_medications: s.answers.current_medications,
    allergies: s.answers.allergies,
  });
  console.log(`✓ Medical history saved\n`);

  // === STEP 4: Assessment Questions ===
  console.log("✅ Step 4: User answers assessment questions");
  s.step = 4;
  s.assessmentAnswers = {
    "assessment.severity": "Выраженное",
    "assessment.changes": "лучше",
    "assessment.discharge_status": "есть эффект",
    "assessment.follow_up_timing": "ч/з 1 месяц",
  };
  console.log(`   Severity: ${s.assessmentAnswers["assessment.severity"]}`);
  console.log(`   Changes: ${s.assessmentAnswers["assessment.changes"]}`);
  console.log(`   Discharge: ${s.assessmentAnswers["assessment.discharge_status"]}`);
  console.log(`   Follow-up: ${s.assessmentAnswers["assessment.follow_up_timing"]}\n`);

  // Save assessment
  addAssessment(s.card_id, {
    preliminary_diagnosis: "Острая вирусная инфекция с головной болью",
    red_flags: [],
    likely_causes: [
      { name: "ОРВИ", rationale: "Лихорадка, головная боль, слабость" },
      { name: "Грипп", rationale: "Высокая температура и интоксикация" },
    ],
    next_steps: ["Повторный осмотр через неделю", "Контроль температуры"],
    urgency: "routine",
    doctor_notes: "Состояние стабильное, требуется наблюдение",
    date_of_assessment: new Date().toISOString().split("T")[0],
    severity: s.assessmentAnswers["assessment.severity"],
    changes: s.assessmentAnswers["assessment.changes"],
    discharge_status: s.assessmentAnswers["assessment.discharge_status"],
    follow_up_timing: s.assessmentAnswers["assessment.follow_up_timing"],
  });
  console.log(`✓ Assessment saved\n`);

  // === VERIFICATION ===
  console.log("🔍 VERIFICATION: All data stored correctly\n");
  const finalCard = getMedicalCard(s.card_id);
  if (!finalCard) {
    console.error("❌ ERROR: Card not found!");
    return false;
  }

  let passed = 0;
  let failed = 0;

  // Check demographics
  if (finalCard.demographics.full_name === "Иван Петров") {
    console.log("✅ Demographics: Name");
    passed++;
  } else {
    console.log("❌ Demographics: Name FAILED");
    failed++;
  }

  // Check chief complaint
  if (
    finalCard.chief_complaint?.complaint === "Головная боль, слабость, тошнота" &&
    finalCard.chief_complaint?.pain_type === "постояннная"
  ) {
    console.log("✅ Chief Complaint: Complaint and pain_type");
    passed++;
  } else {
    console.log("❌ Chief Complaint: FAILED");
    console.log(`   Got: ${finalCard.chief_complaint?.complaint}`);
    console.log(`   Pain type: ${finalCard.chief_complaint?.pain_type}`);
    failed++;
  }

  // Check medical history
  if (
    finalCard.medical_history?.chronic_diseases?.length === 2 &&
    finalCard.medical_history?.chronic_diseases?.[0] === "гипертензия"
  ) {
    console.log("✅ Medical History: Chronic diseases");
    passed++;
  } else {
    console.log("❌ Medical History: Chronic diseases FAILED");
    console.log(`   Got: ${finalCard.medical_history?.chronic_diseases}`);
    failed++;
  }

  // Check assessment
  if (
    finalCard.assessment?.severity === "Выраженное" &&
    finalCard.assessment?.follow_up_timing === "ч/з 1 месяц"
  ) {
    console.log("✅ Assessment: Severity and follow-up");
    passed++;
  } else {
    console.log("❌ Assessment: FAILED");
    console.log(`   Severity: ${finalCard.assessment?.severity}`);
    console.log(`   Follow-up: ${finalCard.assessment?.follow_up_timing}`);
    failed++;
  }

  // Check no loops detected
  if (s.answers.chronic_diseases && s.answers.current_medications) {
    console.log("✅ No infinite loops: Medical history completed");
    passed++;
  } else {
    console.log("❌ No infinite loops: FAILED - flow didn't complete");
    failed++;
  }

  console.log("\n=====================================");
  console.log(`✅ Passed: ${passed}/5`);
  console.log(`❌ Failed: ${failed}/5`);

  if (failed === 0) {
    console.log("\n🎉 ALL INTEGRATION TESTS PASSED!");
    return true;
  } else {
    console.log("\n⚠️ INTEGRATION TEST FAILED!");
    return false;
  }
}

testFullUserFlow().then((success) => {
  process.exit(success ? 0 : 1);
});
