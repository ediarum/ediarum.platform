import { describe, expect, it } from 'vitest'
import { CONTRACT_VERSION } from '../src/contract'

describe('contract', () => {
  it('has an integer version', () => {
    expect(Number.isInteger(CONTRACT_VERSION)).toBe(true)
  })
})
