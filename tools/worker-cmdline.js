const { execSync } = require('child_process')
const out = execSync('wmic process where "name=\'VirtualBrowser.exe\'" get ProcessId,CommandLine /FORMAT:LIST', { encoding: 'utf8', windowsHide: true })
const blocks = out.split(/\r?\n\r?\n/).filter(Boolean)
for (const b of blocks) {
  if (b.includes('--worker-id=') && !b.includes('--type=')) {
    console.log(b.replace(/\s+/g, ' ').trim())
    console.log('----')
  }
}
