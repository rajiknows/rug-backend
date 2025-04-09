import { Context } from "hono";
import { getPrisma } from "./prisma";
import { CACHE_DURATION_MS, CacheEntry, ReportSummary } from "./consts";

const DEFAULT_LIMIT = 100;

const reportSummaryCache = new Map<string, CacheEntry<ReportSummary>>();
export const getSummary = async (c: Context) => {
    const mint = c.req.param("mint");
    if (!mint) {
        return c.json({ error: "Mint address is required" }, 400);
    }

    // Check cache first
    const cached = reportSummaryCache.get(mint);
    if (cached && cached.expiry > Date.now()) {
        console.log(`[Cache] HIT for report summary: ${mint}`);
        return c.json(cached.data);
    }
    console.log(`[Cache] MISS for report summary: ${mint}`);

    const reportUrl = `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`;

    try {
        const response = await fetch(reportUrl, {
            headers: { accept: "application/json" },
        });

        if (!response.ok) {
            console.error(
                `Failed to fetch report summary for ${mint}: ${response.status} ${response.statusText}`,
            );
            // Don't cache errors unless desired

            return c.json(
                {
                    error: `Failed to fetch report summary: ${response.statusText}`,
                },
                500,
            );
        }

        const data = await response.json();
        if (!data) {
            return c.json({ error: "Failed to fetch report summary" }, 500);
        }

        // Store in cache
        reportSummaryCache.set(mint, {
            data: data as ReportSummary,
            expiry: Date.now() + CACHE_DURATION_MS,
        });

        return c.json(data);
    } catch (error) {
        console.error(`Error fetching report summary for ${mint}:`, error);
        return c.json(
            { error: "Internal server error while fetching report summary" },
            500,
        );
    }
};

export const getPriceHistory = async (c: Context) => {
    const mint = c.req.param("mint");
    const limit = parseInt(c.req.query("limit") || `${DEFAULT_LIMIT}`, 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    if (!mint) return c.json({ error: "Mint address is required" }, 400);

    const prisma = getPrisma(c.env.DATABASE_URL);
    try {
        const priceData = await prisma.token_Metrics.findMany({
            where: { mint: mint },
            select: {
                timestamp: true,
                price: true,
            },
            orderBy: { timestamp: "desc" },
            take: limit,
            skip: offset,
        });
        return c.json(priceData.reverse());
    } catch (error) {
        console.error(`Error fetching price data for ${mint}:`, error);
        return c.json(
            { error: "Internal server error fetching price data" },
            500,
        );
    }
};

export const getLiquidityHistory = async (c: Context) => {
    const mint = c.req.param("mint");
    const limit = parseInt(c.req.query("limit") || `${DEFAULT_LIMIT}`, 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    if (!mint) return c.json({ error: "Mint address is required" }, 400);

    const prisma = getPrisma(c.env.DATABASE_URL);
    try {
        const liquidityData = await prisma.token_Metrics.findMany({
            where: { mint: mint },
            select: {
                timestamp: true,
                totalMarketLiquidity: true,
            },
            orderBy: { timestamp: "desc" },
            take: limit,
            skip: offset,
        });
        return c.json(liquidityData.reverse());
    } catch (error) {
        console.error(`Error fetching liquidity data for ${mint}:`, error);
        return c.json(
            { error: "Internal server error fetching liquidity data" },
            500,
        );
    }
};

export const getHolderHistory = async (c: Context) => {
    const mint = c.req.param("mint");
    const limit = parseInt(c.req.query("limit") || `${DEFAULT_LIMIT}`, 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    if (!mint) return c.json({ error: "Mint address is required" }, 400);

    const prisma = getPrisma(c.env.DATABASE_URL);
    try {
        const holderData = await prisma.token_Metrics.findMany({
            where: { mint: mint },
            select: {
                timestamp: true,
                totalHolders: true,
            },
            orderBy: { timestamp: "desc" },
            take: limit,
            skip: offset,
        });
        const responseData = holderData.map((d) => ({
            ...d,
            totalHolders: d.totalHolders?.toString() ?? null,
        }));
        return c.json(responseData.reverse());
    } catch (error) {
        console.error(`Error fetching holder data for ${mint}:`, error);
        return c.json(
            { error: "Internal server error fetching holder data" },
            500,
        );
    }
};

export const getTopHolders = async (c: Context) => {
    const mint = c.req.param("mint");
    if (!mint) return c.json({ error: "Mint address is required" }, 400);

    const prisma = getPrisma(c.env.DATABASE_URL);
    try {
        const latestEntry = await prisma.holder_Movements.findFirst({
            where: { mint: mint },
            orderBy: { timestamp: "desc" },
            select: { timestamp: true },
        });

        if (!latestEntry) {
            return c.json([]);
        }

        const topHolders = await prisma.holder_Movements.findMany({
            where: {
                mint: mint,
                timestamp: latestEntry.timestamp,
            },
            select: {
                address: true,
                amount: true,
                pct: true,
                insider: true,
            },
            orderBy: {
                pct: "desc",
            },
            take: 5,
        });

        const responseData = topHolders.map((h) => ({
            ...h,
            amount: h.amount?.toString() ?? null,
        }));

        return c.json(responseData);
    } catch (error) {
        console.error(`Error fetching top holders for ${mint}:`, error);
        return c.json(
            { error: "Internal server error fetching top holders" },
            500,
        );
    }
};

export const getLiquidityLockInfo = async (c: Context) => {
    const mint = c.req.param("mint");
    if (!mint) return c.json({ error: "Mint address is required" }, 400);

    const prisma = getPrisma(c.env.DATABASE_URL);
    try {
        const latestLiquidityInfo = await prisma.liquidity_Events.findFirst({
            where: { mint: mint },
            orderBy: { timestamp: "desc" },
            select: {
                timestamp: true,
                market_pubkey: true,
                lpLocked: true,
                lpLockedPct: true,
                usdcLocked: true,
                unlockDate: true,
            },
        });

        if (!latestLiquidityInfo) {
            return c.json(
                { message: "No liquidity event data found for this mint." },
                404,
            );
        }

        const responseData = {
            ...latestLiquidityInfo,
            lpLocked: latestLiquidityInfo.lpLocked?.toString() ?? null,
            unlockDate: latestLiquidityInfo.unlockDate?.toString() ?? null,
        };

        return c.json(responseData);
    } catch (error) {
        console.error(`Error fetching liquidity lock info for ${mint}:`, error);
        return c.json(
            { error: "Internal server error fetching liquidity lock info" },
            500,
        );
    }
};
