/* taskbridge-mcp admin console.
   Plain JS, no dependencies; talks only to same-origin /admin/api. */
'use strict';

(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  // ---------- theme ----------

  const THEME_KEY = 'tb-theme';

  function applyTheme(mode) {
    document.documentElement.dataset.theme = mode;
  }

  applyTheme(
    localStorage.getItem(THEME_KEY) ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
  );

  $('#theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  });

  // ---------- toast ----------

  const toast = $('#toast') || document.createElement('div');
  let toastTimer = 0;

  function notify(message, level = 'info') {
    toast.textContent = message;
    toast.dataset.level = level;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
  }

  // ---------- api ----------

  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    if (res.status === 401) {
      location.href = '/admin/login';
      throw new Error('unauthorized');
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        detail = (await res.json()).error || detail;
      } catch { /* non-JSON body */
      }
      throw new Error(detail);
    }
    return res.json();
  }

  // ---------- status rendering ----------

  const CAP_LABELS = [
    ['manageLists', '管理列表'],
    ['subtasks', '子任务'],
    ['moveTasks', '移动任务'],
    ['clearCompleted', '清理已完成'],
  ];

  function setChip(card, provider) {
    const chip = $('[data-role="status"]', card);
    if (!chip) return;
    if (provider.connected) {
      chip.textContent = '已连接';
      chip.dataset.state = 'connected';
    } else if (provider.clientConfigured) {
      chip.textContent = '待授权';
      chip.dataset.state = 'ready';
    } else {
      chip.textContent = '未配置';
      delete chip.dataset.state;
    }
  }

  function renderCaps(card, provider) {
    let row = $('.cap-chips', card);
    if (!row) {
      row = document.createElement('div');
      row.className = 'cap-chips';
      card.querySelector('.provider-desc')?.after(row);
    }
    row.replaceChildren(
      ...CAP_LABELS.map(([key, label]) => {
        const s = document.createElement('span');
        s.textContent = label;
        if (provider.capabilities?.[key]) s.classList.add('on');
        return s;
      }),
    );
  }

  function fmtUptime(sec) {
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return (d ? `${d}天 ` : '') + (d || h ? `${h}时 ` : '') + `${m}分 ${s}秒`;
  }

  function renderStatus(st) {
    for (const p of st.providers || []) {
      const card = $(`[data-provider="${p.id}"]`);
      if (!card) continue;
      setChip(card, p);
      renderCaps(card, p);
    }

    const m = {
      uptime: st.uptimeSeconds != null ? fmtUptime(st.uptimeSeconds) : '—',
      rss: st.process ? `${st.process.rssMb} MB` : '—',
      heap: st.process ? `${st.process.heapUsedMb} / ${st.process.heapTotalMb} MB` : '—',
      cpu: st.process ? `${st.process.cpuPercent}%` : '—',
      load: st.process ? String(st.process.loadAvg1) : '—',
      node: st.process?.node ?? '—',
      platform: st.process?.platform ?? '—',
      baseurl: st.publicBaseUrl ?? '—',
    };
    for (const [key, val] of Object.entries(m)) {
      const el = $(`[data-metric="${key}"]`);
      if (el) el.textContent = val;
    }

    const note = $('[data-role="callback-note"]');
    if (note && st.publicBaseUrl) {
      note.textContent = `${st.publicBaseUrl}/oauth/mstodo/callback`;
    }

    renderProxy(st.proxy);
  }

  async function refresh() {
    try {
      renderStatus(await api('/admin/api/status'));
    } catch (err) {
      if (err.message !== 'unauthorized') notify(`刷新失败：${err.message}`, 'error');
    }
  }

  // ---------- provider cards ----------

  for (const card of document.querySelectorAll('[data-provider]')) {
    const id = card.dataset.provider;
    const form = $('[data-role="cred-form"]', card);
    const hint = $('[data-role="hint"]', card);
    const setHint = (msg, level) => {
      if (!hint) return;
      hint.textContent = msg;
      if (level) hint.dataset.level = level;
      else delete hint.dataset.level;
    };

    const readForm = () => ({
      clientId: form.clientId ? form.clientId.value.trim() : '',
      clientSecret: form.clientSecret ? form.clientSecret.value.trim() : '',
    });

    async function saveCredentials() {
      const { clientId, clientSecret } = readForm();
      // Empty clientId clears the GUI override; the built-in id applies again.
      await api(`/admin/api/providers/${id}/credentials`, {
        method: 'POST',
        body: JSON.stringify({ ...(clientId ? { clientId } : {}), clientSecret: clientSecret || undefined }),
      });
      if (form.clientSecret) form.clientSecret.value = '';
      await refresh();
    }

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('[data-role="save-cred"]', card);
      btn.disabled = true;
      try {
        await saveCredentials();
        setHint('凭据已保存', 'ok');
        notify('凭据已保存', 'ok');
      } catch (err) {
        setHint(`保存失败：${err.message}`, 'error');
      } finally {
        btn.disabled = false;
      }
    });

    // Headless flow: paste the localhost callback URL from another machine.
    $('[data-role="paste-form"]', card)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const out = await api(`/admin/api/providers/${id}/callback`, {
          method: 'POST',
          body: JSON.stringify({ url: e.target.callbackUrl.value.trim() }),
        });
        if (!out.ok) throw new Error(out.message);
        e.target.callbackUrl.value = '';
        setHint('连接成功', 'ok');
        notify(`${card.querySelector('h3').textContent} 已连接`, 'ok');
        await refresh();
      } catch (err) {
        setHint(`粘贴连接失败:${err.message.replace(/^error:\s*/, '')}`, 'error');
      } finally {
        btn.disabled = false;
      }
    });

    $('[data-role="connect"]', card)?.addEventListener('click', async () => {
      const btn = $('[data-role="connect"]', card);
      btn.disabled = true;
      try {
        // Save whatever is in the form first so the just-typed id is used.
        if (readForm().clientId) await saveCredentials();
        const st = await api('/admin/api/status');
        const p = st.providers?.find((x) => x.id === id);
        if (!p?.clientConfigured) {
          setHint('缺少 Client ID：填写并保存后再连接', 'error');
          btn.disabled = false;
          return;
        }
        location.href = `/admin/oauth/${id}/start`;
      } catch (err) {
        setHint(`无法开始授权：${err.message}`, 'error');
        btn.disabled = false;
      }
    });

    $('[data-role="disconnect"]', card)?.addEventListener('click', async () => {
      if (!confirm('确定断开该账户？已保存的令牌将被删除。')) return;
      try {
        await api(`/admin/api/providers/${id}/disconnect`, { method: 'POST' });
        setHint('已断开');
        notify('已断开账户', 'ok');
        await refresh();
      } catch (err) {
        notify(`断开失败：${err.message}`, 'error');
      }
    });
  }

  // ---------- proxy ----------

  const proxyForm = $('[data-role="proxy-form"]');

  function renderProxy(status) {
    const cur = $('[data-role="proxy-current"]');
    const src = $('[data-role="proxy-source"]');
    if (!cur || !src) return;
    if (status?.active) {
      cur.textContent = status.maskedUrl;
      src.textContent = status.source === 'config' ? '界面配置' : '环境变量';
    } else {
      cur.textContent = '未启用（直连）';
      src.textContent = '—';
    }
  }

  function renderProxyResults(results) {
    const list = $('[data-role="proxy-results"]');
    if (!list) return;
    list.replaceChildren(
      ...(results || []).map((r) => {
        const li = document.createElement('li');
        li.dataset.ok = r.ok ? 'ok' : 'err';
        li.textContent = r.ok
          ? `${r.target}：可达（HTTP ${r.status}，${r.ms}ms）`
          : `${r.target}：不可达（${(r.error || '').slice(0, 90)}）`;
        return li;
      }),
    );
    list.removeAttribute('hidden');
  }

  proxyForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = proxyForm.proxyUrl;
    const value = input.value.trim();
    if (!value) {
      notify('地址为空；若要停用代理请点「清除」', 'error');
      return;
    }
    try {
      const st = await api('/admin/api/proxy', {
        method: 'POST',
        body: JSON.stringify({ proxyUrl: value }),
      });
      renderProxy(st);
      notify('代理已保存，对 provider 的请求即刻生效', 'ok');
    } catch (err) {
      notify(`保存失败：${err.message}`, 'error');
    }
  });

  $('[data-role="proxy-test"]')?.addEventListener('click', async () => {
    const btn = $('[data-role="proxy-test"]');
    const value = proxyForm?.proxyUrl?.value.trim();
    const hint = $('[data-role="proxy-hint"]');
    btn.disabled = true;
    if (hint) hint.textContent = '测试中…';
    try {
      // Test the unsaved input when present, otherwise the active proxy.
      const { results } = await api('/admin/api/proxy/test', {
        method: 'POST',
        body: JSON.stringify(value ? { proxyUrl: value } : {}),
      });
      renderProxyResults(results);
      if (hint) hint.textContent = '';
      const allOk = (results || []).length > 0 && results.every((r) => r.ok);
      notify(allOk ? '两个后端均可达' : '存在不可达的后端，见下方结果', allOk ? 'ok' : 'error');
    } catch (err) {
      if (hint) hint.textContent = '';
      notify(`测试失败：${err.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  $('[data-role="proxy-clear"]')?.addEventListener('click', async () => {
    try {
      const st = await api('/admin/api/proxy', {
        method: 'POST',
        body: JSON.stringify({ proxyUrl: null }),
      });
      if (proxyForm) proxyForm.proxyUrl.value = '';
      $('[data-role="proxy-results"]')?.setAttribute('hidden', '');
      renderProxy(st);
      notify('已清除界面配置的代理', 'ok');
    } catch (err) {
      notify(`清除失败：${err.message}`, 'error');
    }
  });

  // ---------- token ----------

  $('[data-role="rotate-token"]')?.addEventListener('click', async () => {
    if (!confirm('生成新令牌后旧令牌立即失效，继续？')) return;
    try {
      const { token } = await api('/admin/api/token/rotate', { method: 'POST' });
      const code = $('[data-role="token-value"]');
      if (code) code.textContent = token;
      $('[data-role="token-result"]')?.removeAttribute('hidden');
      notify('新令牌已生成，请立即保存', 'ok');
    } catch (err) {
      notify(`轮换失败：${err.message}`, 'error');
    }
  });

  $('[data-role="copy-token"]')?.addEventListener('click', async () => {
    const text = $('[data-role="token-value"]')?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(text);
      notify('已复制到剪贴板', 'ok');
    } catch {
      notify('复制失败，请手动选择复制', 'error');
    }
  });

  // ---------- misc ----------

  $('[data-role="refresh"]')?.addEventListener('click', refresh);

  // OAuth callback lands on /admin?oauth=<result>; surface it once.
  const params = new URLSearchParams(location.search);
  const oauth = params.get('oauth');
  if (oauth) {
    if (oauth === 'connected') notify('账户已连接', 'ok');
    else notify(`授权失败：${oauth.replace(/^error:\s*/, '')}`, 'error');
    history.replaceState(null, '', location.pathname);
  }

  refresh();
  setInterval(refresh, 15000);
})();
