import {
    PrismaClient,
    Token_Metrics,
    Alert,
    Comparison as ComparisonType,
} from "@prisma/client";
import { Job, Queue } from "bullmq";
import { getPrisma } from "./prisma"; // Assuming this correctly returns a PrismaClient instance
import type { Env } from "./types"; // Define Env in src/types.ts
import { getRedisConnection } from "./lib/redis";

// --- Placeholder for Email Sending ---
async function sendEmail(
    to: string,
    subject: string,
    body: string,
): Promise<boolean> {
    console.log(`--- Sending Email ---`);
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${body}`);
    console.log(`---------------------`);
    // Replace with actual email sending logic (e.g., using fetch with Mailgun/SendGrid API)
    await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate async operation
    return true;
}
// --- End Placeholder ---

// --- Alert Checking Function ---
async function checkAlerts(
    prisma: PrismaClient,
    mint: string,
    latestMetrics: Token_Metrics | null,
) {
    if (!latestMetrics) {
        console.log(
            `[Alert Check] No latest metrics available for mint ${mint}. Skipping.`,
        );
        return;
    }
    console.log(`[Alert Check] Checking alerts for mint: ${mint}`);

    const alertsToCheck = await prisma.alert.findMany({
        where: { mint, isActive: true, triggeredAt: null },
        include: { token: true }, // Include token info if needed for email subject/body
    });

    if (alertsToCheck.length === 0) {
        console.log(`[Alert Check] No active alerts found for ${mint}.`);
        return;
    }
    console.log(
        `[Alert Check] Found ${alertsToCheck.length} alerts to evaluate.`,
    );

    const triggeredAlertIds: string[] = [];
    const emailPromises: Promise<void>[] = [];

    for (const alert of alertsToCheck) {
        // --- Improved Type Safety ---
        const parameterKey = alert.parameter as keyof Token_Metrics;
        if (!(parameterKey in latestMetrics)) {
            console.warn(
                `[Alert Check] Parameter '${alert.parameter}' not found on Token_Metrics model for alert ${alert.id}. Skipping.`,
            );
            continue;
        }
        const currentValue = latestMetrics[parameterKey];
        // Explicitly check for null/undefined AFTER confirming the key exists
        if (currentValue == null) {
            console.warn(
                `[Alert Check] Parameter '${alert.parameter}' has null/undefined value for alert ${alert.id}. Skipping.`,
            );
            continue;
        }
        // --- End Improved Type Safety ---

        let conditionMet = false;
        const threshold = alert.threshold; // Prisma should ensure this is a number if schema type is Float/Int

        console.log(
            `[Alert Check] Evaluating Alert ID: ${alert.id}. Parameter: ${alert.parameter}, Current: ${currentValue}, Comparison: ${alert.comparison}, Threshold: ${threshold}`,
        );

        // Ensure currentValue is treated as a number for comparison
        const numericCurrentValue = Number(currentValue);
        if (isNaN(numericCurrentValue)) {
            console.warn(
                `[Alert Check] Could not convert current value '${currentValue}' to number for alert ${alert.id}. Skipping.`,
            );
            continue;
        }

        switch (alert.comparison) {
            case ComparisonType.GREATER_THAN: // Use Enum from Prisma if available
                conditionMet = numericCurrentValue > threshold;
                break;
            case ComparisonType.LESS_THAN: // Use Enum from Prisma if available
                conditionMet = numericCurrentValue < threshold;
                break;
            // Add other comparison types if needed (e.g., EQUALS, NOT_EQUALS)
            default:
                console.warn(
                    `[Alert Check] Unknown comparison type '${alert.comparison}' for alert ${alert.id}. Skipping.`,
                );
                continue;
        }

        if (conditionMet) {
            console.log(
                `[Alert Check] Condition MET for Alert ID: ${alert.id}!`,
            );
            triggeredAlertIds.push(alert.id);

            // Queue email sending but don't wait for all emails before marking alerts
            emailPromises.push(
                (async () => {
                    const tokenSymbol = alert.token?.symbol || alert.mint; // Use symbol if available
                    const subject = `🚀 Alert Triggered for ${tokenSymbol}!`;
                    const body = `Your alert condition was met:\n\nToken: ${alert.mint}\nSymbol: ${tokenSymbol}\nParameter: ${alert.parameter}\nCondition: ${alert.comparison.replace("_", " ")} ${alert.threshold}\nCurrent Value: ${currentValue}\n\nThis alert will not trigger again unless reset.`;
                    try {
                        const emailSent = await sendEmail(
                            alert.userEmail,
                            subject,
                            body,
                        );
                        if (emailSent) {
                            console.log(
                                `[Alert Check] Email notification sent for alert ${alert.id} to ${alert.userEmail}`,
                            );
                        } else {
                            console.error(
                                `[Alert Check] Failed to send email notification for alert ${alert.id}`,
                            );
                        }
                    } catch (error) {
                        console.error(
                            `[Alert Check] Error sending email for alert ${alert.id}:`,
                            error,
                        );
                    }
                })(),
            );
        } else {
            console.log(
                `[Alert Check] Condition NOT MET for Alert ID: ${alert.id}.`,
            );
        }
    }

    // Mark alerts as triggered outside the email sending loop
    if (triggeredAlertIds.length > 0) {
        console.log(
            `[Alert Check] Marking ${triggeredAlertIds.length} alerts as triggered...`,
        );
        try {
            const updateResult = await prisma.alert.updateMany({
                where: { id: { in: triggeredAlertIds } },
                data: { triggeredAt: new Date() },
            });
            console.log(
                `[Alert Check] Successfully marked ${updateResult.count} alerts as triggered.`,
            );
        } catch (error) {
            console.error(
                `[Alert Check] Failed to update triggered status for alerts: ${triggeredAlertIds}`,
                error,
            );
        }
    }

    // Wait for all email sending attempts to complete (optional, depending on desired behavior)
    await Promise.allSettled(emailPromises);
    console.log(`[Alert Check] Finished processing alerts for mint: ${mint}`);
}

// --- Worker Processing Function ---
// Takes the BullMQ job and the Cloudflare environment
export async function processTokenBatch(job: Job, env: Env) {
    const prisma = getPrisma(env.DATABASE_URL); // Use env directly
    const mints: string[] = job.data.mints;
    console.log(
        `[Worker] Processing job ${job.id} for mints: ${mints.join(", ")}`,
    );

    for (const mint of mints) {
        try {
            // 1. Check last update time
            const lastUpdate = await prisma.token_Metrics.findFirst({
                where: { mint },
                orderBy: { timestamp: "desc" },
                select: { timestamp: true },
            });

            // 2. Fetch Report Data
            const reportResponse = await fetch(
                `https://api.rugcheck.xyz/v1/tokens/${mint}/report`,
            );
            if (!reportResponse.ok) {
                throw new Error(
                    `Report fetch failed (${reportResponse.status}): ${await reportResponse.text()}`,
                );
            }
            const report = await reportResponse.json();

            // 3. Check if update is needed based on report timestamp
            if (
                lastUpdate &&
                report.detectedAt &&
                new Date(report.detectedAt).getTime() <=
                    lastUpdate.timestamp.getTime()
            ) {
                console.log(
                    `[Worker] Mint ${mint} already updated at ${lastUpdate.timestamp} (Report detectedAt: ${report.detectedAt}). Skipping.`,
                );
                continue;
            }
            if (!report.markets || report.markets.length === 0) {
                console.warn(
                    `[Worker] Mint ${mint} has no market data in report. Skipping liquidity/lock info.`,
                );
                // Decide if you should continue processing other data or skip entirely
                // continue; // uncomment to skip mint entirely if no market data
            }

            // 4. Fetch Price, Votes, Insiders Concurrently
            const [priceRes, votesRes, insiderGraphRes] = await Promise.all([
                fetch(`https://data.fluxbeam.xyz/tokens/${mint}/price`),
                fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/votes`),
                fetch(
                    `https://api.rugcheck.xyz/v1/tokens/${mint}/insiders/graph`,
                ),
            ]);

            // Check all responses before proceeding
            if (!priceRes.ok)
                throw new Error(
                    `Price fetch failed (${priceRes.status}): ${await priceRes.text()}`,
                );
            if (!votesRes.ok)
                throw new Error(
                    `Votes fetch failed (${votesRes.status}): ${await votesRes.text()}`,
                );
            if (!insiderGraphRes.ok)
                throw new Error(
                    `Insider Graph fetch failed (${insiderGraphRes.status}): ${await insiderGraphRes.text()}`,
                );

            const [priceData, votesData, insiderGraphData] = await Promise.all([
                priceRes.json(),
                votesRes.json(),
                insiderGraphRes.json(),
            ]);

            // Safely extract price, provide default if structure is unexpected
            const price =
                typeof priceData === "number"
                    ? priceData
                    : (priceData?.price ?? 0);

            // 5. Perform Database Transaction
            const transactionTimestamp = new Date(); // Use a single timestamp

            await prisma.$transaction(async (tx) => {
                // Create Token Metrics
                const tokenMetricsData = {
                    timestamp: transactionTimestamp,
                    mint,
                    price: price, // Use extracted price
                    totalMarketLiquidity: report.totalMarketLiquidity ?? 0, // Provide defaults
                    totalHolders: report.totalHolders ?? 0,
                    score: report.score ?? 0,
                    score_normalised: report.score_normalised ?? 0,
                    upvotes: votesData.up ?? 0,
                    downvotes: votesData.down ?? 0,
                    // Add any other relevant fields from report or other sources
                };

                const createdMetrics = await tx.token_Metrics.create({
                    data: tokenMetricsData,
                });
                console.log(
                    `[Worker] Token Metrics Created for ${mint} at ${transactionTimestamp.toISOString()}`,
                );

                // --- Prepare related data creations ---

                const holderMovementsData = (report.topHolders || [])
                    .slice(0, 5) // Limit to top 5
                    .map((holder: any) => ({
                        timestamp: transactionTimestamp,
                        mint,
                        address: holder.address,
                        amount: holder.amount ?? 0,
                        pct: holder.pct ?? 0,
                        insider: holder.insider ?? false,
                    }));

                const firstMarket =
                    report.markets && report.markets.length > 0
                        ? report.markets[0]
                        : null;
                const firstLocker =
                    Object.keys(report.lockers || {}).length > 0
                        ? (Object.values(report.lockers)[0] as any)
                        : null;

                const liquidityEventData = firstMarket
                    ? {
                          timestamp: transactionTimestamp,
                          mint,
                          market_pubkey: firstMarket.pubkey,
                          lpLocked: firstMarket.lp?.lpLocked ?? null, // Allow null if not present
                          lpLockedPct: firstMarket.lp?.lpLockedPct ?? null,
                          usdcLocked: firstLocker?.usdcLocked ?? null, // Use null instead of 0 if unknown
                          unlockDate: firstLocker?.unlockDate
                              ? new Date(firstLocker.unlockDate * 1000)
                              : null, // Convert epoch seconds to Date, allow null
                      }
                    : null; // No event if no market

                const insiderGraphNodes = (insiderGraphData || [])
                    .flatMap((network: any) => network.nodes || [])
                    .slice(0, 25) // Limit nodes
                    .map((node: any) => ({
                        timestamp: transactionTimestamp,
                        mint,
                        node_id: node.id,
                        participant: node.participant ?? "unknown",
                        holdings: node.holdings ?? 0,
                    }));

                // --- Execute related data creations concurrently ---
                const creationPromises = [];

                if (holderMovementsData.length > 0) {
                    creationPromises.push(
                        tx.holder_Movements
                            .createMany({ data: holderMovementsData })
                            .then(() =>
                                console.log(
                                    `[Worker] Holder Movements Created for ${mint}`,
                                ),
                            )
                            .catch((e) =>
                                console.error(
                                    `[Worker] Error creating Holder Movements for ${mint}:`,
                                    e,
                                ),
                            ),
                    );
                }

                if (liquidityEventData) {
                    creationPromises.push(
                        tx.liquidity_Events
                            .create({ data: liquidityEventData })
                            .then(() =>
                                console.log(
                                    `[Worker] Liquidity Event Created for ${mint}`,
                                ),
                            )
                            .catch((e) =>
                                console.error(
                                    `[Worker] Error creating Liquidity Event for ${mint}:`,
                                    e,
                                ),
                            ),
                    );
                }

                if (insiderGraphNodes.length > 0) {
                    creationPromises.push(
                        tx.insider_Graph
                            .createMany({ data: insiderGraphNodes })
                            .then(() =>
                                console.log(
                                    `[Worker] Insider Graph Nodes Created for ${mint}`,
                                ),
                            )
                            .catch((e) =>
                                console.error(
                                    `[Worker] Error creating Insider Graph Nodes for ${mint}:`,
                                    e,
                                ),
                            ),
                    );
                }

                await Promise.all(creationPromises);

                // 6. Check Alerts (pass the transaction client `tx`)
                await checkAlerts(tx, mint, createdMetrics); // Pass the newly created metrics
            }); // End Transaction

            console.log(`[Worker] Successfully processed mint ${mint}`);
        } catch (error: any) {
            console.error(
                `[Worker] Error processing mint ${mint} in job ${job.id}:`,
                error.message,
                error.stack,
            );
            // Optional: Re-throw the error if you want BullMQ to retry based on attempts
            // throw error;
        }
    } // End loop through mints

    console.log(`[Worker] Finished processing job ${job.id}`);
    return { status: "completed", processedMints: mints };
}

