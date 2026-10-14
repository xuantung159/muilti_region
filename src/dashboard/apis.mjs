import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CONTROL_TABLE, db, json, parseBody } from '../shared/lib.mjs';

export function validateApi(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Body phải là JSON object');
  if (Object.keys(body).some(key => !['name', 'baseUrl', 'timeoutMs', 'enabled'].includes(key))) {
    throw new Error('Chỉ nhận name, baseUrl, timeoutMs, enabled');
  }
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 100) throw new Error('Tên API cần 1–100 ký tự');
  if (typeof body.baseUrl !== 'string' || body.baseUrl.length > 2048) throw new Error('baseUrl không hợp lệ');
  let url;
  try { url = new URL(body.baseUrl); } catch { throw new Error('baseUrl phải là URL HTTPS'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443')) {
    throw new Error('Chỉ nhận HTTPS cổng 443, không chứa credentials, query hoặc fragment');
  }
  if (isIP(host.replace(/^\[|\]$/g, '')) || !host.includes('.') || !/^[a-z0-9.-]+$/.test(host) ||
      host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host)) {
    throw new Error('Dùng tên miền HTTPS công khai; không nhận IP hoặc tên miền nội bộ');
  }
  const timeoutMs = body.timeoutMs ?? 5000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 10000) throw new Error('timeoutMs phải là số nguyên từ 1000 đến 10000');
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') throw new Error('enabled phải là boolean');
  return { name: body.name.trim(), baseUrl: url.href.replace(/\/+$/, ''), timeoutMs, enabled: body.enabled ?? true };
}

const ref = (tenantId, apiId) => ({ PK: `TENANT#${tenantId}`, SK: `API#${apiId}` });
const publicApi = ({ PK, SK, ...api }) => api;

export async function apis(method, id, session, event) {
  if (id && !/^a[0-9a-f]{32}$/.test(id)) return json(404, { error: 'Không tìm thấy API' });
  if (!id && method === 'GET') {
    const items = [];
    let cursor;
    do {
      const result = await db.send(new QueryCommand({ TableName: CONTROL_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `TENANT#${session.tenantId}`, ':sk': 'API#' }, ExclusiveStartKey: cursor,
        ConsistentRead: true,
      }));
      items.push(...(result.Items ?? []).map(publicApi));
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    return json(200, { apis: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  }
  if (!id && method === 'POST') {
    let config;
    try { config = validateApi(parseBody(event)); } catch (error) { return json(400, { error: error.message }); }
    const apiId = `a${randomUUID().replaceAll('-', '')}`;
    const now = new Date().toISOString();
    const api = { apiId, tenantId: session.tenantId, ...config, revision: 1, createdAt: now, updatedAt: now };
    await db.send(new PutCommand({ TableName: CONTROL_TABLE, Item: { ...ref(session.tenantId, apiId), ...api }, ConditionExpression: 'attribute_not_exists(PK)' }));
    return json(201, { api });
  }
  if (id && ['GET', 'PATCH'].includes(method)) {
    const { Item } = await db.send(new GetCommand({ TableName: CONTROL_TABLE, Key: ref(session.tenantId, id), ConsistentRead: true }));
    if (!Item) return json(404, { error: 'Không tìm thấy API' });
    if (method === 'GET') return json(200, { api: publicApi(Item) });
    const body = parseBody(event);
    if (!Object.keys(body).length) return json(400, { error: 'Cần ít nhất một trường để cập nhật' });
    let config;
    try { config = validateApi({ name: Item.name, baseUrl: Item.baseUrl, timeoutMs: Item.timeoutMs, enabled: Item.enabled, ...body }); }
    catch (error) { return json(400, { error: error.message }); }
    const updated = { ...Item, ...config, revision: Item.revision + 1, updatedAt: new Date().toISOString() };
    try {
      await db.send(new PutCommand({ TableName: CONTROL_TABLE, Item: updated,
        ConditionExpression: 'attribute_exists(PK) AND revision = :revision', ExpressionAttributeValues: { ':revision': Item.revision },
      }));
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') return json(409, { error: 'Cấu hình vừa thay đổi; tải lại và thử lại' });
      throw error;
    }
    return json(200, { api: publicApi(updated) });
  }
  return json(405, { error: 'Method không được hỗ trợ' });
}
