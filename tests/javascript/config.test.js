import { describe, expect, it } from 'vitest'
import demoAreaConfig from '../../config/demo_area.json'
import { DATA_SOURCE_STATUS, dataSources, statusDataSources } from '../../src/config/dataSources.js'
import { demoArea } from '../../src/config/demoArea.js'
import { assetPath } from '../../src/utils/assetPath.js'

describe('Demo Area 配置', () => {
  it('将约 2–3 km 开发区域保持在一份有效配置中', () => {
    expect(demoArea.id).toBe('temporary_demo_area')
    expect(demoArea.center).toEqual([139.7575, 35.683])
    expect(demoArea.zoom).toBe(14.2)
    expect(demoArea.boundingBox).toEqual([139.744, 35.672, 139.771, 35.694])
    expect(demoArea.boundingBox[0]).toBeLessThan(demoArea.boundingBox[2])
    expect(demoArea.boundingBox[1]).toBeLessThan(demoArea.boundingBox[3])
  })

  it('直接采用 React 和 Python 共用的 JSON 配置值', () => {
    expect(demoArea).toEqual(demoAreaConfig)
  })
})

describe('数据源 Registry', () => {
  it('定义六个数据源，且只使用已登记的状态', () => {
    expect(dataSources).toHaveLength(6)
    expect(dataSources.every((source) => Object.values(DATA_SOURCE_STATUS).includes(source.status))).toBe(true)
  })

  it('只在真实发布后把 OSM、Green 与 Drinking 标记为 Ready', () => {
    expect(statusDataSources).toHaveLength(3)
    expect(statusDataSources.filter((source) => source.status === DATA_SOURCE_STATUS.READY)).toHaveLength(3)
    expect(statusDataSources.filter((source) => source.status === DATA_SOURCE_STATUS.PENDING)).toHaveLength(0)
    expect(dataSources.find((source) => source.id === 'osm-walking-network')?.status).toBe(
      DATA_SOURCE_STATUS.READY,
    )
  })

  it('对每个数据源保留代码和文档需要的字段', () => {
    const requiredFields = [
      'id',
      'name',
      'provider',
      'sourcePage',
      'purpose',
      'status',
      'localRawPath',
      'processedPath',
      'required',
      'priority',
      'format',
      'license',
      'notes',
      'showInStatus',
    ]

    dataSources.forEach((source) => {
      requiredFields.forEach((field) => expect(source).toHaveProperty(field))
    })
  })
})

describe('静态资源路径', () => {
  it('不会让文件名开头的斜杠覆盖 Vite base path', () => {
    expect(assetPath('/data/graph.json')).not.toContain('//data/graph.json')
    expect(assetPath('/data/graph.json')).toMatch(/data\/graph\.json$/)
  })
})
