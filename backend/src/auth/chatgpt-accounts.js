'use strict';

const { ChatGPTStore, ChatGPTProfileStore, normalizeAccountId } = require('./chatgpt-store');
const { createChatGPTService } = require('./chatgpt');

// Explicit personal-account allowlist. Never derive a credential profile from request input.
const createChatGPTAccounts = ({ env = process.env, store = new ChatGPTStore(), createService = createChatGPTService } = {}) => {
  const services = new Map();
  const configuredIds = () => new Set([
    env.CHATGPT_OWNER_USER_ID || '',
    ...String(env.CHATGPT_ACCOUNT_USER_IDS || '').split(','),
  ].map((id) => normalizeAccountId(id.trim())).filter(Boolean));
  const serviceForUser = (userId) => {
    const id = normalizeAccountId(userId);
    if (!id || !configuredIds().has(id)) return null;
    // Retain legacy owner's credentials; every additional account has an independent profile.
    const profileId = id === normalizeAccountId(env.CHATGPT_OWNER_USER_ID) ? null : id;
    const key = profileId || 'legacy';
    if (!services.has(key)) services.set(key, createService({ store: new ChatGPTProfileStore(store, profileId) }));
    return services.get(key);
  };
  return { serviceForUser, hasAccounts: () => configuredIds().size > 0 };
};

const chatGPTAccounts = createChatGPTAccounts();
module.exports = { createChatGPTAccounts, chatGPTAccounts };
