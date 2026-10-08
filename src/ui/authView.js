import { supabase } from '../services/supabase.js';
import { loginUser, registerUser, isUsernameTaken } from '../services/auth.js';
import { showToast, debounce } from '../utils/helpers.js';

let telemetryInterval = null;

function initTelemetryMonitor() {
  if (telemetryInterval) clearInterval(telemetryInterval);

  const netEl = document.getElementById('telemetry-net');
  const pingEl = document.getElementById('telemetry-ping');
  if (!netEl || !pingEl) return;

  async function checkLatency() {
    const start = performance.now();
    try {
      const { error } = await supabase.from('profiles').select('id').limit(1);
      const latency = Math.round(performance.now() - start);

      if (error) {
        netEl.textContent = 'DEGRADED';
        netEl.className = 'val warn';
      } else {
        netEl.textContent = 'SECURE // ONLINE';
        netEl.className = 'val online';
      }

      pingEl.textContent = `${latency} ms`;
      if (latency < 120) {
        pingEl.className = 'val online';
      } else if (latency < 280) {
        pingEl.className = 'val warn';
      } else {
        pingEl.className = 'val offline';
      }
    } catch {
      netEl.textContent = 'OFFLINE';
      netEl.className = 'val offline';
      pingEl.textContent = 'ERR';
      pingEl.className = 'val offline';
    }
  }

  checkLatency();
  telemetryInterval = setInterval(checkLatency, 12000);
}

export function mountAuthView(container) {
  container.innerHTML = `
    <section id="view-auth" class="view active">
      <div class="auth-crosshair top-left">+</div>
      <div class="auth-crosshair top-right">+</div>

      <!-- Live Telemetry Readout -->
      <aside class="auth-telemetry" aria-label="System Telemetry">
        <div class="telemetry-row">
          <span class="label">NET STATUS:</span>
          <span id="telemetry-net" class="val online">CONNECTING...</span>
        </div>
        <div class="telemetry-row">
          <span class="label">PING:</span>
          <span id="telemetry-ping" class="val">-- ms</span>
        </div>
        <div class="telemetry-row">
          <span class="label">ENGINE:</span>
          <span class="val">CANVAS-2D // ES-MOD v0.4.1</span>
        </div>
        <div class="telemetry-row">
          <span class="label">DB CLUSTER:</span>
          <span class="val">fwmq...kgf [ACTIVE]</span>
        </div>
      </aside>

      <div class="auth-card">
        <h1 class="logo">BATTLE<span>ROYALE</span></h1>
        <p class="subtitle">Survive the Storm</p>

        <div class="tab-buttons">
          <button id="tab-login" class="active">Log In</button>
          <button id="tab-register">Register</button>
        </div>

        <!-- Sign In Form -->
        <form id="form-login" class="auth-form">
          <div class="field">
            <label for="login-username">Call-Sign</label>
            <input type="text" id="login-username" required placeholder="LoneWolf99" autocomplete="username" />
          </div>
          <div class="field">
            <label for="login-password">Password</label>
            <input type="password" id="login-password" required minlength="6" autocomplete="current-password" />
          </div>
          <button type="submit" class="btn primary-btn">Enter Battle</button>
        </form>

        <!-- Sign Up Form -->
        <form id="form-register" class="auth-form hidden">
          <div class="field">
            <label for="reg-username">Unique Call-Sign</label>
            <input type="text" id="reg-username" required maxlength="16" placeholder="LoneWolf99" autocomplete="username" />
            <span id="username-check-msg" class="hint"></span>
          </div>
          <div class="field">
            <label for="reg-password">Password</label>
            <input type="password" id="reg-password" required minlength="6" autocomplete="new-password" />
          </div>
          <button type="submit" class="btn primary-btn">Create Account</button>
        </form>
      </div>
    </section>
  `;

  initTelemetryMonitor();

  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');

  const regUsernameInput = document.getElementById('reg-username');
  const regPasswordInput = document.getElementById('reg-password');
  const loginUsernameInput = document.getElementById('login-username');
  const loginPasswordInput = document.getElementById('login-password');
  const usernameMsg = document.getElementById('username-check-msg');

  let usernameAvailable = false;
  let isChecking = false;

  tabLogin?.addEventListener('click', () => {
    tabLogin.classList.add('active');
    tabRegister.classList.remove('active');
    formLogin.classList.remove('hidden');
    formRegister.classList.add('hidden');
  });

  tabRegister?.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabLogin.classList.remove('active');
    formRegister.classList.remove('hidden');
    formLogin.classList.add('hidden');
  });

  // Debounced check: displays warning ONLY when invalid or taken
  const performCheck = debounce(async (val) => {
    const clean = val.trim();

    if (clean.length === 0) {
      usernameMsg.textContent = '';
      usernameAvailable = false;
      isChecking = false;
      return;
    }

    if (clean.length < 3) {
      usernameMsg.textContent = 'Must be at least 3 characters.';
      usernameMsg.className = 'hint error';
      usernameAvailable = false;
      isChecking = false;
      return;
    }

    if (clean.length > 16) {
      usernameMsg.textContent = 'Max 16 characters.';
      usernameMsg.className = 'hint error';
      usernameAvailable = false;
      isChecking = false;
      return;
    }

    isChecking = true;

    try {
      const taken = await isUsernameTaken(clean);
      if (taken) {
        usernameMsg.textContent = '❌ Call-sign already taken';
        usernameMsg.className = 'hint error';
        usernameAvailable = false;
      } else {
        usernameMsg.textContent = '';
        usernameAvailable = true;
      }
    } catch {
      usernameMsg.textContent = 'Could not verify call-sign';
      usernameMsg.className = 'hint error';
      usernameAvailable = false;
    } finally {
      isChecking = false;
    }
  }, 300);

  regUsernameInput?.addEventListener('input', (e) => {
    performCheck(e.target.value);
  });

  formLogin?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = loginUsernameInput.value.trim();
    const password = loginPasswordInput.value;

    const submitBtn = formLogin.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Authenticating...';

    try {
      await loginUser(username, password);
      showToast('Welcome back, Soldier!', 'success');
    } catch (err) {
      showToast(err.message || 'Login failed', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enter Battle';
    }
  });

  formRegister?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = regUsernameInput.value.trim();
    const password = regPasswordInput.value;

    if (isChecking) {
      showToast('Verifying call-sign, please wait...', 'info');
      return;
    }

    if (!usernameAvailable) {
      showToast('Please pick an available call-sign first', 'error');
      regUsernameInput.focus();
      return;
    }

    const submitBtn = formRegister.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Enlisting...';

    try {
      await registerUser(username, password);
      showToast('Account created! Welcome to the arena.', 'success');
    } catch (err) {
      showToast(err.message || 'Registration failed', 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account';
    }
  });
}