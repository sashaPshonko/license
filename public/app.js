const $ = (id) => document.getElementById(id);

function token() {
  return ($('adminToken').value || localStorage.getItem('bpp_admin_token') || '').trim();
}

$('adminToken').value = localStorage.getItem('bpp_admin_token') || '';
$('adminToken').addEventListener('change', () => {
  localStorage.setItem('bpp_admin_token', $('adminToken').value.trim());
  refreshAll();
});

function headers(json = true) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  const t = token();
  if (t) h['X-Admin-Token'] = t;
  return h;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...headers(Boolean(opts.body)), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.reason || res.statusText);
  return data;
}

function fmtMoney(n) {
  const x = Number(n) || 0;
  return x.toLocaleString('ru-RU');
}

function fmtDate(iso) {
  if (!iso) return '∞';
  try {
    return new Date(iso).toLocaleString('ru-RU');
  } catch {
    return iso;
  }
}

function shortKey(k) {
  if (!k) return '—';
  return k.length > 18 ? `${k.slice(0, 14)}…` : k;
}

function selectedKeyId() {
  const v = $('profitKey')?.value;
  return v ? Number(v) : null;
}

function fillKeyFilter(keys) {
  const sel = $('profitKey');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">все</option>';
  for (const k of keys || []) {
    const opt = document.createElement('option');
    opt.value = String(k.id);
    opt.textContent = `${k.key_code} (${k.plan})`;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

$('issueForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const plan = $('plan').value;
  const days = Number($('days').value);
  const note = $('note').value.trim();
  try {
    const data = await api('/v1/admin/keys', {
      method: 'POST',
      body: JSON.stringify({ plan, days, note }),
    });
    $('issueResult').textContent = `создан: ${data.key.key_code}`;
    $('note').value = '';
    refreshAll();
  } catch (err) {
    $('issueResult').textContent = `ошибка: ${err.message}`;
  }
});

$('plan').addEventListener('change', () => {
  $('days').disabled = $('plan').value === 'admin';
});

async function revokeKey(keyCode) {
  if (!confirm(`Отозвать ${keyCode}?`)) return;
  await api('/v1/admin/keys/revoke', {
    method: 'POST',
    body: JSON.stringify({ key: keyCode }),
  });
  refreshAll();
}

async function refreshKeys() {
  const data = await api('/v1/admin/keys');
  fillKeyFilter(data.keys);
  const tb = $('keysTable').querySelector('tbody');
  tb.innerHTML = '';
  for (const k of data.keys || []) {
    const tr = document.createElement('tr');
    const active =
      !k.revoked &&
      (k.plan === 'admin' || (k.expires_at && new Date(k.expires_at) > new Date()));
    tr.innerHTML = `
      <td class="mono" title="${k.key_code}">${k.key_code}</td>
      <td>${k.plan}${k.revoked ? ' <span class="bad">revoked</span>' : ''}</td>
      <td>${k.plan === 'admin' ? '∞' : fmtDate(k.expires_at)}</td>
      <td>${k.active_sessions || 0}</td>
      <td>${k.launch_count || 0}</td>
      <td class="${(k.net_profit || 0) >= 0 ? 'ok' : 'bad'}">${fmtMoney(k.net_profit)}</td>
      <td>${
        active && !k.revoked
          ? `<button type="button" class="danger" data-revoke="${k.key_code}">revoke</button>`
          : ''
      }</td>
    `;
    tb.appendChild(tr);
  }
  tb.querySelectorAll('[data-revoke]').forEach((btn) => {
    btn.addEventListener('click', () => revokeKey(btn.getAttribute('data-revoke')));
  });
}

async function refreshProfit() {
  const days = Number($('profitDays').value) || 14;
  const keyId = selectedKeyId();
  const q = new URLSearchParams({ days: String(days) });
  if (keyId) q.set('keyId', String(keyId));
  const data = await api(`/v1/admin/profit?${q}`);

  const keyTb = $('keyProfitTable')?.querySelector('tbody');
  if (keyTb) {
    keyTb.innerHTML = '';
    for (const r of data.byKey || []) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="mono" title="${r.key_code}">${r.key_code}</td>
        <td>${r.plan}</td>
        <td>${r.trades}</td>
        <td>${fmtMoney(r.bought)}</td>
        <td>${fmtMoney(r.sold)}</td>
        <td class="${r.net >= 0 ? 'ok' : 'bad'}">${fmtMoney(r.net)}</td>`;
      keyTb.appendChild(tr);
    }
  }

  const dayTb = $('dayTable').querySelector('tbody');
  dayTb.innerHTML = '';
  for (const r of data.byDay || []) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.day}</td>
      <td>${r.trades}</td>
      <td>${fmtMoney(r.bought)}</td>
      <td>${fmtMoney(r.sold)}</td>
      <td class="${r.net >= 0 ? 'ok' : 'bad'}">${fmtMoney(r.net)}</td>`;
    dayTb.appendChild(tr);
  }

  const labelTb = $('labelTable').querySelector('tbody');
  labelTb.innerHTML = '';
  for (const r of data.byLabel || []) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.label}</td>
      <td>${r.buys || 0}</td>
      <td>${r.sells || 0}</td>
      <td>${fmtMoney(r.bought)}</td>
      <td>${fmtMoney(r.sold)}</td>
      <td class="${r.net >= 0 ? 'ok' : 'bad'}">${fmtMoney(r.net)}</td>`;
    labelTb.appendChild(tr);
  }
}

async function refreshTrades() {
  const keyId = selectedKeyId();
  const q = new URLSearchParams({ limit: '100' });
  if (keyId) q.set('keyId', String(keyId));
  const data = await api(`/v1/admin/trades?${q}`);
  const tb = $('tradesTable').querySelector('tbody');
  tb.innerHTML = '';
  for (const t of data.trades || []) {
    let ench = '';
    try {
      const arr = JSON.parse(t.enchants_json || '[]');
      ench = arr
        .map((e) => `${String(e.name || '').replace('minecraft:', '')} ${e.lvl ?? ''}`)
        .join(', ');
    } catch {
      ench = '';
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtDate(t.ts)}</td>
      <td class="mono" title="${t.key_code}">${shortKey(t.key_code)}</td>
      <td>${t.side}</td>
      <td>${t.label}</td>
      <td class="mono muted">${t.item_type || '—'}</td>
      <td>${fmtMoney(t.price)}</td>
      <td>${t.integrity == null ? '—' : `${Math.round(Number(t.integrity) * 100)}%`}</td>
      <td>${t.anarchy ?? '—'}</td>
      <td class="muted">${ench || '—'}</td>`;
    tb.appendChild(tr);
  }
}

