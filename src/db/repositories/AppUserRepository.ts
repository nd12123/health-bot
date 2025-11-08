/**
 * AppUser Repository - Abstraction layer for app user operations
 * Connected to Prisma ORM for database operations
 */

import type { AppUser } from "../../types.js";

export interface IAppUserRepository {
  // Create or update a Telegram user mapping
  upsertByTelegramId(tgId: number, data: { username?: string; firstName?: string; lastName?: string }): Promise<AppUser>;

  // Get user by ID
  getById(userId: string): Promise<AppUser | null>;

  // Get user by Telegram ID
  getByTelegramId(tgId: number): Promise<AppUser | null>;

  // Create new app user
  create(data: { tgUserId?: number; email?: string; displayName?: string; metadata?: Record<string, any> }): Promise<AppUser>;

  // Update user
  update(userId: string, data: Partial<AppUser>): Promise<AppUser>;

  // List all users
  list(limit?: number, offset?: number): Promise<AppUser[]>;
}

/**
 * In-memory implementation (current)
 * This will be replaced with PrismaAppUserRepository when transitioning to DB
 */
export class InMemoryAppUserRepository implements IAppUserRepository {
  private users = new Map<string, any>();

  async upsertByTelegramId(tgId: number, data: { username?: string; firstName?: string; lastName?: string }): Promise<AppUser> {
    // TODO: Implement when transitioning
    throw new Error("Not implemented");
  }

  async getById(userId: string): Promise<AppUser | null> {
    // TODO: Implement when transitioning
    return null;
  }

  async getByTelegramId(tgId: number): Promise<AppUser | null> {
    // TODO: Implement when transitioning
    return null;
  }

  async create(data: { tgUserId?: number; email?: string; displayName?: string; metadata?: Record<string, any> }): Promise<AppUser> {
    // TODO: Implement when transitioning
    throw new Error("Not implemented");
  }

  async update(userId: string, data: Partial<AppUser>): Promise<AppUser> {
    // TODO: Implement when transitioning
    throw new Error("Not implemented");
  }

  async list(limit?: number, offset?: number): Promise<AppUser[]> {
    // TODO: Implement when transitioning
    return [];
  }
}

/**
 * Prisma implementation (future)
 * Will be used when transitioning from in-memory to database
 */
export class PrismaAppUserRepository implements IAppUserRepository {
  constructor(private prisma: any) {}

  async upsertByTelegramId(
    tgId: number,
    data: { username?: string; firstName?: string; lastName?: string }
  ): Promise<AppUser> {
    // First, ensure TgUser exists
    await this.prisma.tgUser.upsert({
      where: { id: tgId },
      update: {
        username: data.username,
        firstName: data.firstName,
        lastName: data.lastName,
      },
      create: {
        id: tgId,
        username: data.username,
        firstName: data.firstName,
        lastName: data.lastName,
      },
    });

    // Then upsert AppUser linked to this TgUser
    return this.prisma.appUser.upsert({
      where: { tgUserId: tgId },
      update: {
        displayName: data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : data.firstName,
      },
      create: {
        tgUserId: tgId,
        displayName: data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : data.firstName,
      },
    });
  }

  async getById(userId: string): Promise<AppUser | null> {
    return this.prisma.appUser.findUnique({
      where: { id: userId },
    });
  }

  async getByTelegramId(tgId: number): Promise<AppUser | null> {
    return this.prisma.appUser.findUnique({
      where: { tgUserId: tgId },
    });
  }

  async create(data: { tgUserId?: number; email?: string; displayName?: string; metadata?: Record<string, any> }): Promise<AppUser> {
    return this.prisma.appUser.create({
      data: {
        tgUserId: data.tgUserId,
        email: data.email,
        displayName: data.displayName,
        metadata: data.metadata || {},
      },
    });
  }

  async update(userId: string, data: Partial<AppUser>): Promise<AppUser> {
    const updateData: any = {};

    if (data.email !== undefined) updateData.email = data.email;
    if (data.displayName !== undefined) updateData.displayName = data.displayName;
    if (data.identityVerifiedAt !== undefined) updateData.identityVerifiedAt = data.identityVerifiedAt;
    if (data.metadata !== undefined) updateData.metadata = data.metadata;

    return this.prisma.appUser.update({
      where: { id: userId },
      data: updateData,
    });
  }

  async list(limit?: number, offset?: number): Promise<AppUser[]> {
    return this.prisma.appUser.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: "desc" },
    });
  }
}
