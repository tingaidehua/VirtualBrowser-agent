const path = require('path')
const fs = require('fs')
const core = require('../local-sync-ext/sync-core')

async function main() {
  const cfg = core.saveSettings({
    syncPath: path.join(process.env.USERPROFILE, 'OneDrive', 'VirtualBrowser'),
    autoLoad: true,
    autoUploadOnExit: true
  })
  console.log('settings', cfg)

  fs.mkdirSync(cfg.syncPath, { recursive: true })

  const local = await core.listLocalEnvironments()
  console.log('local envs', local.length, local.map(x => ({ id: x.id, name: x.name, size: x.size })))

  if (!local.length) {
    console.log('No local environments to upload — creating nothing, still ok')
  } else {
    const id = local[0].id
    await core.enableLocalSync([id])
    const up = await core.uploadEnvironment(id, cfg.syncPath)
    console.log('uploaded', up)
  }

  const synced = await core.listSyncedEnvironments(cfg.syncPath)
  console.log('synced', synced)

  // verify files on disk
  const layout = core.syncLayout(cfg.syncPath)
  console.log('manifest exists', fs.existsSync(layout.manifest))
  console.log('root listing', fs.readdirSync(layout.root))
  if (fs.existsSync(layout.envs)) console.log('envs', fs.readdirSync(layout.envs))
}
main().catch(e => { console.error(e); process.exit(1) })
