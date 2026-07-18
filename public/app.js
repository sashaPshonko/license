const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'bpp_admin_key';

function token() {
  return (localStorage.getItem(STORAGE_KEY) || '').trim();
}

function setToken(v) {
  const t = String(v || '').trim();
  if (t) localStorage.setItem(STORAGE_KEY, t);
  else localStorage.removeItem(STORAGE_KEY);
}

function showGate(on) {
  $('gate')?.classList.toggle('hidden', !on);
  $('adminApp')?.classList.toggle('hidden', on);
}

function headers(json = true) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  const t = token();
  if (t) h['X-Admin-Token'] = t;
  return h;
}

function periodDays() {
  const v = Number($('periodDays')?.value);
  return Number.isFinite(v) ? v : 30;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...headers(Boolean(opts.body)), ...(opts.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    setToken('');
    showGate(true);
    throw new Error('нужен admin-ключ');
  }
  if (!res.ok) throw new Error(data.reason || res.statusText);
  return data;
}

function exportUrl(path) {
  const days = periodDays() || 30;
  const q = new URLSearchParams({ days: String(days || 30) });
  const t = token();
  if (t) q.set('token', t);
  return `${path}?${q}`;
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
  return k.length > 22 ? `${k.slice(0, 16)}…` : k;
}

