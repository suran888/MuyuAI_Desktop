const repository = require('./sqlite.repository');

let authService = null;

function getAuthService() {
    if (!authService) {
        authService = require('../../services/authService');
    }
    return authService;
}

const userRepositoryAdapter = {
    findOrCreate: (user) => {
        return repository.findOrCreate(user);
    },
    
    getById: () => {
        const uid = getAuthService().getCurrentUserId();
        return repository.getById(uid);
    },



    update: (updateData) => {
        const uid = getAuthService().getCurrentUserId();
        return repository.update({ uid, ...updateData });
    },

    deleteById: () => {
        const uid = getAuthService().getCurrentUserId();
        return repository.deleteById(uid);
    }
};

module.exports = {
    ...userRepositoryAdapter
}; 
