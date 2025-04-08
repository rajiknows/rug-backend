// src/cronjobs.ts (or your file)
import { Context } from "hono";
import { getPrisma } from "../prisma";
import { PrismaClient, Token_Metrics } from "@prisma/client"; // Import PrismaClient and generated types

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

export async function dbupdate(
    c: Context<{ Bindings: { DATABASE_URL: string } }>,
) {
    const prisma = getPrisma(c.env.DATABASE_URL);
    const mint = "6eVpGi4e3AA1fyN8r9oTMAQKUGjSh168jv1h295Ax1Qg"; // Hardcoded Mint

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

// Your Hono app setup remains the same
import { Hono } from "hono";
// Remove duplicate import: import { getPrisma } from "./prisma";
// Remove duplicate import: import { env } from "hono/adapter";
// Remove duplicate import: import { dbupdate } from "./cronjobs";

const app = new Hono<{ Bindings: { DATABASE_URL: string } }>();

app.get("/", (c) => c.text("RugCheck Backend is running!"));
app.get("/cron/poll", dbupdate);
export default app;
