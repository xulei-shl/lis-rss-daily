/**
 * 启动LinkMind的Web服务器部分，不启动Telegram机器人
 */
import dotenv from "dotenv";
dotenv.config({ override: true });

import { initLogger, logger } from "./src/logger.js";
import { getLLM } from "./src/llm.js";
import { startWebServer } from "./src/web.js";

// Initialize logger after dotenv has loaded
initLogger();

const webPort = parseInt(process.env.WEB_PORT ?? "3456", 10);
const webBaseUrl = process.env.WEB_BASE_URL ?? `http://localhost:${webPort}`;

logger.info("🧠 LinkMind Web Server starting (without Telegram Bot)...");

// Initialize LLM provider (validates API keys)
const llm = getLLM();
logger.info({ llm: llm.name, web: webBaseUrl }, "Config");

// Start web server only
startWebServer(webPort);

logger.info("🧠 LinkMind Web Server ready!");