#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// MIT License
//
// Copyright (c) 2026 MoM contributors
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// End of dedicated helper license. Third-party source keeps its original terms.
// MoM object relinking utility, 2026-09-30. No application TypeScript is needed.
// Parses public JavaScript objects; never imports or evaluates their code.
import {parse} from './vendor/acorn.mjs';
import {decode,crc32} from './vendor/simple-yenc.mjs';
import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const LIMIT=16*1024*1024;
const digest=value=>createHash('sha256').update(value).digest('hex');
function fail(code){const error=new Error(code);error.code=code;throw error;}
function checkHash(source,expected){
  if(typeof expected!=='string'||!/^[a-f0-9]{64}$/i.test(expected))fail('MOM_RELINK_HASH_REQUIRED');
  if(typeof source!=='string'||Buffer.byteLength(source)>LIMIT)fail('MOM_RELINK_SIZE_LIMIT');
  if(digest(source)!==expected.toLowerCase())fail('MOM_RELINK_HASH_MISMATCH');
}
function payloads(source){
  let ast;try{ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});}catch{fail('MOM_RELINK_PARSE_ERROR');}
  const found=[],stack=[ast];
  while(stack.length){
    const node=stack.pop();
    if(node.type==='TaggedTemplateExpression'&&node.tag.type==='MemberExpression'&&!node.tag.computed&&node.tag.object.type==='Identifier'&&node.tag.object.name==='String'&&node.tag.property.name==='raw'&&node.quasi.expressions.length===0&&node.quasi.quasis.length===1){
      const raw=node.quasi.quasis[0].value.raw;
      if(raw.startsWith('dynEncode01'))found.push({raw,start:node.start,end:node.end,expression:source.slice(node.start,node.end)});
    }
    for(const value of Object.values(node)){
      if(Array.isArray(value)){for(const child of value)if(child&&typeof child==='object'&&typeof child.type==='string')stack.push(child);}
      else if(value&&typeof value==='object'&&typeof value.type==='string')stack.push(value);
    }
  }
  return found;
}
function modulePayload(source){const found=payloads(source);if(found.length!==1)fail('MOM_RELINK_MODULE_PAYLOAD');return found[0];}
function wasmBytes(raw){
  try{
    if(!/^dynEncode01[0-9a-f]{10}/i.test(raw))fail('MOM_RELINK_INVALID_WASM');
    const header=Buffer.from(raw.slice(13,21),'hex');
    const expectedCrc=header.readInt32LE();
    const compressed=decode(raw,data=>{const actual=crc32(data);if(actual!==expectedCrc)fail('MOM_RELINK_INVALID_WASM');return actual;});
    const wasm=inflateRawSync(compressed,{maxOutputLength:LIMIT});if(!WebAssembly.validate(wasm))fail('MOM_RELINK_INVALID_WASM');return wasm;
  }
  catch{fail('MOM_RELINK_INVALID_WASM');}
}

// Resolve exported/imported MVP function signatures rather than comparing names
// alone. This deliberately rejects unsupported GC/memory64/global/tag ABIs.
function abi(bytes){
  let pos=8;
  const u32=()=>{let value=0,shift=0;for(let i=0;i<5;i++){const b=bytes[pos++];if(b===undefined)fail('MOM_RELINK_ABI_UNSUPPORTED');value+=(b&127)*2**shift;if(!(b&128))return value;shift+=7;}fail('MOM_RELINK_ABI_UNSUPPORTED');};
  const text=()=>{const n=u32(),value=bytes.subarray(pos,pos+n).toString('utf8');pos+=n;return value;};
  const val=()=>{const value=bytes[pos++];if(![127,126,125,124,123,112,111].includes(value))fail('MOM_RELINK_ABI_UNSUPPORTED');return value;};
  const vector=read=>Array.from({length:u32()},()=>read());
  const limits=()=>{const flags=u32();if(flags&~3)fail('MOM_RELINK_ABI_UNSUPPORTED');return {shared:!!(flags&2),min:u32(),max:flags&1?u32():null};};
  const table=()=>({element:val(),...limits()});
  const types=[],functions=[],tables=[],memories=[],imports=[],exports=[];
  while(pos<bytes.length){
    const id=bytes[pos++],length=u32(),end=pos+length;
    if(id===1)types.push(...vector(()=>{if(bytes[pos++]!==96)fail('MOM_RELINK_ABI_UNSUPPORTED');return {params:vector(val),results:vector(val)};}));
    else if(id===2)imports.push(...vector(()=>{const module=text(),name=text(),kind=bytes[pos++];let descriptor;if(kind===0){const type=u32();functions.push(type);descriptor={kind:'function',type:types[type]};}else if(kind===1){descriptor={kind:'table',...table()};tables.push(descriptor);}else if(kind===2){descriptor={kind:'memory',...limits()};memories.push(descriptor);}else fail('MOM_RELINK_ABI_UNSUPPORTED');return {module,name,...descriptor};}));
    else if(id===3)functions.push(...vector(u32));
    else if(id===4)tables.push(...vector(table));
    else if(id===5)memories.push(...vector(limits));
    else if(id===7)exports.push(...vector(()=>({name:text(),kind:bytes[pos++],index:u32()})));
    pos=end;
  }
  const resolved=exports.map(({name,kind,index})=>{
    if(kind===0)return {name,kind:'function',type:types[functions[index]]};
    if(kind===1)return {name,kind:'table',...tables[index]};
    if(kind===2)return {name,kind:'memory',...memories[index]};
    fail('MOM_RELINK_ABI_UNSUPPORTED');
  });
  return {imports,exports:resolved};
}
function checkAbi(oldBytes,newBytes){
  const old=abi(oldBytes),replacement=abi(newBytes);
  if(JSON.stringify(old.imports)!==JSON.stringify(replacement.imports)||old.exports.length!==replacement.exports.length)fail('MOM_RELINK_ABI_MISMATCH');
  for(const entry of old.exports){
    const next=replacement.exports.find(value=>value.name===entry.name);
    if(!next||entry.kind!==next.kind)fail('MOM_RELINK_ABI_MISMATCH');
    if(entry.kind==='function'){if(!entry.type||JSON.stringify(entry.type)!==JSON.stringify(next.type))fail('MOM_RELINK_ABI_MISMATCH');}
    else if(entry.shared!==next.shared||entry.element!==next.element||next.min<entry.min||(next.max!==null&&next.max<entry.min))fail('MOM_RELINK_ABI_MISMATCH');
  }
}

