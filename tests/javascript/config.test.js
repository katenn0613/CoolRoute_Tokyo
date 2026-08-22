import { describe, expect, it } from 'vitest'
import tokyo23AreaConfig from '../../config/tokyo23_area.json'
import { DATA_SOURCE_STATUS, dataSources, statusDataSources } from '../../src/config/dataSources.js'
import { demoArea } from '../../src/config/demoArea.js'
import { assetPath } from '../../src/utils/assetPath.js'

describe('Production Area 配置', () => {
  it('使用有效的 Tokyo23 配置', () => {
    expect(demoArea.id).toBe('tokyo_23_wards')
    expect(demoArea.center).toEqual([139.758, 35.676])
    expect(demoArea.zoom).toBe(10.4)
    expect(demoArea.boundingBox).toEqual([139.559, 35.528, 139.918, 35.818])
    expect(demoArea.boundingBox[0]).toBeLessThan(demoArea.boundingBox[2])
    expect(demoArea.boundingBox[1]).toBeLessThan(demoArea.boundingBox[3])
  })

  it('直接采用 React 和 Python 共用的 JSON 配置值', () => {
    expect(demoArea).toEqual(tokyo23AreaConfig)
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
