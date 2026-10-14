// Spike : logue les payloads des hooks Claude Code pour voir ce qu'ils exposent.
import { createServer } from 'node:http'
import { appendFileSync } from 'node:fs'

createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const line = JSON.stringify({ event: req.url.slice(1), payload: JSON.parse(body || '{}') })
    appendFileSync(new URL('./hooks.log', import.meta.url), line + '\n')
    res.end('ok')
  })
}).listen(4242, () => console.log('écoute sur :4242'))
