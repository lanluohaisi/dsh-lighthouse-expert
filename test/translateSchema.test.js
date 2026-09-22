/**
 * translateSchema 单元测试（JSON Schema → dsh-tools DSL 递归翻译）
 * 运行：node --test test/（CI 已接入；本地需先 pnpm run build）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { translateSchema } from '../lib/index.js'

test('基本类型映射：integer/number→number，boolean→boolean', () => {
  const out = translateSchema({
    properties: {
      Count: { type: 'integer', description: '数量' },
      Flag: { type: 'boolean' },
      Ratio: { type: 'number' },
    },
  })
  assert.equal(out.Count.type, 'number')
  assert.equal(out.Flag.type, 'boolean')
  assert.equal(out.Ratio.type, 'number')
  assert.equal(out.Count.description, '数量')
})

test('required 由父级附加到子节点', () => {
  const out = translateSchema({
    properties: {
      Region: { type: 'string' },
      Zone: { type: 'string' },
    },
    required: ['Region'],
  })
  assert.equal(out.Region.required, true)
  assert.equal(out.Zone.required, undefined)
})

test('enum 透传', () => {
  const out = translateSchema({
    properties: {
      Protocol: { type: 'string', enum: ['TCP', 'UDP', 'ALL'] },
    },
  })
  assert.deepEqual(out.Protocol.enum, ['TCP', 'UDP', 'ALL'])
})

test('array + 简单 items 递归翻译', () => {
  const out = translateSchema({
    properties: {
      InstanceIds: { type: 'array', items: { type: 'string' }, description: '实例列表' },
    },
  })
  assert.equal(out.InstanceIds.type, 'array')
  assert.deepEqual(out.InstanceIds.items, { type: 'string' })
})

test('array + object items 嵌套递归（create_firewall_rules 实际结构）', () => {
  // 这是从云端 tools/list 抓的真实结构（曾导致启动 fatal 的场景）
  const out = translateSchema({
    properties: {
      FirewallRules: {
        type: 'array',
        description: '要添加的防火墙规则集合',
        items: {
          type: 'object',
          properties: {
            Protocol: { type: 'string', enum: ['TCP', 'UDP', 'ICMP', 'ALL'] },
            Port: { type: 'string', description: '端口范围' },
            Action: { type: 'string', enum: ['ACCEPT', 'DROP'], default: 'ACCEPT' },
          },
          required: ['Protocol'],
          additionalProperties: false,
        },
      },
    },
    required: ['Region', 'InstanceId', 'FirewallRules'],
  })
  const rules = out.FirewallRules
  assert.equal(rules.type, 'array')
  assert.equal(rules.items.type, 'object')
  // 嵌套 properties 必须翻译出来
  assert.ok(rules.items.properties.Protocol, '嵌套 properties 应存在')
  assert.deepEqual(rules.items.properties.Protocol.enum, ['TCP', 'UDP', 'ICMP', 'ALL'])
  // 嵌套 required 附加
  assert.equal(rules.items.properties.Protocol.required, true)
  assert.equal(rules.items.properties.Port.required, undefined)
  // object 节点 additionalProperties 必须显式 boolean
  assert.equal(rules.items.additionalProperties, false)
  // default 透传
  assert.equal(rules.items.properties.Action.default, 'ACCEPT')
})

test('DSL 不认识的关键词被丢弃（maxLength 等）', () => {
  const out = translateSchema({
    properties: {
      Desc: { type: 'string', maxLength: 64, minLength: 1 },
    },
  })
  assert.equal(out.Desc.maxLength, undefined)
  assert.equal(out.Desc.minLength, undefined)
})

test('顶层无 properties 返回空对象', () => {
  assert.deepEqual(translateSchema({}), {})
})
