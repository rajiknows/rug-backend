// src/cronjobs.ts (or your file)
import { Context } from "hono";
import { getPrisma } from "../prisma";
import { PrismaClient, Token_Metrics } from "@prisma/client"; // Import PrismaClient and generated types
import { Worker } from "bullmq";

// --- Placeholder for Email Sending ---
// In a real app, you'd use a service like SendGrid, Mailgun, AWS SES, etc.
// and inject its client/configuration.
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
    // Replace with actual email sending logic
    // Example: const success = await emailServiceClient.send(...); return success;
    await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate async operation
    // For MVP, assume it always succeeds. Add error handling in production.
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

    // Find active, untriggered alerts for this specific mint
    const alertsToCheck = await prisma.alert.findMany({
        where: {
            mint: mint,
            isActive: true,
            triggeredAt: null, // Only check alerts that haven't fired yet
        },
    });

    if (alertsToCheck.length === 0) {
        console.log(`[Alert Check] No active alerts found for ${mint}.`);
        return;
    }

    console.log(
        `[Alert Check] Found ${alertsToCheck.length} alerts to evaluate.`,
    );

    const triggeredAlertIds: string[] = [];

    for (const alert of alertsToCheck) {
        // Get the value from the latest metrics based on the alert's parameter
        const currentValue = (latestMetrics as any)[alert.parameter]; // Use 'as any' for dynamic access

        if (currentValue === null || currentValue === undefined) {
            console.warn(
                `[Alert Check] Parameter '${alert.parameter}' not found or null in latest metrics for alert ${alert.id}. Skipping.`,
            );
            continue;
        }

        let conditionMet = false;
        const threshold = alert.threshold;

        console.log(
            `[Alert Check] Evaluating Alert ID: ${alert.id}. Parameter: ${alert.parameter}, Current: ${currentValue}, Comparison: ${alert.comparison}, Threshold: ${threshold}`,
        );

        // Evaluate the condition
        switch (alert.comparison) {
            case "GREATER_THAN":
                conditionMet = currentValue > threshold;
                break;
            case "LESS_THAN":
                conditionMet = currentValue < threshold;
                break;
            // Add more comparison types here (e.g., "EQUALS")
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
            // --- Trigger Notification ---
            const subject = `🚀 Alert Triggered for ${alert.mint}!`;
            const body = `Your alert condition was met:\nToken: ${alert.mint}\nParameter: ${alert.parameter}\nCondition: ${alert.comparison.replace("_", " ")} ${alert.threshold}\nCurrent Value: ${currentValue}\n\nThis alert will not trigger again unless reset.`;

            try {
                const emailSent = await sendEmail(
                    alert.userEmail,
                    subject,
                    body,
                );
                if (emailSent) {
                    triggeredAlertIds.push(alert.id);
                    console.log(
                        `[Alert Check] Email notification queued for alert ${alert.id} to ${alert.userEmail}`,
                    );
                } else {
                    console.error(
                        `[Alert Check] Failed to send email notification for alert ${alert.id}`,
                    );
                    // Decide if you want to retry later or mark as failed
                }
            } catch (error) {
                console.error(
                    `[Alert Check] Error sending email for alert ${alert.id}:`,
                    error,
                );
            }
        } else {
            console.log(
                `[Alert Check] Condition NOT MET for Alert ID: ${alert.id}.`,
            );
        }
    }

    // --- Update triggered alerts ---
    if (triggeredAlertIds.length > 0) {
        console.log(
            `[Alert Check] Marking ${triggeredAlertIds.length} alerts as triggered...`,
        );
        try {
            const updateResult = await prisma.alert.updateMany({
                where: {
                    id: {
                        in: triggeredAlertIds,
                    },
                },
                data: {
                    triggeredAt: new Date(),
                    // Optional: You could also set isActive: false here if alerts are one-shot forever
                    // isActive: false,
                },
            });
            console.log(
                `[Alert Check] Successfully marked ${updateResult.count} alerts as triggered.`,
            );
        } catch (error) {
            console.error(
                `[Alert Check] Failed to update triggered status for alerts: ${triggeredAlertIds}`,
                error,
            );
            // Implement retry logic or monitoring for failed updates if necessary
        }
    }
}
// --- End Alert Checking Function ---
//

