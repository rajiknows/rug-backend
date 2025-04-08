import { Hono } from "hono";
import { cors } from "hono/cors"; // Import cors middleware
import { logger } from "hono/logger"; // Optional: Add logger middleware
import { getPrisma } from "./prisma"; // Your Prisma client setup
import { dbupdate } from "./cronjobs/cronjobs"; // Your existing cron job import
import { deleteAlert, getAlertByMint, getAlertByUserEmail, getAlerts, makeAlert, updateAlert } from "./alerts";

// Import the tokenomics functions
import { 
    getPriceHistory, 
    getLiquidityHistory, 
    getHolderHistory, 
    getTopHolders, 
    getLiquidityLockInfo 
} from './tokenomics';

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
app.post("/alert/new", makeAlert);
app.get("/alert/get", getAlerts);
app.delete("/alert/delete", deleteAlert);
app.put("/alert/update", updateAlert);
app.get("/alert/getbyuseremail", getAlertByUserEmail);
app.get("/alert/getbymint", getAlertByMint);

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

// Replace the existing tokenomics routes with:
app.get("/tokens/:mint/visualizations/price", getPriceHistory);
app.get("/tokens/:mint/visualizations/liquidity", getLiquidityHistory);
app.get("/tokens/:mint/visualizations/holders", getHolderHistory);
app.get("/tokens/:mint/visualizations/top-holders", getTopHolders);
app.get("/tokens/:mint/visualizations/liquidity-lock", getLiquidityLockInfo);

export default app;
