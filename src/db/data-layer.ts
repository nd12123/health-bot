/**
 * Data Layer Adapter
 *
 * This module provides a unified interface for medical card operations that supports
 * both in-memory and database modes using raw PostgreSQL client (pg).
 *
 * Phase 1 (Current): Write to both memory and DB (via pg), read from memory
 * Phase 2 (Later): Write to both, read from DB
 * Phase 3 (Final): DB only
 */

import {
  ensureUserExists,
  saveMedicalCard,
  updateCardChiefComplaint,
  updateCardMedicalHistory,
  updateCardCompletionPercent,
} from "./pg-client.js";
import {
  createMedicalCard as createMedicalCardInMemory,
  getMedicalCard as getMedicalCardInMemory,
  updateChiefComplaint as updateChiefComplaintInMemory,
  updateMedicalHistory as updateMedicalHistoryInMemory,
  updateCompletionPercent as updateCompletionPercentInMemory,
  addAssessment as addAssessmentInMemory,
  getUserCards as getUserCardsInMemory,
} from "../services/medical-card.js";
import type { MedicalCard, MedicalCardDemographics, MedicalCardChiefComplaint, MedicalCardMedicalHistory } from "../types.js";

const DB_ENABLED = process.env.DB_ENABLED === "true";

console.log(`[DataLayer] Initialized with DB_ENABLED=${DB_ENABLED} using raw pg client`);

/**
 * Create a new medical card (with optional dual-write)
 * Returns sync from memory, fires async DB write in background
 */
export function createMedicalCard(
  tg_id: number,
  demographics: MedicalCardDemographics
): MedicalCard {
  // Always write to memory first (sync)
  const memoryCard = createMedicalCardInMemory(tg_id, demographics);

  // If DB is enabled, write to database in background (don't await)
  if (DB_ENABLED) {
    // Fire and forget - don't block on database write
    (async () => {
      try {
        console.log(`[DataLayer] Attempting to write card ${memoryCard.card_id} to database for user ${tg_id}`);

        // First, ensure AppUser exists in database
        const userId = await ensureUserExists(tg_id);
        console.log(`[DataLayer] AppUser ${userId} ensured for Telegram user ${tg_id}`);

        // Then create medical card in database
        const cardId = await saveMedicalCard(userId, { demographics });
        console.log(`[DataLayer] Card ${cardId} written to database successfully`);
      } catch (error) {
        // Log error but don't fail - memory write succeeded
        console.error("[DataLayer] Failed to write to database, continuing with memory:", error);
      }
    })();
  }

  return memoryCard;
}

/**
 * Get medical card by ID (read from memory for now)
 */
export function getMedicalCard(card_id: string): MedicalCard | null {
  // Phase 1: Read from memory
  return getMedicalCardInMemory(card_id);
}

/**
 * Get user's medical cards (read from memory for now)
 */
export function getUserCards(tg_id: number): MedicalCard[] {
  // Phase 1: Read from memory
  return getUserCardsInMemory(tg_id);
}

/**
 * Update chief complaint (with optional dual-write)
 */
export function updateChiefComplaint(
  card_id: string,
  complaint: MedicalCardChiefComplaint
): MedicalCard | null {
  // Always write to memory first (sync)
  const memoryCard = updateChiefComplaintInMemory(card_id, complaint);

  // If DB is enabled, write to database in background (don't await)
  if (DB_ENABLED && memoryCard) {
    (async () => {
      try {
        await updateCardChiefComplaint(card_id, complaint);
        console.log(`[DataLayer] Card ${card_id} chief complaint updated in both memory and DB`);
      } catch (error) {
        console.error("[DataLayer] Failed to update chief complaint in database:", error);
      }
    })();
  }

  return memoryCard;
}

/**
 * Update medical history (with optional dual-write)
 */
export function updateMedicalHistory(
  card_id: string,
  history: Partial<MedicalCardMedicalHistory>
): MedicalCard | null {
  // Always write to memory first (sync)
  const memoryCard = updateMedicalHistoryInMemory(card_id, history);

  // If DB is enabled, write to database in background (don't await)
  if (DB_ENABLED && memoryCard) {
    (async () => {
      try {
        await updateCardMedicalHistory(card_id, history);
        console.log(`[DataLayer] Card ${card_id} medical history updated in both memory and DB`);
      } catch (error) {
        console.error("[DataLayer] Failed to update medical history in database:", error);
      }
    })();
  }

  return memoryCard;
}

/**
 * Update completion percentage (with optional dual-write)
 * Note: Completion percent is auto-calculated based on card data
 */
export function updateCompletionPercent(card_id: string): number {
  // Always write to memory first (sync) - returns calculated percent
  const percent = updateCompletionPercentInMemory(card_id);
  const card = getMedicalCardInMemory(card_id);

  // If DB is enabled, write to database in background (don't await)
  if (DB_ENABLED && card) {
    (async () => {
      try {
        await updateCardCompletionPercent(card_id, percent);
        console.log(`[DataLayer] Card ${card_id} completion percent updated to ${percent}% in both memory and DB`);
      } catch (error) {
        console.error("[DataLayer] Failed to update completion percent in database:", error);
      }
    })();
  }

  return percent;
}

/**
 * Add assessment (with optional dual-write)
 */
export function addAssessment(
  card_id: string,
  assessment: any
): MedicalCard | null {
  // Always write to memory first (sync)
  const memoryCard = addAssessmentInMemory(card_id, assessment);

  // If DB is enabled, write to database in background (don't await)
  if (DB_ENABLED && memoryCard) {
    (async () => {
      try {
        // Use a generic update since we don't have a dedicated assessment function yet
        // We'll need to add this to pg-client.ts if assessments need to be tracked separately
        console.log(`[DataLayer] Assessment added in memory for card ${card_id}`);
        console.log(`[DataLayer] Note: Assessment database persistence not yet implemented`);
      } catch (error) {
        console.error("[DataLayer] Failed to add assessment in database:", error);
      }
    })();
  }

  return memoryCard;
}

/**
 * Get DB status for debugging
 */
export function getDataLayerStatus() {
  return {
    db_enabled: DB_ENABLED,
    mode: DB_ENABLED ? "dual-write (memory + database)" : "memory only",
    message: DB_ENABLED
      ? "Writing to both memory and database. Reads from memory (Phase 1)."
      : "Using in-memory storage only.",
  };
}
