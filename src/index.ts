import { createApp } from './app.js';
import type { Env } from './types/env.js';

/**
 * Worker entry point. A single app instance is created at module scope so the
 * in-isolate central-directory memo and other module state persist across
 * requests handled by the same isolate.
 */
const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