const worker = new Worker(
    "tokenupdate",
    async (job) => {
        const tx = getPrisma(job.data.dbUrl);
        const mints = job.data.mints; // Array of mints to process
        console.log(`[worker] Processing mints: ${mints.join(", ")}`);

        for (const mint in mints) {
            try {
                const lastupdate = await tx.token_Metrics.findFirst({
                    where: {
                        mint: mint,
                    },
                    orderBy: {
                        timestamp: "desc",
                    },
                    select: {
                        timestamp: true,
                    },
                });

                const reportResponse = await fetch(
                    `https://api.rugcheck.xyz/v1/tokens/${mint}/report`,
                );
                const report = await reportResponse.json();

                // "detectedAt": "2025-04-03T01:51:58.882335507Z",
                if (
                    lastupdate &&
                    report.detectedAt &&
                    new Date(report.detectedAt).getTime() <=
                        lastupdate.timestamp.getTime()
                ) {
                    console.log(
                        `[worker] ${mint} already updated at ${lastupdate.timestamp}`,
                    );
                    continue;
                }

                const [priceRes, votesRes, insiderGraphRes] = await Promise.all(
                    [
                        fetch(`https://data.fluxbeam.xyz/tokens/${mint}/price`),
                        fetch(
                            `https://api.rugcheck.xyz/v1/tokens/${mint}/votes`,
                        ),
                        fetch(
                            `https://api.rugcheck.xyz/v1/tokens/${mint}/insiders/graph`,
                        ),
                    ],
                );

                if (!reportRes.ok)
                    throw new Error(
                        `Report fetch failed: ${await reportRes.text()}`,
                    );
                if (!priceRes.ok)
                    throw new Error(
                        `Price fetch failed: ${await priceRes.text()}`,
                    );
                if (!votesRes.ok)
                    throw new Error(
                        `Votes fetch failed: ${await votesRes.text()}`,
                    );
                if (!insiderGraphRes.ok)
                    throw new Error(
                        `Insider Graph fetch failed: ${await insiderGraphRes.text()}`,
                    );

                const [price, votes, insiderGraph] = await Promise.all([
                    priceRes.json(),
                    votesRes.json(),
                    insiderGraphRes.json(),
                ]);

                console.timeEnd(`API Fetch for ${mint}`);

                console.time(`DB Transaction for ${mint}`);
                const transactionTimestamp = new Date();

                await prisma.$transaction(async (tx) => {
                    const tokenMetricsData = {
                        timestamp: transactionTimestamp,
                        mint,
                        price: price as number,
                        totalMarketLiquidity: report.totalMarketLiquidity,
                        totalHolders: report.totalHolders,
                        score: report.score,
                        score_normalised: report.score_normalised,
                        upvotes: votes.up,
                        downvotes: votes.down,
                    };

                    latestMetricsRecord = await tx.token_Metrics.create({
                        data: tokenMetricsData,
                    });
                    console.log(`Token Metrics Created for ${mint}`);

                    await Promise.all([
                        tx.holder_Movements
                            .createMany({
                                data: report.topHolders
                                    .slice(0, 5)
                                    .map((holder: any) => ({
                                        timestamp: transactionTimestamp,
                                        mint,
                                        address: holder.address,
                                        amount: holder.amount,
                                        pct: holder.pct,
                                        insider: holder.insider,
                                    })),
                            })
                            .then(() =>
                                console.log(
                                    `Holder Movements Created for ${mint}`,
                                ),
                            ),

                        tx.liquidity_Events
                            .create({
                                data: {
                                    timestamp: transactionTimestamp,
                                    mint,
                                    market_pubkey: report.markets[0].pubkey,
                                    lpLocked: report.markets[0].lp.lpLocked,
                                    lpLockedPct:
                                        report.markets[0].lp.lpLockedPct,
                                    usdcLocked:
                                        (Object.values(report.lockers)[0] || {})
                                            .usdcLocked || 0,
                                    unlockDate:
                                        (Object.values(report.lockers)[0] || {})
                                            .unlockDate || 0,
                                },
                            })
                            .then(() =>
                                console.log(
                                    `Liquidity Events Created for ${mint}`,
                                ),
                            ),

                        tx.insider_Graph
                            .createMany({
                                data: insiderGraph
                                    .flatMap(
                                        (network: any) => network.nodes || [],
                                    )
                                    .slice(0, 25)
                                    .map((node: any) => ({
                                        timestamp: transactionTimestamp,
                                        mint,
                                        node_id: node.id,
                                        participant: node.participant,
                                        holdings: node.holdings,
                                    })),
                            })
                            .then(() =>
                                console.log(
                                    `Insider Graph Created for ${mint}`,
                                ),
                            ),
                    ]);
                });
                console.timeEnd(`DB Transaction for ${mint}`);

                console.time(`Alert Check for ${mint}`);
                await checkAlerts(prisma, mint, latestMetricsRecord);
                console.timeEnd(`Alert Check for ${mint}`);
            } catch (error) {
                console.error(`Error processing mint ${mint}:`, error);
            }
        }
        return { status: "completed" };
    },
    { connection: redisConnection },
);

worker.on("failed", (job, err) => {
    console.error(
        `[Worker] Job failed for mints ${job.data.mints.join(", ")}: ${err.message}`,
    );
});