// --- Helper to fetch tokens (Replace with actual DB query) ---
async function getTokensToMonitor(prisma?: PrismaClient): Promise<string[]> {
    console.log("[Queueing] Fetching tokens to monitor...");
    // Example: Fetch all unique mints from an 'alerts' table or a dedicated 'monitored_tokens' table
    /*
    const alerts = await prisma.alert.findMany({
        where: { isActive: true }, // Or other criteria
        distinct: ['mint'],
        select: { mint: true },
        take: 100, // Limit how many you fetch at once
    });
    const mints = alerts.map(a => a.mint);
    */
    // Using hardcoded list for now, replace this!
    const mints = [
        "6eVpGi4e3AA1fyN8r9oTMAQKUGjSh168jv1h295Ax1Qg", // blackshibad
        "DX1JSMFtirJmxWoLjSLvTYXSUfG5EELn638vA7pgJNGL",
        "Ddm4DTxNZxABUYm2A87TFLY6GDG2ktM2eJhGZS3EbzHM",
        "FtUEW73K6vEYHfbkfpdBZfWpxgQar2HipGdbutEhpump",
        "CU4Faw8o7Pj4tmXTR5qzYHmYeuShC3t8okZeQ5xqpump",
        // Add more mints here or fetch dynamically
    ].slice(0, 50); // Limit total tokens processed per run if necessary

    console.log(`[Queueing] Found ${mints.length} tokens to monitor.`);
    return mints;
}

