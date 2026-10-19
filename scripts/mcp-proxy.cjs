#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
  ToolListChangedNotificationSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const ROOT = path.resolve(__dirname, '..');
const MAX_CONNECTION_BYTES = 16 * 1024;

function comparablePath(value) {
  const result = path.resolve(value);
  return process.platform === 'win32' ? result.toLowerCase() : result;
}

function validateConnection(value, root = ROOT) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MCP connection descriptor must be an object.');
  }
  if (typeof value.root !== 'string' || !path.isAbsolute(value.root) ||
      comparablePath(value.root) !== comparablePath(root)) {
    throw new Error('MCP connection belongs to a different workbench directory.');
  }
  // Accept only the exact endpoint shape written by this workbench. This also
  // rejects credentials, queries, fragments and alternate numeric host spellings.
  const endpointMatch = typeof value.url === 'string' && /^http:\/\/127\.0\.0\.1:(\d{1,5})\/mcp$/.exec(value.url);
  if (!endpointMatch) {
    throw new Error('MCP connection must use http://127.0.0.1:<port>/mcp.');
  }
  const endpoint = new URL(value.url);
  const port = Number(endpointMatch[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MCP connection has an invalid local port.');
  }
  if (typeof value.token !== 'string' || !/^[a-f0-9]{64}$/.test(value.token)) {
    throw new Error('MCP connection has an invalid authentication token.');
  }
  if (!Number.isSafeInteger(value.pid) || value.pid <= 0) {
    throw new Error('MCP connection has an invalid workbench process ID.');
  }
  if (typeof value.version !== 'string' || !/^[A-Za-z0-9.+_-]{1,64}$/.test(value.version)) {
    throw new Error('MCP connection has an invalid version.');
  }
  return Object.freeze({ url: endpoint.href, token: value.token, pid: value.pid,
    root: path.resolve(root), version: value.version });
}

function readConnection(root = ROOT) {
  const runtimeDir = path.join(root, '.runtime');
  const filename = path.join(runtimeDir, 'mcp-connection.json');
  let file;
  try {
    const directory = fs.lstatSync(runtimeDir);
    const before = fs.lstatSync(filename);
    if (!directory.isDirectory() || directory.isSymbolicLink() ||
        !before.isFile() || before.isSymbolicLink()) {
      throw new Error('MCP runtime must be a regular file in a local directory.');
    }
    if (before.size > MAX_CONNECTION_BYTES) {
      throw new Error('MCP connection descriptor is too large.');
    }
    const expectedDirectory = path.join(fs.realpathSync(root), '.runtime');
    if (comparablePath(fs.realpathSync(runtimeDir)) !== comparablePath(expectedDirectory)) {
      throw new Error('MCP runtime directory cannot redirect outside the workbench.');
    }
    file = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(file);
    if (!opened.isFile() || opened.size > MAX_CONNECTION_BYTES ||
        opened.ino !== before.ino || opened.dev !== before.dev) {
      throw new Error('MCP connection descriptor changed while opening.');
    }
    // A bounded read also handles a descriptor being enlarged after fstat.
    const data = Buffer.alloc(MAX_CONNECTION_BYTES + 1);
    let length = 0;
    while (length < data.length) {
      const count = fs.readSync(file, data, length, data.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > MAX_CONNECTION_BYTES) {
      throw new Error('MCP connection descriptor is too large.');
    }
    let parsed;
    try { parsed = JSON.parse(data.subarray(0, length).toString('utf8')); }
    catch { throw new Error('MCP connection descriptor contains invalid JSON.'); }
    return validateConnection(parsed, root);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Workbench MCP is not enabled. Start start_admin_mcp.cmd first, then reconnect the Codex MCP server.');
    }
    throw error;
  } finally {
    if (file !== undefined) fs.closeSync(file);
  }
}

function safeMessage(error, token) {
  let message = error instanceof Error ? error.message : String(error);
  if (token) message = message.replaceAll(token, '[redacted]');
  return message.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]').slice(0, 1600);
}

async function startProxy({ root = ROOT, stdin = process.stdin,
  stdout = process.stdout, stderr = process.stderr } = {}) {
  const connection = readConnection(root);
  const log = error => stderr.write(`[nycs-studio MCP] ${safeMessage(error, connection.token)}\n`);
  const client = new Client({ name: 'nycs-studio-stdio-proxy', version: connection.version });
  // Do not follow redirects with the workbench bearer token, including on SSE GET.
  const localFetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== connection.url) throw new Error('MCP proxy refused a different network endpoint.');
    return fetch(input, { ...init, redirect: 'error' });
  };
  const upstream = new StreamableHTTPClientTransport(new URL(connection.url), {
    requestInit: { headers: { Authorization: `Bearer ${connection.token}` } },
    fetch: localFetch,
    reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000,
      maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
  });
  client.onerror = log;
  let server;
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    stdin.off('end', onEnd);
    process.off('SIGINT', onEnd);
    process.off('SIGTERM', onEnd);
    await Promise.allSettled([server?.close(), client.close()]);
  };
  const onEnd = () => { close().catch(log); };
  try {
    await client.connect(upstream, { timeout: 8000 });
    const capabilities = client.getServerCapabilities();
    if (!capabilities?.tools) throw new Error('Workbench MCP server does not expose tools.');
    server = new Server({ name: 'nycs-studio', version: connection.version }, {
      capabilities: { tools: { listChanged: Boolean(capabilities.tools.listChanged) } },
      instructions: client.getInstructions(),
    });
    server.onerror = log;
    server.onclose = onEnd;
    client.onclose = onEnd;
    server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
      try {
        return await client.listTools(request.params, { signal: extra.signal, timeout: 15000 });
      } catch (error) {
        // Never include a bearer credential in a JSON-RPC error or diagnostic.
        throw new Error(safeMessage(error, connection.token));
      }
    });
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      try {
        return await client.callTool(request.params, CallToolResultSchema,
          { signal: extra.signal, timeout: 55000 });
      } catch (error) {
        log(error);
        return { isError: true, content: [{ type: 'text', text:
          `Workbench MCP request failed: ${safeMessage(error, connection.token)}. Check the workbench connection and run state before retrying; game inputs are not replayed automatically.` }] };
      }
    });
    if (capabilities.tools.listChanged) {
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        await server.sendToolListChanged();
      });
    }
    stdin.once('end', onEnd);
    process.once('SIGINT', onEnd);
    process.once('SIGTERM', onEnd);
    await server.connect(new StdioServerTransport(stdin, stdout));
    return { client, server, close };
  } catch (error) {
    await close();
    throw new Error(safeMessage(error, connection.token));
  }
}

if (require.main === module) {
  startProxy().catch(error => {
    process.stderr.write(`[nycs-studio MCP] ${safeMessage(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { ROOT, MAX_CONNECTION_BYTES, validateConnection, readConnection, safeMessage, startProxy };
