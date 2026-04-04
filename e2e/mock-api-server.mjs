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

    // Default: slow streaming response
    writeSse(
      res,
      [
        {
          delayMs: 10,
          message: {
            id: 'msg-execute-1',
            type: 'text',
            role: 'assistant',
            content: '正在执行模拟任务，请稍候...',
            timestamp: Date.now(),
          },
        },
      ],
      15000
    )
    return
  }

  if (req.method === 'POST' && pathname.startsWith('/api/v2/agent/stop/')) {
    writeJson(res, 200, { success: true })
    return
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
