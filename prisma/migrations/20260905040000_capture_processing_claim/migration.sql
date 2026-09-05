-- Finding 2 (decisions.md 2026-09-05 "Capture processing claim"): one
-- extraction attempt holds the claim from before transmission until the
-- capture is proposed or failed.

-- AlterTable
ALTER TABLE "capture" ADD COLUMN "processing_claim_key" TEXT,
ADD COLUMN "processing_claimed_at" TIMESTAMPTZ(3);

-- CreateIndex
CREATE UNIQUE INDEX "capture_processing_claim_key_key" ON "capture"("processing_claim_key");
