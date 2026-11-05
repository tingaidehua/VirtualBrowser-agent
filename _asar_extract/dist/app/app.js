const start = () => { require('bytenode'); require('./app.jsc'); };
try {
  const path = require('path');
  const fs = require('fs');
  const candidates = [
    path.join(__dirname, 'local-sync', 'bootstrap.js'),
    path.join(process.resourcesPath || '', 'local-sync', 'bootstrap.js')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        require(p);
        console.log('[local-sync] loaded', p);
        break;
      }
    } catch (e) {
      console.error('[local-sync] load failed', p, e);
    }
  }
} catch (e) {
  console.error('[local-sync] init error', e);
}
start();
