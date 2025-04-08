-- CreateTable
CREATE TABLE "Token_Metrics" (
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mint" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "totalMarketLiquidity" DOUBLE PRECISION,
    "totalHolders" BIGINT,
    "score" INTEGER,
    "score_normalised" DOUBLE PRECISION,
    "upvotes" INTEGER,
    "downvotes" INTEGER,

    CONSTRAINT "Token_Metrics_pkey" PRIMARY KEY ("mint")
);

-- CreateTable
CREATE TABLE "Holder_Movements" (
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mint" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "amount" BIGINT,
    "pct" DOUBLE PRECISION,
    "insider" BOOLEAN,

    CONSTRAINT "Holder_Movements_pkey" PRIMARY KEY ("timestamp","mint","address")
);

-- CreateTable
CREATE TABLE "Liquidity_Events" (
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mint" TEXT NOT NULL,
    "market_pubkey" TEXT NOT NULL,
    "lpLocked" BIGINT,
    "lpLockedPct" DOUBLE PRECISION,
    "usdcLocked" DOUBLE PRECISION,
    "unlockDate" BIGINT,

    CONSTRAINT "Liquidity_Events_pkey" PRIMARY KEY ("timestamp","mint","market_pubkey")
);

-- CreateTable
CREATE TABLE "Insider_Graph" (
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mint" TEXT NOT NULL,
    "node_id" TEXT NOT NULL,
    "participant" BOOLEAN,
    "holdings" BIGINT,
    "edge_source" TEXT,
    "edge_target" TEXT,

    CONSTRAINT "Insider_Graph_pkey" PRIMARY KEY ("timestamp","mint","node_id")
);
