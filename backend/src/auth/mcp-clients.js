'use strict';
// Names come from callback destinations, never untrusted registration metadata.
function describeCallback(uri) {
  if (typeof uri !== 'string' || uri.length > 1024) return null;
  if (/^https:\/\/chatgpt\.com\/(?:connector\/oauth\/[A-Za-z0-9_-]{1,200}|connector_platform_oauth_redirect)$/u.test(uri)) return {clientName:'ChatGPT',callbackUri:uri};
  if (uri === 'https://claude.ai/api/mcp/auth_callback') return {clientName:'Claude',callbackUri:uri};
  if (uri === 'https://grok.com/connectors-oauth-exchange-code/') return {clientName:'Grok',callbackUri:uri};
  // Gemini registers six Google relay URLs, scoped to a user and this server.
  if (/^https:\/\/oauth-redirect(?:-sandbox|-test)?\.googleusercontent\.com\/[ra]\/user_bound_custom-mcp-[0-9]{1,30}-apivps_conditions_weiranxiong_com$/u.test(uri)) return {clientName:'Gemini',callbackUri:uri};
  // Native clients receive codes only on their own loopback listener.
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):[0-9]{1,5}\/[A-Za-z0-9/_-]*$/u.test(uri)) return null;
  try {
    const url=new URL(uri);
    if (!url.port || Number(url.port)<1 || Number(url.port)>65535) return null;
    return {clientName:'Local MCP client',callbackUri:uri};
  } catch { return null; }
}
module.exports={describeCallback};
