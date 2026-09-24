const express = require('express');
const request = require('supertest');
const { registerMcpOAuthRoutes } = require('../src/routes/mcp-oauth');
const env={MCP_PUBLIC_URL:'https://api.example.com',MCP_FRONTEND_ORIGIN:'https://example.com',MCP_OAUTH_CLIENT_ID:'chatgpt',MCP_OAUTH_CLIENT_SECRET:'s'.repeat(32),MCP_OAUTH_REDIRECT_URIS:'https://chatgpt.com/connector/oauth/test'};
function setup() {
 const app=express();app.use(express.json());
 const service={userForToken:jest.fn(async token=>token==='cmcp_alice'?{id:'alice'}:token==='cmcp_bob'?{id:'bob'}:null),list:jest.fn(async()=>[]),revoke:jest.fn(),pending:jest.fn(async()=>({redirect_uri:'https://claude.ai/api/mcp/auth_callback'})),approve:jest.fn(async()=>env.MCP_OAUTH_REDIRECT_URIS),authenticateClient:()=>false};
 const accountService={getUserForSession:jest.fn(async token=>token==='alice-session'?{id:'alice'}:null)};
 registerMcpOAuthRoutes({app,env,service,accountService});
 app.get('/api/account/reports', (req,res)=>res.json({owner:req.mcpUser?.id}));
 app.post('/api/account/reports',(_req,res)=>res.json({write:true}));
 app.get('/api/admin/users',(_req,res)=>res.json({admin:true}));
 return {app,service};
}
test('bearers isolate users, reject invalid tokens, writes and admin routes', async()=>{
 const {app}=setup();
 expect((await request(app).get('/api/account/reports').set('Authorization','Bearer cmcp_alice')).body.owner).toBe('alice');
 expect((await request(app).get('/api/account/reports').set('Authorization','Bearer cmcp_bob')).body.owner).toBe('bob');
 expect((await request(app).get('/api/account/reports').set('Authorization','Bearer cmcp_bad')).status).toBe(401);
 expect((await request(app).post('/api/account/reports').set('Authorization','Bearer cmcp_alice')).status).toBe(403);
 expect((await request(app).get('/api/admin/users').set('Authorization','Bearer cmcp_alice')).status).toBe(403);
});
test('bearers reach the report compute routes as their own account user', async()=>{
 const {app}=setup();
 const { createAccountAccessGuard } = require('../src/auth/account-access');
 const ensureAccountAccess=createAccountAccessGuard({service:{available:true,getUserForSession:jest.fn(async()=>null)},usageService:{available:true,assertUserCanGenerate:jest.fn(async()=>({used:1}))}});
 for (const path of ['/api/ai-brief','/api/route-analysis','/api/snow-vision']) app.post(path,async(req,res)=>{ if(await ensureAccountAccess(req,res)) res.json({user:req.accountUser.id}); });
 app.post('/api/trip-forecasts',(req,res)=>res.json({user:req.mcpUser?.id}));
 app.get('/api/start-time-scenarios',(_req,res)=>res.json({ok:true}));
 for (const path of ['/api/ai-brief','/api/route-analysis','/api/snow-vision','/api/trip-forecasts']) {
  expect((await request(app).post(path).set('Authorization','Bearer cmcp_bob').send({})).body.user).toBe('bob');
 }
 expect((await request(app).get('/api/start-time-scenarios').set('Authorization','Bearer cmcp_alice')).status).toBe(200);
 expect((await request(app).post('/api/ai-brief').set('Authorization','Bearer cmcp_bad').send({})).status).toBe(401);
 // Compute routes are POST only; other writes stay closed.
 expect((await request(app).get('/api/ai-brief').set('Authorization','Bearer cmcp_alice')).status).toBe(403);
 expect((await request(app).post('/api/account/objective-watches').set('Authorization','Bearer cmcp_alice')).status).toBe(403);
});
test('bearers read their own watch history, baseline, usage and service status', async()=>{
 const {app}=setup();
 const { registerAccountUsageRoute } = require('../src/routes/account');
 registerAccountUsageRoute({app,accountService:{available:true,getUserForSession:jest.fn(async()=>null)},describeAccount:async(_req,user)=>({owner:user.id,aiUsage:{used:2}})});
 const id='d4167c22-61fa-4e49-8d68-0c538752967e';
 for (const path of [`/api/account/objective-watches/${id}/checks`,`/api/account/objective-watches/${id}/events`,'/api/account/reports/comparison-baseline','/api/feature-flags','/api/healthz']) app.get(path,(req,res)=>res.json({owner:req.mcpUser?.id}));
 app.post('/api/report-chat',(req,res)=>res.json({owner:req.mcpUser?.id}));
 const usage=await request(app).get('/api/account/usage').set('Authorization','Bearer cmcp_bob');
 expect(usage.body).toEqual({owner:'bob',aiUsage:{used:2}});
 expect((await request(app).get('/api/account/usage')).status).toBe(401);
 for (const path of [`/api/account/objective-watches/${id}/checks`,`/api/account/objective-watches/${id}/events`,'/api/account/reports/comparison-baseline','/api/feature-flags','/api/healthz']) {
  expect((await request(app).get(path).set('Authorization','Bearer cmcp_alice')).body.owner).toBe('alice');
 }
 expect((await request(app).post('/api/report-chat').set('Authorization','Bearer cmcp_alice')).body.owner).toBe('alice');
 // Watch actions stay closed.
 expect((await request(app).post(`/api/account/objective-watches/${id}/refresh`).set('Authorization','Bearer cmcp_alice')).status).toBe(403);
 expect((await request(app).get(`/api/account/objective-watches/${id}/other`).set('Authorization','Bearer cmcp_alice')).status).toBe(403);
});
test('approval needs browser sign-in, exact origin and unchanged account',async()=>{
 const {app,service}=setup();
 const url='/api/auth/mcp/approve';
 expect((await request(app).post(url).set('Origin',env.MCP_FRONTEND_ORIGIN).send({allow:true})).status).toBe(401);
 expect((await request(app).post(url).set('Cookie','bc_session=alice-session').set('Origin','https://evil.example').send({allow:true})).status).toBe(403);
 expect((await request(app).post(url).set('Cookie','bc_session=alice-session').set('Origin',env.MCP_FRONTEND_ORIGIN).send({allow:true,userId:'bob'})).status).toBe(409);
 expect(service.approve).not.toHaveBeenCalled();
 const ok=await request(app).post(url).set('Cookie','bc_session=alice-session').set('Origin',env.MCP_FRONTEND_ORIGIN).send({allow:true,userId:'alice',request:'req'});
 expect(ok.status).toBe(200);expect(service.approve).toHaveBeenCalledWith('req','alice','alice-session',true);
});
test('disconnect uses signed-in user rather than body ownership',async()=>{
 const {app,service}=setup();const id='11111111-1111-4111-8111-111111111111';
 await request(app).post('/api/auth/mcp/disconnect').set('Cookie','bc_session=alice-session').set('Origin',env.MCP_FRONTEND_ORIGIN).send({id,userId:'alice'}).expect(200);
 expect(service.revoke).toHaveBeenCalledWith(id,'alice');
});

