import { Redis } from "ioredis";
import type { Env } from "../types"; // Assuming you create a types file

let redisInstance: Redis | null = null;

export function getRedisConnection(env: Env): Redis {
    if (!redisInstance) {
        console.log("Initializing Redis connection...");
        redisInstance = new Redis({
            host: env.REDIS_HOST,
            port: Number(env.REDIS_PORT) || 6379,
            password: env.REDIS_PASSWORD,
            maxRetriesPerRequest: null, // Recommended for serverless environments
            enableReadyCheck: false, // Optional: can speed up initial connection
            lazyConnect: true, // Connect only when needed
        });

        redisInstance.on("error", (err) => {
            console.error("Redis Client Error:", err);
            // Reset instance on critical errors to allow re-initialization
            if (err.message === "ECONNREFUSED" || err.message === "ENOTFOUND") {
                redisInstance = null;
            }
        });
        redisInstance.on("connect", () => {
            console.log("Redis connected successfully.");
        });
        redisInstance.on("ready", () => {
            console.log("Redis client ready.");
        });
        redisInstance.on("close", () => {
            console.log("Redis connection closed.");
            redisInstance = null; // Allow re-initialization
        });
    }
    return redisInstance;
}

// Optional: Function to explicitly close connection if needed (e.g., for testing)
export async function disconnectRedis(): Promise<void> {
    if (redisInstance) {
        await redisInstance.quit();
        redisInstance = null;
        console.log("Redis connection explicitly closed.");
    }
}
