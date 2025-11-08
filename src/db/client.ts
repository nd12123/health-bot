import { PrismaClient } from "@prisma/client";
import { PrismaMedicalCardRepository } from "./repositories/MedicalCardRepository.js";
import { PrismaAppUserRepository } from "./repositories/AppUserRepository.js";

// Initialize Prisma Client
const prisma = new PrismaClient();

// Initialize repositories with Prisma client
export const medicalCardRepo = new PrismaMedicalCardRepository(prisma);
export const appUserRepo = new PrismaAppUserRepository(prisma);

// Export Prisma client for direct access if needed
export { prisma };
