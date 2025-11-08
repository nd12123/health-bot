// src/index.ts
import "dotenv/config";
import { Bot } from "grammy";
// import { registerFlows } from "./bot/flows.js"; // v1: hardcoded questions
// import { registerFlowsV2 } from "./bot/flows-v2.js"; // v2: dynamic questions
import { registerFlowsV3 } from "./bot/flows-v3.js"; // v3: medical card with demographics

const bot = new Bot(process.env.BOT_TOKEN!);
registerFlowsV3(bot); // используем новую версию с медицинской картой
bot.start();

console.log("✓ Health bot v0.3.0 started (medical card flow)");
