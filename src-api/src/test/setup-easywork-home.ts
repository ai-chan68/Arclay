import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

function ensureTestEasyWorkHome(): void {
  const workerId = process.env.VITEST_WORKER_ID || '0'
  const testHomePrefix = path.join(os.tmpdir(), `easywork-vitest-home-${process.pid}-${workerId}-`)
  const testHome = fs.mkdtempSync(testHomePrefix)
  process.env.EASYWORK_HOME = testHome
}

ensureTestEasyWorkHome()
