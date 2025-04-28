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
import Redis from "ioredis";

const app = new Hono<{ Bindings: Env }>();

// middleware
app.use("*", logger());
app.use("*", cors());

// routes
app.get("/", (c) => c.text("RugCheck Backend API is running!"));
app.post("/alert/new", makeAlert);
app.get("/alert/get", getAlerts);
app.delete("/alert/delete", deleteAlert);
app.put("/alert/update", updateAlert);
app.get("/alert/getbyuseremail", getAlertByUserEmail);
app.get("/alert/getbymint", getAlertByMint);
app.get("/tokens/:mint/report/summary", getSummary);
app.get("/tokens/:mint/visualizations/price", getPriceHistory);
app.get("/tokens/:mint/visualizations/liquidity", getLiquidityHistory);
app.get("/tokens/:mint/visualizations/holders", getHolderHistory);
app.get("/tokens/:mint/visualizations/top-holders", getTopHolders);
app.get("/tokens/:mint/visualizations/liquidity-lock", getLiquidityLockInfo);

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

// Process Redis Queue
async function processRedisQueue(env: Env): Promise<void> {
    if (!env.UPSTASH_REDIS_REST_URL) {
        console.error("UPSTASH_REDIS_REST_URL is not set");
        return;
    }
    const redis = new Redis(env.UPSTASH_REDIS_REST_URL);
    try {
        const maxBatchSize = 10;
        const messages: TokenBatchMessage[] = [];

        // Fetch up to maxBatchSize messages from Redis
        for (let i = 0; i < maxBatchSize; i++) {
            const message = await redis.rpop("token_update_queue");
            if (!message) break;
            try {
                messages.push(JSON.parse(message));
            } catch (error) {
                console.error(`[Redis Worker] Error parsing message:`, error);
            }
        }

        if (messages.length > 0) {
            await processTokenBatch(messages, env);
        } else {
            console.log(`[Redis Worker] No messages in Redis queue.`);
        }
    } catch (error) {
        console.error(`[Redis Worker] Error processing Redis queue:`, error);
    } finally {
        await redis.quit();
    }
}

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
                    console.log(
                        "[Scheduled] Triggering queueTokenUpdateJobs...",
                    );
                    await queueTokenUpdateJobs(env);
                    console.log("[Scheduled] queueTokenUpdateJobs finished.");
                    console.log("[Scheduled] Processing Redis queue...");
                    await processRedisQueue(env);
                    console.log("[Scheduled] Redis queue processing finished.");
                } catch (error) {
                    console.error(
                        "[Scheduled] Error in scheduled task:",
                        error,
                    );
                }
            })(),
        );
        console.log(
            "[Scheduled] Handler finished, tasks running via waitUntil.",
        );
    },

    fetch: app.fetch,
};
