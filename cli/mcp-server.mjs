#!/usr/bin/env node
// SkillGuard MCP Server (JSON-RPC 2.0 over stdio for Claude / Cursor / Antigravity)

import readline from 'node:readline';
import { querySkillGuardAttestation } from './skillguard.mjs';

const SERVER_INFO = {
  name: 'skillguard-mcp',
  version: '1.0.0',
};

const TOOLS = [
  {
    name: 'skillguard_check_attestation',
    description:
      'Query GenLayer SkillGuard on-chain attestation for a commit-pinned MCP server or Agent Skill (<owner/repo>@<commit_sha>) before installation or invocation.',
    inputSchema: {
      type: 'object',
      properties: {
        target: {
          type: 'string',
          description: 'Repository and commit SHA in the format owner/repo@commit_sha',
        },
      },
      required: ['target'],
    },
  },
];

export async function handleJsonRpcMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      },
    };
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: TOOLS },
    };
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    if (toolName === 'skillguard_check_attestation') {
      try {
        const res = await querySkillGuardAttestation(toolArgs.target);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
            isError: res.verdict === 'BLOCKED',
          },
        };
      } catch (err) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: String(err.message || err) }],
            isError: true,
          },
        };
      }
    }
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Unknown tool: ${toolName}` },
    };
  }

  if (id !== undefined) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('mcp-server.mjs')) {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const parsed = JSON.parse(trimmed);
      const response = await handleJsonRpcMessage(parsed);
      if (response) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch {
      // ignore malformed line
    }
  });
}
