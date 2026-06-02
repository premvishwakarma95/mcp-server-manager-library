'use strict';

const ApiError = require('../../utils/ApiError');

/**
 * Resolve auth configuration with tool-level overriding server-level (when the tool
 * declares anything other than 'inherit'), and inject the appropriate headers/auth
 * onto an Axios request config.
 *
 * Server-level `toolAuthType` (bearer/apiKey) takes precedence: it forwards the
 * caller's inbound header verbatim to upstream. When `toolAuthType === 'none'`
 * (or absent), we fall through to the existing inherit-from-server logic.
 */
function applyToolAuthPassthrough(axiosConfig, server, tool, callerHeaders) {
  const mode = server && server.toolAuthType;
  if (!mode || mode === 'none') return false; // signal: caller should run legacy path

  // Per-tool opt-out. Lets an admin run one public-API tool on an otherwise-
  // authenticated server without faking a credential. When set, we skip the
  // pass-through and fall through to the legacy applyAuth path (which will
  // typically be a no-op too if tool.auth.type === 'inherit' and server.auth
  // is 'none').
  if (tool && tool.disableServerToolAuth === true) return false;

  axiosConfig.headers = axiosConfig.headers || {};
  const headers = callerHeaders || {};

  if (mode === 'bearer') {
    const raw = headers.authorization || headers.Authorization;
    if (!raw || !String(raw).trim()) {
      throw ApiError.unauthorized(
        `Server "${server.slug}" requires an inbound "Authorization: Bearer <token>" header to relay upstream.`
      );
    }
    axiosConfig.headers.Authorization = String(raw);
    return true;
  }

  if (mode === 'apiKey') {
    const headerName = (server.toolAuthHeaderName || 'x-api-key');
    // Express lowercases header keys; look up by lowercase but write back with
    // the admin-configured casing so upstream sees what they expect.
    const value = headers[headerName.toLowerCase()];
    if (!value || !String(value).trim()) {
      throw ApiError.unauthorized(
        `Server "${server.slug}" requires an inbound "${headerName}" header to relay upstream.`
      );
    }
    axiosConfig.headers[headerName] = String(value);
    return true;
  }

  return false;
}

function resolveSecret(authConfig) {
  if (!authConfig) return null;
  if (authConfig.secretEnvVar) {
    const v = process.env[authConfig.secretEnvVar];
    if (v) return v;
  }
  return null;
}

function resolveEffectiveAuth(server, tool) {
  const serverAuth = server.auth || { type: server.authType || 'none' };
  const toolAuth = tool.auth || { type: 'inherit' };
  if (!toolAuth.type || toolAuth.type === 'inherit') return serverAuth;
  return toolAuth;
}

function applyAuth(axiosConfig, server, tool, callerHeaders) {
  // Server-level pass-through wins when configured — replaces the existing
  // admin/inherit credential for upstream. When it returns true, the request's
  // auth header has been set from the caller's inbound credential; skip the
  // legacy path so we don't double-write.
  if (applyToolAuthPassthrough(axiosConfig, server, tool, callerHeaders)) return axiosConfig;

  const auth = resolveEffectiveAuth(server, tool);
  if (!auth || !auth.type || auth.type === 'none') return axiosConfig;

  axiosConfig.headers = axiosConfig.headers || {};

  switch (auth.type) {
    case 'bearer': {
      const token = resolveSecret(auth) || auth.token;
      if (token) axiosConfig.headers.Authorization = `Bearer ${token}`;
      break;
    }
    case 'apiKey': {
      const headerName = auth.headerName || 'x-api-key';
      const value = resolveSecret(auth) || auth.token;
      if (value) axiosConfig.headers[headerName] = value;
      break;
    }
    case 'basic': {
      const password = resolveSecret(auth) || auth.password;
      if (auth.username && password) axiosConfig.auth = { username: auth.username, password };
      break;
    }
    default:
      break;
  }
  return axiosConfig;
}

module.exports = { applyAuth, resolveEffectiveAuth };
