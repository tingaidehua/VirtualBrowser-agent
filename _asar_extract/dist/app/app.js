require('bytenode');
try {
  const path = require('path');
  const fs = require('fs');
  const candidates = [
    path.join(__dirname, 'local-sync', 'bootstrap.js'),
    path.join(process.resourcesPath || '', 'local-sync', 'bootstrap.js')
  ];
  let loaded = false;
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        require(p);
        loaded = true;
        console.log('[local-sync] loaded', p);
        break;
      }
    } catch (e) {
      console.error('[local-sync] load failed', p, e);
    }
  }
  if (!loaded) console.warn('[local-sync] bootstrap not found');
} catch (e) {
  console.error('[local-sync] init error', e);
}
require('./app.jsc');
