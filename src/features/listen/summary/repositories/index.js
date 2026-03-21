const repository = require('./sqlite.repository');
const authService = require('../../../common/services/authService');

const summaryRepositoryAdapter = {
    saveSummary: ({ sessionId, tldr, text, bullet_json, action_json, model }) => {
        const uid = authService.getCurrentUserId();
        return repository.saveSummary({ uid, sessionId, tldr, text, bullet_json, action_json, model });
    },
    getSummaryBySessionId: (sessionId) => {
        return repository.getSummaryBySessionId(sessionId);
    }
};

module.exports = summaryRepositoryAdapter; 
