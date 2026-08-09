import { copyFileSync, renameSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const source = resolve('out/web/web-index.html')
const destination = resolve('out/web/index.html')
const temporary = `${destination}.tmp`

if (!statSync(source).isFile()) throw new Error('tauri_frontend_source_not_file')
copyFileSync(source, temporary)
renameSync(temporary, destination)
if (statSync(destination).size === 0) throw new Error('tauri_frontend_index_empty')

console.log(JSON.stringify({ service: 'tauri-frontend-preparation', state: 'ready' }))
