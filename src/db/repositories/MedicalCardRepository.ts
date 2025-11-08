/**
 * MedicalCard Repository - Abstraction layer for medical card operations
 * Connected to Prisma ORM for database operations
 */

import type { MedicalCard } from "../../types.js";

export interface IMedicalCardRepository {
  // Create a new medical card
  create(userId: string, data: { demographics?: any; status?: string; completionPercent?: number }): Promise<MedicalCard>;

  // Get card by ID
  getById(cardId: string): Promise<MedicalCard | null>;

  // Get all user's cards
  getUserCards(userId: string, limit?: number): Promise<MedicalCard[]>;

  // Get active (in_progress) card for user
  getActiveCard(userId: string): Promise<MedicalCard | null>;

  // Update card
  update(cardId: string, data: Partial<MedicalCard>): Promise<MedicalCard>;

  // Update completion percentage
  updateCompletionPercent(cardId: string, percent: number): Promise<MedicalCard>;

  // Soft delete (mark as deleted)
  softDelete(cardId: string): Promise<MedicalCard>;

  // Hard delete (permanent)
  hardDelete(cardId: string): Promise<void>;

  // List all cards with optional filters
  list(filters?: { status?: string; userId?: string }, limit?: number, offset?: number): Promise<MedicalCard[]>;
}

/**
 * In-memory implementation (current)
 * This will be replaced with PrismaMedicalCardRepository when transitioning to DB
 */
export class InMemoryMedicalCardRepository implements IMedicalCardRepository {
  private cards = new Map<string, any>();

  async create(userId: string, data: { demographics?: any; status?: string; completionPercent?: number }): Promise<MedicalCard> {
    // TODO: Implement when transitioning
    throw new Error("Not implemented");
  }

  async getById(cardId: string): Promise<MedicalCard | null> {
    // TODO: Implement when transitioning
    return null;
  }

  async getUserCards(userId: string, limit?: number): Promise<MedicalCard[]> {
    // TODO: Implement when transitioning
    return [];
  }

  async getActiveCard(userId: string): Promise<MedicalCard | null> {
    // TODO: Implement when transitioning
    return null;
  }

  async update(cardId: string, data: Partial<MedicalCard>): Promise<MedicalCard> {
    // TODO: Implement when transitioning
    throw new Error("Not implemented");
  }

  async updateCompletionPercent(cardId: string, percent: number): Promise<MedicalCard> {
    // TODO: Implement when transitioning
    throw new Error("Not implemented");
  }

  async softDelete(cardId: string): Promise<MedicalCard> {
    // TODO: Implement when transitioning
    throw new Error("Not implemented");
  }

  async hardDelete(cardId: string): Promise<void> {
    // TODO: Implement when transitioning
    throw new Error("Not implemented");
  }

  async list(filters?: { status?: string; userId?: string }, limit?: number, offset?: number): Promise<MedicalCard[]> {
    // TODO: Implement when transitioning
    return [];
  }
}

/**
 * Prisma implementation (future)
 * Will be used when transitioning from in-memory to database
 */
export class PrismaMedicalCardRepository implements IMedicalCardRepository {
  constructor(private prisma: any) {}

  async create(userId: string, data: { demographics?: any; status?: string; completionPercent?: number }): Promise<MedicalCard> {
    return this.prisma.medicalCard.create({
      data: {
        userId,
        demographics: data.demographics,
        status: data.status || "in_progress",
        completionPercent: data.completionPercent || 0,
      },
    });
  }

  async getById(cardId: string): Promise<MedicalCard | null> {
    return this.prisma.medicalCard.findUnique({
      where: { id: cardId },
    });
  }

  async getUserCards(userId: string, limit?: number): Promise<MedicalCard[]> {
    return this.prisma.medicalCard.findMany({
      where: { userId },
      take: limit,
      orderBy: { createdAt: "desc" },
    });
  }

  async getActiveCard(userId: string): Promise<MedicalCard | null> {
    return this.prisma.medicalCard.findFirst({
      where: { userId, status: "in_progress" },
    });
  }

  async update(cardId: string, data: Partial<MedicalCard>): Promise<MedicalCard> {
    // Transform fields for Prisma
    const updateData: any = {};

    if (data.completionPercent !== undefined) updateData.completionPercent = data.completionPercent;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.demographics !== undefined) updateData.demographics = data.demographics;
    if (data.chiefComplaint !== undefined) updateData.chiefComplaint = data.chiefComplaint;
    if (data.medicalHistory !== undefined) updateData.medicalHistory = data.medicalHistory;
    if (data.assessment !== undefined) updateData.assessment = data.assessment;
    if (data.deletedAt !== undefined) updateData.deletedAt = data.deletedAt;

    return this.prisma.medicalCard.update({
      where: { id: cardId },
      data: updateData,
    });
  }

  async updateCompletionPercent(cardId: string, percent: number): Promise<MedicalCard> {
    return this.prisma.medicalCard.update({
      where: { id: cardId },
      data: { completionPercent: percent },
    });
  }

  async softDelete(cardId: string): Promise<MedicalCard> {
    return this.prisma.medicalCard.update({
      where: { id: cardId },
      data: { deletedAt: new Date() },
    });
  }

  async hardDelete(cardId: string): Promise<void> {
    await this.prisma.medicalCard.delete({
      where: { id: cardId },
    });
  }

  async list(filters?: { status?: string; userId?: string }, limit?: number, offset?: number): Promise<MedicalCard[]> {
    return this.prisma.medicalCard.findMany({
      where: {
        ...(filters?.status && { status: filters.status }),
        ...(filters?.userId && { userId: filters.userId }),
      },
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
    });
  }
}