export function relinkDecoderObject(input){
  const {workerJs,baselineModuleJs,replacementModuleJs,expectedWorkerSha256,expectedBaselineModuleSha256,expectedReplacementModuleSha256}=input;
  checkHash(workerJs,expectedWorkerSha256);checkHash(baselineModuleJs,expectedBaselineModuleSha256);checkHash(replacementModuleJs,expectedReplacementModuleSha256);
  const baseline=modulePayload(baselineModuleJs),replacement=modulePayload(replacementModuleJs);
  const oldBytes=wasmBytes(baseline.raw),newBytes=wasmBytes(replacement.raw);
  checkAbi(oldBytes,newBytes);
  const matches=payloads(workerJs).filter(value=>value.raw===baseline.raw);
  if(matches.length===0)fail('MOM_RELINK_TARGET_NOT_FOUND');
  if(matches.length!==1)fail('MOM_RELINK_TARGET_AMBIGUOUS');
  const match=matches[0];
  const output=workerJs.slice(0,match.start)+replacement.expression+workerJs.slice(match.end);
  const newMatches=payloads(output).filter(value=>value.raw===replacement.raw);
  if(newMatches.length!==1||!wasmBytes(newMatches[0].raw).equals(newBytes))fail('MOM_RELINK_OUTPUT_VALIDATION');
  return output;
}

function main(){
  const args=process.argv.slice(2),options={};
  const allowed=['worker','baseline-module','replacement-module','expected-worker-sha256','expected-baseline-module-sha256','expected-replacement-module-sha256','output'];
  for(let i=0;i<args.length;i+=2){const name=args[i].replace(/^--/,'');if(!allowed.includes(name)||options[name]||!args[i+1])fail('MOM_RELINK_ARGUMENTS');options[name]=args[i+1];}
  if(allowed.some(name=>!options[name]))fail('MOM_RELINK_ARGUMENTS');
  if(['worker','baseline-module','replacement-module'].some(name=>resolve(options[name])===resolve(options.output)))fail('MOM_RELINK_OUTPUT_OVERWRITE');
  const read=name=>{if(statSync(options[name]).size>LIMIT)fail('MOM_RELINK_SIZE_LIMIT');const data=readFileSync(options[name]);if(data.length>LIMIT)fail('MOM_RELINK_SIZE_LIMIT');const text=data.toString('utf8');if(!Buffer.from(text).equals(data))fail('MOM_RELINK_PARSE_ERROR');return text;};
  const output=relinkDecoderObject({workerJs:read('worker'),baselineModuleJs:read('baseline-module'),replacementModuleJs:read('replacement-module'),expectedWorkerSha256:options['expected-worker-sha256'],expectedBaselineModuleSha256:options['expected-baseline-module-sha256'],expectedReplacementModuleSha256:options['expected-replacement-module-sha256']});
  writeFileSync(options.output,output,{flag:'wx'});
  process.stdout.write(JSON.stringify({output:options.output,bytes:Buffer.byteLength(output),sha256:digest(output)})+'\n');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{main();}catch(error){process.stderr.write((error.code||'MOM_RELINK_FAILED')+'\n');process.exitCode=1;}
}
