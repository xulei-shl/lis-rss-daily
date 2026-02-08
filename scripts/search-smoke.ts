/**
 * 搜索接口冒烟测试
 * 依赖服务已启动，并存在可登录用户
 */

export {};

const baseUrl = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const username = process.env.SEARCH_TEST_USERNAME || process.env.USERNAME;
const password = process.env.SEARCH_TEST_PASSWORD || process.env.PASSWORD;
const query = process.env.SEARCH_TEST_QUERY || '测试';

if (!username || !password) {
  throw new Error('缺少用户名或密码，请设置 SEARCH_TEST_USERNAME / SEARCH_TEST_PASSWORD');
}

const loginResponse = await fetch(`${baseUrl}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
});

if (!loginResponse.ok) {
  const text = await loginResponse.text();
  throw new Error(`登录失败：${loginResponse.status} ${text}`);
}

const setCookie = loginResponse.headers.get('set-cookie');
if (!setCookie) {
  throw new Error('登录响应未返回 cookie');
}

const cookie = setCookie.split(';')[0];
const searchUrl = `${baseUrl}/api/search?q=${encodeURIComponent(query)}`;

const searchResponse = await fetch(searchUrl, {
  headers: { cookie },
});

if (!searchResponse.ok) {
  const text = await searchResponse.text();
  throw new Error(`搜索失败：${searchResponse.status} ${text}`);
}

const data = await searchResponse.json();
if (data.mode !== 'mixed') {
  throw new Error(`搜索模式异常：期望 mixed，实际 ${data.mode}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      mode: data.mode,
      total: data.total,
      results: Array.isArray(data.results) ? data.results.length : 0,
    },
    null,
    2
  )
);
