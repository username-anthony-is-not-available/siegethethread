import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createServer, getServerPort } from '@devvit/web/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from './trpc';
import { forms } from './routes/forms';
import { menu } from './routes/menu';
import { triggers } from './routes/triggers';

const app = new Hono();
const internal = new Hono();

internal.route('/menu', menu);
internal.route('/form', forms);
internal.route('/triggers', triggers);

app.route('/internal', internal);

// tRPC adapter — handles all /trpc/* requests with end-to-end type safety
app.all('/trpc/*', (c) =>
  fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    onError: ({ path, error }) => {
      console.error(`[tRPC] Error on procedure '${path ?? 'unknown'}':`, error.message);
    },
  })
);

serve({
  fetch: app.fetch,
  createServer,
  port: getServerPort(),
});
