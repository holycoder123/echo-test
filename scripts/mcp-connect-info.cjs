#!/usr/bin/env node
'use strict';

const path = require('node:path');
const fs = require('node:fs');

function connectionInfo(root = path.resolve(__dirname, '..')) {
  const proxy = path.join(root, 'scripts', 'mcp-proxy.cjs');
  const bundledNode = path.join(root, 'runtime', 'node', 'node.exe');
  const node = fs.existsSync(bundledNode) ? bundledNode : 'node';
  // TOML literal strings preserve Windows backslashes. Use a basic string when
  // a directory contains an apostrophe; JSON escapes are also valid here.
  const toml = value => value.includes("'") ? JSON.stringify(value) : `'${value}'`;
  // PowerShell's single quoted string preserves spaces and literal metacharacters.
  const powershell = value => `'${value.replaceAll("'", "''")}'`;
  return [
    'Run this PowerShell command once to register the workbench in your Codex profile:',
    `codex mcp add echo-test -- ${powershell(node)} ${powershell(proxy)}`,
    '',
    'Or add this equivalent entry in Codex Settings > MCP servers / config.toml:',
    '[mcp_servers.echo-test]',
    `command = ${toml(node)}`,
    `args = [${toml(proxy)}]`,
    `cwd = ${toml(root)}`,
    'startup_timeout_sec = 15',
    'tool_timeout_sec = 60',
    '',
    'Default starts request Windows administrator permission and enable MCP. Confirm the UAC prompt to open the workbench.',
    'To disable MCP for one launch, run scripts/start-studio.ps1 -NoMcp or Electron with --disable-mcp.',
    'The proxy reads the rotating local credential from .runtime/mcp-connection.json; no token belongs in Codex configuration.',
    'After saving, restart the MCP server in Codex Settings and verify it with /mcp.',
  ].join('\n');
}

if (require.main === module) process.stdout.write(`${connectionInfo()}\n`);

module.exports = { connectionInfo };
