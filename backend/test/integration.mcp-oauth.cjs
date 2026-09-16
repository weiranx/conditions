const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { Pool } = require('pg');
const { createMcpOAuthService, hash } = require('../src/auth/mcp-oauth');
const config = {clientId:'chatgpt',clientSecret:'x'.repeat(64),redirectUris:['https://chatgpt.com/connector/oauth/test'],issuer:'https://api.example.com',frontendOrigin:'https://example.com'};

test('persistent per-user OAuth: PKCE, rotation, replay, isolation, revocation, logout and disabled accounts', {skip:!process.env.MCP_TEST_DATABASE_URL}, async()=>{
 const schema = 'mcp_test_'+randomUUID().replaceAll('-','');
 const admin = new Pool({connectionString:process.env.MCP_TEST_DATABASE_URL});
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool = new Pool({connectionString:process.env.MCP_TEST_DATABASE_URL,options:`-c search_path=${schema}`});
 const database={query:(...args)=>pool.query(...args),transaction:async cb=>{
   const c=await pool.connect();try{await c.query('BEGIN');const r=await cb((...a)=>c.query(...a));await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }};
 try {
  await pool.query(`CREATE TABLE users(id uuid PRIMARY KEY,email text,display_name text,status text DEFAULT 'active');
   CREATE TABLE user_sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id),token_hash char(64),expires_at timestamptz);`);
  await pool.query(readFileSync(require('node:path').join(__dirname,'../migrations/018_mcp_oauth.sql'),'utf8'));
  const alice=randomUUID(),bob=randomUUID(),sessionA='alice-session',sessionB='bob-session';
  for(const [id,session] of [[alice,sessionA],[bob,sessionB]]){
   await pool.query('INSERT INTO users(id,email,display_name) VALUES($1,$2,$3)',[id,id+'@example.com',id]);
   await pool.query("INSERT INTO user_sessions VALUES($1,$2,$3,NOW()+INTERVAL '1 day')",[randomUUID(),id,hash(session)]);
  }
  const auth=createMcpOAuthService({database,...config});
  const verifier='v'.repeat(43),challenge=createHash('sha256').update(verifier).digest('base64url');
  const q={client_id:config.clientId,response_type:'code',redirect_uri:config.redirectUris[0],state:'original-state',scope:'conditions:read',code_challenge:challenge,code_challenge_method:'S256',resource:auth.resource};
  assert.throws(()=>auth.validateRequest({...q,redirect_uri:'https://evil.example'}));
  assert.throws(()=>auth.validateRequest({...q,scope:'conditions:write'}));
  assert.throws(()=>auth.validateRequest({...q,resource:'https://evil.example'}));
  assert.equal(auth.authenticateClient({client_id:'chatgpt',client_secret:'bad'}),false);
  const authorize=async(id,session)=>{
   const request=new URL(await auth.start(q)).searchParams.get('request');
   return new URL(await auth.approve(request,id,session,true)).searchParams.get('code');
  };
  const request=new URL(await auth.start(q)).searchParams.get('request');
  await assert.rejects(auth.approve(request,bob,sessionA,true));
  assert.ok(await auth.pending(request));
  const denied=new URL(await auth.approve(request,alice,sessionA,false));
  assert.equal(denied.searchParams.get('error'),'access_denied');
  assert.equal(denied.searchParams.get('state'),'original-state');
  await assert.rejects(auth.pending(request));
  const code=await authorize(alice,sessionA);
  const exchange={grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:q.redirect_uri,resource:auth.resource};
  await assert.rejects(auth.exchange({...exchange,code_verifier:'z'.repeat(43)}));
  await assert.rejects(auth.exchange({...exchange,redirect_uri:'https://evil.example'}));
  const a=await auth.exchange(exchange);
  await assert.rejects(auth.exchange(exchange));
  assert.equal((await auth.userForToken(a.access_token)).id,alice);
  assert.equal(await auth.userForToken(a.refresh_token),null);
  const b=await auth.exchange({...exchange,code:await authorize(bob,sessionB)});
  assert.equal((await auth.userForToken(b.access_token)).id,bob);
  assert.equal((await auth.list(alice)).length,1);
  assert.equal((await auth.list(bob)).length,1);
  const grantA=(await auth.list(alice))[0].id;
  await auth.revoke(grantA,bob);
  assert.ok(await auth.userForToken(a.access_token));
  const restarted=createMcpOAuthService({database,...config});
  assert.equal((await restarted.userForToken(a.access_token)).id,alice);
  const rotated=await restarted.exchange({grant_type:'refresh_token',refresh_token:a.refresh_token});
  assert.ok(await restarted.userForToken(rotated.access_token));
  await assert.rejects(restarted.exchange({grant_type:'refresh_token',refresh_token:a.refresh_token}));
  assert.equal(await auth.userForToken(rotated.access_token),null);
  assert.ok(await auth.userForToken(b.access_token));
  await pool.query("UPDATE users SET status='disabled' WHERE id=$1",[bob]);
  assert.equal(await auth.userForToken(b.access_token),null);
  await pool.query("UPDATE users SET status='active' WHERE id=$1",[bob]);
  await auth.revokeToken(b.refresh_token);
  assert.equal(await auth.userForToken(b.access_token),null);
  const logout=await auth.exchange({...exchange,code:await authorize(alice,sessionA)});
  await pool.query('DELETE FROM user_sessions WHERE user_id=$1',[alice]);
  assert.equal(await auth.userForToken(logout.access_token),null);
  await assert.rejects(auth.exchange({grant_type:'refresh_token',refresh_token:logout.refresh_token}));
 } finally { await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end(); }
});
