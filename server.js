require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const app = express();
app.use(express.json());
app.use(express.static('public'));

// Login via Supabase Auth
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: 'Wrong email or password' });
  res.json({ token: data.session.access_token });
});

// Require a valid token for everything below
app.use('/api', async (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Please sign in' });
  next();
});

// Generic CRUD for each table
const tables = {
  residents: 'last_name',
  certificates: 'created_at',
  blotters: 'created_at',
};
const select = {
  residents: '*',
  certificates: '*, residents(first_name,last_name,address,purok,birthdate,civil_status)',
  blotters: '*',
};

for (const [t, order] of Object.entries(tables)) {
  app.get(`/api/${t}`, async (req, res) => {
    const { data, error } = await db.from(t).select(select[t]).order(order, { ascending: t === 'residents' });
    error ? res.status(400).json({ error: error.message }) : res.json(data);
  });
  app.post(`/api/${t}`, async (req, res) => {
    const { data, error } = await db.from(t).insert(req.body).select().single();
    error ? res.status(400).json({ error: error.message }) : res.json(data);
  });
  app.put(`/api/${t}/:id`, async (req, res) => {
    const { data, error } = await db.from(t).update(req.body).eq('id', req.params.id).select().single();
    error ? res.status(400).json({ error: error.message }) : res.json(data);
  });
  app.delete(`/api/${t}/:id`, async (req, res) => {
    const { error } = await db.from(t).delete().eq('id', req.params.id);
    error ? res.status(400).json({ error: error.message }) : res.json({ ok: true });
  });
}

app.get('/api/stats', async (req, res) => {
  const count = async (t, f) => {
    let q = db.from(t).select('*', { count: 'exact', head: true });
    if (f) q = q.eq(f[0], f[1]);
    return (await q).count || 0;
  };
  res.json({
    residents: await count('residents'),
    voters: await count('residents', ['voter', true]),
    pending: await count('certificates', ['status', 'Pending']),
    openBlotters: await count('blotters', ['status', 'Open']),
  });
});

app.listen(process.env.PORT || 3000, () => console.log('Running on http://localhost:' + (process.env.PORT || 3000)));
