// Compatibility for the pinned Harness Web settings client. Remove when upstream
// exposes a supported persistence capability for authenticated remote operators.
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const version='0.2.1-alpha.1';
const upstreamHash='2ac7f186165c5a8ec2cd90045cf74693e5d3518ec90cd429951360d79754aa94';
const original='const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";';
const replacement='const persistence = (ctx.remote.$host.isLoopback || (globalThis.location?.protocol === "https:" && globalThis.location.origin === globalThis.__MANGAI_SETTINGS_ORIGIN__)) ? "host" : "memory";';
const digest=text=>createHash('sha256').update(text).digest('hex');

/** Change only this settings client's persistence decision, never host identity,
 * authentication, allowed origins, or the server's redaction/writability rules.
 * Refuse unreviewed upstream bytes instead of silently patching a new version. */
export function patchSettingsClient(source,installedVersion){
  if(installedVersion!==version)throw Error('Harness settings compatibility: unsupported version; review the remote settings adapter');
  const count=source.split(replacement).length-1;
  const baseline=count===1?source.replace(replacement,original):source;
  if(digest(baseline)!==upstreamHash)throw Error('Harness settings compatibility: upstream bundle changed; review the remote settings adapter');
  return count===1?source:source.replace(original,replacement);
}

/** Reapply after npm install; an already installed, verified patch is a no-op. */
export async function prepareHarnessSettings(packageRoot){
  const directory=join(packageRoot,'node_modules/@deepseek-ai/dsh-client-ui-settings');
  const manifest=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
  const file=join(directory,'lib/client.js'),source=await readFile(file,'utf8');
  const patched=patchSettingsClient(source,manifest.version);
  if(patched!==source)await writeFile(file,patched);
}
