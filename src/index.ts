import { Hono } from "hono";
import { cors } from "hono/cors"; // Import cors middleware
import { logger } from "hono/logger"; // Optional: Add logger middleware
import { getPrisma } from "./prisma"; // Your Prisma client setup
import { dbupdate } from "./cronjobs/cronjobs"; // Your existing cron job import
import {
    deleteAlert,
    getAlertByMint,
    getAlertByUserEmail,
    getAlerts,
    makeAlert,
    updateAlert,
} from "./alerts";

// Import the tokenomics functions
import {
    getHolderHistory,
    getLiquidityHistory,
    getLiquidityLockInfo,
    getPriceHistory,
    getSummary,
    getTopHolders,
} from "./tokenomics";

// --- Initialize Hono App ---
const app = new Hono<{ Bindings: { DATABASE_URL: string } }>();

// --- Middleware ---
app.use("*", logger()); // Log all requests
app.use("*", cors()); // Enable CORS for frontend access

// --- Existing Routes ---
app.get("/", (c) => c.text("RugCheck Backend is running!"));
app.get("/cron/poll", dbupdate); // Your existing cron endpoint

// ---Token alert endpoints---
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

// TODO:cache this route
app.get("/tokens/:mint/visualizations/holders", getHolderHistory);

// TODO:cache this route
app.get("/tokens/:mint/visualizations/top-holders", getTopHolders);
app.get("/tokens/:mint/visualizations/liquidity-lock", getLiquidityLockInfo);

export default app;
