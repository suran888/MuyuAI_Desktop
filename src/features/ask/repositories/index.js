const repository = require('./sqlite.repository');
const authService = require('../../common/services/authService');

// The adapter layer that injects the UID
const askRepositoryAdapter = {
    addAiMessage: ({ sessionId, role, content, model }) => {
        const uid = authService.getCurrentUserId();
        return repository.addAiMessage({ uid, sessionId, role, content, model });
    },
    getAllAiMessagesBySessionId: (sessionId) => {
        return repository.getAllAiMessagesBySessionId(sessionId);
    }
};

module.exports = askRepositoryAdapter; 
