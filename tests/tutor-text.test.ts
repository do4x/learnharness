import assert from 'node:assert/strict';
import {test} from 'node:test';
import {tutorText} from '../src/core/tutor-text.ts';
import {projectView} from '../src/core/view.ts';
import type {LhMessage} from '../src/core/native-messages.ts';
test('saved Codex prose hides protocol tail without rewriting records or question arguments',()=>{
 const text='Your timeline is correct.\n\n[assistant to=functions.exec commentary code]|text(await tools.probe({correctAnswer:"ab",explanation:"SECRET"}))';
 const message={id:'fixture',role:'assistant',provider:'codex',content:[{type:'text',text},{type:'toolCall',id:'q',name:'probe',arguments:{question:'Which?',correctAnswer:'ab'}}]} as unknown as LhMessage;
 const view=projectView([message]);
 assert.equal(view[0]!.parts.find(p=>p.type==='text')?.text,'Your timeline is correct.');
 assert.equal(JSON.stringify(message).includes(text.slice(0,25)),true);
 assert(JSON.stringify(message).includes('SECRET'));
 assert(view[0]!.parts.some(p=>p.toolCallId==='q'));
});
test('ordinary learning prose is preserved; printed calls are never executed',()=>{
 for(const text of ['A and B meet their deadlines.','Explain why tools matter.','The function f(x) = x + 1.']) assert.equal(tutorText(text),text);
 assert.equal(tutorText('text(await tools.probe({correctAnswer:"ab"}))'),'');
});
