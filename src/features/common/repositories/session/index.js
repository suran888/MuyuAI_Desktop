const repository = require('./sqlite.repository');

let authService = null;

function setAuthService(service) {
    authService = service;
}

// The adapter layer that injects the UID
const sessionRepositoryAdapter = {
    setAuthService, // Expose the setter

    getById: (id) => repository.getById(id),
    
    create: (type = 'ask') => {
        const uid = authService.getCurrentUserId();
        return repository.create(uid, type);
    },
    
    getAllByUserId: () => {
        const uid = authService.getCurrentUserId();
        return repository.getAllByUserId(uid);
    },

    updateTitle: (id, title) => repository.updateTitle(id, title),
    
    deleteWithRelatedData: (id) => repository.deleteWithRelatedData(id),

    end: (id) => repository.end(id),

    updateType: (id, type) => repository.updateType(id, type),

    touch: (id) => repository.touch(id),

    getOrCreateActive: (requestedType = 'ask') => {
        const uid = authService.getCurrentUserId();
        return repository.getOrCreateActive(uid, requestedType);
    },

    endAllActiveSessions: () => {
        const uid = authService.getCurrentUserId();
        return repository.endAllActiveSessions(uid);
    },
};

module.exports = sessionRepositoryAdapter; 
