import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sseBus } from './sse-bus';

export function registerSseRoute(server: FastifyInstance) {
  server.get(
    '/api/events/sse',
    async (req: FastifyRequest, reply: FastifyReply) => {
      reply.hijack();
      reply.raw.statusCode = 200;
      reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      reply.raw.setTimeout(0);
      reply.raw.flushHeaders?.();
      reply.raw.write(': connected\n\n');

      const channels = [
        'run-event',
        'benchpack-mutation-progress',
        'verifier-progress',
      ];

      const unsubscribers = channels.map((ch) =>
        sseBus.on(ch, (data) => {
          reply.raw.write(`event: ${ch}\ndata: ${JSON.stringify(data)}\n\n`);
        }),
      );

      const keepAlive = setInterval(() => {
        reply.raw.write(': heartbeat\n\n');
      }, 15000);

      req.raw.on('close', () => {
        unsubscribers.forEach((u) => u());
        clearInterval(keepAlive);
      });
    },
  );
}
