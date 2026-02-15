-- CreateTable
CREATE TABLE "territory_cells" (
    "cellId" TEXT NOT NULL,
    "cellX" INTEGER NOT NULL,
    "cellY" INTEGER NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "lastClaimedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityId" UUID,

    CONSTRAINT "territory_cells_pkey" PRIMARY KEY ("cellId")
);

-- CreateTable
CREATE TABLE "territory_claims" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cellId" TEXT NOT NULL,
    "cellX" INTEGER NOT NULL,
    "cellY" INTEGER NOT NULL,
    "claimerUserId" UUID NOT NULL,
    "previousOwnerUserId" UUID,
    "activityId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "territory_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "territory_cells_cellX_cellY_idx" ON "territory_cells"("cellX", "cellY");

-- CreateIndex
CREATE INDEX "territory_claims_cellId_idx" ON "territory_claims"("cellId");

-- CreateIndex
CREATE INDEX "territory_claims_claimedAt_idx" ON "territory_claims"("claimedAt");

-- AddForeignKey
ALTER TABLE "territory_cells" ADD CONSTRAINT "territory_cells_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_claims" ADD CONSTRAINT "territory_claims_claimerUserId_fkey" FOREIGN KEY ("claimerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_claims" ADD CONSTRAINT "territory_claims_previousOwnerUserId_fkey" FOREIGN KEY ("previousOwnerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territory_claims" ADD CONSTRAINT "territory_claims_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
