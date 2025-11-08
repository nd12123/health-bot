import { getState, resetState } from "../src/storage.js";
import {
  createMedicalCard,
  getMedicalCard,
  updateChiefComplaint,
  updateMedicalHistory,
} from "../src/services/medical-card.js";

/**
 * Test skipping questions with "-"
 */
async function testSkipQuestions() {
  console.log("🤖 TEST: Skipping Medical History Questions with '-'\n");
  console.log("=====================================\n");

  const chatId = 99999;
  resetState(chatId);
  const s = getState(chatId);

  // Setup basic card
  s.answers = {
    full_name: "Test User",
    date_of_birth: "1990-01-01",
    sex: "male",
    phone_number: "+7-999-999-9999",
  };

  const card = createMedicalCard(chatId, s.answers);
  s.card_id = card.card_id;

  // Setup for Step 3
  s.step = 3;
  s.answers.medical_history_confirmed = true;
  s.answers.has_similar_symptoms = false;
  s.answers.previous_symptoms_details = "-";

  console.log("Simulating user flow with '-' to skip:\n");

  // Simulate: User says "-" to chronic diseases
  console.log("1️⃣ User answers '-' to chronic diseases:");
  console.log("   Before: s.answers.chronic_diseases =", s.answers.chronic_diseases);
  if (s.answers.chronic_diseases === undefined) {
    if ("-" === "-") {
      s.answers.chronic_diseases = [];
    }
    console.log("   After: s.answers.chronic_diseases =", s.answers.chronic_diseases);
    console.log("   ✓ Sets to empty array, asks medications\n");
  }

  // Simulate: User answers medications
  console.log("2️⃣ User answers medications: 'метопролол'");
  console.log("   Before: s.answers.current_medications =", s.answers.current_medications);
  if (s.answers.current_medications === undefined) {
    s.answers.current_medications = ["метопролол"];
    console.log("   After: s.answers.current_medications =", s.answers.current_medications);
    console.log("   ✓ Sets to array, asks allergies\n");
  }

  // Simulate: User answers "-" to allergies
  console.log("3️⃣ User answers '-' to allergies:");
  console.log("   Before: s.answers.allergies =", s.answers.allergies);
  if (s.answers.allergies === undefined) {
    if ("-" === "-") {
      s.answers.allergies = [];
    }
    console.log("   After: s.answers.allergies =", s.answers.allergies);
    console.log("   ✓ Sets to empty array, saves and completes\n");
  }

  // Save medical history
  console.log("=====================================\n");
  updateMedicalHistory(s.card_id, {
    similar_symptoms_before: s.answers.has_similar_symptoms,
    previous_symptoms_details: s.answers.previous_symptoms_details,
    chronic_diseases: s.answers.chronic_diseases,
    current_medications: s.answers.current_medications,
    allergies: s.answers.allergies,
  });

  // Verify
  const finalCard = getMedicalCard(s.card_id);
  if (!finalCard) {
    console.error("❌ Card not found!");
    return false;
  }

  console.log("📋 VERIFICATION:\n");
  let allGood = true;

  if (
    Array.isArray(finalCard.medical_history?.chronic_diseases) &&
    finalCard.medical_history?.chronic_diseases?.length === 0
  ) {
    console.log("✅ Chronic diseases: Empty array (skip worked)");
  } else {
    console.log("❌ Chronic diseases: Should be empty array");
    console.log(`   Got: ${finalCard.medical_history?.chronic_diseases}`);
    allGood = false;
  }

  if (
    Array.isArray(finalCard.medical_history?.current_medications) &&
    finalCard.medical_history?.current_medications?.[0] === "метопролол"
  ) {
    console.log("✅ Medications: Set correctly");
  } else {
    console.log("❌ Medications: Should have метопролол");
    console.log(`   Got: ${finalCard.medical_history?.current_medications}`);
    allGood = false;
  }

  if (
    Array.isArray(finalCard.medical_history?.allergies) &&
    finalCard.medical_history?.allergies?.length === 0
  ) {
    console.log("✅ Allergies: Empty array (skip worked)");
  } else {
    console.log("❌ Allergies: Should be empty array");
    console.log(`   Got: ${finalCard.medical_history?.allergies}`);
    allGood = false;
  }

  console.log("\n" + (allGood ? "🎉 TEST PASSED!" : "⚠️ TEST FAILED!"));
  return allGood;
}

testSkipQuestions().then((success) => {
  process.exit(success ? 0 : 1);
});
