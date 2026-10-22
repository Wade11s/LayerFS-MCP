/** Launch an in-container Node entry with a private, collision-free temp root.
 * Upstream names Store overlays using PID + a process counter; container PID
 * reuse after restart must not collide with temporary files left by a killed client.
 * This directory never contains the persistent project Store.
 */
export function isolatedEntry(script: string, args: string[]): string {
  return `const fs=require('node:fs');
const dir=fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'layerfs-mcp-'));
fs.chmodSync(dir,0o700); process.env.TMPDIR=dir;
process.once('exit',()=>{try{fs.rmSync(dir,{recursive:true,force:true})}catch{}});
const child=require('node:child_process').spawn(process.execPath,[${JSON.stringify(script)},...${JSON.stringify(args)}],{stdio:'inherit',env:process.env});
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>child.kill(signal));
child.once('error',error=>{console.error(error);process.exitCode=1});
child.once('exit',(code,signal)=>{process.exitCode=code ?? (signal==='SIGINT'?130:143)});`;
}
