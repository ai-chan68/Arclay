#!/usr/bin/env node

import http from 'node:http'
import process from 'node:process'

const host = process.env.EASYWORK_E2E_API_HOST || '127.0.0.1'
const port = Number(process.env.EASYWORK_E2E_API_PORT || '2026')

const defaultSettings = {
  activeProviderId: 'provider-mock',
  providers: [
    {
      id: 'provider-mock',
      name: 'Mock Claude',
      provider: 'claude',
      apiKey: 'sk-mock',
      model: 'claude-sonnet-4-5',
      baseUrl: '',
    },
  ],
  mcp: { enabled: false, mcpServers: {} },
  skills: { enabled: true, routing: 'auto', skills: {}, sources: [] },
  approval: { enabled: true, autoAllowTools: [], timeoutMs: 300000 },
  sandbox: { enabled: false, provider: 'native', apiEndpoint: '', image: '' },
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
  })
  res.end(JSON.stringify(payload))
}

function writeSse(res, chunks, finalDelayMs = 0) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
  })

  let closed = false
  const timers = []
  const cleanup = () => {
    closed = true
    for (const timer of timers) {
      clearTimeout(timer)
    }
  }

  res.on('close', cleanup)

  chunks.forEach(({ delayMs, message }) => {
    const timer = setTimeout(() => {
      if (closed) return
      res.write(`data: ${JSON.stringify(message)}\n`)
    }, delayMs)
    timers.push(timer)
  })

  const endTimer = setTimeout(() => {
    if (closed) return
    res.end()
  }, finalDelayMs)
  timers.push(endTimer)
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => {
      if (!data) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(data))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

