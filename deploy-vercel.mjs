import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const token = process.env.VERCEL_TOKEN;
const teamId = 'team_7R94UUPSqKzRtQPrf1G6UbOw';
const projectId = 'prj_cPEorNybRfSmOONDSEg4r6PNA8hZ';
if (!token) throw new Error('VERCEL_TOKEN missing');
const root = process.cwd();
const skip = new Set(['node_modules', '.git', '.vercel', 'android', 'deploy-vercel.mjs']);
async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}
const files = await walk(root);
const refs = [];
for (const file of files) {
  const buf = await fs.readFile(file);
  const sha = crypto.createHash('sha1').update(buf).digest('hex');
  const res = await fetch(`https://api.vercel.com/v2/now/files?teamId=${teamId}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'x-vercel-digest': sha }, body: buf
  });
  if (!res.ok) throw new Error(`upload ${file}: ${res.status} ${await res.text()}`);
  refs.push({ file: path.relative(root, file).replaceAll('\\','/'), sha, size: buf.length });
  process.stdout.write(`uploaded ${refs.at(-1).file}\n`);
}
const res = await fetch(`https://api.vercel.com/v12/now/deployments?teamId=${teamId}`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'ai-los', project: projectId, target: 'production', files: refs, projectSettings: { framework: null } })
});
const txt = await res.text();
if (!res.ok) throw new Error(`create deployment: ${res.status} ${txt}`);
console.log(txt);
