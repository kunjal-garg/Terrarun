-- AlterTable
ALTER TABLE "strava_accounts" ADD COLUMN IF NOT EXISTS "lastAutoSyncAt" TIMESTAMP(3);