// In-memory storage for knowledge notes (shared across requests)
const inMemoryNotes = new Map()
let noteIdCounter = 1

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    })
    res.end()
    return
  }

  const url = new URL(req.url || '/', `http://${host}:${port}`)
  const { pathname } = url

  if (req.method === 'GET' && pathname === '/api/health') {
    writeJson(res, 200, { status: 'ok' })
    return
  }

  if (req.method === 'GET' && pathname === '/api/health/dependencies') {
    writeJson(res, 200, {
      success: true,
      claudeCode: true,
      providers: 1,
      providerConfigured: true,
      activeProvider: true,
    })
    return
  }

  if (req.method === 'GET' && pathname === '/api/settings') {
    writeJson(res, 200, defaultSettings)
    return
  }

  if (req.method === 'PUT' && pathname === '/api/settings') {
    await parseBody(req).catch(() => ({}))
    writeJson(res, 200, { success: true })
    return
  }

  if (req.method === 'GET' && pathname === '/api/preview/list') {
    writeJson(res, 200, { instances: [] })
    return
  }

  if (req.method === 'GET' && pathname === '/api/settings/skills/list') {
    writeJson(res, 200, { skills: [], stats: { total: 0, healthy: 0, warning: 0, broken: 0 } })
    return
  }

  if (req.method === 'GET' && pathname === '/api/v2/agent/pending') {
    writeJson(res, 200, { pendingPermissions: [], pendingQuestions: [], latestTerminal: null })
    return
  }

  if (req.method === 'GET' && pathname.startsWith('/api/v2/agent/runtime/')) {
    writeJson(res, 200, { runtime: { version: 1 }, turns: [] })
    return
  }

  if (req.method === 'GET' && pathname.includes('/pending-plan')) {
    writeJson(res, 200, {
      id: 'plan-mock',
      goal: '完成一个稳定的模拟任务',
      steps: [
        { id: 'step-1', description: '读取用户输入', status: 'pending' },
        { id: 'step-2', description: '输出模拟结果', status: 'pending' },
      ],
      createdAt: new Date().toISOString(),
    })
    return
  }

  if (req.method === 'GET' && pathname.startsWith('/api/v2/agent/turn/')) {
    writeJson(res, 200, { detail: { output: { text: 'mock', artifacts: [] } } })
    return
  }

  if (req.method === 'POST' && pathname === '/api/v2/agent/plan') {
    await parseBody(req).catch(() => ({}))
    writeSse(
      res,
      [
        {
          delayMs: 10,
          message: {
            id: 'msg-plan-1',
            type: 'plan',
            role: 'assistant',
            timestamp: Date.now(),
            plan: {
              id: 'plan-mock',
              goal: '完成一个稳定的模拟任务',
              steps: [
                { id: 'step-1', description: '读取用户输入', status: 'pending' },
                { id: 'step-2', description: '输出模拟结果', status: 'pending' },
              ],
              notes: 'This plan comes from the desktop regression mock API.',
              createdAt: new Date().toISOString(),
            },
          },
        },
      ],
      40
    )
    return
  }

  if (req.method === 'POST' && pathname === '/api/v2/agent/execute') {
    const body = await parseBody(req).catch(() => ({}))

    // Error simulation: prompt contains "error" → immediate server error
    if (typeof body.prompt === 'string' && body.prompt.includes('trigger-error')) {
      writeJson(res, 500, { error: 'Simulated server error' })
      return
    }

    // Multi-turn simulation: prompt contains "multi-turn" → multiple messages
    if (typeof body.prompt === 'string' && body.prompt.includes('multi-turn')) {
      writeSse(
        res,
        [
          {
            delayMs: 10,
            message: {
              id: 'msg-thinking-1',
              type: 'thinking',
              role: 'assistant',
              content: '正在分析任务需求...',
              timestamp: Date.now(),
            },
          },
          {
            delayMs: 30,
            message: {
              id: 'msg-execute-1',
              type: 'text',
              role: 'assistant',
              content: '第一轮：分析任务内容...',
              timestamp: Date.now(),
            },
          },
          {
            delayMs: 50,
            message: {
              id: 'msg-execute-2',
              type: 'tool_use',
              role: 'assistant',
              toolName: 'bash',
              toolInput: { command: 'echo hello' },
              toolUseId: 'tool-1',
              timestamp: Date.now(),
            },
          },
          {
            delayMs: 80,
            message: {
              id: 'msg-execute-3',
              type: 'tool_result',
              toolUseId: 'tool-1',
              toolName: 'bash',
              toolOutput: 'hello',
              timestamp: Date.now(),
            },
          },
          {
            delayMs: 120,
            message: {
              id: 'msg-execute-4',
              type: 'text',
              role: 'assistant',
              content: '第二轮：任务执行完成。',
              timestamp: Date.now(),
            },
          },
          {
            delayMs: 150,
            message: {
              id: 'msg-done',
              type: 'done',
              timestamp: Date.now(),
            },
          },
        ],
        200
      )
      return
    }

    // Default: streaming response with thinking messages
    writeSse(
      res,
      [
        {
          delayMs: 10,
          message: {
            id: 'msg-thinking-1',
            type: 'thinking',
            role: 'assistant',
            content: '正在思考如何完成这个任务...',
            timestamp: Date.now(),
          },
        },
        {
          delayMs: 50,
          message: {
            id: 'msg-tool-1',
            type: 'tool_use',
            role: 'assistant',
            toolName: 'Write',
            toolInput: { file_path: 'hello.txt', content: 'Hello World' },
            toolUseId: 'tool-write-1',
            timestamp: Date.now(),
          },
        },
        {
          delayMs: 100,
          message: {
            id: 'msg-tool-result-1',
            type: 'tool_result',
            toolUseId: 'tool-write-1',
            toolName: 'Write',
            toolOutput: 'File written successfully',
            timestamp: Date.now(),
          },
        },
        {
          delayMs: 150,
          message: {
            id: 'msg-text-1',
            type: 'text',
            role: 'assistant',
            content: '任务执行完成。',
            timestamp: Date.now(),
          },
        },
        {
          delayMs: 180,
          message: {
            id: 'msg-done',
            type: 'done',
            timestamp: Date.now(),
          },
        },
      ],
      250
    )
    return
  }

  if (req.method === 'POST' && pathname.startsWith('/api/v2/agent/stop/')) {
    writeJson(res, 200, { success: true })
    return
  }

  // Knowledge Notes API mock endpoints
  if (pathname.startsWith('/api/knowledge-notes')) {
    if (req.method === 'GET' && pathname === '/api/knowledge-notes') {
      const scope = url.searchParams.get('scope')
      const notes = Array.from(inMemoryNotes.values()).filter(n => n.scope === scope)
      writeJson(res, 200, { notes })
      return
    }

    const idMatch = pathname.match(/^\/api\/knowledge-notes\/([^/?]+)/)
    if (req.method === 'GET' && idMatch) {
      const id = idMatch[1]
      const note = inMemoryNotes.get(id)
      if (note) {
        writeJson(res, 200, { note })
      } else {
        writeJson(res, 404, { error: 'Knowledge note not found' })
      }
      return
    }

    if (req.method === 'POST' && pathname === '/api/knowledge-notes') {
      const body = await parseBody(req).catch(() => ({}))
      const note = {
        id: `note-${noteIdCounter++}`,
        ...body,
        enabled: body.enabled ?? true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      inMemoryNotes.set(note.id, note)
      writeJson(res, 201, { note })
      return
    }

    if (req.method === 'PUT' && idMatch) {
      const id = idMatch[1]
      const note = inMemoryNotes.get(id)
      if (note) {
        const body = await parseBody(req).catch(() => ({}))
        const updated = { ...note, ...body, updatedAt: new Date().toISOString() }
        inMemoryNotes.set(id, updated)
        writeJson(res, 200, { note: updated })
      } else {
        writeJson(res, 500, { error: 'Knowledge note not found' })
      }
      return
    }

    if (req.method === 'DELETE' && idMatch) {
      const id = idMatch[1]
      inMemoryNotes.delete(id)
      writeJson(res, 200, { success: true })
      return
    }
  }

  writeJson(res, 404, { error: `Unhandled mock route: ${req.method} ${pathname}` })
})

server.listen(port, host, () => {
  console.log(`[e2e-mock-api] listening on http://${host}:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
