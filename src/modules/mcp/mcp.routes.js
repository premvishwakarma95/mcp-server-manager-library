'use strict';

/**
 * MCP HTTP transport.
 *
 * Endpoint: POST/GET/DELETE /:serverSlug/mcp
 *
 *  - POST: receives a JSON-RPC 2.0 message (or batch). Responds either as
 *    application/json or as an SSE event-stream, depending on the client's
 *    Accept header. This is the "Streamable HTTP" transport per the MCP spec.
 *  - GET:  opens an SSE stream from server to client. We don't push anything
 *    yet beyond keep-alives; the connection is kept open so picky clients
 *    that require this side-channel don't break.
 *  - DELETE: end-of-session no-op (we are stateless).
 */

const { Router } = require('express');
const asyncHandler = require('../../utils/asyncHandler');
const dispatcher = require('./mcp.dispatcher');
const logger = require('../../utils/logger');
const { guardServer, extractIp } = require('../../middlewares/serverGuards');

const router = Router({ mergeParams: true });

// Log incoming MCP requests (origin/referer/UA/ip) once per request, after the
// shared guards have resolved the server.
function logIncoming(req, _res, next) {
  logger.info('[mcp.source] Incoming MCP request', {
    slug:      req.mcpServer && req.mcpServer.slug,
    origin:    req.headers['origin']    || null,
    referer:   req.headers['referer']   || null,
    userAgent: req.headers['user-agent'] || null,
    ip:        extractIp(req),
  });
  next();
}

function wantsEventStream(req) {
  const accept = String(req.headers.accept || '').toLowerCase();
  // If the client asks for SSE (with or without json fallback), use SSE.
  return accept.includes('text/event-stream');
}

function writeSseEvent(res, payload, event) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function dispatchAndRespond(req, res) {
  const message = req.body;

  // Empty body — some clients ping with no body when initializing. Treat as 400.
  if (message === null || message === undefined || message === '') {
    return res.status(400).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Empty body (expected JSON-RPC message)' },
    });
  }

  // Batch?
  if (Array.isArray(message)) {
    const responses = await Promise.all(
      message.map((m) =>
        dispatcher.dispatch({ server: req.mcpServer, message: m, requestId: req.id, callerHeaders: req.headers })
      )
    );
    const out = responses.filter((r) => r !== null);
    if (out.length === 0) return res.status(202).end(); // all notifications

    if (wantsEventStream(req)) {
      sendSse(res, out);
      return undefined;
    }
    return res.json(out);
  }

  const response = await dispatcher.dispatch({
    server: req.mcpServer,
    message,
    requestId: req.id,
    callerHeaders: req.headers,
  });

  // Notification → 202 Accepted, no body.
  if (response === null) return res.status(202).end();

  if (wantsEventStream(req)) {
    sendSse(res, response);
    return undefined;
  }
  return res.json(response);
}

function sendSse(res, payload) {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  writeSseEvent(res, payload, 'message');
  res.end();
}

router.post('/', ...guardServer(), logIncoming, asyncHandler(dispatchAndRespond));

router.get('/', ...guardServer(), logIncoming, (req, res) => {
  // Server-to-client SSE channel. We have no proactive notifications today,
  // so this is just keep-alives. Closing the stream is fine if the client
  // disconnects.
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(`: mcp stream open for ${req.mcpServer.slug}\n\n`);

  const keepalive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch (_) { /* socket closed */ }
  }, 25_000);

  const close = () => {
    clearInterval(keepalive);
    try { res.end(); } catch (_) { /* ignore */ }
  };
  req.on('close', close);
  req.on('aborted', close);
});

router.delete('/', ...guardServer(), (req, res) => {
  // Stateless — session close is a no-op. Return 200 so strict clients are happy.
  logger.debug(`MCP DELETE on ${req.mcpServer.slug} (session close)`);
  res.status(200).json({ ok: true });
});

module.exports = router;
