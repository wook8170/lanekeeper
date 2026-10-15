#!/usr/bin/env node
// Stop / StopFailure: a usage limit ends the turn -> record it in limits.json
// and schedule a headless resume after the reset time.
import { detectAndSchedule } from '../../../lib/retry.mjs'
import { hookMain } from '../../../lib/runtime.mjs'

hookMain(import.meta, (input, env) => {
  detectAndSchedule(input, { env })
  return null
})
