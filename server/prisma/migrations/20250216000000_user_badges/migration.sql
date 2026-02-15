-- CreateTable
CREATE TABLE "user_badges" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "badgeKey" TEXT NOT NULL,
    "tier" INTEGER,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB,

    CONSTRAINT "user_badges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_badges_userId_idx" ON "user_badges"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_badges_userId_badgeKey_tier_key" ON "user_badges"("userId", "badgeKey", "tier");

-- AddForeignKey
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