export async function dbupdate(
    c: Context<{ Bindings: { DATABASE_URL: string } }>,
) {
    const prisma = getPrisma(c.env.DATABASE_URL);
    const tokens = [
        "6eVpGi4e3AA1fyN8r9oTMAQKUGjSh168jv1h295Ax1Qg", // blackshibad
        // Add more tokens as needed
    ];

    const batchSize = 10;
    const batches = [];

    for (let i = 0; i < tokens.length; i += batchSize) {
        const batch = tokens.slice(i, i + batchSize);
        batches.push(batch);
    }

    // Add batches to the queue
    for (const batch of batches) {
        await tokenQueue.add(
            "tokenBatch",
            { mints: batch },
            { attempts: 3, backoff: 5000 },
        );
    }

    return c.text("Batches queued for processing");

    let latestMetricsRecord: Token_Metrics | null = null; // To store the newly inserted metrics

    try {
        // Parallel API fetches with timeout
        console.time("API Fetch");
        // ... (your existing fetch logic remains the same) ...
        const [reportRes, priceRes, votesRes, insiderGraphRes] =
            await Promise.all([
                fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`),
                fetch(`https://data.fluxbeam.xyz/tokens/${mint}/price`),
                fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/votes`),
                fetch(
                    `https://api.rugcheck.xyz/v1/tokens/${mint}/insiders/graph`,
                ),
            ]);
        console.timeEnd("API Fetch");

        if (!reportRes.ok)
            throw new Error(`Report fetch failed: ${await reportRes.text()}`);
        if (!priceRes.ok)
            throw new Error(`Price fetch failed: ${await priceRes.text()}`);
        if (!votesRes.ok)
            throw new Error(`Votes fetch failed: ${await votesRes.text()}`);
        if (!insiderGraphRes.ok)
            throw new Error(
                `Insider Graph fetch failed: ${await insiderGraphRes.text()}`,
            );

        const [report, price, votes, insiderGraph] = await Promise.all([
            reportRes.json(),
            priceRes.json(),
            votesRes.json(),
            insiderGraphRes.json(),
        ]);

        // Use transaction for atomicity
        console.time("DB Transaction");
        const transactionTimestamp = new Date(); // Use a consistent timestamp

        await prisma.$transaction(async (tx) => {
            const tokenMetricsData = {
                timestamp: transactionTimestamp,
                mint,
                price: price as number,
                totalMarketLiquidity: report.totalMarketLiquidity,
                totalHolders: report.totalHolders,
                score: report.score,
                score_normalised: report.score_normalised,
                upvotes: votes.up,
                downvotes: votes.down,
            };

            // Store the data intended for Token_Metrics *before* creating it
            // We need this data *after* the transaction for alert checking
            // Create the record and simultaneously assign it for later use
            latestMetricsRecord = await tx.token_Metrics.create({
                data: tokenMetricsData,
            });
            console.log("Token Metrics Created"); // Adjusted logging

            // Parallelize independent inserts *within* the transaction
            await Promise.all([
                // Holder Movements
                tx.holder_Movements
                    .createMany({
                        data: report.topHolders
                            .slice(0, 5)
                            .map((holder: any) => ({
                                timestamp: transactionTimestamp,
                                mint,
                                address: holder.address,
                                amount: holder.amount,
                                pct: holder.pct,
                                insider: holder.insider,
                            })),
                    })
                    .then(() => console.log("Holder Movements Created")), // Adjusted logging

                // Liquidity Events
                tx.liquidity_Events
                    .create({
                        data: {
                            timestamp: transactionTimestamp,
                            mint,
                            market_pubkey: report.markets[0].pubkey,
                            lpLocked: report.markets[0].lp.lpLocked,
                            lpLockedPct: report.markets[0].lp.lpLockedPct,
                            usdcLocked:
                                (Object.values(report.lockers)[0] || {})
                                    .usdcLocked || 0,
                            unlockDate:
                                (Object.values(report.lockers)[0] || {})
                                    .unlockDate || 0,
                        },
                    })
                    .then(() => console.log("Liquidity Events Created")), // Adjusted logging

                // Insider Graph
                tx.insider_Graph
                    .createMany({
                        data: insiderGraph
                            .flatMap((network: any) => network.nodes || [])
                            .slice(0, 25) // Limit to 25 nodes
                            .map((node: any) => ({
                                timestamp: transactionTimestamp,
                                mint,
                                node_id: node.id,
                                participant: node.participant,
                                holdings: node.holdings,
                            })),
                    })
                    .then(() => console.log("Insider Graph Created")), // Adjusted logging
            ]); // End Promise.all for parallel inserts
        }); // End Transaction
        console.timeEnd("DB Transaction");
        console.log(`Polling complete for mint: ${mint}. Data saved.`);

        // --- Check Alerts AFTER data is successfully saved ---
        console.time("Alert Check");
        // Pass the Prisma instance, the mint processed, and the newly created metrics record
        await checkAlerts(prisma, mint, latestMetricsRecord);
        console.timeEnd("Alert Check");
        // ----------------------------------------------------

        return c.text("Polling and Alert Check complete");
    } catch (error) {
        console.error("Error during dbupdate:", error);
        // Ensure context 'c' is available for sending error response
        return c.text(
            `Error during polling: ${error instanceof Error ? error.message : String(error)}`,
            500,
        );
    } finally {
        // Optional: Disconnect prisma if running in a short-lived environment
        // await prisma.$disconnect();
    }
}
