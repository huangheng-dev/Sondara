import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.logLevel,
  base: { service: "sondara-api", version: config.version },
  timestamp: pino.stdTimeFunctions.isoTime,
});
