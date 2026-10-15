'use strict';

const { ChatGPTStore, ChatGPTProfileStore, normalizeAccountId } = require('./chatgpt-store');
const { createChatGPTService } = require('./chatgpt');

// Every authenticated Conditions account can connect its own plan. Profile IDs come from verified sessions.
const createChatGPTAccounts = ({ env = process.env, store = new ChatGPTStore(), createService = createChatGPTService } = {}) => {
  const services = new Map();
  const isEnabled = () => String(env.CHATGPT_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
  const serviceForUser = (userId) => {
    const id = normalizeAccountId(userId);
    if (!id || !isEnabled()) return null;
    // Retain legacy owner's credentials; every additional account has an independent profile.
    const profileId = id === normalizeAccountId(env.CHATGPT_OWNER_USER_ID) ? null : id;
    const key = profileId || 'legacy';
    if (!services.has(key)) services.set(key, createService({ store: new ChatGPTProfileStore(store, profileId) }));
    return services.get(key);
  };
  return { serviceForUser, isEnabled };
};

const chatGPTAccounts = createChatGPTAccounts();
module.exports = { createChatGPTAccounts, chatGPTAccounts };
