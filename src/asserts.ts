import type { Socket } from "./types"

export const assertTTL = (ttl?: number): void | never => {
  if (ttl != null && ttl <= 0) {
    throw new Error(`ttl must be > 0 (ttl=${ttl})`)
  }
}

export const assertChannel = (channel: string): void | never => {
  if (!channel.length) {
    throw new Error('Empty channel is not allowed')
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