async function refreshLaunches() {
  const keyId = selectedKeyId();
  const q = keyId ? `?keyId=${keyId}` : '';
  const data = await api(`/v1/admin/launches${q}`);
  const tb = $('launchesTable').querySelector('tbody');
  tb.innerHTML = '';
  for (const l of data.launches || []) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${fmtDate(l.at)}</td>
      <td class="mono" title="${l.key_code}">${shortKey(l.key_code)}</td>
      <td class="${l.ok ? 'ok' : 'bad'}">${l.ok ? 'ok' : 'fail'}</td>
      <td class="mono muted">${l.device_id ? String(l.device_id).slice(0, 12) : '—'}</td>
      <td class="muted">${l.reason || '—'}</td>`;
    tb.appendChild(tr);
  }
}

async function refreshAll() {
  try {
    await Promise.all([refreshKeys(), refreshProfit(), refreshTrades(), refreshLaunches()]);
  } catch (e) {
    console.warn(e);
    $('issueResult').textContent = `admin api: ${e.message}`;
  }
}

$('refreshKeys').addEventListener('click', refreshAll);
$('profitDays').addEventListener('change', refreshProfit);
$('profitKey')?.addEventListener('change', () => {
  void Promise.all([refreshProfit(), refreshTrades(), refreshLaunches()]);
});

refreshAll();
setInterval(refreshAll, 15000);
