import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import * as Sentry from "@sentry/node";
import { AppModule } from "./app";
import { ErrorFilter } from "./core";
export async function createApp() {
  const production = process.env.NODE_ENV === "production";
  if (!process.env.DATABASE_URL || !process.env.BOT_TOKEN)
    throw new Error("DATABASE_URL and BOT_TOKEN are required");
  const origins = (process.env.FRONTEND_URL || "http://localhost:3000")
    .split(",")
    .map((x) => x.trim());
  if (origins.some((o) => o.includes("*") || !/^https?:\/\//.test(o)))
    throw new Error("Explicit frontend origins required");
  if (
    production &&
    (!process.env.TELEGRAM_WEBHOOK_SECRET ||
      process.env.TELEGRAM_WEBHOOK_SECRET.length < 32 ||
      origins.some((o) => !o.startsWith("https://")) ||
      process.env.ALLOW_DEV_AUTH === "true")
  )
    throw new Error("Invalid production security configuration");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    sendDefaultPii: false,
    beforeSend: (event) => {
      delete event.request;
      return event;
    },
  });
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));
  if (production) app.getHttpAdapter().getInstance().set("trust proxy", 1);
  app.use(helmet());
  app.use(json({ limit: "32kb" }));
  app.enableCors({
    origin: origins,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  });
  app.setGlobalPrefix("api/v1");
  app.useGlobalFilters(app.get(ErrorFilter));
  app.enableShutdownHooks();
  return app;
}