// --- Function to Queue Token Batches ---
export async function queueTokenUpdateJobs(env: Env) {
    const queueName = "tokenUpdates";
    const connection = getRedisConnection(env);
    const prisma = getPrisma(env.DATABASE_URL);
    const tokenQueue = new Queue(queueName, { connection });

    const tokens = await getTokensToMonitor();

    if (tokens.length === 0) {
        console.log("[Queueing] No tokens found to queue. Exiting.");
        return 0; // Indicate no batches were queued
    }

    const batchSize = 10; // Process 10 tokens per job
    let batchesQueued = 0;

    for (let i = 0; i < tokens.length; i += batchSize) {
        const batch = tokens.slice(i, i + batchSize);
        try {
            await tokenQueue.add(
                "tokenBatch", // Job name
                { mints: batch }, // Job data
                {
                    attempts: 3, // Retry job 3 times if it fails
                    backoff: {
                        // Exponential backoff
                        type: "exponential",
                        delay: 5000, // Wait 5s before first retry
                    },
                    removeOnComplete: true, // Clean up successful jobs
                    removeOnFail: 100, // Keep last 100 failed jobs
                },
            );
            console.log(
                `[Queueing] Queued batch ${batchesQueued + 1}/${Math.ceil(tokens.length / batchSize)} with mints: ${batch.join(", ")}`,
            );
            batchesQueued++;
        } catch (error) {
            console.error(
                `[Queueing] Failed to add batch ${i / batchSize + 1} to queue:`,
                error,
            );
        }
    }

    console.log(`[Queueing] Finished queueing ${batchesQueued} batches.`);
    // Don't close connection here if worker runs in the same process/context
    // await tokenQueue.close();
    return batchesQueued;
}