function flash(msg, bad = false) {
  const el = $('flash');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('bad', bad);
  el.classList.remove('hidden');
  clearTimeout(flash._t);
  flash._t = setTimeout(() => el.classList.add('hidden'), 4000);
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
    opt.textContent = `${k.key_code} (${k.plan})${k.note ? ` · ${k.note}` : ''}`;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

/* tabs */
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === btn));
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('hidden', p.id !== `tab-${name}`);
    });
  });
});

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
    flash(`ключ ${data.key.key_code}`);
    refreshAll();
  } catch (err) {
    $('issueResult').textContent = `ошибка: ${err.message}`;
    flash(err.message, true);
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

async function refreshPurchases() {
  const data = await api('/v1/admin/keys');
  fillKeyFilter(data.keys);
  const keys = data.keys || [];
  const sales = keys.filter((k) => k.plan !== 'admin');
  const active = sales.filter(
    (k) => !k.revoked && k.expires_at && new Date(k.expires_at) > new Date(),
  );
  const pills = $('purchaseStats');
  if (pills) {
    pills.innerHTML = `
      <span class="pill">продаж: <b>${sales.length}</b></span>
      <span class="pill">активных: <b>${active.length}</b></span>
      <span class="pill">pro: <b>${sales.filter((k) => k.plan === 'pro').length}</b></span>
      <span class="pill">normal: <b>${sales.filter((k) => k.plan === 'normal').length}</b></span>
    `;
  }

  const ordered = [
    ...sales.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    ...keys.filter((k) => k.plan === 'admin'),
  ];

  const tb = $('purchasesTable').querySelector('tbody');
  tb.innerHTML = '';
  for (const k of ordered) {
    const alive =
      !k.revoked &&
      (k.plan === 'admin' || (k.expires_at && new Date(k.expires_at) > new Date()));
    const tr = document.createElement('tr');
    if (!alive) tr.classList.add('dim');
    tr.innerHTML = `
      <td>${fmtDate(k.created_at)}</td>
      <td><span class="plan-tag ${k.plan}">${k.plan}</span>${k.revoked ? ' <span class="bad">revoked</span>' : ''}</td>
      <td>${k.note ? escapeHtml(k.note) : '<span class="muted">—</span>'}</td>
      <td class="mono" title="${escapeHtml(k.key_code)}">${escapeHtml(k.key_code)}</td>
      <td>${k.plan === 'admin' ? '∞' : fmtDate(k.expires_at)}</td>
      <td>${k.launch_count || 0}</td>
      <td>${k.trade_count || 0}</td>
      <td class="${(k.net_profit || 0) >= 0 ? 'ok' : 'bad'}">${fmtMoney(k.net_profit)}</td>
      <td>${
        alive && !k.revoked && k.plan !== 'admin'
          ? `<button type="button" class="danger" data-revoke="${escapeHtml(k.key_code)}">revoke</button>`
          : ''
      }</td>`;
    tb.appendChild(tr);
  }
  tb.querySelectorAll('[data-revoke]').forEach((btn) => {
    btn.addEventListener('click', () => revokeKey(btn.getAttribute('data-revoke')));
  });
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function refreshItems() {
  const days = periodDays();
  const q = new URLSearchParams();
  if (days > 0) q.set('days', String(days));
  else q.set('days', '3650');
  const data = await api(`/v1/admin/items?${q}`);

  const tb = $('itemsTable').querySelector('tbody');
  tb.innerHTML = '';
  (data.items || []).forEach((r, i) => {
    const margin =
      r.avg_buy != null && r.avg_sell != null ? Number(r.avg_sell) - Number(r.avg_buy) : null;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="muted">${i + 1}</td>
      <td><strong>${escapeHtml(r.label)}</strong></td>
      <td class="mono muted">${escapeHtml(r.item_type) || '—'}</td>
      <td class="${r.net >= 0 ? 'ok' : 'bad'}"><strong>${fmtMoney(r.net)}</strong></td>
      <td>${r.buys || 0} / ${r.sells || 0}</td>
      <td>${r.keys_trading || 0}</td>
      <td>${r.avg_buy == null ? '—' : fmtMoney(r.avg_buy)}</td>
      <td>${r.avg_sell == null ? '—' : fmtMoney(r.avg_sell)}</td>
      <td class="${margin == null ? '' : margin >= 0 ? 'ok' : 'bad'}">${
        margin == null ? '—' : fmtMoney(margin)
      }</td>
      <td>${
        r.avg_integrity == null ? '—' : `${Math.round(Number(r.avg_integrity) * 100)}%`
      }</td>`;
    tb.appendChild(tr);
  });

  const kib = $('keyItemTable').querySelector('tbody');
  kib.innerHTML = '';
  for (const r of data.byKeyItem || []) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="mono" title="${escapeHtml(r.key_code)}">${shortKey(r.key_code)}</td>
      <td>${r.plan}</td>
      <td>${r.note ? escapeHtml(r.note) : '<span class="muted">—</span>'}</td>
      <td>${escapeHtml(r.label)}</td>
      <td class="${r.net >= 0 ? 'ok' : 'bad'}">${fmtMoney(r.net)}</td>
      <td>${r.avg_buy == null ? '—' : fmtMoney(r.avg_buy)}</td>
      <td>${r.avg_sell == null ? '—' : fmtMoney(r.avg_sell)}</td>
      <td>${r.trades || 0}</td>`;
    kib.appendChild(tr);
  }
}

async function refreshTrades() {
  const keyId = selectedKeyId();
  const q = new URLSearchParams({ limit: '150' });
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
      <td class="mono" title="${escapeHtml(t.key_code)}">${shortKey(t.key_code)}</td>
      <td>${t.side}</td>
      <td>${escapeHtml(t.label)}</td>
      <td class="mono muted">${escapeHtml(t.item_type) || '—'}</td>
      <td>${fmtMoney(t.price)}</td>
      <td>${t.integrity == null ? '—' : `${Math.round(Number(t.integrity) * 100)}%`}</td>
      <td>${t.anarchy ?? '—'}</td>
      <td class="muted">${escapeHtml(ench) || '—'}</td>`;
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
      <td class="mono" title="${escapeHtml(l.key_code)}">${shortKey(l.key_code)}</td>
      <td class="${l.ok ? 'ok' : 'bad'}">${l.ok ? 'ok' : 'fail'}</td>
      <td class="mono muted">${l.device_id ? String(l.device_id).slice(0, 12) : '—'}</td>
      <td class="muted">${escapeHtml(l.reason) || '—'}</td>`;
    tb.appendChild(tr);
  }
}

async function refreshAll() {
  try {
    await Promise.all([refreshPurchases(), refreshItems(), refreshTrades(), refreshLaunches()]);
  } catch (e) {
    console.warn(e);
    flash(`api: ${e.message}`, true);
    if ($('issueResult')) $('issueResult').textContent = `admin api: ${e.message}`;
  }
}

$('refreshAll')?.addEventListener('click', refreshAll);
$('periodDays')?.addEventListener('change', () => {
  void Promise.all([refreshItems()]);
});
$('profitKey')?.addEventListener('change', () => {
  void Promise.all([refreshTrades(), refreshLaunches()]);
});

async function tryUnlock(key) {
  const err = $('gateError');
  if (err) {
    err.classList.add('hidden');
    err.textContent = '';
  }
  const k = String(key || '').trim();
  if (!k) {
    if (err) {
      err.classList.remove('hidden');
      err.textContent = 'Введи admin-ключ';
    }
    return false;
  }
  try {
    const res = await fetch('/v1/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: k }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      if (err) {
        err.classList.remove('hidden');
        err.textContent = 'Неверный ключ (нужен plan=admin)';
      }
      return false;
    }
    setToken(k);
    if ($('adminWho')) $('adminWho').textContent = k;
    showGate(false);
    await refreshAll();
    return true;
  } catch (e) {
    if (err) {
      err.classList.remove('hidden');
      err.textContent = e.message || 'ошибка';
    }
    return false;
  }
}

$('gateUnlock')?.addEventListener('click', () => void tryUnlock($('gateKey')?.value));
$('gateKey')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void tryUnlock($('gateKey')?.value);
});
$('logoutBtn')?.addEventListener('click', () => {
  setToken('');
  showGate(true);
  if ($('gateKey')) $('gateKey').value = '';
});

(async function boot() {
  const saved = token();
  if (saved) {
    const ok = await tryUnlock(saved);
    if (!ok) showGate(true);
  } else {
    showGate(true);
  }
})();

setInterval(() => {
  if (token()) void refreshAll();
}, 20000);

function downloadHref(path) {
  window.location.href = exportUrl(path);
}

$('dlMd')?.addEventListener('click', () => downloadHref('/v1/admin/export/analysis.md'));
$('dlJson')?.addEventListener('click', () => downloadHref('/v1/admin/export/analysis.json'));
$('dlDb')?.addEventListener('click', () => {
  const t = token();
  const q = t ? `?token=${encodeURIComponent(t)}` : '';
  window.location.href = `/v1/admin/export/db${q}`;
});

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('копирование недоступно');
}

$('copyMd')?.addEventListener('click', async () => {
  try {
    const res = await fetch(exportUrl('/v1/admin/export/analysis.md'), {
      headers: headers(false),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || res.statusText);
    await copyText(text);
    $('exportPreview').textContent = text.slice(0, 4000) + (text.length > 4000 ? '\n…' : '');
    flash('analysis.md скопирован — вставь в Cursor');
  } catch (e) {
    flash(e.message, true);
  }
});

