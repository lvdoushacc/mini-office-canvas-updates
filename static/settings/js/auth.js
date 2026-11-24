(function() {
  const authSubtitle = document.getElementById('authSubtitle');
  const authForm = document.getElementById('authForm');
  const confirmPasswordGroup = document.getElementById('confirmPasswordGroup');
  const confirmPasswordInput = document.getElementById('confirmPasswordInput');
  const usernameGroup = document.getElementById('usernameGroup');
  const usernameInput = document.getElementById('usernameInput');
  const passwordInput = document.getElementById('passwordInput');
  const rememberPasswordRow = document.getElementById('rememberPasswordRow');
  const rememberPasswordInput = document.getElementById('rememberPasswordInput');
  const oldPasswordGroup = document.getElementById('oldPasswordGroup');
  const oldPasswordInput = document.getElementById('oldPasswordInput');
  const authErrorMsg = document.getElementById('authErrorMsg');
  const authSuccessMsg = document.getElementById('authSuccessMsg');
  const authSubmitBtn = document.getElementById('authSubmitBtn');
  const submitBtnText = document.getElementById('submitBtnText');
  const modeToggleBtn = document.getElementById('modeToggleBtn');
  const authStatusBanner = document.getElementById('authStatusBanner');
  const rememberedLoginKey = 'xxdp_remembered_login';

  const urlParams = new URLSearchParams(window.location.search);
  const nextPath = (() => {
    const value = urlParams.get('next') || '/';
    return value.startsWith('/') && !value.startsWith('//') ? value : '/';
  })();
  const goAfterLogin = () => window.location.replace(nextPath);
  let currentMode = urlParams.get('mode') || 'setup';
  let isCheckingStatus = false;
  let rememberedLoginLoaded = false;
  const isFixedLanEntry = window.location.port === '8910' || (
    window.location.hostname && !['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname)
  );

  // 8910 只用于账号进入协作画布，不提供首次创建主账号入口。
  if (isFixedLanEntry && currentMode === 'setup') currentMode = 'login';
  if (isFixedLanEntry && modeToggleBtn) {
    modeToggleBtn.style.display = 'none';
    modeToggleBtn.setAttribute('aria-hidden', 'true');
  }

  function showError(msg) {
    if (authSuccessMsg) {
      authSuccessMsg.textContent = '';
      authSuccessMsg.style.display = 'none';
    }
    if (!msg) {
      authErrorMsg.textContent = '';
      authErrorMsg.style.display = 'none';
      return;
    }
    if (msg === 'Failed to fetch' || (typeof msg === 'string' && msg.toLowerCase().includes('failed to fetch'))) {
      msg = '无法连接到后端服务。请确认「启动小小办公.bat」或后台服务已启动。';
    }
    authErrorMsg.textContent = msg;
    authErrorMsg.style.display = 'block';
  }

  function showSuccess(msg) {
    showError('');
    if (!authSuccessMsg) return;
    if (!msg) {
      authSuccessMsg.textContent = '';
      authSuccessMsg.style.display = 'none';
      return;
    }
    authSuccessMsg.textContent = msg;
    authSuccessMsg.style.display = 'block';
  }

  function showStatus(msg) {
    if (!msg) {
      authStatusBanner.textContent = '';
      authStatusBanner.style.display = 'none';
      return;
    }
    authStatusBanner.textContent = msg;
    authStatusBanner.style.display = 'block';
  }

  function detailFromResponse(errData, fallback) {
    if (!errData) return fallback;
    const d = errData.detail;
    if (typeof d === 'string' && d) return d;
    if (Array.isArray(d) && d.length) {
      return d.map(function (item) { return item.msg || item.message || String(item); }).join('；');
    }
    return fallback;
  }

  function loadRememberedLogin() {
    rememberedLoginLoaded = true;
    try {
      const remembered = JSON.parse(localStorage.getItem(rememberedLoginKey) || 'null');
      if (!remembered || typeof remembered !== 'object') return;
       usernameInput.value = String(remembered.username || '');
       // 旧版本可能把密码写入 localStorage；读取时立即清除，永不回填。
       if (Object.prototype.hasOwnProperty.call(remembered, 'password')) {
         localStorage.setItem(rememberedLoginKey, JSON.stringify({ username: usernameInput.value }));
       }
       rememberPasswordInput.checked = Boolean(usernameInput.value);
    } catch (_) {
      localStorage.removeItem(rememberedLoginKey);
    }
  }

  function updateRememberedLogin(username) {
    if (rememberPasswordInput?.checked) {
      localStorage.setItem(rememberedLoginKey, JSON.stringify({ username: username }));
    } else {
      localStorage.removeItem(rememberedLoginKey);
    }
  }

  function setMode(mode) {
    currentMode = mode;
    if (currentMode === 'login' && !rememberedLoginLoaded) loadRememberedLogin();
    showError('');
    showSuccess('');
    modeToggleBtn.style.display = isFixedLanEntry ? 'none' : 'inline-block';

    if (usernameGroup) usernameGroup.style.display = 'flex';
    if (oldPasswordGroup) oldPasswordGroup.style.display = 'none';
    if (oldPasswordInput) oldPasswordInput.required = false;
    usernameInput.required = true;
    passwordInput.required = true;
    if (rememberPasswordRow) rememberPasswordRow.style.display = currentMode === 'login' ? 'flex' : 'none';

    if (currentMode === 'setup') {
      authSubtitle.textContent = '首次使用 · 创建主账号';
      confirmPasswordGroup.style.display = 'flex';
      confirmPasswordInput.required = true;
      submitBtnText.textContent = '创建主账号并进入';
      usernameInput.placeholder = '设置主账号用户名，如 admin';
      passwordInput.placeholder = '设置主账号密码（至少 6 位）';
      passwordInput.autocomplete = 'new-password';
      modeToggleBtn.textContent = '已有主账号？切换为登录';
    } else if (currentMode === 'change-password') {
      authSubtitle.textContent = '修改密码';
      if (usernameGroup) usernameGroup.style.display = 'none';
      usernameInput.required = false;
      if (oldPasswordGroup) oldPasswordGroup.style.display = 'flex';
      if (oldPasswordInput) oldPasswordInput.required = true;
      confirmPasswordGroup.style.display = 'flex';
      confirmPasswordInput.required = true;
      submitBtnText.textContent = '确认修改密码';
      passwordInput.placeholder = '请输入新密码（至少 6 位）';
      passwordInput.autocomplete = 'new-password';
      modeToggleBtn.textContent = '返回登录';
    } else {
      authSubtitle.textContent = '欢迎回来 · 账号登录';
      confirmPasswordGroup.style.display = 'none';
      confirmPasswordInput.required = false;
      submitBtnText.textContent = '登录并进入';
      usernameInput.placeholder = '请输入用户名';
      passwordInput.placeholder = '请输入密码';
      passwordInput.autocomplete = 'current-password';
      modeToggleBtn.textContent = '首次使用？切换为创建主账号';
    }
  }

  modeToggleBtn.addEventListener('click', function () {
    if (currentMode === 'change-password') {
      setMode('login');
      return;
    }
    setMode(currentMode === 'setup' ? 'login' : 'setup');
  });

  rememberPasswordInput?.addEventListener('change', function () {
    if (!rememberPasswordInput.checked) localStorage.removeItem(rememberedLoginKey);
  });

  async function checkInitialStatus(retryCount) {
    retryCount = retryCount || 0;
    if (isCheckingStatus) return;
    isCheckingStatus = true;

    const existingToken = localStorage.getItem('xxdp_auth_token');
    const requestedMode = urlParams.get('mode');

    if (existingToken && requestedMode === 'change-password') {
      try {
        const meRes = await fetch('/api/auth/me', {
          headers: { 'Authorization': 'Bearer ' + existingToken }
        });
        if (meRes.ok) {
          setMode('change-password');
          showStatus('');
          isCheckingStatus = false;
          return;
        }
        localStorage.removeItem('xxdp_auth_token');
      } catch (e) {}
    }

    if (existingToken && requestedMode !== 'change-password') {
      try {
        const meRes = await fetch('/api/auth/me', {
          headers: { 'Authorization': 'Bearer ' + existingToken }
        });
        if (meRes.ok) {
          goAfterLogin();
          return;
        }
        localStorage.removeItem('xxdp_auth_token');
      } catch (e) {}
    }

    try {
      const res = await fetch('/api/auth/status');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const serverSetupRequired = Boolean(data.setupRequired);

      if (isFixedLanEntry) {
        setMode('login');
        showStatus('协作画布账号登录');
      } else if (serverSetupRequired) {
        setMode('setup');
      } else if (requestedMode === 'setup') {
        setMode('setup');
      } else if (requestedMode === 'change-password') {
        setMode('login');
        showError('请先登录后再修改密码');
      } else {
        setMode('login');
      }
      showStatus('');
      isCheckingStatus = false;
    } catch (err) {
      console.warn('Checking /api/auth/status failed (retry ' + retryCount + '):', err);
      showStatus('正在等待本地后台服务就绪…');
      isCheckingStatus = false;
      setTimeout(function () { checkInitialStatus(retryCount + 1); }, 1500);
    }
  }

  authForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    showError('');
    showSuccess('');

    const username = (usernameInput.value || '').trim();
    const password = passwordInput.value || '';

    if (currentMode !== 'change-password') {
      if (!username || username.length < 2) {
        showError('用户名长度至少为 2 个字符');
        usernameInput.focus();
        return;
      }
    }

    if (!password || password.length < 6) {
      showError(currentMode === 'change-password' ? '新密码长度至少为 6 个字符' : '密码长度至少为 6 个字符');
      passwordInput.focus();
      return;
    }

    if (currentMode === 'setup' || currentMode === 'change-password') {
      const confirmPassword = confirmPasswordInput.value || '';
      if (password !== confirmPassword) {
        showError('两次输入的密码不一致，请核对后再试');
        confirmPasswordInput.focus();
        return;
      }
    }

    if (currentMode === 'change-password') {
      const oldPassword = (oldPasswordInput && oldPasswordInput.value) || '';
      if (!oldPassword || oldPassword.length < 6) {
        showError('请输入旧密码');
        if (oldPasswordInput) oldPasswordInput.focus();
        return;
      }
    }

    try {
      authSubmitBtn.disabled = true;
      if (currentMode === 'setup') submitBtnText.textContent = '正在创建主账号…';
      else if (currentMode === 'change-password') submitBtnText.textContent = '正在修改密码…';
      else submitBtnText.textContent = '正在登录…';

      if (currentMode === 'change-password') {
        const token = localStorage.getItem('xxdp_auth_token');
        if (!token) throw new Error('登录已失效，请重新登录后再改密');
        const changeRes = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({
            oldPassword: oldPasswordInput.value,
            newPassword: password
          })
        });
        if (!changeRes.ok) {
          const errData = await changeRes.json().catch(function () { return {}; });
          throw new Error(detailFromResponse(errData, '修改密码失败'));
        }
        localStorage.removeItem('xxdp_auth_token');
        localStorage.removeItem(rememberedLoginKey);
        showSuccess('密码已修改，请使用新密码重新登录');
        passwordInput.value = '';
        confirmPasswordInput.value = '';
        if (oldPasswordInput) oldPasswordInput.value = '';
        setMode('login');
        authSubmitBtn.disabled = false;
        submitBtnText.textContent = '登录并进入';
        return;
      }

      if (currentMode === 'setup') {
        const setupRes = await fetch('/api/auth/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: username, password: password })
        });
        if (!setupRes.ok) {
          const errData = await setupRes.json().catch(function () { return {}; });
          if (setupRes.status === 409) {
            throw new Error('主账号已存在，请直接登录');
          }
          throw new Error(detailFromResponse(errData, '创建主账号失败'));
        }
      }

      const loginRes = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username, password: password })
      });

      if (!loginRes.ok) {
        const errData = await loginRes.json().catch(function () { return {}; });
        throw new Error(detailFromResponse(errData, loginRes.status === 401 ? '用户名或密码不正确' : '登录失败'));
      }

      const loginData = await loginRes.json();
      if (loginData && loginData.token) {
        if (currentMode === 'login') updateRememberedLogin(username);
        localStorage.setItem('xxdp_auth_token', loginData.token);
        showSuccess(currentMode === 'setup' ? '主账号已创建，正在进入…' : '登录成功，正在进入…');
        goAfterLogin();
      } else {
        throw new Error('服务器未返回有效登录凭证');
      }
    } catch (err) {
      showError((err && err.message) || '操作失败，请检查网络与服务状态');
      authSubmitBtn.disabled = false;
      if (currentMode === 'setup') submitBtnText.textContent = '创建主账号并进入';
      else if (currentMode === 'change-password') submitBtnText.textContent = '确认修改密码';
      else submitBtnText.textContent = '登录并进入';
    }
  });

  setMode(currentMode);
  checkInitialStatus();
})();
