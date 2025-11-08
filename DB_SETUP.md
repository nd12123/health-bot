# Database Setup Guide

This document explains the database architecture and how to transition from in-memory storage to PostgreSQL + Prisma.

## Architecture Overview

### Current State (In-Memory)
- Medical cards stored in JavaScript Map (`src/services/medical-card.ts`)
- Sessions stored in memory (`src/storage.ts`)
- Data lost on bot restart
- Single instance only

### Future State (PostgreSQL + Prisma)
- Persistent data in PostgreSQL database
- Event sourcing for complete audit trail
- Multi-instance support
- Production-ready compliance features

## Files Structure

```
health-bot/
├── docker-compose.yml           # PostgreSQL + pgAdmin setup
├── .env                         # Database URL (already configured)
├── prisma/
│   ├── schema.prisma           # Data model (complete)
│   ├── seed.ts                 # Test data seeding script
│   └── migrations/
│       └── 0_init/
│           └── migration.sql   # Initial schema (prepared, not applied)
└── src/
    └── db/
        └── repositories/
            ├── AppUserRepository.ts       # User abstraction layer
            └── MedicalCardRepository.ts   # Medical card abstraction layer
```

## Database Schema

### Identity Layer
- **tg_users**: Telegram user integrations (ID-based)
- **app_users**: Application user identity (separates from Telegram for multi-channel support)

### Medical Data Layer
- **medical_cards**: Patient medical information (demographics, complaints, history, assessment)
- **card_events**: Immutable event log (domain events) - source of truth for changes

### Compliance & Consent
- **consents**: User consent tracking (GDPR, medical data, exports)
- **attachments**: File uploads (scans, labs, imaging)
- **card_exports**: Export history and audit trail

### Session Management
- **sessions**: Ephemeral session state (TTL: 48 hours)

### System Auditing
- **audit_logs**: Infrastructure actions (migrations, backups, admin actions)

## Quick Start

### 1. Start PostgreSQL via Docker

```bash
cd health-bot
docker-compose up -d
```

This starts:
- **PostgreSQL** on `localhost:5432`
  - Username: `healthbot`
  - Password: `healthbot_dev_password_change_in_prod`
  - Database: `healthbot_db`
- **pgAdmin** on `http://localhost:5050`
  - Email: `admin@healthbot.local`
  - Password: `admin_password_change_in_prod`

### 2. Verify Connection

```bash
# Check Postgres is healthy
docker-compose ps

# Should see "health-bot-db" running and "healthy"
```

### 3. Generate Prisma Client

```bash
npx prisma generate
```

### 4. Apply Migrations (When Ready)

When you're ready to transition from in-memory to database:

```bash
npx prisma migrate deploy
```

This applies the migration from `prisma/migrations/0_init/migration.sql`

### 5. Seed Test Data (Optional)

```bash
npx prisma db seed
```

This creates test data using the seed script at `prisma/seed.ts`

## Migration Path: In-Memory → Database

### Phase 1: Preparation (Current)
✅ Prisma schema defined
✅ Migrations prepared (not applied)
✅ Repository abstraction layer created
✅ Seed script ready

### Phase 2: Integration (When you're ready)
1. Create data layer implementation (connect `PrismaMedicalCardRepository` to actual code)
2. Run migrations: `npx prisma migrate deploy`
3. Add dual-write mode (write to both Maps AND database)
4. Run tests to verify both sources match
5. Cut over to database reads

### Phase 3: Cleanup (After verification)
1. Remove in-memory fallback
2. Remove dual-write code
3. Archive in-memory implementation

## Environment Variables

Already configured in `.env`:

```
DATABASE_URL="postgresql://healthbot:healthbot_dev_password_change_in_prod@localhost:5432/healthbot_db?schema=public"
```

For production, change to:
- Managed PostgreSQL service (AWS RDS, Digital Ocean, etc.)
- Use strong password
- Enable SSL/TLS
- Consider connection pooling (PgBouncer)

## Repository Pattern

The abstraction layer allows switching implementations:

```typescript
// Current: In-memory
const cardRepo = new InMemoryMedicalCardRepository();

// Future: Prisma
const prisma = new PrismaClient();
const cardRepo = new PrismaMedicalCardRepository(prisma);
```

Both implement `IMedicalCardRepository` interface, so the rest of the code doesn't need to change.

## pgAdmin Access

Access database via web UI:
1. Open `http://localhost:5050`
2. Login: `admin@healthbot.local` / `admin_password_change_in_prod`
3. Create server connection:
   - Hostname: `postgres` (Docker service name)
   - Username: `healthbot`
   - Password: `healthbot_dev_password_change_in_prod`
   - Database: `healthbot_db`

## Development Workflow

### Check Migration Status

```bash
npx prisma migrate status
```

### View Data (After applying migrations)

```bash
npx prisma studio
```

Opens Prisma Studio at `http://localhost:5555` for visual data management.

### Create New Migration

When you modify `prisma/schema.prisma`:

```bash
npx prisma migrate dev --name <migration_name>
```

This:
1. Creates migration file in `prisma/migrations/`
2. Applies migration to database
3. Regenerates Prisma Client

### Reset Database (Development Only)

```bash
npx prisma migrate reset
```

This:
1. Drops database
2. Reapplies all migrations
3. Runs seed script

⚠️ **Warning**: This deletes all data. Never use in production!

## Backup & Restore

### Backup

```bash
# Backup PostgreSQL database
docker exec health-bot-db pg_dump -U healthbot healthbot_db > backup.sql

# Backup with environment variables
docker exec health-bot-db pg_dump -U healthbot -d healthbot_db > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Restore

```bash
docker exec -i health-bot-db psql -U healthbot healthbot_db < backup.sql
```

## Troubleshooting

### Can't connect to database

```bash
# Check if containers are running
docker-compose ps

# View logs
docker-compose logs postgres
docker-compose logs pgadmin

# Restart
docker-compose restart
```

### Permission errors

```bash
# PostgreSQL data volume permissions
docker exec health-bot-db chown -R postgres:postgres /var/lib/postgresql/data
```

### Migration conflicts

```bash
# Check migration status
npx prisma migrate status

# Resolve migration issues
npx prisma migrate resolve --rolled-back <migration_name>
```

## Security Checklist

- [ ] Change default passwords in docker-compose.yml
- [ ] Use environment variables for secrets (.env should not be in Git)
- [ ] Enable PostgreSQL SSL for production
- [ ] Set up connection pooling
- [ ] Regular backups scheduled
- [ ] Audit logs review process
- [ ] Data retention policy implemented

## Next Steps

1. ✅ Docker + PostgreSQL ready
2. ✅ Prisma schema defined
3. ✅ Migrations prepared
4. ✅ Repository layer created
5. ⏳ **When ready**: Integrate repositories into bot code
6. ⏳ **When ready**: Run migrations and switch to database

When you decide to transition, just let me know and I'll help implement the integration layer!
