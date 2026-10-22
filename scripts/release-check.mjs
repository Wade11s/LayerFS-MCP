import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function shouldPublish(pkg, request = fetch) {
  const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stable.test(pkg.version)) throw new Error('Automatic latest publishing requires a stable x.y.z version.');
  const response = await request(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) throw new Error('Package does not exist yet. Complete the first manual publish and npm Trusted Publisher setup in docs/RELEASING.md.');
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status}; refusing to treat a lookup failure as an unpublished version.`);
  const metadata = await response.json();
  if (metadata.name !== pkg.name || !metadata.versions) throw new Error('Invalid npm registry package metadata.');
  if (Object.hasOwn(metadata.versions, pkg.version)) return false;
  const latest = metadata['dist-tags']?.latest;
  const latestCore = latest?.split('-')[0];
  if (!latestCore || !stable.test(latestCore) || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(latest)) throw new Error('Expected a valid latest version in the npm registry.');
  const next = pkg.version.split('.').map(Number);
  const previous = latestCore.split('.').map(Number);
  const difference = next.map((value, i) => value - previous[i]).find(value => value !== 0) || 0;
  if (difference < 0 || (difference === 0 && !latest.includes('-'))) throw new Error(`Version ${pkg.version} must be newer than npm latest ${latest}.`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const publish = await shouldPublish(pkg);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `publish=${publish}\n`);
  console.log(`${pkg.name}@${pkg.version}: ${publish ? 'new version; checks and publication required' : 'already published; skipped'}`);
}
