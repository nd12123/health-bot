-- CreateTable tg_users
CREATE TABLE IF NOT EXISTS "tg_users" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "username" TEXT UNIQUE,
    "firstName" TEXT,
    "lastName" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable app_users
CREATE TABLE IF NOT EXISTS "app_users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tgUserId" INTEGER UNIQUE,
    "email" TEXT UNIQUE,
    "displayName" TEXT,
    "identityVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "app_users_tgUserId_fkey" FOREIGN KEY ("tgUserId") REFERENCES "tg_users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable medical_cards
CREATE TABLE IF NOT EXISTS "medical_cards" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "completionPercent" INTEGER NOT NULL DEFAULT 0,
    "demographics" JSONB,
    "chiefComplaint" JSONB,
    "medicalHistory" JSONB,
    "assessment" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "medical_cards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable card_events
CREATE TABLE IF NOT EXISTS "card_events" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "stepNumber" INTEGER,
    "changedFields" JSONB,
    "payload" JSONB,
    "source" TEXT NOT NULL DEFAULT 'telegram_bot',
    "idempotencyKey" TEXT NOT NULL UNIQUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "card_events_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "medical_cards" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "card_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable consents
CREATE TABLE IF NOT EXISTS "consents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "givenAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "consents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable attachments
CREATE TABLE IF NOT EXISTS "attachments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL UNIQUE,
    "sizeBytes" BIGINT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    CONSTRAINT "attachments_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "medical_cards" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "attachments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable card_exports
CREATE TABLE IF NOT EXISTS "card_exports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "recipientType" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "storagePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "metadata" JSONB,
    CONSTRAINT "card_exports_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "medical_cards" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "card_exports_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable sessions
CREATE TABLE IF NOT EXISTS "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL UNIQUE,
    "step" INTEGER NOT NULL,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "stateData" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "app_users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sessions_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "medical_cards" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable audit_logs
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "status" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB
);

-- CreateIndex
CREATE INDEX "medical_cards_userId_idx" ON "medical_cards"("userId");
CREATE INDEX "medical_cards_status_idx" ON "medical_cards"("status");
CREATE INDEX "medical_cards_createdAt_idx" ON "medical_cards"("createdAt");

-- CreateIndex
CREATE INDEX "card_events_cardId_idx" ON "card_events"("cardId");
CREATE INDEX "card_events_userId_idx" ON "card_events"("userId");
CREATE INDEX "card_events_eventType_idx" ON "card_events"("eventType");
CREATE INDEX "card_events_createdAt_idx" ON "card_events"("createdAt");

-- CreateIndex
CREATE INDEX "consents_userId_idx" ON "consents"("userId");
CREATE INDEX "consents_type_idx" ON "consents"("type");

-- CreateIndex
CREATE INDEX "attachments_cardId_idx" ON "attachments"("cardId");
CREATE INDEX "attachments_userId_idx" ON "attachments"("userId");

-- CreateIndex
CREATE INDEX "card_exports_cardId_idx" ON "card_exports"("cardId");
CREATE INDEX "card_exports_userId_idx" ON "card_exports"("userId");
CREATE INDEX "card_exports_status_idx" ON "card_exports"("status");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorType_idx" ON "audit_logs"("actorType");
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
