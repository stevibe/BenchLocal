import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { registerApiRoutes } from './api-routes';
import { pathExists, resolveRendererOutDir } from './path-resolution';
import { activeRunManager } from './run-manager';
import { registerSseRoute } from './sse-route';

async function main() {
  const server = Fastify({ logger: { level: 'info' } });

  registerApiRoutes(server);
  registerSseRoute(server);

  const rendererOut = resolveRendererOutDir();
  const rendererOutExists = pathExists(rendererOut);

  if (rendererOutExists) {
    server.register(fastifyStatic, { root: rendererOut, prefix: '/' });

    server.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.type('text/html').sendFile('index.html');
    });
  } else {
    server.log.warn(
      `Renderer build output not found at ${rendererOut}. Static SPA serving is disabled.`,
    );

    server.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.code(503).send({
        error:
          'Web renderer build not found. Run npm run web:build or npm run web:dev.',
      });
    });
  }

  const port = Number(process.env.BENCHLOCAL_PORT) || 4300;
  const host = process.env.BENCHLOCAL_HOST || '0.0.0.0';

  await server.listen({ port, host });
  console.log(`BenchLocal running at http://${host}:${port}`);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await activeRunManager.shutdown();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await activeRunManager.shutdown();
  process.exit(0);
});

main();
