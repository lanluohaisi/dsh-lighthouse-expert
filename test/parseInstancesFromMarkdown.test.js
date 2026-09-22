/**
 * parseInstancesFromMarkdown 单元测试（远端 Markdown 表格 → 结构化实例）
 * 运行：node --test test/（CI 已接入；本地需先 pnpm run build）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseInstancesFromMarkdown } from '../lib/api/bridge.js'

// 预发环境实测的真实返回格式（字段名含空格，如 "Instance Id" / "C P U"）
const REAL_MD = `| Instance Id | Instance Name | Instance State | C P U | Memory | Zone | PublicAddresses | PrivateAddresses | Created Time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| lhins-6hk49dze | Hermes Agent | RUNNING | 2 | 2 | ap-beijing-7 | 49.233.166.93 | 10.2.4.4 | 2026-07-30T11:56:30Z |
| lhins-1nmtrpl8 | web-server | STOPPED | 4 | 8 | ap-beijing-3 | 82.156.62.198 | 10.2.4.5 | 2026-08-02T10:00:00Z |`

test('解析真实格式：字段名含空格 + PascalCase 表头', () => {
  const list = parseInstancesFromMarkdown(REAL_MD)
  assert.equal(list.length, 2)
  const first = list[0]
  assert.equal(first.instanceId, 'lhins-6hk49dze')
  assert.equal(first.instanceName, 'Hermes Agent')
  assert.equal(first.state, 'RUNNING')
  assert.equal(first.cpu, 2)
  assert.equal(first.memory, 2)
  assert.equal(first.zone, 'ap-beijing-7')
  assert.equal(first.publicIp, '49.233.166.93')
  assert.equal(first.privateIp, '10.2.4.4')
  assert.equal(first.createdAt, '2026-07-30T11:56:30Z')
})

test('扩展状态原样保留（SHUTDOWN 不再误兜底为 RUNNING）', () => {
  const md = `| Instance Id | Instance Name | Instance State |
| --- | --- | --- |
| lhins-xxx1 | isolated | SHUTDOWN |
| lhins-xxx2 | frozen | FREEZING |
| lhins-xxx3 | rescue | RESCUE_MODE |`
  const list = parseInstancesFromMarkdown(md)
  assert.equal(list[0].state, 'SHUTDOWN')
  assert.equal(list[1].state, 'FREEZING')
  assert.equal(list[2].state, 'RESCUE_MODE')
})

test('缺字段的行宽松处理（无 IP/无规格仍解析）', () => {
  const md = `| Instance Id | Instance Name | Instance State |
| --- | --- | --- |
| lhins-sp1 | sparse | RUNNING |`
  const list = parseInstancesFromMarkdown(md)
  assert.equal(list.length, 1)
  assert.equal(list[0].instanceId, 'lhins-sp1')
  assert.equal(list[0].publicIp, '') // 缺失字段给空串
  assert.equal(list[0].cpu, 0)
})

test('非法行跳过：非 lhins- 前缀的 ID 行忽略', () => {
  const md = `| Instance Id | Instance Name |
| --- | --- |
| lhins-ok1 | real |
| snap-12345 | snapshot-id 不是实例 |
| garbage | 无 ID 格式 |`
  const list = parseInstancesFromMarkdown(md)
  assert.equal(list.length, 1)
  assert.equal(list[0].instanceId, 'lhins-ok1')
})

test('空输入/无表格返回空数组', () => {
  assert.deepEqual(parseInstancesFromMarkdown(''), [])
  assert.deepEqual(parseInstancesFromMarkdown('暂无数据'), [])
  assert.deepEqual(parseInstancesFromMarkdown('普通文本\n没有表格'), [])
})

test('instanceName 缺失时回退为 instanceId', () => {
  const md = `| Instance Id | Instance State |
| --- | --- |
| lhins-noname | RUNNING |`
  const list = parseInstancesFromMarkdown(md)
  assert.equal(list[0].instanceName, 'lhins-noname')
})
