import {mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Delete only the fixed generated artifact, never a caller-supplied directory.
rmSync(resolve(root,'dist'),{recursive:true,force:true});
const html=readFileSync(resolve(root,'index.html'),'utf8');
const files=new Set(['index.html','.nojekyll']);
for(const match of html.matchAll(/(?:src|href)="(assets\/[^"?#]+)"/g))files.add(match[1]);
const manifest=[];
for(const name of files){
 if(name.includes('..')||name.includes('.bak')||!(/^(?:index\.html|\.nojekyll|assets\/(?:js\/[a-z/-]+\.js|css\/styles\.css|data\/seed-graph\.json))$/i.test(name)))throw new Error('Unexpected public path '+name);
 // Canonical text bytes make Windows-reviewed builds match Linux Pages builds.
 const source=resolve(root,name),bytes=Buffer.from(readFileSync(source,'utf8').replace(/\r\n/g,'\n'),'utf8'),target=resolve(root,'dist',name);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);manifest.push({path:name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
writeFileSync(resolve(root,'dist','release-manifest.json'),JSON.stringify({files:manifest},null,2));
console.log(`Public-only artifact: ${manifest.length} files. No repository backups, tools, tests, or private state included.`);