(() => {
  "use strict";

  const BASE = "home/energy";
  const DISCOVERY_TOPICS = [
    `${BASE}/+/status`,
    `${BASE}/+/state`,
    `${BASE}/+/admin/response`,
    `${BASE}/+/admin/csv`
  ];

  const DEFAULTS = {
    host: "b7e93fa24c0c4c86a995afecd61e93f3.s1.eu.hivemq.cloud",
    port: "8884",
    path: "/mqtt"
  };

  const AUTO_REFRESH_MS = 60000;
  const devices = new Map();
  const csvBuffers = new Map();
  const adminBusy = new Set();

  let client = null;
  let autoRefreshTimer = null;
  let toastTimeout = null;
  let deferredInstallPrompt = null;
  let adminTargetId = null;

  const $ = (id) => document.getElementById(id);

  const ui = {
    brokerDot: $("brokerDot"),
    brokerStatus: $("brokerStatus"),
    metersDot: $("metersDot"),
    metersStatus: $("metersStatus"),
    updateAllBtn: $("updateAllBtn"),
    updateAllIcon: $("updateAllIcon"),
    updateAllText: $("updateAllText"),
    devicesGrid: $("devicesGrid"),
    emptyState: $("emptyState"),
    settingsBtn: $("settingsBtn"),
    installBtn: $("installBtn"),
    settingsDialog: $("settingsDialog"),
    settingsForm: $("settingsForm"),
    closeSettingsBtn: $("closeSettingsBtn"),
    disconnectBtn: $("disconnectBtn"),
    connectionError: $("connectionError"),
    hostInput: $("hostInput"),
    portInput: $("portInput"),
    pathInput: $("pathInput"),
    usernameInput: $("usernameInput"),
    passwordInput: $("passwordInput"),
    adminDialog: $("adminDialog"),
    closeAdminBtn: $("closeAdminBtn"),
    adminEyebrow: $("adminEyebrow"),
    adminTitle: $("adminTitle"),
    dehAdminInput: $("dehAdminInput"),
    storeDehBtn: $("storeDehBtn"),
    resetStoreDehBtn: $("resetStoreDehBtn"),
    exportDailyBtn: $("exportDailyBtn"),
    clearDailyBtn: $("clearDailyBtn"),
    adminStatus: $("adminStatus"),
    toast: $("toast")
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatNumber(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    return n.toLocaleString("el-GR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function setDot(element, state) {
    element.classList.remove("dot-good", "dot-bad", "dot-warn", "dot-muted");
    element.classList.add(`dot-${state}`);
  }

  function showToast(message, timeout = 2600) {
    clearTimeout(toastTimeout);
    ui.toast.textContent = message;
    ui.toast.classList.remove("hidden");
    toastTimeout = setTimeout(() => ui.toast.classList.add("hidden"), timeout);
  }

  function showConnectionError(message = "") {
    ui.connectionError.textContent = message;
    ui.connectionError.classList.toggle("hidden", !message);
  }

  function setBrokerState(state, label) {
    setDot(ui.brokerDot, state);
    ui.brokerStatus.textContent = label;
    const connected = Boolean(client && client.connected);
    ui.updateAllBtn.disabled = !connected || onlineDeviceIds().length === 0;
  }

  function onlineDeviceIds() {
    return [...devices.values()].filter((d) => d.online).map((d) => d.id);
  }

  function meterType(device) {
    const s = device.state || {};
    const declared = String(s.meter || "").toUpperCase();
    if (declared.includes("JSY")) return "JSY";
    if (declared.includes("DDS")) return "DDS";
    if (Object.prototype.hasOwnProperty.call(s, "v1") ||
        Object.prototype.hasOwnProperty.call(s, "i1") ||
        device.id.toLowerCase().includes("jsy")) return "JSY";
    return "DDS";
  }

  function meterName(device) {
    const s = device.state || {};
    if (s.meter) return String(s.meter);
    return meterType(device) === "JSY" ? "JSY-MK-333" : "DDS238";
  }

  function deviceTitle(device) {
    const friendly = meterName(device);
    const id = device.id;
    if (id === "dds238" || id === "jsy333") return friendly;
    return `${friendly} · ${id}`;
  }

  function parseTopic(topic) {
    const prefix = `${BASE}/`;
    if (!topic.startsWith(prefix)) return null;
    const rest = topic.slice(prefix.length);
    const firstSlash = rest.indexOf("/");
    if (firstSlash < 1) return null;
    return {
      id: rest.slice(0, firstSlash),
      suffix: rest.slice(firstSlash + 1)
    };
  }

  function ensureDevice(id) {
    if (!devices.has(id)) {
      devices.set(id, {
        id,
        online: false,
        state: {},
        lastReceived: null
      });
    }
    return devices.get(id);
  }

  function phaseDirection(state, phase) {
    const explicit = String(state[`dir${phase}`] || "").toUpperCase();
    if (explicit === "REV" || explicit === "FWD") return explicit;
    const current = Number(state[`i${phase}`]);
    return Number.isFinite(current) && current < 0 ? "REV" : "FWD";
  }

  function totalReverse(state) {
    const raw = Number(state.power_direction);
    if (Number.isFinite(raw)) return Boolean(raw & 0x08);
    return false;
  }

  function metric(label, value, unit = "", extra = "") {
    return `
      <article class="metric-card ${extra}">
        <span class="metric-label">${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)} ${unit ? `<small>${escapeHtml(unit)}</small>` : ""}</strong>
      </article>`;
  }

  function renderDdsBody(device) {
    const s = device.state;
    return `
      <section class="metrics-grid">
        ${metric("Ισχύς τώρα", formatNumber(s.power, 0), "W", "power-card")}
        ${metric("Τάση", formatNumber(s.voltage, 1), "V")}
        ${metric("Ρεύμα", formatNumber(s.current, 2), "A")}
        ${metric("Power factor", formatNumber(s.pf, 3))}
        ${metric("Συχνότητα", formatNumber(s.frequency, 2), "Hz")}
      </section>
      <section class="energy-section">
        <div class="section-title-row">
          <h3>Ενέργεια / DEH</h3>
          <span class="section-meta">${escapeHtml(s.datetime || "Χωρίς ημερομηνία")}</span>
        </div>
        <div class="energy-grid">
          ${metric("Diff", formatNumber(s.diff, 2), "kWh", "diff-card")}
          ${metric("DEH τώρα", formatNumber(s.deh_now, 2), "kWh")}
          ${metric("DEH reference", formatNumber(s.deh_reference, 2), "kWh")}
          ${metric("Forward", formatNumber(s.energy_fwd, 2), "kWh")}
          ${metric("Reverse", formatNumber(s.energy_rev, 2), "kWh")}
        </div>
      </section>`;
  }

  function renderJsyBody(device) {
    const s = device.state;
    const revTotal = totalReverse(s);
    const totalLabel = revTotal ? "E · παραγωγή" : "P · κατανάλωση";
    const phaseCards = [1, 2, 3].map((phase) => {
      const dir = phaseDirection(s, phase);
      const rev = dir === "REV";
      const current = Math.abs(Number(s[`i${phase}`]) || 0);
      const power = Math.abs(Number(s[`p${phase}`]) || 0);
      return `
        <article class="phase-card">
          <div class="phase-head">
            <strong>L${phase}</strong>
            <span class="direction-badge ${rev ? "reverse" : "forward"}">${dir}</span>
          </div>
          <div class="phase-row"><span>Τάση</span><b>${formatNumber(s[`v${phase}`], 1)} V</b></div>
          <div class="phase-row"><span>Ρεύμα</span><b>${rev ? "i" : "I"}${phase} ${formatNumber(current, 2)} A</b></div>
          <div class="phase-row"><span>Ισχύς</span><b>${rev ? "E" : "P"}${phase} ${formatNumber(power, 0)} W</b></div>
          <div class="phase-row"><span>PF</span><b>${formatNumber(s[`pf${phase}`], 3)}</b></div>
        </article>`;
    }).join("");

    const totalPower = Math.abs(Number(s.power_total) || 0);

    return `
      <section class="jsy-summary-grid">
        ${metric(`Συνολική ισχύς (${totalLabel})`, formatNumber(totalPower / 1000, 2), "kW", revTotal ? "reverse-card" : "power-card")}
        ${metric("Συχνότητα", formatNumber(s.frequency, 2), "Hz")}
        ${metric("Power factor", formatNumber(s.pf_total, 3))}
        ${metric("JSY Total Energy", formatNumber(s.energy_total, 2), "kWh", "accent-card")}
      </section>
      <div class="section-title-row"><h3>Φάσεις</h3></div>
      <section class="phases-grid">${phaseCards}</section>
      <section class="energy-section">
        <div class="section-title-row">
          <h3>Ενέργεια / DEH</h3>
          <span class="section-meta">${escapeHtml(s.datetime || "Χωρίς ημερομηνία")}</span>
        </div>
        <div class="energy-grid compact-four">
          ${metric("Diff", formatNumber(s.diff, 2), "kWh", "diff-card")}
          ${metric("DEH τώρα", formatNumber(s.deh_now, 2), "kWh")}
          ${metric("DEH reference", formatNumber(s.deh_reference, 2), "kWh")}
          ${metric("RSSI", formatNumber(s.rssi, 0), "dBm")}
        </div>
      </section>`;
  }

  function renderDevice(device) {
    const hasState = device.state && Object.keys(device.state).length > 0;
    const body = hasState
      ? (meterType(device) === "JSY" ? renderJsyBody(device) : renderDdsBody(device))
      : '<div class="waiting-state">Αναμονή για την πρώτη μέτρηση…</div>';

    const last = device.lastReceived
      ? device.lastReceived.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "--";

    return `
      <article class="device-panel" data-device="${escapeHtml(device.id)}">
        <div class="device-head">
          <div class="device-title-wrap">
            <span class="dot dot-good"></span>
            <div>
              <span class="device-id">${escapeHtml(device.id)}</span>
              <h2>${escapeHtml(deviceTitle(device))}</h2>
            </div>
          </div>
          <div class="device-actions">
            <button class="small-btn refresh-device" type="button" data-action="refresh" data-device="${escapeHtml(device.id)}">↻ UPDATE</button>
            <button class="small-btn ghost" type="button" data-action="admin" data-device="${escapeHtml(device.id)}">ADMIN</button>
          </div>
        </div>
        ${body}
        <div class="device-footer">
          <span>ONLINE</span>
          <span>Τελευταία λήψη: ${last}</span>
        </div>
      </article>`;
  }

  function renderAll() {
    const online = [...devices.values()]
      .filter((d) => d.online)
      .sort((a, b) => a.id.localeCompare(b.id));

    ui.emptyState.classList.toggle("hidden", online.length > 0);
    ui.devicesGrid.innerHTML = online.map(renderDevice).join("");
    ui.metersStatus.textContent = String(online.length);
    setDot(ui.metersDot, online.length ? "good" : "muted");
    ui.updateAllBtn.disabled = !(client && client.connected) || online.length === 0;
  }

  function topicFor(id, suffix) {
    return `${BASE}/${id}/${suffix}`;
  }

  function publish(id, suffix, payload, callback) {
    if (!client || !client.connected) {
      showToast("Δεν υπάρχει σύνδεση με HiveMQ");
      return false;
    }
    client.publish(topicFor(id, suffix), payload, { qos: 0, retain: false }, callback);
    return true;
  }

  function requestUpdate(id, manual = true) {
    if (!publish(id, "request", "update", (err) => {
      if (err && manual) showToast(`Αποτυχία update ${id}`);
    })) return;
    if (manual) showToast(`Ζητήθηκε νέα μέτρηση: ${id}`, 1500);
  }

  function requestAll(manual = true) {
    const ids = onlineDeviceIds();
    if (!ids.length) {
      if (manual) showToast("Δεν υπάρχει online μετρητής");
      return;
    }
    ids.forEach((id) => requestUpdate(id, false));
    if (manual) showToast(`Ζητήθηκε update σε ${ids.length} μετρητές`);
    scheduleAutoRefresh();
  }

  function scheduleAutoRefresh() {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    if (!client || !client.connected) return;
    autoRefreshTimer = setInterval(() => requestAll(false), AUTO_REFRESH_MS);
  }

  function openAdmin(id) {
    const device = devices.get(id);
    if (!device) return;
    adminTargetId = id;
    ui.adminEyebrow.textContent = `${meterName(device)} ADMIN`;
    ui.adminTitle.textContent = `Διαχείριση · ${id}`;
    ui.dehAdminInput.value = "";
    setAdminStatus("Έτοιμο.", "ok");
    updateAdminButtons();
    ui.adminDialog.showModal();
  }

  function setAdminStatus(message, kind = "") {
    ui.adminStatus.textContent = message;
    ui.adminStatus.classList.remove("is-ok", "is-error");
    if (kind) ui.adminStatus.classList.add(`is-${kind}`);
  }

  function updateAdminButtons() {
    const busy = adminTargetId && adminBusy.has(adminTargetId);
    [ui.storeDehBtn, ui.resetStoreDehBtn, ui.exportDailyBtn, ui.clearDailyBtn].forEach((b) => {
      b.disabled = !adminTargetId || busy || !client || !client.connected;
    });
    ui.dehAdminInput.disabled = !adminTargetId || busy || !client || !client.connected;
  }

  function adminDehValue() {
    const raw = ui.dehAdminInput.value.trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value <= 0 || value >= 999999) {
      setAdminStatus("Γράψε έγκυρη νέα τιμή DEH.", "error");
      return null;
    }
    return raw;
  }

  function sendAdmin(command, pendingMessage) {
    if (!adminTargetId) return;
    const id = adminTargetId;
    adminBusy.add(id);
    updateAdminButtons();
    setAdminStatus(pendingMessage);
    publish(id, "admin/request", command, (err) => {
      if (!err) return;
      adminBusy.delete(id);
      updateAdminButtons();
      setAdminStatus(`Αποτυχία αποστολής: ${err.message || err}`, "error");
    });
  }

  function handleAdminResponse(id, text) {
    adminBusy.delete(id);
    updateAdminButtons();

    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      if (adminTargetId === id) setAdminStatus("Μη έγκυρη admin απάντηση.", "error");
      return;
    }

    const ok = Boolean(data.ok);
    const msg = ok
      ? `OK: ${data.cmd || "admin"}`
      : `Σφάλμα: ${data.error || "άγνωστο"}`;

    if (adminTargetId === id) setAdminStatus(msg, ok ? "ok" : "error");
    showToast(`${id}: ${msg}`);

    if (ok && (data.cmd === "store_deh" || data.cmd === "reset_store_deh")) {
      setTimeout(() => requestUpdate(id, false), 250);
    }
  }

  function handleCsv(id, text) {
    if (text.startsWith("BEGIN|")) {
      csvBuffers.set(id, []);
      if (adminTargetId === id) setAdminStatus("Λήψη Daily CSV…");
      return;
    }

    if (text.startsWith("ROW|")) {
      const rows = csvBuffers.get(id);
      if (!rows) return;
      const separator = text.indexOf("|", 4);
      if (separator >= 0) rows.push(text.slice(separator + 1));
      return;
    }

    if (text === "END") {
      const rows = csvBuffers.get(id) || [];
      csvBuffers.delete(id);
      adminBusy.delete(id);
      updateAdminButtons();
      if (!rows.length) {
        if (adminTargetId === id) setAdminStatus("Το CSV δεν περιείχε δεδομένα.", "error");
        return;
      }
      const blob = new Blob([`\uFEFF${rows.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${id}_daily_stats_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (adminTargetId === id) setAdminStatus("Το Daily CSV δημιουργήθηκε.", "ok");
      showToast(`${id}: το CSV κατέβηκε`);
    }
  }

  function restoreSettings() {
    ui.hostInput.value = localStorage.getItem("energy.host") || DEFAULTS.host;
    ui.portInput.value = localStorage.getItem("energy.port") || DEFAULTS.port;
    ui.pathInput.value = localStorage.getItem("energy.path") || DEFAULTS.path;
    ui.usernameInput.value = localStorage.getItem("energy.username") || "";
    ui.passwordInput.value = "";
  }

  function saveNonSecretSettings(settings) {
    localStorage.setItem("energy.host", settings.host);
    localStorage.setItem("energy.port", settings.port);
    localStorage.setItem("energy.path", settings.path);
    localStorage.setItem("energy.username", settings.username);
  }

  function disconnect(showMessage = true) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    if (client) {
      try { client.end(true); } catch (_) {}
    }
    client = null;
    devices.clear();
    renderAll();
    setBrokerState("warn", "Αποσυνδεδεμένο");
    if (showMessage) showToast("Αποσυνδέθηκε από το HiveMQ");
  }

  function connect(settings) {
    if (typeof mqtt === "undefined") {
      showConnectionError("Δεν φορτώθηκε η MQTT.js. Έλεγξε τη σύνδεση Internet.");
      return;
    }

    disconnect(false);
    showConnectionError();
    saveNonSecretSettings(settings);

    const cleanPath = settings.path.startsWith("/") ? settings.path : `/${settings.path}`;
    const url = `wss://${settings.host}:${settings.port}${cleanPath}`;
    const clientId = `energy-dds-jsy-${Math.random().toString(16).slice(2, 10)}`;

    setBrokerState("warn", "Σύνδεση…");

    const newClient = mqtt.connect(url, {
      clientId,
      username: settings.username,
      password: settings.password,
      clean: true,
      protocolVersion: 4,
      connectTimeout: 10000,
      reconnectPeriod: 4000,
      keepalive: 30
    });
    client = newClient;

    newClient.on("connect", () => {
      if (client !== newClient) return;
      setBrokerState("good", "Συνδεδεμένο");
      showConnectionError();

      newClient.subscribe(DISCOVERY_TOPICS, { qos: 0 }, (err) => {
        if (err) {
          showToast(`Σφάλμα subscribe: ${err.message || err}`);
          return;
        }
        showToast("Συνδέθηκε στο HiveMQ · discovery ενεργό");
        scheduleAutoRefresh();
        setTimeout(() => requestAll(false), 500);
      });

      if (ui.settingsDialog.open) ui.settingsDialog.close();
    });

    newClient.on("reconnect", () => setBrokerState("warn", "Επανασύνδεση…"));
    newClient.on("offline", () => setBrokerState("bad", "Offline"));
    newClient.on("close", () => {
      if (client === newClient) setBrokerState("warn", "Αποσυνδεδεμένο");
    });
    newClient.on("error", (err) => {
      if (client !== newClient) return;
      setBrokerState("bad", "Σφάλμα");
      showConnectionError(`MQTT: ${err.message || err}`);
    });

    newClient.on("message", (topic, payload) => {
      if (client !== newClient) return;
      const parsed = parseTopic(topic);
      if (!parsed) return;

      const text = payload.toString();
      const device = ensureDevice(parsed.id);

      if (parsed.suffix === "status") {
        device.online = text.trim().toLowerCase() === "online";
        renderAll();
        if (device.online && (!device.state || !Object.keys(device.state).length)) {
          setTimeout(() => requestUpdate(device.id, false), 100);
        }
        return;
      }

      if (parsed.suffix === "state") {
        try {
          device.state = JSON.parse(text);
          device.lastReceived = new Date();
          device.online = true;
          renderAll();
        } catch (err) {
          console.error("Invalid meter JSON", parsed.id, text, err);
          showToast(`${parsed.id}: μη έγκυρο JSON`);
        }
        return;
      }

      if (parsed.suffix === "admin/response") {
        handleAdminResponse(parsed.id, text);
        return;
      }

      if (parsed.suffix === "admin/csv") {
        handleCsv(parsed.id, text);
      }
    });
  }

  ui.devicesGrid.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-device]");
    if (!button) return;
    const id = button.dataset.device;
    if (button.dataset.action === "refresh") requestUpdate(id, true);
    if (button.dataset.action === "admin") openAdmin(id);
  });

  ui.updateAllBtn.addEventListener("click", () => requestAll(true));
  ui.settingsBtn.addEventListener("click", () => {
    showConnectionError();
    ui.settingsDialog.showModal();
  });
  ui.closeSettingsBtn.addEventListener("click", () => ui.settingsDialog.close());
  ui.disconnectBtn.addEventListener("click", () => disconnect(true));

  ui.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    connect({
      host: ui.hostInput.value.trim(),
      port: ui.portInput.value.trim(),
      path: ui.pathInput.value.trim() || "/mqtt",
      username: ui.usernameInput.value.trim(),
      password: ui.passwordInput.value
    });
  });

  ui.closeAdminBtn.addEventListener("click", () => ui.adminDialog.close());

  ui.storeDehBtn.addEventListener("click", () => {
    const value = adminDehValue();
    if (value !== null) sendAdmin(`store_deh|${value}`, "Αποθήκευση νέου DEH reference…");
  });

  ui.resetStoreDehBtn.addEventListener("click", () => {
    const value = adminDehValue();
    if (value === null) return;
    if (!window.confirm("RESET + STORE θα διαγράψει ΟΛΑ τα daily stats και drift/calibration history. Συνέχεια;")) return;
    sendAdmin(`reset_store_deh|${value}`, "RESET + STORE σε εξέλιξη…");
  });

  ui.exportDailyBtn.addEventListener("click", () => {
    if (!adminTargetId) return;
    csvBuffers.delete(adminTargetId);
    sendAdmin("export_daily", "Προετοιμασία Daily CSV…");
  });

  ui.clearDailyBtn.addEventListener("click", () => {
    if (!window.confirm("Να καθαριστούν μόνο τα daily statistics;")) return;
    sendAdmin("clear_daily", "Καθαρισμός daily stats…");
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    ui.installBtn.classList.remove("hidden");
  });

  ui.installBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    ui.installBtn.classList.add("hidden");
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    ui.installBtn.classList.add("hidden");
    showToast("Η εφαρμογή εγκαταστάθηκε");
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((err) => {
        console.warn("Service worker registration failed", err);
      });
    });
  }

  restoreSettings();
  renderAll();
  setBrokerState("warn", "Αποσυνδεδεμένο");
  setTimeout(() => ui.settingsDialog.showModal(), 250);
})();
