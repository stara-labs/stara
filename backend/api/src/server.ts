import Fastify from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Writable } from 'node:stream';

export function createServer(options: { logStream?: Writable } = {}) {
  const server = Fastify({
    exposeHeadRoutes: false,
    requestIdHeader: false,
    forceCloseConnections: true,
    requestTimeout: 10_000,
    connectionTimeout: 10_000,
    logger: {
      level: 'info',
      ...(options.logStream ? { stream: options.logStream } : {}),
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'headers.authorization',
          'headers.cookie',
          'res.headers["set-cookie"]',
        ],
        censor: '[Redacted]',
      },
      // Allowlist log fields: URLs, headers, bodies, and raw errors can contain secrets.
      serializers: {
        req: (request) => ({ method: request.method }),
        res: (reply) => ({ statusCode: reply.statusCode }),
        err: () => ({ type: 'Error', message: 'Operation failed', stack: '' }),
      },
    },
    frameworkErrors: (_error, request: FastifyRequest, reply: FastifyReply) => {
      request.log.warn({ event: 'request_rejected' }, 'Request rejected');
      void reply.code(400).send({ error: 'Request failed' });
    },
  });

  // Fastify's secondary localhost listeners close without awaiting their callbacks.
  // Drain accepted responses first, then let Fastify close connections on every binding.
  let activeResponses = 0;
  let drained: (() => void) | undefined;
  server.addHook('onRequest', (_request, reply, done) => {
    activeResponses++;
    const complete = () => {
      reply.raw.off('finish', complete);
      reply.raw.off('close', complete);
      activeResponses--;
      if (activeResponses === 0) drained?.();
    };
    reply.raw.once('finish', complete);
    reply.raw.once('close', complete);
    done();
  });
  server.addHook('preClose', async () => {
    if (activeResponses > 0) {
      await new Promise<void>((resolve) => {
        drained = resolve;
      });
    }
  });

  server.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({ error: 'Not Found' });
  });
  server.setErrorHandler((error, request, reply) => {
    const candidate = (error as { statusCode?: number }).statusCode;
    const clientError =
      Number.isInteger(candidate) && Number(candidate) >= 400 && Number(candidate) < 500;
    const statusCode = clientError ? Number(candidate) : 500;
    request.log.error({ event: 'request_failed', statusCode }, 'Request failed');
    void reply
      .code(statusCode)
      .send({ error: clientError ? 'Request failed' : 'Internal Server Error' });
  });
  server.get(
    '/api/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            additionalProperties: false,
            required: ['status'],
            properties: { status: { type: 'string', const: 'ok' } },
          },
        },
      },
    },
    async () => ({ status: 'ok' }),
  );
  return server;
}
