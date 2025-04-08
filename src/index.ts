import { Hono } from "hono";
import { cors } from "hono/cors"; // Import cors middleware
import { logger } from "hono/logger"; // Optional: Add logger middleware
import { getPrisma } from "./prisma"; // Your Prisma client setup
import { dbupdate } from "./cronjobs"; // Your existing cron job import

// --- Simple In-Memory Cache for Report Summary ---
// NOTE: For production, consider a more robust solution like Redis or Memcached.
interface ReportSummary {
    // Define the structure based on the actual API response
    [key: string]: unknown;
}

interface CacheEntry<T> {
    data: T;
    expiry: number; // Timestamp when the cache expires
}

const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes cache

// --- Initialize Hono App ---
const app = new Hono<{ Bindings: { DATABASE_URL: string } }>();

// --- Middleware ---
app.use("*", logger()); // Log all requests
app.use("*", cors()); // Enable CORS for frontend access

// --- Existing Routes ---
app.get("/", (c) => c.text("RugCheck Backend is running!"));
app.get("/cron/poll", dbupdate); // Your existing cron endpoint

// --- New Endpoints ---

const reportSummaryCache = new Map<string, CacheEntry<ReportSummary>>();
// 1. Enhanced Reporting - Report Summary (Direct API Call with Cache)
app.get("/tokens/:mint/report/summary", async (c) => {
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
                { error: `Failed to fetch report summary: ${response.statusText}` },
                500,
            );

        }

        const data = await response.json();
        if(!data) {
            return c.json(
                { error: "Failed to fetch report summary" },
                500,
            );
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
});

// --- Tokenomics Visualization Endpoints ---

const DEFAULT_LIMIT = 100; // Default number of data points for historical charts

// 2. Price History
app.get("/tokens/:mint/visualizations/price", async (c) => {
    const mint = c.req.param("mint");
    const limit = parseInt(c.req.query("limit") || `${DEFAULT_LIMIT}`, 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);

    if (!mint) return c.json({ error: "Mint address is required" }, 400);

    const prisma = getPrisma(c.env.DATABASE_URL);
    try {
        const priceData = await prisma.token_Metrics.findMany({
            where: { mint: mint },
            select: {
                // Select only necessary fields
                timestamp: true,
                price: true,
            },
            orderBy: { timestamp: "desc" }, // Get latest first
            take: limit,
            skip: offset,
        });
        // Reverse to get chronological order for charts if needed by frontend
        return c.json(priceData.reverse());
    } catch (error) {
        console.error(`Error fetching price data for ${mint}:`, error);
        return c.json(
            { error: "Internal server error fetching price data" },
            500,
        );
    }
});

// 3. Liquidity History (Total Market Liquidity)
app.get("/tokens/:mint/visualizations/liquidity", async (c) => {
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
});

// 4. Holder Count History
app.get("/tokens/:mint/visualizations/holders", async (c) => {
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
        // Convert BigInt to string for JSON compatibility if necessary
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
});

// 5. Latest Top Holders Snapshot (Example: Top 5)
app.get("/tokens/:mint/visualizations/top-holders", async (c) => {
    const mint = c.req.param("mint");
    if (!mint) return c.json({ error: "Mint address is required" }, 400);

    const prisma = getPrisma(c.env.DATABASE_URL);
    try {
        // Find the latest timestamp for which we have holder data for this mint
        const latestEntry = await prisma.holder_Movements.findFirst({
            where: { mint: mint },
            orderBy: { timestamp: "desc" },
            select: { timestamp: true },
        });

        if (!latestEntry) {
            return c.json([]); // No data found
        }

        // Get all holder entries matching the latest timestamp
        const topHolders = await prisma.holder_Movements.findMany({
            where: {
                mint: mint,
                timestamp: latestEntry.timestamp, // Filter by the exact latest timestamp
            },
            select: {
                address: true,
                amount: true,
                pct: true,
                insider: true,
            },
            orderBy: {
                // You might need BigInt support or cast to numeric in DB for proper sorting
                // Or sort based on 'pct' which is Float
                pct: "desc", // Order by percentage held
            },
            take: 5, // Get the top 5 based on DB data structure (already sliced in cron)
        });

        // Convert BigInt to string
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
});

// 6. Latest Liquidity Lock Info
app.get("/tokens/:mint/visualizations/liquidity-lock", async (c) => {
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

        // Convert BigInts to strings
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
});

export default app;
