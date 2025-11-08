import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database with test data...\n");

  // Create a test Telegram user
  const testTgUser = await prisma.tgUser.upsert({
    where: { id: 123456789 },
    update: {},
    create: {
      id: 123456789,
      username: "testuser",
      firstName: "Test",
      lastName: "User",
      metadata: {
        language: "en",
        timezone: "UTC",
      },
    },
  });
  console.log("✅ Created Telegram user:", testTgUser.username);

  // Create corresponding app user
  const testAppUser = await prisma.appUser.upsert({
    where: { id: "test-user-1" },
    update: {},
    create: {
      id: "test-user-1",
      tgUserId: testTgUser.id,
      displayName: "Test User",
      identityVerifiedAt: new Date(),
      metadata: {
        source: "telegram",
      },
    },
  });
  console.log("✅ Created app user:", testAppUser.displayName);

  // Create a sample medical card
  const sampleCard = await prisma.medicalCard.upsert({
    where: { id: "sample-card-1" },
    update: {},
    create: {
      id: "sample-card-1",
      userId: testAppUser.id,
      status: "in_progress",
      completionPercent: 50,
      demographics: {
        full_name: "Иван Петров",
        date_of_birth: "1985-03-20",
        sex: "male",
        phone_number: "+7-900-123-4567",
      },
      chiefComplaint: {
        complaint: "Головная боль",
        symptom_onset: new Date().toISOString().split("T")[0],
        intensity: 7,
        pain_type: "постояннная",
        pain_distribution: "локализованная",
      },
      medicalHistory: {
        chronic_diseases: ["гипертензия"],
        current_medications: ["метопролол"],
        allergies: ["аспирин"],
      },
    },
  });
  console.log("✅ Created sample medical card:", sampleCard.id);

  // Create a sample session
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 48);

  const sampleSession = await prisma.session.upsert({
    where: { cardId: sampleCard.id },
    update: {},
    create: {
      id: `session-${randomUUID()}`,
      userId: testAppUser.id,
      cardId: sampleCard.id,
      step: 2,
      answers: {
        full_name: "Иван Петров",
        date_of_birth: "1985-03-20",
        sex: "male",
      },
      stateData: {
        currentQuestionIndex: 0,
        generatedQuestions: [],
      },
      expiresAt: expiresAt,
    },
  });
  console.log("✅ Created sample session:", sampleSession.id.substring(0, 20) + "...");

  // Create a sample event
  const sampleEvent = await prisma.cardEvent.create({
    data: {
      id: randomUUID(),
      cardId: sampleCard.id,
      userId: testAppUser.id,
      eventType: "card_created",
      source: "telegram_bot",
      payload: {
        reason: "test seed",
      },
    },
  });
  console.log("✅ Created sample card event:", sampleEvent.eventType);

  // Create a sample consent
  const sampleConsent = await prisma.consent.create({
    data: {
      id: randomUUID(),
      userId: testAppUser.id,
      type: "data_processing",
      givenAt: new Date(),
      metadata: {
        ip_address: "127.0.0.1",
      },
    },
  });
  console.log("✅ Created sample consent:", sampleConsent.type);

  console.log("\n✨ Database seeding complete!");
  console.log("\n📊 Summary:");
  console.log(`  - Telegram User: ${testTgUser.username}`);
  console.log(`  - App User: ${testAppUser.displayName}`);
  console.log(`  - Medical Cards: 1`);
  console.log(`  - Sessions: 1`);
  console.log(`  - Card Events: 1`);
  console.log(`  - Consents: 1`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Seed error:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
