# Database Transition Checklist

This document guides you through transitioning from in-memory storage to PostgreSQL + Prisma when you're ready.

## ✅ Phase 1: Preparation (COMPLETED)

All preparation work is done. You can proceed to Phase 2 whenever you're ready.

### Created Files
- [x] `docker-compose.yml` - PostgreSQL + pgAdmin setup
- [x] `.env` - Database connection string configured
- [x] `prisma/schema.prisma` - Complete data model (11 tables)
- [x] `prisma/migrations/0_init/migration.sql` - Initial schema (prepared, not applied)
- [x] `prisma/seed.ts` - Test data seeding script
- [x] `src/db/repositories/AppUserRepository.ts` - User repository abstraction
- [x] `src/db/repositories/MedicalCardRepository.ts` - Medical card repository abstraction
- [x] `DB_SETUP.md` - Setup and troubleshooting guide

### Current Status
- ✅ In-memory storage working perfectly
- ✅ Bot fully functional with `/start`, `/test`, `/export` commands
- ✅ Database infrastructure ready (not connected yet)
- ✅ Migrations prepared but not applied

---

## ⏳ Phase 2: Integration (WHEN YOU'RE READY)

### Step 1: Start the Database

```bash
cd health-bot
docker-compose up -d
```

Verify it's running:
```bash
docker-compose ps
# Should show "health-bot-db" and "health-bot-pgadmin" as "Up"
```

### Step 2: Generate Prisma Client

```bash
npx prisma generate
```

This creates the Prisma TypeScript client based on your schema.

### Step 3: Apply Migrations

```bash
npx prisma migrate deploy
```

This:
- Applies migration from `prisma/migrations/0_init/migration.sql`
- Creates all 11 tables and indexes
- Ready for data insertion

### Step 4: Seed Test Data (Optional)

```bash
npx prisma db seed
```

This creates sample data using `prisma/seed.ts`:
- 1 test Telegram user
- 1 test app user (linked to Telegram)
- 1 sample medical card
- 1 sample session
- 1 sample event and consent

**Note**: You can skip this if you want to start fresh.

### Step 5: Implement Repository Layer

Update your code to use the repository pattern:

#### File: `src/db/client.ts` (create this)
```typescript
import { PrismaClient } from "@prisma/client";
import { PrismaMedicalCardRepository } from "./repositories/MedicalCardRepository";
import { PrismaAppUserRepository } from "./repositories/AppUserRepository";

const prisma = new PrismaClient();

export const appUserRepo = new PrismaAppUserRepository(prisma);
export const medicalCardRepo = new PrismaMedicalCardRepository(prisma);

export { prisma };
```

#### Update: `src/services/medical-card.ts`
```typescript
// Replace: const medicalCards = new Map<string, MedicalCard>();
// With: import { medicalCardRepo } from "../db/client";
```

### Step 6: Implement Repository Methods

In `src/db/repositories/MedicalCardRepository.ts`:

Replace `throw new Error("Not implemented yet");` with actual Prisma calls:

```typescript
async create(userId: string, data: any): Promise<MedicalCard> {
  return this.prisma.medicalCard.create({
    data: {
      userId,
      demographics: data.demographics,
      status: data.status || "in_progress",
      completionPercent: data.completionPercent || 0,
    }
  });
}

async getById(cardId: string): Promise<MedicalCard | null> {
  return this.prisma.medicalCard.findUnique({
    where: { id: cardId }
  });
}

// ... etc for all methods
```

### Step 7: Update Bot Code

In `src/bot/flows-v3.ts`:

Replace in-memory operations with repository calls:

**BEFORE:**
```typescript
const card = createMedicalCard(chatId, demographics);
s.card_id = card.card_id;
```

**AFTER:**
```typescript
const appUser = await appUserRepo.getByTelegramId(ctx.from!.id);
const card = await medicalCardRepo.create(appUser.id, demographics);
s.card_id = card.id;
```

### Step 8: Test Everything

```bash
# Run your existing tests
npm run test

# Test the bot manually via Telegram
# - Run `/test` command
# - Verify data appears in database

# Check data in pgAdmin
# http://localhost:5050
```

