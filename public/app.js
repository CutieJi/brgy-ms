let token = sessionStorage.getItem('tok'), tab = 'dashboard', rows = [], editing = null, residents = [];
const $ = s => document.querySelector(s);

async function api(path, method = 'GET', body) {
  const r = await fetch('/api/' + path, {
    method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (r.status === 401) return logout();
  if (!r.ok) { alert(d.error); throw new Error(d.error); }
  return d;
}

// Field config per module: [key, label, type, options]
const T = {
  residents: {
    cols: ['last_name', 'first_name', 'sex', 'purok', 'contact', 'voter'],
    fields: [['last_name', 'Last name'], ['first_name', 'First name'], ['middle_name', 'Middle name'],
      ['birthdate', 'Birthdate', 'date'], ['sex', 'Sex', 'select', ['Male', 'Female']],
      ['civil_status', 'Civil status', 'select', ['Single', 'Married', 'Widowed', 'Separated']],
      ['purok', 'Purok'], ['address', 'Address'], ['contact', 'Contact no.'],
      ['voter', 'Registered voter', 'select', ['false', 'true']]],
  },
  certificates: {
    cols: ['resident', 'type', 'purpose', 'status', 'created_at'],
    fields: [['resident_id', 'Resident', 'resident'],
      ['type', 'Type', 'select', ['Barangay Clearance', 'Certificate of Indigency', 'Certificate of Residency']],
      ['purpose', 'Purpose'], ['status', 'Status', 'select', ['Pending', 'Released', 'Rejected']]],
  },
  blotters: {
    cols: ['complainant', 'respondent', 'incident', 'incident_date', 'status'],
    fields: [['complainant', 'Complainant'], ['respondent', 'Respondent'], ['incident', 'Incident details', 'textarea'],
      ['incident_date', 'Date', 'date'], ['status', 'Status', 'select', ['Open', 'Settled', 'Escalated']]],
  },
};

// Login
$('#loginForm').onsubmit = async e => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
  const d = await r.json();
  if (!r.ok) return ($('#loginErr').textContent = d.error);
  token = d.token; sessionStorage.setItem('tok', token); start();
};
function logout() { sessionStorage.clear(); location.reload(); }
$('#logout').onclick = logout;

function start() {
  $('#login').hidden = true; $('#app').hidden = false; load();
}

document.querySelectorAll('nav a').forEach(a => a.onclick = () => {
  document.querySelectorAll('nav a').forEach(x => x.classList.remove('on'));
  a.classList.add('on'); tab = a.dataset.tab; $('#search').value = ''; load();
});

const name = r => r ? `${r.first_name} ${r.last_name}` : '';
const label = s => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

async function load() {
  $('#title').textContent = label(tab === 'blotters' ? 'blotter' : tab);
  const isDash = tab === 'dashboard';
  $('#stats').hidden = !isDash; $('#table').parentElement.hidden = isDash;
  $('#addBtn').hidden = isDash; $('#search').hidden = isDash;
  if (isDash) {
    const s = await api('stats');
    $('#stats').innerHTML = [['Residents', s.residents], ['Registered voters', s.voters],
      ['Pending certificates', s.pending], ['Open blotter cases', s.openBlotters]]
      .map(([l, n]) => `<div class="stat"><b>${n}</b><span>${l}</span></div>`).join('');
    return;
  }
  rows = await api(tab);
  render();
}

function render() {
  const q = $('#search').value.toLowerCase();
  const cols = T[tab].cols;
  const data = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q));
  if (!data.length) return ($('#table').innerHTML = '<tr><td class="empty">No records yet. Use "Add record" to create one.</td></tr>');
  const cell = (r, c) => c === 'resident' ? name(r.residents) : c === 'created_at' ? r[c].slice(0, 10) : r[c] ?? '';
  $('#table').innerHTML = `<tr>${cols.map(c => `<th>${label(c)}</th>`).join('')}<th>Actions</th></tr>` +
    data.map(r => `<tr>${cols.map(c => `<td>${cell(r, c)}</td>`).join('')}<td>
      ${tab === 'certificates' ? `<button class="sm" onclick="printCert(${r.id})">Print</button>` : ''}
      <button class="sm" onclick="openForm(${r.id})">Edit</button>
      <button class="sm danger" onclick="del(${r.id})">Delete</button></td></tr>`).join('');
}
$('#search').oninput = render;

async function openForm(id) {
  editing = id ? rows.find(r => r.id === id) : null;
  if (tab === 'certificates') residents = await api('residents');
  $('#dlgTitle').textContent = (editing ? 'Edit ' : 'New ') + label(tab).replace(/s$/, '');
  $('#fields').innerHTML = T[tab].fields.map(([k, l, type, opts]) => {
    const v = editing ? editing[k] ?? '' : '';
    let input;
    if (type === 'select') input = `<select name="${k}">${opts.map(o => `<option ${String(v) === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    else if (type === 'resident') input = `<select name="${k}" required>${residents.map(r => `<option value="${r.id}" ${v == r.id ? 'selected' : ''}>${r.last_name}, ${r.first_name}</option>`).join('')}</select>`;
    else if (type === 'textarea') input = `<textarea name="${k}" rows="3" required>${v}</textarea>`;
    else input = `<input name="${k}" type="${type || 'text'}" value="${v}" ${/^(last|first)_name|complainant$/.test(k) ? 'required' : ''}>`;
    return `<label>${l}${input}</label>`;
  }).join('');
  $('#dlg').showModal();
}
$('#addBtn').onclick = () => openForm();
$('#cancel').onclick = () => $('#dlg').close();

$('#form').onsubmit = async e => {
  const body = Object.fromEntries(new FormData(e.target));
  for (const k in body) if (body[k] === '') body[k] = null;
  if (body.voter) body.voter = body.voter === 'true';
  editing ? await api(`${tab}/${editing.id}`, 'PUT', body) : await api(tab, 'POST', body);
  load();
};

async function del(id) {
  if (confirm('Delete this record? This cannot be undone.')) { await api(`${tab}/${id}`, 'DELETE'); load(); }
}

function printCert(id) {
  const c = rows.find(r => r.id === id), r = c.residents;
  const today = new Date().toLocaleDateString('en-PH', { dateStyle: 'long' });
  const w = window.open('', '_blank');
  w.document.write(`<body style="font-family:Georgia,serif;padding:60px;max-width:700px;margin:auto;line-height:1.8">
    <p style="text-align:center">Republic of the Philippines<br><b>BARANGAY ______________</b><br>Office of the Punong Barangay</p>
    <h2 style="text-align:center;margin:40px 0">${c.type.toUpperCase()}</h2>
    <p>TO WHOM IT MAY CONCERN:</p>
    <p style="text-indent:40px">This is to certify that <b>${name(r)}</b>, ${r.civil_status || ''}, a resident of ${r.address || ''}${r.purok ? ', ' + r.purok : ''}, is known to this office${c.type === 'Certificate of Indigency' ? ' to belong to an indigent family' : c.type === 'Barangay Clearance' ? ' to have no derogatory record on file' : ' to be a bona fide resident of this barangay'}.</p>
    <p style="text-indent:40px">This certification is issued upon request for <b>${c.purpose || 'whatever legal purpose it may serve'}</b>.</p>
    <p>Issued this ${today}.</p>
    <p style="margin-top:80px;text-align:right"><b>______________________</b><br>Punong Barangay</p>
    <script>print()<\/script></body>`);
}

if (token) start();
