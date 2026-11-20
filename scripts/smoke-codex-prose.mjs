/** Saved-message rendering regression; synthetic records, no account or inference. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
const root=path.resolve(import.meta.dirname,'..');
const home=await fs.mkdtemp(path.join(os.tmpdir(),'lh-codex-prose-'));
const origin='http://127.0.0.1:3187';
const server=spawn(process.execPath,['.next/standalone/server.js'],{cwd:root,windowsHide:true,env:{...process.env,HOSTNAME:'127.0.0.1',PORT:'3187',NODE_ENV:'production',LH_AUTH_FILE:path.join(home,'auth.json'),LH_DATA_DIR:path.join(home,'data'),LH_IGNORE_ENV_KEYS:'1'},stdio:['ignore','pipe','pipe']});
let browser,logs='';
server.stdout.on('data',d=>logs=(logs+d).slice(-8000));server.stderr.on('data',d=>logs=(logs+d).slice(-8000));
try {
 for(let i=0;i<100;i++){try{if((await fetch(origin)).ok)break;}catch{}if(server.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,200));}
 const created=await(await fetch(`${origin}/api/chats`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'Codex prose rendering regression'})})).json();
 const file=path.join(home,'data','chats',`${created.id}.json`),record=JSON.parse(await fs.readFile(file,'utf8'));
 record.messages=[{id:'user',role:'user',content:'Ask a synthetic question.',timestamp:1},{id:'assistant',role:'assistant',provider:'codex',model:'fixture',api:'codex',timestamp:2,stopReason:'toolUse',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},content:[{type:'text',text:'Your timeline is correct.\n\n[assistant to=functions.exec commentary code]|text(await tools.probe({correctAnswer:"LEAK_SENTINEL",explanation:"SECRET_EXPLANATION"}))\n output?'},{type:'toolCall',id:'q',name:'probe',arguments:{question:'NATIVE QUESTION CARD',options:[{label:'Choice one',value:'one'},{label:'Choice two',value:'two'}],correctAnswer:'one',explanation:'Normal hidden answer explanation'}}]}];
 const original=JSON.stringify(record);await fs.writeFile(file,original);
 browser=await puppeteer.launch({executablePath:process.env.LH_TEST_CHROME,headless:true,args:['--disable-background-networking','--no-first-run']});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width:1440,height:1000});
 await page.goto(`${origin}/chat/${created.id}`,{waitUntil:'networkidle2'});
 await page.waitForFunction(()=>document.body.innerText.includes('NATIVE QUESTION CARD'));
 const text=await page.evaluate(()=>document.body.innerText);
 assert(text.includes('Your timeline is correct.'));
 for(const hidden of ['functions.exec','LEAK_SENTINEL','SECRET_EXPLANATION','Normal hidden answer explanation','streamdown:incomplete-link'])assert(!text.includes(hidden),hidden);
 if(process.env.LH_UI_SCREENSHOTS)await page.screenshot({path:path.join(process.env.LH_UI_SCREENSHOTS,'codex-prose-regression.png')});
 assert.equal(await fs.readFile(file,'utf8'),original);assert.deepEqual(errors,[]);
 console.log('Codex prose browser regression passed: feedback retained, invocation/answer payload hidden, native question rendered, saved record unchanged.');
}finally{await browser?.close();server.kill();if(server.exitCode===null)await once(server,'close');assert.equal(await fs.realpath(path.dirname(home)),await fs.realpath(os.tmpdir()));await fs.rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
