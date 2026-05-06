// Re-exports authMiddleware from routes/auth.js for use in other route files
const { authMiddleware } = require('../routes/auth');
module.exports = authMiddleware;
