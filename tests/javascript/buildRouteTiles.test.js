import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  buildHeatFeatures,
  buildRouteTiles,
  buildShadeFeatures,
  tileRange,
} from '../../scripts/build_route_tiles.mjs'

const BBOX = [139.559, 35.528, 139.918, 35.818]

function miniPayload() {
  const edges = [
    {
      id: 'e0', source: 'a', target: 'b', length: 100,
      green_score: 0.2, water_penalty: 0.4,
      geometry: [[139.7, 35.6], [139.71, 35.61]],
    },
    {
      id: 'e1', source: 'c', target: 'd', length: 200,
      green_score: 0.8, water_penalty: 0.1,
      geometry: [[139.8, 35.7], [139.81, 35.71]],
    },
  ]
  return {
    metadata: {
      graphVersion: '1.1.0',
      generatedAt: 'tile-baseline',
      nodeCount: 4,
      edgeCount: 2,
    },
    nodes: {
      a: { id: 'a', lon: 139.7, lat: 35.6 },
      b: { id: 'b', lon: 139.71, lat: 35.61 },
      c: { id: 'c', lon: 139.8, lat: 35.7 },
      d: { id: 'd', lon: 139.81, lat: 35.71 },
    },
    edges,
  }
}

function miniShade() {
  return {
    metadata: {
      schemaVersion: '1.0.0',
      scenarios: ['09:00', '12:00', '15:00'],
      roadGraphSchemaVersion: '1.1.0',
      roadGraphGeneratedAt: 'tile-baseline',
      edgeCount: 2,
    },
    edgeShadeScores: {
      e0: [0.1, 0.5, 0.9],
      e1: [0.9, 0.5, 0.1],
    },
  }
}

describe('瓦片构建函数', () => {
  it('tileRange 覆盖 Tokyo23 边界且与 slippy 公式一致', () => {
    expect(tileRange(BBOX, 0)).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 })
    const z10 = tileRange(BBOX, 10)
    expect(z10.minX).toBeLessThanOrEqual(z10.maxX)
    expect(z10.minY).toBeLessThanOrEqual(z10.maxY)
    // 东京中心 (139.758, 35.676) 必须在 z10 范围内
    const x = Math.floor((139.758 + 180) / 360 * 2 ** 10)
    const radians = 35.676 * Math.PI / 180
    const mercator = Math.log(Math.tan(radians) + 1 / Math.cos(radians))
    const y = Math.floor((1 - mercator / Math.PI) / 2 * 2 ** 10)
    expect(x).toBeGreaterThanOrEqual(z10.minX)
    expect(x).toBeLessThanOrEqual(z10.maxX)
    expect(y).toBeGreaterThanOrEqual(z10.minY)
    expect(y).toBeLessThanOrEqual(z10.maxY)
  })

  it('heat 要素使用与 exposureModel 相同的公式', () => {
    const features = buildHeatFeatures(miniPayload())
    expect(features).toHaveLength(2)
    expect(features[0].properties.heatExposure).toBeCloseTo(0.7 * 0.8 + 0.3 * 0.4, 6)
    expect(features[1].properties.heatExposure).toBeCloseTo(0.7 * 0.2 + 0.3 * 0.1, 6)
  })

  it('shade 要素包含三个时段的属性列', () => {
    const features = buildShadeFeatures(miniPayload(), miniShade())
    expect(features[0].properties).toEqual({ shade0900: 0.1, shade1200: 0.5, shade1500: 0.9 })
    expect(features[1].properties).toEqual({ shade0900: 0.9, shade1200: 0.5, shade1500: 0.1 })
  })

  it('生成可解码的 MVT 瓦片文件', async () => {
    const outputDirectory = await mkdtemp(path.join(tmpdir(), 'coolroute-tiles-'))
    try {
      const result = await buildRouteTiles({
        graphPayload: miniPayload(),
        shadePayload: miniShade(),
        minZoom: 10,
        maxZoom: 10,
        boundingBox: BBOX,
        outputDirectory,
      })
      expect(result.tileCount).toBeGreaterThan(0)
      expect(result.perLayer.heat.tiles).toBe(result.perLayer.shade.tiles)
      // 递归找一块 heat 瓦片并验证非空且含 MVT layer 名
      const { readdir, readFile: read } = await import('node:fs/promises')
      const heatDir = path.join(outputDirectory, 'heat')
      const zoomDirs = await readdir(heatDir)
      const xDirs = await readdir(path.join(heatDir, zoomDirs[0]))
      const yFiles = await readdir(path.join(heatDir, zoomDirs[0], xDirs[0]))
      const firstPbf = await read(path.join(heatDir, zoomDirs[0], xDirs[0], yFiles[0]))
      expect(firstPbf.length).toBeGreaterThan(0)
      // MVT layer 名应为 default（由 geojson-vt 约定）
      expect(firstPbf.toString('utf8', 0, 40)).toContain('default')
    } finally {
      await rm(outputDirectory, { recursive: true, force: true })
    }
  })
})
