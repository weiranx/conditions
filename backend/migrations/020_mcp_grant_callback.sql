ALTER TABLE mcp_oauth_grants ADD COLUMN redirect_uri TEXT;
UPDATE mcp_oauth_grants g SET redirect_uri=t.metadata->>'redirect'
FROM mcp_oauth_tokens t WHERE t.grant_id=g.id AND t.kind='code';
