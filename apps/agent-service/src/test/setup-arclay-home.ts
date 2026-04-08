import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

function ensureTestArclayHome(): void {
  const workerId = process.env.VITEST_WORKER_ID || '0'
  const testHomePrefix = path.join(os.tmpdir(), `arclay-vitest-home-${process.pid}-${workerId}-`)
  const testHome = fs.mkdtempSync(testHomePrefix)
  process.env.ARCLAY_HOME = testHome
}

ensureTestArclayHome()
