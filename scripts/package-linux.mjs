import {packager} from '@electron/packager';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arches=process.argv.slice(2);
if(!arches.length)arches.push('x64','arm64');
if(arches.some(a=>!['x64','arm64'].includes(a)))throw Error('Use x64 and/or arm64');
const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const electron=JSON.parse(await fs.readFile(path.join(root,'node_modules/electron/package.json'),'utf8'));
const out=path.join(root,'release/linux');await fs.mkdir(out,{recursive:true});
const stage=await fs.mkdtemp(path.join(os.tmpdir(),'solitaire-linux-'));
try {
 for(const name of ['dist','electron','package.json'])await fs.cp(path.join(root,name),path.join(stage,name),{recursive:true});
 const linuxPkg={...pkg,license:'MIT'};await fs.writeFile(path.join(stage,'package.json'),JSON.stringify(linuxPkg,null,2)+'\n');
 await fs.copyFile(path.join(root,'linux/LICENSE'),path.join(stage,'LICENSE'));
 await fs.mkdir(path.join(stage,'node_modules'),{recursive:true});
 for(const name of ['chess.js','react','react-dom','scheduler'])await fs.cp(path.join(root,'node_modules',name),path.join(stage,'node_modules',name),{recursive:true});
 await fs.mkdir(path.join(stage,'resources'),{recursive:true});
 await fs.copyFile(path.join(root,'resources/privacy-policy.txt'),path.join(stage,'resources/privacy-policy.txt'));
 // Only the Linux runtime and system Stockfish are used; never ship the Mach-O engine.
 for(const arch of arches){
  const dirs=await packager({dir:stage,name:'solitaire-chess',platform:'linux',arch,out,electronVersion:electron.version,appVersion:pkg.version,overwrite:true,prune:false,asar:false});
  const notices=path.join(dirs[0],'resources/ThirdParty');await fs.mkdir(notices,{recursive:true});
  for(const name of ['react','react-dom','chess.js','scheduler'])await fs.copyFile(path.join(root,'node_modules',name,'LICENSE'),path.join(notices,name+'-LICENSE.txt'));
  execFileSync('python3',[path.join(root,'linux/build-deb.py'),dirs[0],arch,pkg.version],{cwd:root,stdio:'inherit'});
 }
} finally {await fs.rm(stage,{recursive:true,force:true})}
