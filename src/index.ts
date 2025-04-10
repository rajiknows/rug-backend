import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { Queue, Worker } from "bullmq";
import { getRedisConnection } from "./lib/redis"; // Centralized Redis connection
import { processTokenBatch, queueTokenUpdateJobs } from "./tasks"; // Import task logic

// Import API route handlers
import {
    deleteAlert,
    getAlertByMint,
    getAlertByUserEmail,
    getAlerts,
    makeAlert,
    updateAlert,
} from "./alerts";
import {
    getHolderHistory,
    getLiquidityHistory,
    getLiquidityLockInfo,
    getPriceHistory,
    getSummary,
    getTopHolders,
} from "./tokenomics";

// Import types (create this file)
import type { Env } from "./types";

// --- Initialize Hono App ---
// Use the Env bindings generic
const app = new Hono<{ Bindings: Env }>();

// --- Middleware ---
app.use("*", logger()); // Log all requests
app.use("*", cors()); // Enable CORS

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

// --- Manual Trigger (Optional) ---
// Endpoint to manually trigger the queuing process if needed
app.post("/internal/queue-jobs", async (c) => {
    const env = c.env;
    try {
        console.log("Manual job queueing triggered via API.");
        // Use waitUntil to allow async tasks to complete after response
        c.executionCtx.waitUntil(
            (async () => {
                const batchesQueued = await queueTokenUpdateJobs(env);
                console.log(`Manual trigger queued ${batchesQueued} batches.`);
            })(),
        );
        return c.json({
            success: true,
            message: "Token update job queuing initiated.",
        });
    } catch (error: any) {
        console.error("Error during manual queueing:", error);
        return c.json(
            {
                success: false,
                message: "Failed to initiate job queueing.",
                error: error.message,
            },
            500,
        );
    }
});

// --- Cloudflare Worker Export ---
export default {
    // --- Scheduled Event Handler (Cron Trigger) ---
    async scheduled(
        event: ScheduledEvent,
        env: Env,
        ctx: ExecutionContext,
    ): Promise<void> {
        console.log(`Cron event triggered: ${event.cron}`);

        const queueName = "tokenUpdates";
        const connection = getRedisConnection(env); // Get shared Redis connection

        // 1. Queue Jobs
        ctx.waitUntil(
            (async () => {
                try {
                    await queueTokenUpdateJobs(env);
                } catch (error) {
                    console.error(
                        "Error queueing jobs during scheduled event:",
                        error,
                    );
                }
            })(),
        );

        // 2. Process Jobs from the Queue
        // Create a worker instance to process jobs *within this scheduled execution*
        // It will pick up jobs added above or jobs remaining from previous runs.
        const worker = new Worker(
            queueName,
            async (job) => processTokenBatch(job, env), // Pass env to the job processor
            {
                connection,
                concurrency: 5, // Process up to 5 jobs concurrently within this worker instance
                // removeOnComplete: { count: 100 }, // Keep history of last 100 completed jobs
                // removeOnFail: { count: 500 }, // Keep history of last 500 failed jobs
            },
        );

        // Log worker events for monitoring
        worker.on("completed", (job, result) => {
            console.log(
                `[ScheduledWorker] Job ${job.id} completed. Result:`,
                result?.status,
            );
        });
        worker.on("failed", (job, err) => {
            console.error(
                `[ScheduledWorker] Job ${job?.id} failed for mints ${job?.data.mints?.join(", ")}: ${err.message}`,
                err.stack,
            );
        });
        worker.on("error", (err) => {
            console.error("[ScheduledWorker] Worker error:", err);
        });

        // Allow worker to run and process jobs. It will run until Cloudflare terminates the scheduled execution.
        // We don't explicitly await worker.close() here in the typical CF scheduled function pattern,
        // as we want it to run as long as possible within the time limit.
        // ctx.waitUntil() helps ensure the worker processing has time to run even after the handler theoretically returns.
        ctx.waitUntil(
            new Promise((resolve) => {
                // Listen for the 'drained' event which signifies the worker has processed all available jobs *at that moment*
                // Or rely on the timeout of the scheduled event.
                worker.on("drained", () => {
                    console.log(
                        "[ScheduledWorker] Queue appears drained for this run.",
                    );
                    worker.close().then(resolve); // Close worker once drained
                });
                // Add a safety timeout slightly less than CF's limit if needed, though waitUntil often handles this.
                const timeout = setTimeout(() => {
                    console.warn(
                        "[ScheduledWorker] Reached timeout, closing worker.",
                    );
                    worker.close().then(resolve);
                }, 25000); // Example: 25 seconds (adjust based on CF limits)

                // Clean up timeout if drained happens first
                worker.on("closed", () => clearTimeout(timeout));
            }),
        );

        console.log(
            "Scheduled handler finished setup, worker processing in background via waitUntil.",
        );
        // The scheduled function itself returns void quickly, while ctx.waitUntil allows processing to continue.
    },

    // --- HTTP Request Handler (Hono) ---
    fetch: app.fetch,
};
