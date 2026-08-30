const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ hostname: '127.0.0.1', port: 3000, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: 3000, path, headers }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const reg = await post('/api/auth/register', { name: 'Advogado Teste', email: 'adv@teste.com', password: 'senha1234' });
  console.log('register:', reg.status, reg.body?.user?.name);

  const login = await post('/api/auth/login', { email: 'adv@teste.com', password: 'senha1234' });
  console.log('login:', login.status, login.body?.user?.name);
  const cookie = login.headers['set-cookie']?.[0]?.split(';')[0];
  console.log('cookie:', cookie?.slice(0, 30) + '...');

  const org = await post('/api/organizations', { name: 'Meu Escritório' }, { Cookie: cookie });
  console.log('org:', org.status, org.body?.id?.slice(0, 8) + '...');

  const me = await get('/api/auth/me', { Cookie: cookie });
  console.log('me:', me.status, me.body?.user?.name);

  console.log('\nAll endpoints OK!');
}

main().catch(console.error);