const repository = require('./sqlite.repository');
const authService = require('../../../common/services/authService');

const sttRepositoryAdapter = {
    addTranscript: ({ sessionId, speaker, text }) => {
        const uid = authService.getCurrentUserId();
        return repository.addTranscript({ uid, sessionId, speaker, text });
    },
    getAllTranscriptsBySessionId: (sessionId) => {
        return repository.getAllTranscriptsBySessionId(sessionId);
    }
};

module.exports = sttRepositoryAdapter; 
