-- Ensure healthbot user exists with proper permissions
-- Note: The official postgres image creates the role from POSTGRES_USER/POSTGRES_PASSWORD env vars
-- This script runs as the POSTGRES_USER (healthbot) so it can only grant to itself

-- If we need postgres user (superuser) access later:
-- psql -U healthbot -d healthbot_db -c "ALTER USER healthbot SUPERUSER;"
