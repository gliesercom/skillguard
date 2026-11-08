import test from 'node:test';
import assert from 'node:assert/strict';
import { querySkillGuardAttestation } from '../../cli/skillguard.mjs';
import { handleJsonRpcMessage } from '../../cli/mcp-server.mjs';

test('CLI verifier approves verified OpenZeppelin commit and blocks backdoored MCP', async () => {
  const clean = await querySkillGuardAttestation(
    'OpenZeppelin/openzeppelin-contracts@3e6c86392c97fbc30d3d20a378a6f58beba08eba'
  );
  assert.equal(clean.verdict, 'APPROVED');
  assert.equal(clean.risk_level, 'LOW');

  const blocked = await querySkillGuardAttestation(
    'agent-tools-lab/solana-rebalancer-mcp@7b4e9102aa891234bcde0987654321fedcba0987'
  );
  assert.equal(blocked.verdict, 'BLOCKED');
  assert.equal(blocked.risk_level, 'CRITICAL');
});

test('MCP JSON-RPC server lists tools and executes skillguard_check_attestation', async () => {
  const listRes = await handleJsonRpcMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });
  assert.equal(listRes.result.tools[0].name, 'skillguard_check_attestation');

  const callRes = await handleJsonRpcMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'skillguard_check_attestation',
      arguments: {
        target:
          'OpenZeppelin/openzeppelin-contracts@3e6c86392c97fbc30d3d20a378a6f58beba08eba',
      },
    },
  });
  assert.equal(callRes.result.isError, false);
  const payload = JSON.parse(callRes.result.content[0].text);
  assert.equal(payload.verdict, 'APPROVED');
});