### Step 9: Verify with Prisma Studio

```bash
npx prisma studio
```

Opens visual database browser at `http://localhost:5555`

---

## ✅ Phase 3: Cleanup (AFTER VERIFICATION)

Once everything works with the database, you can remove the in-memory fallback:

### Step 1: Archive In-Memory Code

```bash
# Create backup of old code
mkdir src/db/archived
cp src/services/medical-card.ts src/db/archived/medical-card-inmemory.ts.bak
```

### Step 2: Remove In-Memory Maps

Delete these from `src/services/medical-card.ts`:
```typescript
// REMOVE:
const medicalCards = new Map<string, MedicalCard>();
const userCards = new Map<number, string[]>();
```

### Step 3: Remove Fallback Logic

Delete these functions (they're now in repositories):
```typescript
// REMOVE:
export function getUserCards(tg_id: number): MedicalCard[] { ... }
export function getMedicalCard(cardId: string): MedicalCard { ... }
export function createMedicalCard(...) { ... }
// ... etc
```

### Step 4: Update Imports

Change all imports from direct functions to repository methods:

```typescript
// BEFORE:
import { createMedicalCard, getMedicalCard } from "../services/medical-card";

// AFTER:
import { medicalCardRepo } from "../db/client";
```

### Step 5: Test One More Time

```bash
npm run build
npm run test
# Manual testing via bot
```

---

## 🎯 What Happens Next

### Data Persistence
- Medical cards persist across bot restarts
- Session state can be recovered
- Complete audit trail in `card_events` table

### Compliance Features Available
- User consent tracking (`consents` table)
- File attachments (`attachments` table)
- Export history (`card_exports` table)
- System audit logging (`audit_logs` table)

### Event Sourcing Benefits
- Complete history of all changes (immutable)
- Can replay events to rebuild state
- Analytics queries become easier
- Compliance reporting simplified

### Multi-User Support
- Multiple users can use bot simultaneously
- Proper isolation via `app_users` and `tg_users`
- Ready for team features

---

## ⚠️ Important Notes

### Before Applying Migrations
- Backup any existing data you want to keep
- Test on local database first (docker-compose is local)
- Have a rollback plan

### Production Considerations
- Use managed PostgreSQL service (AWS RDS, Digital Ocean, etc.)
- Change default passwords in docker-compose.yml
- Enable SSL/TLS for database connection
- Regular automated backups
- Monitor database performance

### Data Loss Prevention
- In-memory data is NOT transferred to database automatically
- You'll need to migrate existing data if needed (can write migration script)
- Start fresh with database, or implement data migration script

### Performance
- Indexes are created for common queries
- Foreign key constraints ensure data integrity
- JSONB columns allow flexible schema changes

---

## Commands Reference

```bash
# Start database
docker-compose up -d

# Stop database
docker-compose down

# View database logs
docker-compose logs postgres

# Apply migrations
npx prisma migrate deploy

# Seed test data
npx prisma db seed

# Open database UI
npx prisma studio

# Check migration status
npx prisma migrate status

# Reset database (dev only, loses data!)
npx prisma migrate reset

# Generate TypeScript types
npx prisma generate

# View database backup
docker exec health-bot-db psql -U healthbot -d healthbot_db -c "\dt"

# Backup database
docker exec health-bot-db pg_dump -U healthbot healthbot_db > backup.sql

# Restore database
docker exec -i health-bot-db psql -U healthbot healthbot_db < backup.sql
```

---

## Getting Help

See `DB_SETUP.md` for:
- Detailed setup instructions
- Troubleshooting common issues
- Security checklist
- Backup/restore procedures

---

## Timeline Estimate

- **Phase 1**: ✅ Already done (0 hours for you)
- **Phase 2**: ~2-4 hours (implement repository methods, update bot code, test)
- **Phase 3**: ~1 hour (cleanup and remove in-memory code)

**Total**: ~3-5 hours of development work

Just let me know when you're ready to start Phase 2! 🚀
