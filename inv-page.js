/* Shared logic for Inventory_In.html and Inventory_Out.html (Google Sheets as the database). */
function InvPage(kind) {
  const OUT = kind === "out", $ = id => document.getElementById(id), p2 = n => String(n).padStart(2, "0");
  const S = { data: [], skus: new Map(), skuList: [], ins: [], outs: [], cfg: null, edit: null, busy: false, shown: 50, fresh: null, last: null };
  const norm = s => String(s == null ? "" : s).trim().toUpperCase();
  const canEdit = () => ["ENCODER", "ADMIN"].includes((GS.user() || {}).role), canDel = () => (GS.user() || {}).role === "ADMIN";
  function fmtT(t) { const [h, m, s] = t.split(":").map(Number); return `${h % 12 || 12}:${p2(m)}:${p2(s || 0)} ${h < 12 ? "AM" : "PM"}`; }
  function fmtDT(d, t) { const [y, mo, da] = d.split("-"), [h, m] = t.split(":").map(Number); return `${mo}/${da}/${y} ${h % 12 || 12}:${p2(m)} ${h < 12 ? "AM" : "PM"}`; }
  function weekNo(d) { const j = new Date(d.getFullYear(), 0, 1), doy = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 864e5); return Math.floor((doy + (j.getDay() + 6) % 7) / 7) + 1; }
  function banner(kind, text) { const b = $("banner"); b.className = "banner show " + kind; $("banner-text").textContent = text; $("banner-extra").replaceChildren(); if (kind !== "bad") b.scrollIntoView({ block: "nearest" }); }
  $("banner-close").onclick = () => $("banner").classList.remove("show");
  const shiftNow = () => { const h = new Date().getHours(), v = h >= 6 && h < 18 ? "DAY SHIFT" : "NIGHT SHIFT"; return S.cfg && S.cfg.shifts.includes(v) ? v : ""; };

  function tick() { if (S.edit) return; const d = new Date(); $("f-datetime").value = fmtDT(`${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, d.toTimeString().slice(0, 8)); $("f-time").value = fmtT(d.toTimeString().slice(0, 8)); $("f-week").value = weekNo(d); }
  function fillCfg(cfg) {
    if (!cfg || S.cfg) { S.cfg = S.cfg || cfg; return; }
    S.cfg = cfg; const sh = $("f-shift"); sh.replaceChildren(new Option("Select shift", ""));
    cfg.shifts.forEach(v => sh.add(new Option(v[0] + v.slice(1).toLowerCase(), v))); sh.value = shiftNow();
    if (OUT) { const d = $("f-deliv"); d.replaceChildren(new Option("Select flexo machine", "")); cfg.destinations.forEach(x => d.add(new Option(x, x))); }
  }
  function balance(sku) { const k = norm(sku); let b = 0; S.ins.forEach(r => { if (norm(r.sku) === k) b += r.q; }); S.outs.forEach(r => { if (norm(r.sku) === k) b -= r.q; }); return Math.max(0, b); }
  function syncSku() {
    const it = S.skus.get(norm($("f-sku").value));
    $("f-desc").value = it ? it.desc : ""; $("f-cust").value = it ? it.cust : "";
    $("h-bal").textContent = it ? "Current balance: " + balance(it.sku).toLocaleString() : "";
  }
  function setErr(f, msg) { const i = $(f[0]); $(f[1]).textContent = msg || ""; msg ? i.setAttribute("aria-invalid", "true") : i.removeAttribute("aria-invalid"); return !msg; }
  const FL = { sku: ["f-sku", "e-sku"], qty: ["f-qty", "e-qty"], shift: ["f-shift", "e-shift"], deliv: ["f-deliv", "e-deliv"] };
  const ORDER = OUT ? ["sku", "qty", "shift", "deliv"] : ["sku", "qty", "shift"];
  function validate() {
    const sku = $("f-sku").value.trim(), q = $("f-qty").value.trim(), item = S.skus.get(norm(sku)), max = S.cfg.maxQty;
    const ok = {
      sku: setErr(FL.sku, !sku ? "Enter or select a SKU." : !item ? "This SKU is not in the CORRUGATED SKU sheet." : ""),
      qty: setErr(FL.qty, !q ? "Enter a quantity." : !/^\d+$/.test(q) ? "Use a whole number (no decimals or signs)." : +q < 1 ? "Quantity must be at least 1." : +q > max ? "Quantity is too large (max " + max.toLocaleString() + ")." : ""),
      shift: setErr(FL.shift, $("f-shift").value ? "" : "Select a shift.")
    };
    if (OUT) ok.deliv = setErr(FL.deliv, $("f-deliv").value ? "" : "Select a flexo machine.");
    const bad = ORDER.find(k => !ok[k]); if (bad) { $(FL[bad][0]).focus(); return null; }
    return { item, qty: +q, shift: $("f-shift").value, deliv: OUT ? $("f-deliv").value : undefined };
  }
  ORDER.forEach(k => $(FL[k][0]).addEventListener("input", () => { if (k === "sku") syncSku(); if ($(FL[k][0]).getAttribute("aria-invalid")) setErr(FL[k], ""); }));
  $("f-sku").addEventListener("change", () => { const it = S.skus.get(norm($("f-sku").value)); if (it) $("f-sku").value = it.sku; syncSku(); });

  function resetForm() {
    S.edit = null; $("f-sku").value = ""; $("f-qty").value = ""; if (OUT) $("f-deliv").value = ""; $("f-shift").value = shiftNow(); syncSku();
    ORDER.forEach(k => setErr(FL[k], "")); $("btn-submit").textContent = "Submit transaction"; $("btn-cancel").hidden = true;
    $("form-title").textContent = OUT ? "New inventory-out transaction" : "New inventory-in transaction"; $("f-id").value = S.nextId || ""; tick();
  }
  function startEdit(r) {
    S.edit = r; $("f-id").value = r.id; $("f-week").value = r.wk; $("f-datetime").value = fmtDT(r.d, r.t); $("f-time").value = fmtT(r.t);
    $("f-sku").value = r.sku; $("f-qty").value = r.q; $("f-shift").value = r.shift; if (OUT) $("f-deliv").value = r.fx; syncSku();
    $("btn-submit").textContent = "Save changes"; $("btn-cancel").hidden = false; $("form-title").textContent = "Edit entry #" + r.id; $("f-qty").focus(); scrollTo({ top: $("in-form").offsetTop - 80, behavior: "smooth" });
  }

  async function submit(e) {
    e.preventDefault(); if (S.busy) return;
    const v = validate(); if (!v) { banner("bad", "Please fix the highlighted fields before submitting."); return; }
    const avail = balance(v.item.sku) + (S.edit && S.edit.sku === v.item.sku ? (OUT ? S.edit.q : -S.edit.q) : 0);
    if (OUT && v.qty > avail && !confirm(`Only ${avail.toLocaleString()} of ${v.item.sku} is in stock. Record ${v.qty.toLocaleString()} anyway?`)) return;
    const l = S.last; if (!S.edit && l && l.sku === v.item.sku && l.qty === v.qty && Date.now() - l.t < 60000 && !confirm(`You just submitted ${v.qty.toLocaleString()} of ${v.item.sku}. Submit the same transaction again?`)) return;
    S.busy = true; $("btn-submit").disabled = true;
    try {
      const body = { kind, sku: v.item.sku, qty: v.qty, shift: v.shift, deliv: v.deliv };
      const j = S.edit ? await GS.write("update", { ...body, id: S.edit.id }) : await GS.write("add", body);
      S.fresh = j.id; S.last = { sku: v.item.sku, qty: v.qty, t: Date.now() };
      banner("ok", (S.edit ? "Updated" : "Saved") + `: Entry #${j.id} - ${v.qty.toLocaleString()} x ${v.item.sku} (${v.item.cust})${OUT ? " delivered to " + v.deliv : ""}.`);
      await GS.refresh(true); resetForm(); $("f-sku").focus();
    } catch (err) { banner("bad", "NOT saved: " + err.message); } finally { S.busy = false; $("btn-submit").disabled = false; }
  }
  async function del(r) {
    if (!confirm(`Delete entry #${r.id} (${r.q.toLocaleString()} x ${r.sku})? This cannot be undone (it is logged in AUDIT LOG).`)) return;
    try { await GS.write("delete", { kind, id: r.id }); banner("ok", "Entry #" + r.id + " deleted."); if (S.edit && S.edit.id === r.id) resetForm(); await GS.refresh(true); } catch (err) { banner("bad", "NOT deleted: " + err.message); }
  }

  function render(reset) {
    if (reset) S.shown = 50;
    const all = S.data.slice().sort((a, b) => b.id - a.id), q = $("search").value.trim().toLowerCase();
    const rows = q ? all.filter(r => [r.id, r.wk, fmtDT(r.d, r.t), r.shift, r.q, r.fx, r.sku, r.desc, r.cust].join(" ").toLowerCase().includes(q)) : all;
    $("stat-count").textContent = S.data.length.toLocaleString(); $("stat-qty").textContent = S.data.reduce((s, r) => s + r.q, 0).toLocaleString();
    const body = $("hist-body"); body.replaceChildren();
    rows.slice(0, S.shown).forEach(r => {
      const tr = document.createElement("tr"); if (r.id === S.fresh) tr.className = "fresh";
      const cells = [[r.id, 1], [r.wk, 1], [fmtDT(r.d, r.t)], [fmtT(r.t)], [r.shift], [r.q.toLocaleString(), 1]].concat(OUT ? [[r.fx]] : [], [[r.sku], [r.desc], [r.cust]]);
      cells.forEach(([t, n]) => { const td = document.createElement("td"); if (n) td.className = "num"; td.textContent = t; tr.appendChild(td); });
      const td = document.createElement("td");
      if (canEdit()) { const b = document.createElement("button"); b.className = "button"; b.textContent = "Edit"; b.onclick = () => startEdit(r); td.appendChild(b); }
      if (canDel()) { const b = document.createElement("button"); b.className = "button"; b.textContent = "Delete"; b.style.marginLeft = "6px"; b.onclick = () => del(r); td.appendChild(b); }
      tr.appendChild(td); body.appendChild(tr);
    });
    const none = !rows.length; $("hist-empty").hidden = !none; $("hist-empty").textContent = S.data.length ? "No records match your search." : "No records yet. Submitted transactions will appear here.";
    $("hist-more").hidden = none; $("hist-count").textContent = `Showing ${Math.min(S.shown, rows.length).toLocaleString()} of ${rows.length.toLocaleString()}`; $("btn-more").hidden = S.shown >= rows.length;
    $("hist-sub").textContent = q ? "Filtered - newest first" : "Newest first";
  }
  function exportCsv() {
    const q = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"', h = ["Entry ID", "Week no.", "Date", "Time", "Shift", "Quantity"].concat(OUT ? ["Delivered to"] : [], ["SKU", "Description", "Customer"]);
    const body = S.data.slice().sort((a, b) => a.id - b.id).map(r => [r.id, r.wk, r.d, r.t, r.shift, r.q].concat(OUT ? [r.fx] : [], [r.sku, r.desc, r.cust]).map(q).join(","));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + [h.map(q).join(",")].concat(body).join("\r\n")], { type: "text/csv" }));
    a.download = `Inventory_${OUT ? "OUT" : "IN"}_${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove();
  }

  const dot = $("wb-dot"), name = $("wb-name");
  GS.watch((d, j) => {
    S.ins = d.ins; S.outs = d.outs; S.data = OUT ? d.outs : d.ins; S.skuList = d.sku; S.skus = new Map(d.sku.map(s => [norm(s.sku), s]));
    S.nextId = S.data.reduce((m, r) => Math.max(m, r.id), 0) + 1;
    const list = $("sku-list"); list.replaceChildren(); d.sku.forEach(s => { const o = document.createElement("option"); o.value = s.sku; o.label = s.desc; list.appendChild(o); });
    $("form-fields").disabled = ["VIEWER"].includes(j.user.role); ["btn-submit", "btn-clear"].forEach(id => $(id).disabled = j.user.role === "VIEWER");
    ["search", "btn-export"].forEach(id => $(id).disabled = false);
    $("save-hint").textContent = j.user.role === "VIEWER" ? "Your account is view-only." : "Each submission is saved straight to the shared Google Sheet; every signed-in user sees it within seconds.";
    if (!S.edit) $("f-id").value = S.nextId; fillCfg(j.cfg); syncSku(); render(!S.keep); S.keep = true;
  }, (st, msg) => {
    dot.classList.toggle("on", st === "ok");
    name.textContent = st === "ok" ? `Connected to Google Sheets - ${S.data.length} records - synced ${new Date().toLocaleTimeString()}` : st === "busy" ? name.textContent || "Connecting..." : "Sync problem: " + msg + " (will retry)";
  }, fillCfg);
  $("btn-refresh").onclick = () => GS.refresh(true);
  $("btn-export").onclick = exportCsv; $("btn-more").onclick = () => { S.shown += 50; render(false); }; $("search").oninput = () => render(true);
  $("btn-clear").onclick = () => { resetForm(); $("banner").classList.remove("show"); }; $("btn-cancel").onclick = resetForm; $("in-form").onsubmit = submit;
  tick(); setInterval(tick, 1000);
}
