/*
 * Banana Path — host adapter.
 *
 * On claude.ai the page was handed a `window.claude` object with three
 * capabilities: `sample` (streaming Claude), `db` (per-user documents) and
 * `user` (who is signed in). Outside claude.ai none of that exists, so this
 * file rebuilds exactly the same shape on top of our own NestJS backend:
 *
 *   window.claude.use("sample") -> sample(input, opts) / sample.json(prompt, opts)
 *   window.claude.use("db")     -> db.doc(path).get() / .set(obj)
 *   window.claude.use("user")   -> user.id()
 *
 * Because the shape is identical, index.html needs no other change.
 * It also owns the login overlay: the site is private, and every /api/* route
 * is behind a session cookie.
 */
(function () {
  'use strict';

  /* ----------------------------- errors ----------------------------- */

  // Codes match ERR_COPY in index.html, so the app already has Russian copy.
  function apiError(code, message) {
    var error = new Error(message || code);
    error.code = code;
    return error;
  }

  function isAbort(error) {
    return !!error && (error.name === 'AbortError' || error.code === 'cancelled');
  }

  function errorForStatus(status, body) {
    if (body && body.code) return apiError(body.code, body.message);
    if (status === 401) return apiError('session_expired', 'Сессия истекла');
    if (status === 429) return apiError('rate_limited', 'Слишком много запросов');
    if (status === 422) return apiError('invalid_json', 'Ментор ответил в неверном формате');
    if (status === 413) return apiError('prompt_too_large', 'Слишком длинный запрос');
    return apiError('upstream_error', 'Сервер ответил ошибкой ' + status);
  }

  /* ------------------------------- http ------------------------------ */

  async function api(path, options) {
    var opts = options || {};
    var hasBody = opts.body !== undefined;
    var response;

    try {
      response = await fetch(path, {
        method: opts.method || 'GET',
        credentials: 'same-origin',
        headers: hasBody ? { 'content-type': 'application/json' } : undefined,
        body: hasBody ? JSON.stringify(opts.body) : undefined,
        signal: opts.signal,
      });
    } catch (error) {
      if (isAbort(error)) throw apiError('cancelled', 'Отменено');
      throw apiError('upstream_error', 'Нет связи с сервером');
    }

    if (response.status === 401) showLogin();
    if (!response.ok) {
      var body = null;
      try {
        body = await response.json();
      } catch (ignored) {
        /* the server did not send a JSON body */
      }
      throw errorForStatus(response.status, body);
    }
    return response;
  }

  /* ------------------------------ sample ----------------------------- */

  function toMessages(input) {
    if (typeof input === 'string') return [{ role: 'user', content: input }];
    return (input || []).map(function (message) {
      return {
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: String(message.content == null ? '' : message.content),
      };
    });
  }

  /**
   * Streams an answer from POST /api/ai/chat (Server-Sent Events).
   * `onText` is called with the full text so far plus the new delta, which is
   * what the chat and the "review my notes" screen expect.
   */
  async function sample(input, options) {
    var opts = options || {};
    var response = await api('/api/ai/chat', {
      method: 'POST',
      body: { messages: toMessages(input) },
      signal: opts.signal,
    });

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var text = '';

    try {
      for (;;) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });

        var separator;
        while ((separator = buffer.indexOf('\n\n')) !== -1) {
          var frame = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);

          var payload = frame
            .split('\n')
            .filter(function (line) {
              return line.indexOf('data:') === 0;
            })
            .map(function (line) {
              return line.slice(5).trim();
            })
            .join('');
          if (!payload) continue;

          var event;
          try {
            event = JSON.parse(payload);
          } catch (ignored) {
            continue;
          }

          if (event.type === 'delta') {
            text += event.text;
            if (opts.onText) opts.onText({ text: text, delta: event.text });
          } else if (event.type === 'error') {
            throw apiError(event.code, event.message);
          }
        }
      }
    } catch (error) {
      if (isAbort(error)) throw apiError('cancelled', 'Отменено');
      throw error;
    }

    return { text: text };
  }

  /**
   * One prompt in, parsed JSON out (POST /api/ai/json).
   * `opts.cache === false` skips the server-side 24h lesson cache — that is how
   * the "generate a fresh lesson" button asks for a new variant.
   */
  sample.json = async function (prompt, options) {
    var opts = options || {};
    var response = await api('/api/ai/json', {
      method: 'POST',
      body: { prompt: String(prompt), cache: opts.cache !== false },
      signal: opts.signal,
    });

    try {
      return await response.json();
    } catch (error) {
      throw apiError('invalid_json', 'Ответ сервера не разобрался как JSON');
    }
  };

  /* -------------------------------- db ------------------------------- */

  // The path argument is kept for API compatibility: the server already knows
  // which user is asking from the session cookie, so there is one document.
  var db = {
    doc: function (path) {
      return {
        path: path,
        get: async function () {
          var response = await api('/api/progress');
          var body = await response.json();
          return {
            exists: !!body.exists,
            data: function () {
              return body.data || {};
            },
          };
        },
        set: async function (value) {
          await api('/api/progress', { method: 'PUT', body: value });
          return true;
        },
      };
    },
  };

  /* ------------------------------- user ------------------------------ */

  var mePromise = null;

  function me() {
    if (!mePromise) {
      mePromise = api('/api/me').then(function (response) {
        return response.json();
      });
      // Nobody may be awaiting this yet; swallow the rejection so the console
      // stays clean. The overlay has already been shown by `api`.
      mePromise.catch(function () {});
    }
    return mePromise;
  }

  var user = {
    id: async function () {
      var profile = await me();
      return profile.id;
    },
  };

  /* ------------------------------ login ------------------------------ */

  var loginMounted = false;

  function mountLoginStyles() {
    var style = document.createElement('style');
    style.textContent = [
      '.bp-login{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;',
      'padding:20px;background:var(--bg,#EEF1F8)}',
      '.bp-login-card{width:100%;max-width:360px;background:var(--surface,#fff);color:var(--ink,#1B2140);',
      'border:1px solid var(--line,#D9DEEC);border-radius:20px;padding:26px 22px;box-shadow:0 12px 40px rgba(0,0,0,.14);',
      'font-family:var(--font,system-ui,sans-serif);display:flex;flex-direction:column;gap:12px}',
      '.bp-login-title{font-size:24px;font-weight:800;text-align:center}',
      '.bp-login-sub{margin:0;text-align:center;color:var(--muted,#636C8F);font-size:14px;line-height:1.45}',
      '.bp-login-card input{width:100%;padding:13px 14px;font:inherit;font-size:16px;border-radius:14px;',
      'border:2px solid var(--line,#D9DEEC);background:var(--surface-2,#F6F8FC);color:inherit}',
      '.bp-login-card input:focus{outline:none;border-color:var(--blue,#3E8BFF)}',
      '.bp-login-card button{padding:13px 16px;font:inherit;font-size:16px;font-weight:700;border:0;cursor:pointer;',
      'border-radius:14px;background:var(--banana,#FFC61A);color:#3B2A00;box-shadow:0 3px 0 var(--banana-deep,#D69E00)}',
      '.bp-login-card button:disabled{opacity:.6;cursor:default}',
      '.bp-login-err{min-height:18px;font-size:13px;color:var(--red,#EF4E4B);text-align:center}',
    ].join('');
    document.head.appendChild(style);
  }

  /** Shown when /api/* answers 401. Signing in reloads the page. */
  function showLogin(message) {
    if (loginMounted) {
      if (message) setLoginError(message);
      return;
    }
    loginMounted = true;
    mountLoginStyles();

    var overlay = document.createElement('div');
    overlay.className = 'bp-login';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = [
      '<form class="bp-login-card" autocomplete="on">',
      '  <div class="bp-login-title">🍌 Путь к банану</div>',
      '  <p class="bp-login-sub">Это личный сайт. Введи пароль, чтобы продолжить.</p>',
      '  <input id="bpPassword" type="password" name="password" autocomplete="current-password"',
      '         placeholder="Пароль" aria-label="Пароль" required>',
      '  <div class="bp-login-err" id="bpLoginErr" role="alert"></div>',
      '  <button type="submit" id="bpLoginBtn">Войти</button>',
      '</form>',
    ].join('\n');

    document.body.appendChild(overlay);
    var input = overlay.querySelector('#bpPassword');
    var button = overlay.querySelector('#bpLoginBtn');
    input.focus();

    overlay.querySelector('form').addEventListener('submit', async function (event) {
      event.preventDefault();
      setLoginError('');
      button.disabled = true;
      button.textContent = 'Проверяю…';

      try {
        var response = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: input.value }),
        });

        if (response.ok) {
          // Reload so the app boots with a session from the first line of code.
          window.location.reload();
          return;
        }
        setLoginError(response.status === 401 ? 'Неверный пароль' : 'Не получилось войти');
      } catch (error) {
        setLoginError('Нет связи с сервером');
      }

      button.disabled = false;
      button.textContent = 'Войти';
      input.select();
    });

    if (message) setLoginError(message);
  }

  function setLoginError(text) {
    var node = document.getElementById('bpLoginErr');
    if (node) node.textContent = text || '';
  }

  /* ----------------------------- bootstrap --------------------------- */

  window.claude = {
    use: async function (capability) {
      if (capability === 'sample') return sample;
      if (capability === 'db') return db;
      if (capability === 'user') return user;
      return null;
    },
  };

  // Ask who we are right away, so an unauthenticated visitor sees the login
  // form immediately instead of after the first failed lesson.
  me();
})();
