import type { Socket } from './types.ts'

export const assertTTL = (ttl?: number): void | never => {
  if (ttl != null && ttl <= 0) {
    throw new Error(`ttl must be > 0 (ttl=${ttl})`)
  }
}

// Comma is the separator of channels inside a socket hash
export const assertChannel = (channel: string): void | never => {
  if (!channel.length) {
    throw new Error('Empty channel is not allowed')
  }
  if (channel.includes(',')) {
    throw new Error(`Comma is not allowed in channel (channel=${channel})`)
  }
}

export const assertSocketFields = (fields: Array<keyof Socket>) => {
  if (!fields.length) {
    throw new Error('no empty fields')
  }
  if (fields.length > 3) {
    throw new Error('too many fields')
  }
}
