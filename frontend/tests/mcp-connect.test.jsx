import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { AccountContext } from '../src/contexts/account';
import McpConnect from '../src/field/McpConnect';
async function mount(t, search, handler) {
 const dom=new JSDOM('<div id="root"></div>',{url:'https://conditions.example/connect'+search});
 const old={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const calls=[];globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json(await handler(url,options));};
 const root=createRoot(document.getElementById('root'));
 const render=async id=>act(async()=>root.render(<AccountContext.Provider value={{user:id?{id,email:id+'@example.com'}:null,google:{available:false},loading:false,busy:false}}><McpConnect/></AccountContext.Provider>));
 t.after(async()=>{await act(async()=>root.unmount());dom.window.close();Object.assign(globalThis,old);delete globalThis.IS_REACT_ACT_ENVIRONMENT;});
 return {render,calls};
}
test('consent requires sign-in and explicit user action',async t=>{
 const ui=await mount(t,'?request='+'a'.repeat(43),async()=>({userId:'alice',clientName:'Claude',callbackUri:'https://claude.ai/api/mcp/auth_callback'}));
 await ui.render(null);assert.match(document.body.textContent,/Sign in to your Conditions account/);assert.equal(ui.calls.length,0);
 await ui.render('alice');assert.match(document.body.textContent,/alice@example.com/);assert.match(document.body.textContent,/trip locations and dates/);
 assert.match(document.body.textContent,/Allow Claude/);assert.match(document.body.textContent,/claude.ai/);
 assert.equal(ui.calls.length,1);assert.equal(ui.calls[0].options.method,undefined);
 assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='Allow read access').disabled,false);
});
test('late consent response cannot enable approval for another account',async t=>{
 let resolve;const ui=await mount(t,'?request='+'a'.repeat(43),()=>new Promise(r=>{resolve=r;}));
 await ui.render('alice');const resolveAlice=resolve;await ui.render('bob');
 await act(async()=>resolveAlice({userId:'alice'}));
 assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='Allow read access').disabled,true);
});
test('previous account connections disappear immediately on account switch',async t=>{
 let calls=0;const ui=await mount(t,'',async()=>++calls===1?{connections:[{id:'a',created_at:'2026-09-16',expires_at:'2026-10-01'}]}:new Promise(()=>{}));
 await ui.render('alice');assert.match(document.body.textContent,/Disconnect/);
 await ui.render('bob');assert.doesNotMatch(document.body.textContent,/Disconnect/);assert.match(document.body.textContent,/Loading connections/);
});
