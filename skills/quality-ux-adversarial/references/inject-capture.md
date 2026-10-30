# Fix captures by DOM or CSS injection

A fix capture shows the proposal on the real page without touching product code. The checker opens the same page in the same state, injects CSS or changes the DOM, and captures again. The injected code is saved next to the capture so the implementing lane can see exactly what was shown.

Use only the design system's tokens and classes in the injection (for example `var(--space-4)` or an existing button class). A raw colour or pixel value in the injection is a look-alike, not a proposal.

```js
// inject/01.js — run with: wb-slot --kind browser -- node inject/01.js
import { chromium } from 'playwright'

const BASE = process.env.UXADV_BASE_URL // the lane port, from the brief
const OUT = process.env.UXADV_OUT // the result folder

const browser = await chromium.launch({
  headless: true,
  ignoreDefaultArgs: ['--hide-scrollbars'], // keep overflow scroll bars visible in the capture
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' })
await page.goto(`${BASE}/<route>`)
await page.getByRole('button', { name: '<label>' }).click()

await page.screenshot({ path: `${OUT}/caps/now-01.png`, fullPage: false })

// Proposal F-01: the same spacing step as the other list rows, and the primary button class.
await page.addStyleTag({ content: `
  [data-list="items"] > li { padding-block: var(--space-3); }
` })
await page.evaluate(() => {
  const b = document.querySelector('[data-action="save"]')
  b?.classList.add('<primary button class>')
})

await page.screenshot({ path: `${OUT}/caps/fix-01.png`, fullPage: false })

// Measurement for axis ⑤, kept as evidence.
const m = await page.$$eval('[data-list="items"] > li', (rows) => rows.map((r) => getComputedStyle(r).paddingTop))
console.log(JSON.stringify({ finding: 'F-01', paddingTop: m }))

await browser.close()
```

Repeat with `colorScheme: 'dark'` and the narrow width when the finding depends on them. Close the browser in the same script; the checker stops only the processes it started.
