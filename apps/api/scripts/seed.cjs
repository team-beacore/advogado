const { randomBytes, scryptSync } = require('node:crypto');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL || 'postgres://advogado:advogado@127.0.0.1:54329/advogado' });

function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 16384, r: 8 });
  return `scrypt$$16384$$8$$${salt.toString('base64')}$$${derived.toString('base64')}`;
}

async function main() {
  const scenario = process.argv[2] || 'solo';
  console.log(`Seed: cenário ${scenario}`);

  const passwordHash = hashPassword('12345678');

  if (scenario === 'solo') {
    // 1. Criar usuário
    const userRes = await pool.query(
      `INSERT INTO users (name, email, password_hash, phone) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      ['João Silva', 'joao.solo@example.com', passwordHash, '5521999990001'],
    );
    const userId = userRes.rows[0].id;

    // 2. Criar organização
    const orgRes = await pool.query(
      `INSERT INTO organizations (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`,
      ['João Silva Advocacia'],
    );
    let orgId = orgRes.rows[0]?.id;
    if (!orgId) {
      const existing = await pool.query(`SELECT id FROM organizations WHERE name = 'João Silva Advocacia'`);
      orgId = existing.rows[0]?.id;
    }
    if (orgId) {
      await pool.query(
        `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'ADMIN') ON CONFLICT DO NOTHING`,
        [orgId, userId],
      );
    }

    // 3. Criar clientes
    const clients = [
      { name: 'André Santos', email: 'andre@example.com', phone: '5521999990002' },
      { name: 'Maria Costa', email: 'maria@example.com', phone: '5521999990003' },
      { name: 'Carlos Pereira', email: 'carlos@example.com', phone: '5521999990004' },
    ];
    for (const c of clients) {
      await pool.query(
        `INSERT INTO clients (organization_id, name, email, phone) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [orgId, c.name, c.email, c.phone],
      );
    }

    // 4. Criar processos
    const clientRes = await pool.query('SELECT id, name FROM clients WHERE organization_id = $1 LIMIT 3', [orgId]);
    for (const client of clientRes.rows) {
      await pool.query(
        `INSERT INTO cases (organization_id, client_id, title, status, responsible_id) VALUES ($1, $2, $3, 'ACTIVE', $4) ON CONFLICT DO NOTHING`,
        [orgId, client.id, `Processo de ${client.name}`, userId],
      );
    }

    console.log(`Solo seed: 1 usuário, 1 organização, 3 clientes, 3 processos`);
  }

  if (scenario === 'escritorio') {
    // 1. Criar usuários
    const users = [
      { name: 'João Admin', email: 'joao.admin@example.com', phone: '5521999990010', role: 'ADMIN' },
      { name: 'Maria Advogada', email: 'maria.lawyer@example.com', phone: '5521999990011', role: 'LAWYER' },
      { name: 'Ana Assistente', email: 'ana.assistant@example.com', phone: '5521999990012', role: 'ASSISTANT' },
      { name: 'Carlos Financeiro', email: 'carlos.finance@example.com', phone: '5521999990013', role: 'FINANCE' },
    ];
    const createdUsers = [];
    for (const u of users) {
      const res = await pool.query(
        `INSERT INTO users (name, email, password_hash, phone) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [u.name, u.email, passwordHash, u.phone],
      );
      createdUsers.push({ ...u, id: res.rows[0].id });
    }

    // 2. Criar organização
    const orgRes = await pool.query(
      `INSERT INTO organizations (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id`,
      ['Silva & Associados'],
    );
    let orgId = orgRes.rows[0]?.id;
    if (!orgId) {
      const existing = await pool.query(`SELECT id FROM organizations WHERE name = 'Silva & Associados'`);
      orgId = existing.rows[0]?.id;
    }
    if (orgId) {
      for (const u of createdUsers) {
        await pool.query(
          `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [orgId, u.id, u.role],
        );
      }
    }

    // 3. Criar clientes
    const clients = [
      { name: 'André Santos', email: 'andre@example.com', phone: '5521999990020' },
      { name: 'Maria Costa', email: 'maria@example.com', phone: '5521999990021' },
      { name: 'Pedro Alves', email: 'pedro@example.com', phone: '5521999990022' },
    ];
    const clientIds = [];
    for (const c of clients) {
      const res = await pool.query(
        `INSERT INTO clients (organization_id, name, email, phone) VALUES ($1, $2, $3, $4) ON CONFLICT (email, organization_id) DO NOTHING RETURNING id`,
        [orgId, c.name, c.email, c.phone],
      );
      if (res.rows.length > 0) clientIds.push(res.rows[0]);
    }

    // 4. Criar processos distribuídos
    const allClients = await pool.query('SELECT id, name FROM clients WHERE organization_id = $1', [orgId]);
    const lawyers = createdUsers.filter(u => u.role === 'ADMIN' || u.role === 'LAWYER');
    const processNames = ['Processo Indenização', 'Processo Trabalhista', 'Processo Civil', 'Processo Família'];
    for (let i = 0; i < processNames.length; i++) {
      const client = allClients.rows[i % allClients.rows.length];
      const lawyer = lawyers[i % lawyers.length];
      const caseRes = await pool.query(
        `INSERT INTO cases (organization_id, client_id, title, status, responsible_id) VALUES ($1, $2, $3, 'ACTIVE', $4) RETURNING id`,
        [orgId, client.id, processNames[i], lawyer.id],
      );
      // Adicionar admin e criador como membros
      await pool.query(
        `INSERT INTO case_members (case_id, user_id, role, can_view, can_edit, can_manage) VALUES ($1, $2, 'ADMIN', TRUE, TRUE, TRUE) ON CONFLICT DO NOTHING`,
        [caseRes.rows[0].id, createdUsers[0].id],
      );
    }

    console.log(`Escritório seed: ${createdUsers.length} usuários, 1 organização, ${allClients.rows.length} clientes, ${processNames.length} processos`);
  }

  await pool.end();
  console.log('Seed concluído.');
}

main().catch((e) => {
  console.error('Seed falhou:', e.message);
  process.exit(1);
});