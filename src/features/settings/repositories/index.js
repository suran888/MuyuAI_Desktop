const repository = require('./sqlite.repository');
const authService = require('../../common/services/authService');

const settingsRepositoryAdapter = {
    getPresets: () => {
        const uid = authService.getCurrentUserId();
        return repository.getPresets(uid);
    },

    getPresetTemplates: () => {
        return repository.getPresetTemplates();
    },

    createPreset: (options) => {
        const uid = authService.getCurrentUserId();
        return repository.createPreset({ uid, ...options });
    },

    updatePreset: (id, options) => {
        const uid = authService.getCurrentUserId();
        return repository.updatePreset(id, options, uid);
    },

    deletePreset: (id) => {
        const uid = authService.getCurrentUserId();
        return repository.deletePreset(id, uid);
    },

    getAutoUpdate: () => {
        const uid = authService.getCurrentUserId();
        return repository.getAutoUpdate(uid);
    },

    setAutoUpdate: (isEnabled) => {
        const uid = authService.getCurrentUserId();
        return repository.setAutoUpdate(uid, isEnabled);
    },
};

module.exports = settingsRepositoryAdapter;
