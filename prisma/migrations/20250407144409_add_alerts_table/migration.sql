-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "parameter" TEXT NOT NULL,
    "comparison" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "triggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Alert_mint_parameter_isActive_triggeredAt_idx" ON "Alert"("mint", "parameter", "isActive", "triggeredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_userEmail_key" ON "Alert"("userEmail");
