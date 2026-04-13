import pino from 'pino'

const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')

const transport =
  process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
    : undefined

const rootLogger = pino({
  level: LOG_LEVEL,
  transport,
  base: { service: 'arclay-api' },
})

export function createLogger(module: string): pino.Logger {
  return rootLogger.child({ module })
}

export { rootLogger as logger }
