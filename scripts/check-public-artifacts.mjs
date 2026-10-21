import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { pathToFileURL } from 'node:url';

// Reports rule names and owned paths only, never matching values.
export function scanPublicText(text) {
 const failures=[];
 if (/\bsk-[A-Za-z0-9_-]{20,}\b|\bAIza[A-Za-z0-9_-]{25,}\b|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) failures.push('credential-pattern');
 const approved=new Set(['api.openai.com','openrouter.ai']);
 for(const match of text.matchAll(/https:\/\/[A-Za-z0-9._-]+\/(?:api\/|v1\/)[^\s"'<>)]*/g)) {
  const parsed=new URL(match[0]);
  const officialDocumentation=parsed.hostname==='developers.openai.com' && parsed.pathname.startsWith('/api/docs/');
  if(!approved.has(parsed.hostname) && !officialDocumentation) failures.push('unapproved-provider-url');
 }
 if (/visual-project|Private test meeting|keyless-test-only-rate|fixture speech|TEST_ONLY_PROVIDER_RESULT/.test(text)) failures.push('fixture-payload');
 if (/\b(?:localStorage|sessionStorage)\.setItem\s*\(/.test(text)) failures.push('plaintext-web-storage-write');
 return [...new Set(failures)];
}
const textExtensions=new Set(['.ts','.tsx','.js','.mjs','.json','.css','.html','.svg','.txt','.md']);
async function* ownedFiles(directory) {
 for(const entry of await readdir(directory,{withFileTypes:true})) {
  // Never follow symlinks or enumerate configuration/secret/home directories.
  if(entry.isSymbolicLink()) continue;
  const path=resolve(directory,entry.name);
  if(entry.isDirectory()) yield* ownedFiles(path);
  else if(textExtensions.has(extname(entry.name)) || entry.name==='_headers') yield path;
  else if(entry.name.endsWith('.map')) throw new Error('public-source-map');
 }
}
export async function checkPublicArtifacts(root=process.cwd()) {
 const failures=[];
 for(const name of ['src/react-app','public','dist/client']) {
  const directory=resolve(root,name);
  try {
   for await(const path of ownedFiles(directory)) {
    for(const rule of scanPublicText(await readFile(path,'utf8'))) failures.push({path:relative(root,path),rule});
   }
  } catch(error) {
   if(error.code==='ENOENT') failures.push({path:name,rule:'required-owned-path-absent'});
   else if(error.message==='public-source-map') failures.push({path:name,rule:'public-source-map'});
   else throw error;
  }
 }
 return failures;
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]??'')).href) {
 const failures=await checkPublicArtifacts();
 if(failures.length){console.error(JSON.stringify(failures,null,2));process.exitCode=1;}
 else console.log('Public artifact scan passed: owned app source, static assets and client build; no matched values printed.');
}
