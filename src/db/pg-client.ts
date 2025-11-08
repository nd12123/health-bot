import { Pool } from "pg";
import { randomUUID } from "crypto";

const pool = new Pool({
  host: "localhost",
  port: 5432,
  user: "healthbot",
  password: "healthbot_dev_password_change_in_prod",
  database: "healthbot_db",
});

pool.on("error", (err: Error) => {
  console.error("[PG Pool] Unexpected error on idle client", err);
});

export async function ensureUserExists(tgId: number) {
  try {
    const client = await pool.connect();
    try {
      // First ensure TgUser exists
      await client.query(
        `INSERT INTO tg_users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
        [tgId]
      );

      // Then ensure AppUser exists linked to this TgUser
      const result = await client.query(
        `INSERT INTO app_users (id, "tgUserId")
         VALUES ($1, $2)
         ON CONFLICT ("tgUserId") DO UPDATE SET "tgUserId" = $2
         RETURNING id`,
        [randomUUID(), tgId]
      );

      return result.rows[0].id;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[PG] Error ensuring user exists:", err);
    throw err;
  }
}

export async function saveMedicalCard(userId: string, cardData: any) {
  try {
    const client = await pool.connect();
    try {
      const cardId = randomUUID();
      await client.query(
        `INSERT INTO medical_cards
         (id, "userId", status, "completionPercent", demographics, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [
          cardId,
          userId,
          "in_progress",
          15,
          JSON.stringify(cardData.demographics),
        ]
      );

      console.log(`[PG] Card ${cardId} saved for user ${userId}`);
      return cardId;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[PG] Error saving medical card:", err);
    throw err;
  }
}

export async function updateCardChiefComplaint(
  cardId: string,
  complaint: any
) {
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE medical_cards
         SET "chiefComplaint" = $1, "updatedAt" = NOW()
         WHERE id = $2`,
        [JSON.stringify(complaint), cardId]
      );

      console.log(`[PG] Chief complaint updated for card ${cardId}`);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[PG] Error updating chief complaint:", err);
    throw err;
  }
}

export async function updateCardMedicalHistory(cardId: string, history: any) {
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE medical_cards
         SET "medicalHistory" = $1, "updatedAt" = NOW()
         WHERE id = $2`,
        [JSON.stringify(history), cardId]
      );

      console.log(`[PG] Medical history updated for card ${cardId}`);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[PG] Error updating medical history:", err);
    throw err;
  }
}

export async function updateCardCompletionPercent(
  cardId: string,
  percent: number
) {
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE medical_cards
         SET "completionPercent" = $1, "updatedAt" = NOW()
         WHERE id = $2`,
        [percent, cardId]
      );

      console.log(
        `[PG] Completion percent updated to ${percent}% for card ${cardId}`
      );
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[PG] Error updating completion percent:", err);
    throw err;
  }
}

export async function closePool() {
  await pool.end();
}
