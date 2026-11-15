/// <reference lib="dom" />
/**
 * Renders the repository's 1280x640 social preview, `media/social-preview.png`: the title and
 * tagline beside the demo video's last answer (`social-preview.html`). Upload it by hand under
 * the repository's Settings, General, Social preview; GitHub has no API for it.
 *
 *   deno run -A --config media/demo/recipe/deno.jsonc media/demo/recipe/social-preview.ts
 */
import { chromium } from 'playwright'

const here = new URL('.', import.meta.url)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } })
  await page.goto(new URL('social-preview.html', here).href)
  await page.evaluate(async () => {
    const video = document.querySelector('video')!
    if (video.readyState < 1) await new Promise((done) => (video.onloadedmetadata = done))
    video.currentTime = 46
    await new Promise((done) => (video.onseeked = done))
    await document.fonts.ready
  })
  await page.screenshot({ path: new URL('../../social-preview.png', here).pathname })
} finally {
  await browser.close()
}
