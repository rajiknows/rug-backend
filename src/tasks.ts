import {
    PrismaClient,
    Token_Metrics,
    Alert,
    Comparison as ComparisonType,
    Prisma,
} from "@prisma/client";
import { getPrisma } from "./prisma";
import type { Env, TokenBatchMessage } from "./types";
import Redis from "ioredis";

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
    await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate async operation
    return true;
}

// --- Alert Checking Function ---
async function checkAlerts(
    prisma: PrismaClient | Prisma.TransactionClient,
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
        const parameterKey = alert.parameter as keyof Token_Metrics;
        if (!(parameterKey in latestMetrics)) {
            console.warn(
                `[Alert Check] Parameter '${alert.parameter}' not found on Token_Metrics model for alert ${alert.id}. Skipping.`,
            );
            continue;
        }
        const currentValue = latestMetrics[parameterKey];
        if (currentValue == null) {
            console.warn(
                `[Alert Check] Parameter '${alert.parameter}' has null/undefined value for alert ${alert.id}. Skipping.`,
            );
            continue;
        }

        let conditionMet = false;
        const threshold = alert.threshold;

        console.log(
            `[Alert Check] Evaluating Alert ID: ${alert.id}. Parameter: ${alert.parameter}, Current: ${currentValue}, Comparison: ${alert.comparison}, Threshold: ${threshold}`,
        );

        const numericCurrentValue = Number(currentValue);
        if (isNaN(numericCurrentValue)) {
            console.warn(
                `[Alert Check] Could not convert current value '${currentValue}' to number for alert ${alert.id}. Skipping.`,
            );
            continue;
        }

        switch (alert.comparison) {
            case ComparisonType.GREATER_THAN:
                conditionMet = numericCurrentValue > threshold;
                break;
            case ComparisonType.LESS_THAN:
                conditionMet = numericCurrentValue < threshold;
                break;
            case ComparisonType.EQUALS:
                conditionMet = numericCurrentValue === threshold;
                break;
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

            emailPromises.push(
                (async () => {
                    const tokenSymbol = alert.mint;
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

    await Promise.allSettled(emailPromises);
    console.log(`[Alert Check] Finished processing alerts for mint: ${mint}`);
}

export async function processTokenBatch(
    messages: TokenBatchMessage[],
    env: Env,
): Promise<void> {
    console.log(
        `[Redis Worker] Processing batch with ${messages.length} messages.`,
    );

    for (const message of messages) {
        const prisma = getPrisma(env.DATABASE_URL);
        const mints: string[] = message.mints;
        const messageId = Math.random().toString(36).substring(2); // Simulate message ID
        console.log(
            `[Redis Worker] Processing message ${messageId} for mints: ${mints.join(", ")}`,
        );

        for (const mint of mints) {
            try {
                /// we do this optimisation to reduce the writes in the db , if the data is unchanged we wont need to update the db
                const lastUpdate = await prisma.token_Metrics.findFirst({
                    where: { mint },
                    orderBy: { timestamp: "desc" },
                    select: { timestamp: true },
                });

                const reportResponse = await fetch(
                    `https://api.rugcheck.xyz/v1/tokens/${mint}/report`,
                );
                if (!reportResponse.ok) {
                    throw new Error(
                        `Report fetch failed (${reportResponse.status}): ${await reportResponse.text()}`,
                    );
                }
                const report: any = await reportResponse.json();

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

                const [priceData, votesData, insiderGraphData]: [
                    any,
                    any,
                    any,
                ] = await Promise.all([
                    priceRes.json(),
                    votesRes.json(),
                    insiderGraphRes.json(),
                ]);

                const price =
                    typeof priceData === "number"
                        ? priceData
                        : (priceData?.price ?? 0);

                const transactionTimestamp = new Date();

                await prisma.$transaction(async (tx) => {
                    const tokenMetricsData = {
                        timestamp: transactionTimestamp,
                        mint,
                        price,
                        totalMarketLiquidity: report.totalMarketLiquidity ?? 0,
                        totalHolders: report.totalHolders ?? 0,
                        score: report.score ?? 0,
                        score_normalised: report.score_normalised ?? 0,
                        upvotes: votesData.up ?? 0,
                        downvotes: votesData.down ?? 0,
                    };

                    const createdMetrics = await tx.token_Metrics.create({
                        data: tokenMetricsData,
                    });
                    console.log(
                        `[Worker] Token Metrics Created for ${mint} at ${transactionTimestamp.toISOString()}`,
                    );

                    const holderMovementsData = (report.topHolders || [])
                        .slice(0, 5)
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
                              lpLocked: firstMarket.lp?.lpLocked ?? null,
                              lpLockedPct: firstMarket.lp?.lpLockedPct ?? null,
                              usdcLocked: firstLocker?.usdcLocked ?? null,
                              unlockDate: firstLocker?.unlockDate ?? null,
                          }
                        : null;

                    const networks = Array.isArray(insiderGraphData)
                        ? insiderGraphData
                        : [];
                    const insiderGraphNodes = networks
                        .flatMap((network: any) => network.nodes || [])
                        .slice(0, 25)
                        .map((node: any) => ({
                            timestamp: transactionTimestamp,
                            mint,
                            node_id: node.id,
                            participant: node.participant ?? "unknown",
                            holdings: node.holdings ?? 0,
                        }));

                    const creationPromises: Promise<void>[] = [];

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

                    await checkAlerts(
                        tx as any as PrismaClient | Prisma.TransactionClient,
                        mint,
                        createdMetrics,
                    );
                });

                console.log(
                    `[Redis Worker] Successfully processed mint ${mint} in message ${messageId}`,
                );
            } catch (error: any) {
                console.error(
                    `[Redis Worker] Error processing mint ${mint} in message ${messageId}:`,
                    error.message,
                    error.stack,
                );
            }
        }

        console.log(`[Redis Worker] Finished processing message ${messageId}.`);
    }

    console.log(`[Redis Worker] Finished processing batch.`);
}

async function getTokensToMonitor(
    prisma: PrismaClient | Prisma.TransactionClient,
): Promise<string[]> {
    console.log("[Queueing] Fetching tokens to monitor...");
    // TODO: Replace hardcoded mints by querying the api for getting tokens
    //
    // for now we have a hardcoded list of tokens to monitor(mvp limitations otherwise,
    // we will overuse the cloudflare workers and i will be charged with hefty $ bills)
    const mints = [
        "6eVpGi4e3AA1fyN8r9oTMAQKUGjSh168jv1h295Ax1Qg",
        "DX1JSMFtirJmxWoLjSLvTYXSUfG5EELn638vA7pgJNGL",
        "Ddm4DTxNZxABUYm2A87TFLY6GDG2ktM2eJhGZS3EbzHM",
        "FtUEW73K6vEYHfbkfpdBZfWpxgQar2HipGdbutEhpump",
        "CU4Faw8o7Pj4tmXTR5qzYHmYeuShC3t8okZeQ5xqpump",
    ].slice(0, 50);

    console.log(`[Queueing] Found ${mints.length} tokens to monitor.`);
    return mints;
}

export async function queueTokenUpdateJobs(env: Env): Promise<number> {
    const prisma = getPrisma(env.DATABASE_URL);

    if (!env.UPSTASH_REDIS_REST_URL) {
        console.error("UPSTASH_REDIS_REST_URL is not set");
        return 0;
    }

    const redis = new Redis(env.UPSTASH_REDIS_REST_URL);

    const tokens = await getTokensToMonitor(
        prisma as any as PrismaClient | Prisma.TransactionClient,
    );

    if (tokens.length === 0) {
        console.log("[Queueing] No tokens found to queue. Exiting.");
        await redis.quit();
        return 0;
    }

    const batchSize = 10;
    let batchesQueued = 0;
    const messagesToSend: TokenBatchMessage[] = [];

    for (let i = 0; i < tokens.length; i += batchSize) {
        const batch = tokens.slice(i, i + batchSize);
        messagesToSend.push({ mints: batch });
    }

    try {
        console.log(
            `[Queueing] Sending ${messagesToSend.length} messages (batches) to Redis queue...`,
        );
        for (const message of messagesToSend) {
            await redis.lpush("token_update_batches", JSON.stringify(message));
        }
        batchesQueued = messagesToSend.length;
        console.log(
            `[Queueing] Successfully sent ${batchesQueued} batches to Redis queue.`,
        );
    } catch (error) {
        console.error(
            `[Queueing] Failed to send batches to Redis queue:`,
            error,
        );
        await redis.quit();
        throw error;
    } finally {
        await redis.quit();
    }
    console.log(`[Queueing] Finished queueing job.`);
    return batchesQueued;
}
