import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const composePath = resolve('compose.control.yml')
const expectedImageByDockerfile = {
  'Dockerfile.control': 'ade-control-control:stable',
  'Dockerfile.rust-control': 'ade-control-rust-control:stable',
  'Dockerfile.tauri-contract': 'ade-control-tauri-contract:stable'
}

function readBuildImageByDockerfile() {
  const lines = readFileSync(composePath, 'utf8').split('\n')
  const imageByDockerfile = new Map()
  let service = null
  let dockerfile = null
  let image = null

  const commitService = () => {
    if (dockerfile !== null) {
      imageByDockerfile.set(`${service}:${dockerfile}`, image)
    }
  }

  for (const line of lines) {
    const serviceMatch = /^  ([a-z0-9-]+):$/.exec(line)
    if (serviceMatch) {
      commitService()
      service = serviceMatch[1]
      dockerfile = null
      image = null
      continue
    }

    if (service === null) continue

    const dockerfileMatch = /^      dockerfile: (.+)$/.exec(line)
    if (dockerfileMatch) {
      dockerfile = dockerfileMatch[1]
      continue
    }

    const imageMatch = /^    image: (.+)$/.exec(line)
    if (imageMatch) image = imageMatch[1]
  }
  commitService()
  return imageByDockerfile
}

describe('compose.control.yml build image tags', () => {
  it('uses one explicit stable image per Dockerfile for every build service', () => {
    const imageByDockerfile = readBuildImageByDockerfile()
    const servicesByDockerfile = new Map()

    for (const [serviceAndDockerfile, image] of imageByDockerfile) {
      const [service, dockerfile] = serviceAndDockerfile.split(':')
      const services = servicesByDockerfile.get(dockerfile) ?? []
      services.push({ image, service })
      servicesByDockerfile.set(dockerfile, services)
    }

    expect(servicesByDockerfile.size).toBe(Object.keys(expectedImageByDockerfile).length)
    for (const [dockerfile, expectedImage] of Object.entries(expectedImageByDockerfile)) {
      const services = servicesByDockerfile.get(dockerfile) ?? []
      expect(services.length, `${dockerfile} build services`).toBeGreaterThan(0)
      expect(new Set(services.map(({ image }) => image))).toEqual(new Set([expectedImage]))
      expect(expectedImage).not.toContain('ADE_CONTROL_RUN_ID')
    }
  })
})
