import { CHNL } from './constants.ts'
import type { Socket } from './types.ts'

export const sleep = (ms: number) => new Promise((resolve) => {
  setTimeout(resolve, ms)
})

// Escapes ASCII punctuation and whitespace for a TAG field in RediSearch queries
export const escapeTag = (value: string) => value.replace(/[\s!-/:-@[-^`{-~]/g, '\\$&')

export const parseChannels = (value: string) => value.split(',').slice(1, -1)

export const parseSocketFields = <F extends keyof Socket>(fields: F[], values: string[]) => {
  const socket: Partial<Record<keyof Socket, string[] | number>> = {}

  fields.forEach((field, index) => {
    const value = values[index]
    socket[field] = field === CHNL ? parseChannels(value) : Number(value)
  })

  return socket as Pick<Socket, F>
}
