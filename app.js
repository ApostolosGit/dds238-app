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
    host: "",
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

  function injectDualZoneUi() {
    if ($("dualZoneSettings")) return;

    const section = document.createElement("section");
    section.id = "dualZoneSettings";
    section.className = "settings-section dual-zone-settings";
    section.innerHTML = `
      <div class="setting-toggle-row">
        <div>
          <p class="eyebrow">ΔΙΖΩΝΙΚΟ</p>
          <h3>Διζωνικό Ζ1 / Ζ2</h3>
        </div>
        <label class="switch-label">
          <input id="dualZoneToggle" type="checkbox">
          <span>Ενεργό</span>
        </label>
      </div>

      <p id="dualZoneUnsupported" class="admin-help hidden">
        Ο συγκεκριμένος ESP δεν αναφέρει υποστήριξη Ζ1/Ζ2. Απαιτεί firmware 1.18 ή νεότερο.
      </p>

      <div id="dualZoneDetails" class="hidden">
        <div class="tariff-schedule">
          <strong>Ωράριο Διζωνικού Συστήματος</strong>
          <p><b>Ζ1:</b> ακριβή ζώνη · όλες οι ώρες εκτός Ζ2.</p>
          <p><b>Ζ2:</b> φθηνή ζώνη.</p>
          <div class="schedule-grid">
            <div>
              <b>Χειμερινή περίοδος</b>
              <span>Νοέμβριος – Μάρτιος</span>
              <span>02:00 – 05:00</span>
              <span>12:00 – 15:00</span>
            </div>
            <div>
              <b>Θερινή περίοδος</b>
              <span>Απρίλιος – Οκτώβριος</span>
              <span>02:00 – 04:00</span>
              <span>11:00 – 15:00</span>
            </div>
          </div>
          <a href="https://apps.deddie.gr/ccrWebapp/dizoniko.html" target="_blank" rel="noopener noreferrer">Πηγή ωραρίου: ΔΕΔΔΗΕ</a>
        </div>

        <div class="form-grid">
          <label>
            Ζ1 — ακριβή (kWh)
            <input id="z1Input" type="number" inputmode="decimal" min="0" max="999998.99" step="0.01">
          </label>
          <label>
            Ζ2 — φθηνή (kWh)
            <input id="z2Input" type="number" inputmode="decimal" min="0" max="999998.99" step="0.01">
          </label>
        </div>

        <p class="admin-help">
          Κάθε νέα δήλωση Ζ1/Ζ2 γίνεται νέο Reference. Τα Ζ1/Ζ2 Now ξεκινούν από αυτές τις τιμές και μετά μεταβάλλονται αυτόματα.
        </p>
      </div>

      <button id="saveDualZoneBtn" class="primary-btn admin-btn full-btn" type="button">
        ΑΠΟΘΗΚΕΥΣΗ ΡΥΘΜΙΣΗΣ
      </button>
    `;

    ui.adminStatus.parentNode.insertBefore(section, ui.adminStatus);
  }

  injectDualZoneUi();

  ui.monoZoneSettings = $("monoZoneSettings");
  ui.dualZoneToggle = $("dualZoneToggle");
  ui.dualZoneDetails = $("dualZoneDetails");
  ui.dualZoneUnsupported = $("dualZoneUnsupported");
  ui.z1Input = $("z1Input");
  ui.z2Input = $("z2Input");
  ui.saveDualZoneBtn = $("saveDualZoneBtn");

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

  function diffTone(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return "diff-zero";
    return n < 0 ? "diff-negative" : "diff-positive";
  }

  function signedPhasePower(state, phase) {
    const raw = Number(state[`p${phase}`]);
    if (!Number.isFinite(raw)) return 0;
    if (raw < 0) return raw;
    return phaseDirection(state, phase) === "REV" ? -Math.abs(raw) : Math.abs(raw);
  }

  function signedTotalPower(state) {
    const raw = Number(state.power_total);
    if (!Number.isFinite(raw)) return 0;
    if (raw < 0) return raw;
    return totalReverse(state) ? -Math.abs(raw) : Math.abs(raw);
  }

  function powerTone(value) {
    const n = Number(value);
    return n < 0 ? "power-negative" : "power-positive";
  }

  function tariffRow(label, value, unit = "kWh", extra = "") {
    return `
      <div class="tariff-row ${extra}">
        <span class="tariff-row-label">${escapeHtml(label)}</span>
        <span class="tariff-row-colon">:</span>
        <b class="tariff-row-value">${escapeHtml(formatNumber(value, 2))}${unit ? ` <small>${escapeHtml(unit)}</small>` : ""}</b>
      </div>`;
  }

  function renderTariffEnergy(state) {
    const dual = state.dual_zone === true || state.tariff_mode === "dual";

    if (dual) {
      const zone = String(state.tariff_zone || "-");
      const isZ2 = zone === "Z2";
      const clock = state.clock_source === "internal" ? "εσωτερικό ρολόι" :
                    state.clock_source === "ntp/internal" ? "NTP / εσωτερικό" :
                    "χωρίς έγκυρη ώρα";

      const z1Ref = state.z1_ref ?? state.z1 ?? 0;
      const z1Now = state.z1_now ?? state.z1 ?? 0;
      const z1Diff = state.z1_diff ?? (Number(z1Now) - Number(z1Ref));

      const z2Ref = state.z2_ref ?? state.z2 ?? 0;
      const z2Now = state.z2_now ?? state.z2 ?? 0;
      const z2Diff = state.z2_diff ?? (Number(z2Now) - Number(z2Ref));

      return `
        <section class="tariff-dashboard">
          <div class="section-title-row">
            <h3>Ρολόγια ΔΕΗ Ζ1 / Ζ2</h3>
            <span class="zone-now ${isZ2 ? "cheap" : "normal"}">Τώρα ${escapeHtml(zone)}</span>
          </div>
          <div class="tariff-zone-grid">
            <article class="tariff-zone-card">
              <h4>Ζ1 · ακριβή ζώνη</h4>
              ${tariffRow("Διαφορά", z1Diff, "kWh", diffTone(z1Diff))}
              ${tariffRow("Now", z1Now)}
              ${tariffRow("Reference", z1Ref)}
            </article>
            <article class="tariff-zone-card cheap-zone-card">
              <h4>Ζ2 · οικονομική ζώνη</h4>
              ${tariffRow("Διαφορά", z2Diff, "kWh", diffTone(z2Diff))}
              ${tariffRow("Now", z2Now)}
              ${tariffRow("Reference", z2Ref)}
            </article>
          </div>
          <div class="tariff-meta">Ρολόι: ${escapeHtml(clock)} · ${escapeHtml(state.datetime || "")}</div>
        </section>`;
    }

    const zRef = state.z_ref ?? state.deh_reference;
    const zNow = state.z_now ?? state.deh_now;
    const zDiff = state.z_diff ?? state.diff;

    return `
      <section class="tariff-dashboard single-zone-dashboard">
        <div class="section-title-row">
          <h3>Ρολόγια ΔΕΗ Ζ</h3>
          <span class="section-meta">${escapeHtml(state.datetime || "")}</span>
        </div>
        <div class="tariff-zone-grid single-zone-grid">
          <article class="tariff-zone-card single-zone-card">
            <h4>Ζ</h4>
            ${tariffRow("Διαφορά", zDiff, "kWh", diffTone(zDiff))}
            ${tariffRow("Now", zNow)}
            ${tariffRow("Reference", zRef)}
          </article>
        </div>
      </section>`;
  }

  function renderDdsBody(device) {
    const s = device.state;
    const power = Number(s.power) || 0;
    const current = Math.abs(Number(s.current) || 0);

    return `
      <section class="single-phase-grid">
        <article class="phase-card single-phase-card">
          <div class="phase-head"><strong>Μονοφασικό</strong></div>
          ${phaseRow("Ισχύς", formatNumber(power, 0), "W", `phase-power-row ${powerTone(power)}`)}
          ${phaseRow("Ρεύμα", formatNumber(current, 2), "A")}
          ${phaseRow("Τάση", formatNumber(s.voltage, 1), "V")}
          ${phaseRow("Συχν.", formatNumber(s.frequency, 2), "Hz")}
          ${phaseRow("PF", formatNumber(s.pf, 3))}
        </article>
      </section>
      ${renderTariffEnergy(s)}`;
  }

  function phaseRow(label, value, unit = "", extra = "") {
    return `
      <div class="phase-row ${extra}">
        <span class="phase-label">${escapeHtml(label)}</span>
        <span class="phase-colon">:</span>
        <b class="phase-value">${escapeHtml(value)}${unit ? ` <small>${escapeHtml(unit)}</small>` : ""}</b>
      </div>`;
  }

  function renderJsyBody(device) {
    const s = device.state;
    const phaseNames = ["R", "S", "T"];
    const phaseCards = [1, 2, 3].map((phase) => {
      const current = Math.abs(Number(s[`i${phase}`]) || 0);
      const power = signedPhasePower(s, phase);
      return `
        <article class="phase-card">
          <div class="phase-head"><strong>Φάση ${phaseNames[phase - 1]}</strong></div>
          ${phaseRow("Ισχύς", formatNumber(power, 0), "W", `phase-power-row ${powerTone(power)}`)}
          ${phaseRow("Ρεύμα", formatNumber(current, 2), "A")}
          ${phaseRow("Τάση", formatNumber(s[`v${phase}`], 1), "V")}
          ${phaseRow("Συχν.", formatNumber(s.frequency, 2), "Hz")}
          ${phaseRow("PF", formatNumber(s[`pf${phase}`], 3))}
        </article>`;
    }).join("");

    return `
      <section class="phases-grid phases-without-title">${phaseCards}</section>
      ${renderTariffEnergy(s)}`;
  }

  function renderDevice(device) {
    const hasState = device.state && Object.keys(device.state).length > 0;
    const state = device.state || {};
    const body = hasState
      ? (meterType(device) === "JSY" ? renderJsyBody(device) : renderDdsBody(device))
      : '<div class="waiting-state">Αναμονή για την πρώτη μέτρηση…</div>';

    const last = device.lastReceived
      ? device.lastReceived.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "--";

    const firmware = state.firmware ? `v${state.firmware}` : "--";
    const buildDate = state.build_date || "--";
    const rssi = Number.isFinite(Number(state.rssi)) ? `${formatNumber(state.rssi, 0)} dBm` : "--";

    let totalPowerLine = "";
    if (hasState && meterType(device) === "JSY") {
      const totalPower = signedTotalPower(state);
      totalPowerLine = `
        <div class="device-total-power ${powerTone(totalPower)}">
          <span>Συνολική ισχύς</span>
          <span class="device-total-power-colon">:</span>
          <b class="device-total-power-value">${escapeHtml(formatNumber(totalPower / 1000, 2))} <small>kW</small></b>
        </div>`;
    }

    return `
      <article class="device-panel" data-device="${escapeHtml(device.id)}">
        <div class="device-head">
          <div class="device-title-wrap">
            <span class="dot dot-good"></span>
            <div>
              <span class="device-id">${escapeHtml(device.id)}</span>
              <h2>${escapeHtml(deviceTitle(device))}</h2>
              ${totalPowerLine}
              <span class="firmware-meta">Firmware ${escapeHtml(firmware)} · ${escapeHtml(buildDate)}</span>
            </div>
          </div>
          <div class="device-head-right">
            <span class="rssi-badge">RSSI ${escapeHtml(rssi)}</span>
            <div class="device-actions">
              <button class="small-btn refresh-device" type="button" data-action="refresh" data-device="${escapeHtml(device.id)}">↻ UPDATE</button>
              <button class="small-btn ghost" type="button" data-action="admin" data-device="${escapeHtml(device.id)}">ΡΥΘΜΙΣΕΙΣ</button>
            </div>
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

  function refreshDualZoneSettings(device) {
    const s = device.state || {};
    const supported = Object.prototype.hasOwnProperty.call(s, "dual_zone") ||
                      Object.prototype.hasOwnProperty.call(s, "tariff_mode");

    const dual = supported && (s.dual_zone === true || s.tariff_mode === "dual");

    ui.dualZoneUnsupported.classList.toggle("hidden", supported);
    ui.dualZoneToggle.disabled = !supported;
    ui.saveDualZoneBtn.disabled = !supported;
    ui.dualZoneToggle.checked = dual;

    const z1Value = s.z1_now ?? s.z1 ?? s.z1_ref;
    const z2Value = s.z2_now ?? s.z2 ?? s.z2_ref;
    ui.z1Input.value = Number.isFinite(Number(z1Value)) ? Number(z1Value).toFixed(2) : "";
    ui.z2Input.value = Number.isFinite(Number(z2Value)) ? Number(z2Value).toFixed(2) : "";

    const zValue = s.z_now ?? s.deh_now ?? s.z_ref ?? s.deh_reference;
    if (!dual && Number.isFinite(Number(zValue))) {
      ui.dehAdminInput.value = Number(zValue).toFixed(2);
    }

    ui.dualZoneDetails.classList.toggle("hidden", !dual);
    if (ui.monoZoneSettings) ui.monoZoneSettings.classList.toggle("hidden", dual);
    ui.saveDualZoneBtn.textContent = dual ? "ΑΠΟΘΗΚΕΥΣΗ Ζ1 / Ζ2" : "ΑΠΟΘΗΚΕΥΣΗ ΡΥΘΜΙΣΗΣ";
  }

  function openAdmin(id) {
    const device = devices.get(id);
    if (!device) return;
    adminTargetId = id;
    ui.adminEyebrow.textContent = `${meterName(device)} SETTINGS`;
    ui.adminTitle.textContent = `Ρυθμίσεις · ${id}`;
    refreshDualZoneSettings(device);
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
    const connected = Boolean(client && client.connected);
    [ui.storeDehBtn, ui.resetStoreDehBtn, ui.exportDailyBtn, ui.clearDailyBtn].forEach((b) => {
      b.disabled = !adminTargetId || busy || !connected;
    });
    ui.dehAdminInput.disabled = !adminTargetId || busy || !connected;

    const device = adminTargetId ? devices.get(adminTargetId) : null;
    const supportsDual = Boolean(device && Object.prototype.hasOwnProperty.call(device.state || {}, "dual_zone"));
    ui.dualZoneToggle.disabled = !supportsDual || busy || !connected;
    ui.saveDualZoneBtn.disabled = !supportsDual || busy || !connected;
    ui.z1Input.disabled = !supportsDual || busy || !connected;
    ui.z2Input.disabled = !supportsDual || busy || !connected;
  }

  function adminDehValue() {
    const raw = ui.dehAdminInput.value.trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value <= 0 || value >= 999999) {
      setAdminStatus("Γράψε έγκυρη νέα τιμή Ζ.", "error");
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

    const errorMessages = {
      invalid_z_values: "Οι τιμές Ζ1/Ζ2 δεν είναι έγκυρες.",
      time_not_valid: "Ο ESP δεν έχει ακόμα έγκυρη ημερομηνία/ώρα από NTP.",
      dds238_read_failed: "Απέτυχε η ανάγνωση DDS238.",
      jsy_read_failed: "Απέτυχε η ανάγνωση JSY-MK-333."
    };

    const ok = Boolean(data.ok);
    const msg = ok
      ? `OK: ${data.cmd || "admin"}`
      : (errorMessages[data.error] || `Σφάλμα: ${data.error || "άγνωστο"}`);

    if (adminTargetId === id) setAdminStatus(msg, ok ? "ok" : "error");
    showToast(`${id}: ${msg}`);

    if (ok && (data.cmd === "store_deh" ||
               data.cmd === "reset_store_deh" ||
               data.cmd === "dualzone_set")) {
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
    ui.hostInput.value = localStorage.getItem("energy.host") || ui.hostInput.value || DEFAULTS.host;
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

          if (adminTargetId === device.id && ui.adminDialog.open) {
            refreshDualZoneSettings(device);
            updateAdminButtons();
          }
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
    if (value !== null) sendAdmin(`zone_set|${value}`, "Αποθήκευση νέου Ζ reference…");
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

  ui.dualZoneToggle.addEventListener("change", () => {
    const enabled = ui.dualZoneToggle.checked;
    ui.dualZoneDetails.classList.toggle("hidden", !enabled);
    if (ui.monoZoneSettings) ui.monoZoneSettings.classList.toggle("hidden", enabled);
    ui.saveDualZoneBtn.textContent = enabled ? "ΑΠΟΘΗΚΕΥΣΗ Ζ1 / Ζ2" : "ΑΠΟΘΗΚΕΥΣΗ ΡΥΘΜΙΣΗΣ";
  });

  ui.saveDualZoneBtn.addEventListener("click", () => {
    if (!adminTargetId) return;

    const device = devices.get(adminTargetId);
    if (!device || !Object.prototype.hasOwnProperty.call(device.state || {}, "dual_zone")) {
      setAdminStatus("Απαιτεί firmware 1.18 ή νεότερο.", "error");
      return;
    }

    const enabled = ui.dualZoneToggle.checked;
    let z1 = Number(ui.z1Input.value);
    let z2 = Number(ui.z2Input.value);

    if (!enabled) {
      z1 = Number.isFinite(z1) ? z1 : Number(device.state.z1 || 0);
      z2 = Number.isFinite(z2) ? z2 : Number(device.state.z2 || 0);
    }

    if (!Number.isFinite(z1) || !Number.isFinite(z2) ||
        z1 < 0 || z2 < 0 || z1 >= 999999 || z2 >= 999999) {
      setAdminStatus("Γράψε έγκυρες τιμές Ζ1 και Ζ2.", "error");
      return;
    }

    sendAdmin(
      `dualzone_set|${enabled ? 1 : 0}|${z1.toFixed(2)}|${z2.toFixed(2)}`,
      enabled ? "Ενεργοποίηση διζωνικού…" : "Απενεργοποίηση διζωνικού…"
    );
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

  const footerSpans = document.querySelectorAll("footer span");
  if (footerSpans[0]) footerSpans[0].textContent = "Energy DDS / JSY v1.4";
  if (footerSpans[1]) footerSpans[1].textContent = "Auto discovery · Z1/Z2 · refresh 60″";

  restoreSettings();
  renderAll();
  setBrokerState("warn", "Αποσυνδεδεμένο");
  setTimeout(() => ui.settingsDialog.showModal(), 250);
})();
