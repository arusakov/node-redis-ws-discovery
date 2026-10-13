import type { Redis } from 'ioredis'

import type { CHNL, SCKT, SID, SRVR } from './constants.ts'

export type WSDiscoveryOptions = {
  redis: Redis
  prefix?: string
  ttl?: {
    server?: number
    socket?: number
  }
}

export type SocketWithServer = {
  [SCKT]: number
  [SRVR]: number
}

export type Socket = {
  [CHNL]: string[]
  [SID]: number
  [SRVR]: number
}

export type LockOpts = {
  key: string
  token: string
  ttlMs: number
  attempts: number
  sleepMs: number
}

// Commands defined with redis.defineCommand() (see lua.ts)
export type ScriptCommands = {
  channelAdd(key: string, field: string, ...channels: string[]): Promise<number>
  channelRemove(key: string, field: string, ...channels: string[]): Promise<number>
  incWithReset(key: string): Promise<number>
  hsetWithTTL(key: string, ttl: number, ...fieldsAndValues: Array<string | number>): Promise<number>
}
