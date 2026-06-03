import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import { registerAuthRoutes } from "./auth/auth.routes.js";
import { registerDashboardRoutes } from "./dashboard/index.js";
import { registerDownloaderRoutes } from "./downloaders/index.js";
import { registerFeedRoutes } from "./feeds/index.js";
import { registerItemRoutes } from "./items/index.js";
import { registerJobRoutes } from "./jobs/index.js";
import { registerMediaRoutes } from "./media/index.js";
import { registerMemberRoutes } from "./members/members.routes.js";
import { registerSubscriptionRoutes } from "./subscriptions/index.js";
import { registerWorkspaceRoutes } from "./workspaces/workspaces.routes.js";

export async function registerAppRoutes(app: FastifyInstance, config: AppConfig) {
  await registerAuthRoutes(app, config);
  await registerWorkspaceRoutes(app, config);
  await registerMemberRoutes(app);
  await registerFeedRoutes(app, config);
  await registerItemRoutes(app, config);
  await registerMediaRoutes(app, config);
  await registerSubscriptionRoutes(app, config);
  await registerDownloaderRoutes(app, config);
  await registerJobRoutes(app, config);
  registerDashboardRoutes(app);
}
