const express = require('express');
const request = require('supertest');
const { registerMcpOAuthRoutes } = require('../src/routes/mcp-oauth');
const env={MCP_PUBLIC_URL:'https://api.example.com',MCP_FRONTEND_ORIGIN:'https://example.com',MCP_OAUTH_CLIENT_ID:'chatgpt',MCP_OAUTH_CLIENT_SECRET:'s'.repeat(32),MCP_OAUTH_REDIRECT_URIS:'https://chatgpt.com/connector/oauth/test'};
function setup() {
 const app=express();app.use(express.json());
 const service={userForToken:jest.fn(async token=>token==='cmcp_alice'?{id:'alice'}:token==='cmcp_bob'?{id:'bob'}:null),list:jest.fn(async()=>[]),revoke:jest.fn(),pending:jest.fn(async()=>({})),approve:jest.fn(async()=>env.MCP_OAUTH_REDIRECT_URIS),authenticateClient:()=>false};
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
