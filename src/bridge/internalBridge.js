// src/bridge/internalBridge.js
const { EventEmitter } = require('events');

// Internal event bus connecting FeatureCore and WindowCore
const internalBridge = new EventEmitter();
module.exports = internalBridge;

// Example events
// internalBridge.on('content-protection-changed', (enabled) => {
//   // handled by windowManager
// });