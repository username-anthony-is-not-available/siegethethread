import {
  createTRPCProxyClient,
  httpLink,
} from '@trpc/client';
import type { AppRouter } from '../server/trpc';

/**
 * Typed tRPC proxy client.
 * The URL is relative so it works in both the Devvit iframe and local playtest.
 * `import type { AppRouter }` is erased at runtime — no server code is bundled
 * into the client; only the TypeScript type information is used.
 */
export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpLink({
      url: '/trpc',
      fetch: (url, options) => {
        const fetchOpts: RequestInit = {};
        if (options) {
          Object.assign(fetchOpts, options);
        }
        fetchOpts.keepalive = true;
        return fetch(url, fetchOpts);
      },
    }),
  ],
});
