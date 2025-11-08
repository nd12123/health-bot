#!/bin/bash
# Run Prisma migrations inside the database container
docker-compose exec -T postgres sh -c "cd /tmp/health-bot && npx prisma migrate deploy"
