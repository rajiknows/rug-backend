-- CreateIndex
CREATE INDEX "Holder_Movements_mint_timestamp_idx" ON "Holder_Movements"("mint", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Liquidity_Events_mint_timestamp_idx" ON "Liquidity_Events"("mint", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "Token_Metrics_mint_timestamp_idx" ON "Token_Metrics"("mint", "timestamp" DESC);
