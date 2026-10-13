const { denyUnconfiguredAccountAccess } = require('../auth/account-access');

// Placeholder: the route is filled in by its feature work.
const registerPlanParseRoute = ({ app, askAI, ensureAccountAccess = denyUnconfiguredAccountAccess }) => {
  void app; void askAI; void ensureAccountAccess;
};

module.exports = { registerPlanParseRoute };
