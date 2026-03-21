const repository = require('./sqlite.repository');
const authService = require('../../services/authService');

const presetRepositoryAdapter = {
    getPresets: () => {
        const uid = authService.getCurrentUserId();
        return repository.getPresets(uid);
    },

    getPresetTemplates: () => {
        return repository.getPresetTemplates();
    },

    create: (options) => {
        const uid = authService.getCurrentUserId();
        return repository.create({ uid, ...options });
    },

    update: (id, options) => {
        const uid = authService.getCurrentUserId();
        return repository.update(id, options, uid);
    },

    delete: (id) => {
        const uid = authService.getCurrentUserId();
        return repository.delete(id, uid);
    },
};

module.exports = presetRepositoryAdapter; 
