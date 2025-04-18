import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { processTokenBatch, queueTokenUpdateJobs } from "./tasks";
import type { Env, TokenBatchMessage } from "./types";
import {
    makeAlert,
    getAlerts,
    deleteAlert,
    updateAlert,
    getAlertByUserEmail,
    getAlertByMint,
} from "./alerts";
import {
    getSummary,
    getPriceHistory,
    getLiquidityHistory,
    getHolderHistory,
    getTopHolders,
    getLiquidityLockInfo,
} from "./tokenomics";

// --- Initialize Hono App ---
const app = new Hono<{ Bindings: Env }>();

// --- Middleware ---
app.use("*", logger());
app.use("*", cors());

// --- API Routes ---
app.get("/", (c) => c.text("RugCheck Backend API is running!"));

// --- Token alert endpoints ---
app.post("/alert/new", makeAlert);
app.get("/alert/get", getAlerts);
app.delete("/alert/delete", deleteAlert);
app.put("/alert/update", updateAlert);
app.get("/alert/getbyuseremail", getAlertByUserEmail);
app.get("/alert/getbymint", getAlertByMint);

// --- Tokenomics Report Endpoints ---
app.get("/tokens/:mint/report/summary", getSummary);

// --- Tokenomics Visualization Endpoints ---
app.get("/tokens/:mint/visualizations/price", getPriceHistory);
app.get("/tokens/:mint/visualizations/liquidity", getLiquidityHistory);
app.get("/tokens/:mint/visualizations/holders", getHolderHistory);
app.get("/tokens/:mint/visualizations/top-holders", getTopHolders);
app.get("/tokens/:mint/visualizations/liquidity-lock", getLiquidityLockInfo);

// --- Manual Trigger ---
app.post("/internal/queue-jobs", async (c) => {
    const env = c.env;
    try {
        console.log("Manual job queueing triggered via API.");
        c.executionCtx.waitUntil(
            (async () => {
                const batchesQueued = await queueTokenUpdateJobs(env);
                console.log(`Manual trigger queued ${batchesQueued} batches.`);
            })(),
        );
        return c.json({
            success: true,
            message: "Token update job batching initiated.",
        });
    } catch (error: any) {
        console.error("Error during manual queueing:", error);
        return c.json(
            {
                success: false,
                message: "Failed to initiate job batching.",
                error: error.message,
            },
            500,
        );
    }
});

// --- Cloudflare Worker Module ---
export default {
    async scheduled(
        event: ScheduledEvent,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<void> {
        console.log(`[Scheduled] Cron event triggered: ${event.cron}`);
        ctx.waitUntil(
            (async () => {
                try {
                    console.log("[Scheduled] Triggering queueTokenUpdateJobs...");
                    await queueTokenUpdateJobs(env);
                    console.log("[Scheduled] queueTokenUpdateJobs finished.");
                } catch (error) {
                    console.error(
                        "[Scheduled] Error triggering queueTokenUpdateJobs:",
                        error,
                    );
                }
            })(),
        );
        console.log("[Scheduled] Handler finished, job queueing running via waitUntil.");
    },

    async queue(
        batch: MessageBatch<TokenBatchMessage>,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<void> {
        console.log(`[Queue Handler] Received batch of size ${batch.messages.length} from queue: ${batch.queue}`);
        try {
            await processTokenBatch(batch, env);
            console.log(`[Queue Handler] Successfully processed batch from queue: ${batch.queue}`);
        } catch (error) {
            console.error(`[Queue Handler] Error processing batch from queue ${batch.queue}:`, error);
            batch.retryAll();
        }
    },

    fetch: app.fetch,
};
