import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldPublish } from '../scripts/release-check.mjs';

test('release gate skips existing versions, allows newer versions and prevents latest rollback', async () => {
  const request = async () => new Response(JSON.stringify({ name: 'layerfs-mcp', versions: { '0.1.0': {} }, 'dist-tags': { latest: '0.1.0' } }));
  assert.equal(await shouldPublish({ name: 'layerfs-mcp', version: '0.1.0' }, request), false);
  assert.equal(await shouldPublish({ name: 'layerfs-mcp', version: '0.2.0' }, request), true);
  await assert.rejects(shouldPublish({ name: 'layerfs-mcp', version: '0.0.9' }, request), /newer/);
  await assert.rejects(shouldPublish({ name: 'layerfs-mcp', version: '0.2.0-beta.1' }, request), /stable/);
});

test('release gate distinguishes first publication from registry outages and malformed responses', async () => {
  const pkg = { name: 'layerfs-mcp', version: '0.1.0' };
  await assert.rejects(shouldPublish(pkg, async () => new Response('', { status: 404 })), /first manual publish/);
  await assert.rejects(shouldPublish(pkg, async () => new Response('', { status: 503 })), /HTTP 503/);
  await assert.rejects(shouldPublish(pkg, async () => { throw new Error('network unavailable'); }), /network unavailable/);
  await assert.rejects(shouldPublish(pkg, async () => new Response('{}')), /Invalid/);
});

test('first stable release can advance a bootstrap prerelease without rolling back latest', async () => {
  const request = latest => async () => new Response(JSON.stringify({ name: 'layerfs-mcp', versions: { [latest]: {} }, 'dist-tags': { latest } }));
  const pkg = { name: 'layerfs-mcp', version: '0.1.0' };
  assert.equal(await shouldPublish(pkg, request('0.0.0-stage')), true);
  assert.equal(await shouldPublish(pkg, request('0.1.0-rc.1')), true);
  await assert.rejects(shouldPublish(pkg, request('0.2.0-rc.1')), /newer/);
});