test('discovery advertises registration and token routes await client authentication',async()=>{
 const {app,service}=setup();
 expect((await request(app).get('/api/auth/mcp/metadata')).body.registration_endpoint).toBe(env.MCP_PUBLIC_URL+'/api/auth/mcp/register');
 service.register=jest.fn(async()=>({client_id:'new-client'}));
 await request(app).post('/api/auth/mcp/register').send({redirect_uris:[env.MCP_OAUTH_REDIRECT_URIS]}).expect(201);
 service.authenticateClient=jest.fn(async()=>false);
 service.exchange=jest.fn(async()=>({access_token:'token'}));
 await request(app).post('/api/auth/mcp/token').type('form').send({client_id:'bad'}).expect(401);
 expect(service.exchange).not.toHaveBeenCalled();
 service.authenticateClient.mockResolvedValue('registered-client');
 await request(app).post('/api/auth/mcp/token').type('form').send({client_id:'registered-client'}).expect(200);
 expect(service.exchange).toHaveBeenCalledWith({client_id:'registered-client'},'registered-client');
});

test('consent describes the actual callback destination',async()=>{
 const {app}=setup();
 const response=await request(app).get('/api/auth/mcp/request/request').set('Cookie','bc_session=alice-session').expect(200);
 expect(response.body.clientName).toBe('Claude');
 expect(response.body.callbackUri).toBe('https://claude.ai/api/mcp/auth_callback');
});
const {describeCallback}=require('../src/auth/mcp-clients');
test('callback allowlist rejects lookalikes, private networks, credentials, fragments and unsafe schemes',()=>{
 for(const uri of ['https://claude.ai.evil.com/api/mcp/auth_callback','https://claude.ai/api/mcp/auth_callback?next=evil','https://claude.ai/other','http://192.168.1.1:3000/callback','http://0.0.0.0:3000/callback','http://127.1:3000/callback','http://127.0.0.1.evil.com:3000/callback','http://user@localhost:3000/callback','http://localhost:3000/callback#x','http://localhost:99999/callback','javascript:alert(1)','file:///tmp/callback']) expect(describeCallback(uri)).toBeNull();
});

test('Grok registration allows only its observed exact callback',()=>{
 const uri='https://grok.com/connectors-oauth-exchange-code/';
 expect(describeCallback(uri)).toEqual({clientName:'Grok',callbackUri:uri});
 for(const bad of [uri+'?next=evil',uri+'#x',uri.replace('grok.com','grok.com.evil.example'),uri.replace('https:','http:'),uri.slice(0,-1),uri.replace('grok.com','user@grok.com')]) expect(describeCallback(bad)).toBeNull();
});

test('Gemini accepts only Google relay hosts and this server callback namespace',()=>{
 for(const host of ['oauth-redirect','oauth-redirect-test','oauth-redirect-sandbox']) for(const path of ['r','a']) {
  const uri=`https://${host}.googleusercontent.com/${path}/user_bound_custom-mcp-123456789012345678901-apivps_conditions_weiranxiong_com`;
  expect(describeCallback(uri)).toEqual({clientName:'Gemini',callbackUri:uri});
  for(const bad of [uri+'?next=evil',uri+'#x',uri+'/',uri.replace('.com/','.com.evil.example/'),uri.replace('https:','http:'),uri.replace('apivps_conditions_weiranxiong_com','other_server'),uri.replace('123456789012345678901','abc'),uri.replace('/'+path+'/','/other/')]) expect(describeCallback(bad)).toBeNull();
 }
});
