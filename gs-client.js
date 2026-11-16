/* Shared Google Sheets client: sign-in, API calls, live change watching. */
const GS = (() => {
  const C = window.APP_CONFIG || {}, KEY = "tpd.inv.session";
  let sess = null, ver = null, timer = null, busy = false, cbData = null, cbStat = () => {}, cbCfg = null, loginP = null;
  try { sess = JSON.parse(sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || "null"); } catch (e) { }
  const save = (s, keep) => { sess = s; sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); if (s) (keep ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(s)); };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2));

  async function raw(action, body) {
    if (!C.API_URL) throw Object.assign(new Error("API_URL is empty in config.js. Paste your Apps Script Web App URL (DEPLOYMENT.md, step 5)."), { code: "CONFIG" });
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await fetch(C.API_URL, { method: "POST", body: JSON.stringify({ action, name: sess && sess.name, pin: sess && sess.pin, ...body }), signal: ctl.signal });
      const j = await r.json();
      if (!j.ok) throw Object.assign(new Error(j.error || "Request failed."), { code: j.code });
      return j;
    } catch (e) {
      if (e.code) throw e;
      throw Object.assign(new Error(e.name === "AbortError" ? "The server took too long to answer." : "Cannot reach Google Sheets. Check the internet connection."), { code: "NET" });
    } finally { clearTimeout(to); }
  }
  // call with automatic sign-in prompt when needed
  async function call(action, body) {
    for (;;) {
      if (!sess) await login();
      try { const j = await raw(action, body); if (j.user) { sess.role = j.user.role; sess.display = j.user.name; } return j; }
      catch (e) { if (e.code === "AUTH") { const m = e.message; save(null); await login(m); continue; } throw e; }
    }
  }
  function login(msg) {
    if (loginP) return loginP;
    loginP = new Promise(res => {
      const d = document.createElement("dialog");
      d.innerHTML = `<form method="dialog" style="display:grid;gap:12px;min-width:min(320px,80vw);font:14px system-ui,sans-serif"><h2 style="margin:0;font-size:18px">Sign in</h2>
      <p id="gl-m" style="margin:0;color:#a11212;min-height:18px">${msg || ""}</p>
      <label>Name<input id="gl-n" autocomplete="username" style="width:100%;height:40px;padding:0 10px;box-sizing:border-box"></label>
      <label>PIN<input id="gl-p" type="password" autocomplete="current-password" style="width:100%;height:40px;padding:0 10px;box-sizing:border-box"></label>
      <label style="display:flex;gap:8px;align-items:center"><input id="gl-k" type="checkbox"> Keep me signed in on this device</label>
      <button id="gl-b" style="height:42px;background:#002fa7;color:#fff;border:0;font-weight:700;cursor:pointer">Sign in</button></form>`;
      d.style.cssText = "border:1px solid #ccc;padding:24px"; d.addEventListener("cancel", e => e.preventDefault());
      document.body.appendChild(d); d.showModal();
      const n = d.querySelector("#gl-n"), p = d.querySelector("#gl-p"), k = d.querySelector("#gl-k"), m = d.querySelector("#gl-m"), b = d.querySelector("#gl-b");
      n.focus();
      d.querySelector("form").onsubmit = async ev => {
        ev.preventDefault(); b.disabled = true; m.textContent = "";
        sess = { name: n.value.trim(), pin: p.value.trim() };
        try { const j = await raw("login", {}); save({ name: sess.name, pin: sess.pin, role: j.user.role, display: j.user.name }, k.checked); cbCfg && cbCfg(j.cfg); d.close(); d.remove(); loginP = null; paintUser(); res(); }
        catch (e) { sess = null; m.textContent = e.message; b.disabled = false; }
      };
    });
    return loginP;
  }
  function logout() { save(null); ver = null; location.reload(); }
  const user = () => sess && { name: sess.display || sess.name, role: sess.role || "" };
  function paintUser() { const el = document.getElementById("gs-user"); if (!el) return; const u = user(); el.innerHTML = u ? `${u.name.replace(/[<&]/g, "")} &middot; ${u.role} &middot; <a href="#" id="gs-out">Sign out</a>` : ""; const o = document.getElementById("gs-out"); if (o) o.onclick = e => { e.preventDefault(); logout(); }; }

  // Pull everything now (force) or only when the change stamp moved.
  async function refresh(force) {
    if (busy) return; busy = true; cbStat("busy");
    try {
      if (!force && ver) { const v = await call("version", {}); if (v.version === ver) { cbStat("ok"); return; } }
      const j = await call("all", {}); ver = j.version; cbCfg && cbCfg(j.cfg); paintUser(); cbData && cbData(j.data, j); cbStat("ok");
    } catch (e) { cbStat("err", e.message); } finally { busy = false; }
  }
  function watch(onData, onStatus, onCfg) {
    cbData = onData; cbStat = onStatus || cbStat; cbCfg = onCfg || null;
    refresh(true); clearInterval(timer);
    timer = setInterval(() => { if (!document.hidden) refresh(false); }, Math.max(10, C.REFRESH_SEC || 20) * 1000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(false); });
    addEventListener("online", () => refresh(true));
  }
  async function write(action, body) { const j = await call(action, { reqId: uid(), ...body }); ver = null; return j; } // ver=null forces a full reload next
  return { watch, refresh, write, call, user, logout };
})();
