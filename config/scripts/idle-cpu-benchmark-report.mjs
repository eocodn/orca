export async function collectIdleCpuRendererState(page) {
  return page.evaluate(() => {
    const describeElement = (element) => {
      if (!(element instanceof Element)) {
        return null
      }
      const classes = typeof element.className === 'string' ? element.className : ''
      const testId = element.getAttribute('data-testid')
      const label = element.getAttribute('aria-label')
      return {
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        testId,
        label,
        classes: classes.split(/\s+/).filter(Boolean).slice(0, 12),
        text: (element.textContent || '').trim().slice(0, 80)
      }
    }
    const animations = document.getAnimations({ subtree: true }).map((animation) => {
      const effect = animation.effect
      const target = effect instanceof KeyframeEffect ? effect.target : null
      return {
        playState: animation.playState,
        currentTime: typeof animation.currentTime === 'number' ? animation.currentTime : null,
        playbackRate: animation.playbackRate,
        duration:
          effect instanceof KeyframeEffect && typeof effect.getTiming().duration === 'number'
            ? effect.getTiming().duration
            : null,
        iterations: effect instanceof KeyframeEffect ? effect.getTiming().iterations : null,
        target: describeElement(target)
      }
    })
    return {
      visibilityState: document.visibilityState,
      runningAnimationCount: animations.filter((animation) => animation.playState === 'running')
        .length,
      animations: animations.slice(0, 80)
    }
  })
}

function meanIdleCpuValues(values) {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function percentileIdleCpuValues(sorted, fraction) {
  if (sorted.length === 0) {
    return 0
  }
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  return sorted[index]
}

export function summarizeIdleCpuSamples(samples) {
  const byKind = new Map()
  for (const sample of samples) {
    for (const proc of sample.processes) {
      const bucket = byKind.get(proc.kind) ?? { cpuValues: [], rssValues: [], maxProcessCount: 0 }
      bucket.cpuValues.push(proc.cpu)
      bucket.rssValues.push(proc.rssBytes)
      byKind.set(proc.kind, bucket)
    }
    const counts = new Map()
    for (const proc of sample.processes) {
      counts.set(proc.kind, (counts.get(proc.kind) ?? 0) + 1)
    }
    for (const [kind, count] of counts) {
      byKind.get(kind).maxProcessCount = Math.max(byKind.get(kind).maxProcessCount, count)
    }
  }
  const summary = {}
  for (const [kind, values] of byKind) {
    const cpuSorted = [...values.cpuValues].sort((a, b) => a - b)
    const rssSumBySample = samples.map((sample) =>
      sample.processes
        .filter((proc) => proc.kind === kind)
        .reduce((sum, proc) => sum + proc.rssBytes, 0)
    )
    summary[kind] = {
      meanCpuPercent: meanIdleCpuValues(values.cpuValues),
      p95CpuPercent: percentileIdleCpuValues(cpuSorted, 0.95),
      maxCpuPercent: Math.max(0, ...values.cpuValues),
      meanRssBytes: meanIdleCpuValues(rssSumBySample),
      maxProcessCount: values.maxProcessCount
    }
  }
  summary.total = {
    meanCpuPercent: meanIdleCpuValues(samples.map((sample) => sample.totalCpuPercent)),
    p95CpuPercent: percentileIdleCpuValues(
      samples.map((sample) => sample.totalCpuPercent).sort((a, b) => a - b),
      0.95
    ),
    meanRssBytes: meanIdleCpuValues(samples.map((sample) => sample.totalRssBytes))
  }
  return summary
}

export function summarizeIdleCpuProcessInventory(samples) {
  const inventory = {}
  for (const sample of samples) {
    const counts = new Map()
    for (const proc of sample.processes) {
      counts.set(proc.kind, (counts.get(proc.kind) ?? 0) + 1)
      const entry = inventory[proc.kind] ?? {
        maxProcessCount: 0,
        maxCpuPercent: 0,
        commandSamples: []
      }
      entry.maxCpuPercent = Math.max(entry.maxCpuPercent, proc.cpu)
      if (!entry.commandSamples.includes(proc.command) && entry.commandSamples.length < 6) {
        entry.commandSamples.push(proc.command)
      }
      inventory[proc.kind] = entry
    }
    for (const [kind, count] of counts) {
      inventory[kind].maxProcessCount = Math.max(inventory[kind].maxProcessCount, count)
    }
  }
  return inventory
}
