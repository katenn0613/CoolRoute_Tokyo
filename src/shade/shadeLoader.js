import { shadeConfig } from '../config/shadeConfig.js'
import { assetPath } from '../utils/assetPath.js'

export class ShadeSchemaError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ShadeSchemaError'
  }
}

export class ShadeLoadError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'ShadeLoadError'
  }
}

export function validateShadePayload(payload, graph) {
  if (!payload || typeof payload !== 'object' || !payload.metadata) {
    throw new ShadeSchemaError('Shade 数据缺少 metadata。')
  }
  const { metadata, edgeShadeScores } = payload
  if (metadata.schemaVersion !== '1.0.0') {
    throw new ShadeSchemaError(`不支持的 Shade Schema：${metadata.schemaVersion ?? 'missing'}`)
  }
  if (
    !Array.isArray(metadata.scenarios)
    || metadata.scenarios.length !== shadeConfig.scenarios.length
    || metadata.scenarios.some((scenario, index) => scenario !== shadeConfig.scenarios[index])
  ) {
    throw new ShadeSchemaError('Shade 场景必须严格为 09:00、12:00、15:00。')
  }
  if (!(graph?.edges instanceof Map)) {
    throw new ShadeSchemaError('Shade 数据验证需要已加载的 Road Graph。')
  }
  if (metadata.roadGraphSchemaVersion !== graph.metadata.graphVersion) {
    throw new ShadeSchemaError('Shade 与 Road Graph Schema Version 不匹配。')
  }
  if (metadata.roadGraphGeneratedAt !== graph.metadata.generatedAt) {
    throw new ShadeSchemaError('Shade 与当前 Road Graph 数据快照不匹配。')
  }
  if (!edgeShadeScores || typeof edgeShadeScores !== 'object' || Array.isArray(edgeShadeScores)) {
    throw new ShadeSchemaError('Shade 数据缺少 edgeShadeScores。')
  }
  if (metadata.edgeCount !== graph.edges.size) {
    throw new ShadeSchemaError('Shade metadata Edge 数量不匹配。')
  }
  const graphIds = new Set(graph.edges.keys())
  const scoreIds = Object.keys(edgeShadeScores)
  if (
    scoreIds.length !== graphIds.size
    || scoreIds.some((edgeId) => !graphIds.has(edgeId))
    || [...graphIds].some((edgeId) => !Object.hasOwn(edgeShadeScores, edgeId))
  ) {
    throw new ShadeSchemaError('Shade Edge ID 与 Road Graph 不一致。')
  }
  for (const [edgeId, values] of Object.entries(edgeShadeScores)) {
    if (
      !Array.isArray(values)
      || values.length !== shadeConfig.scenarios.length
      || values.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    ) {
      throw new ShadeSchemaError(`Edge ${edgeId} 的 Shade Score 无效。`)
    }
  }
  return payload
}

export async function loadShadeData({
  fetchImpl = globalThis.fetch,
  url = assetPath('data/shade.json'),
} = {}) {
  let response
  try {
    response = await fetchImpl(url)
  } catch (error) {
    throw new ShadeLoadError('无法连接 Shade 静态资源。', { cause: error })
  }
  if (!response?.ok) {
    throw new ShadeLoadError(`Shade 数据加载失败（HTTP ${response?.status ?? 'unknown'}）。`)
  }
  try {
    return await response.json()
  } catch (error) {
    throw new ShadeLoadError('Shade 静态资源不是有效 JSON。', { cause: error })
  }
}

