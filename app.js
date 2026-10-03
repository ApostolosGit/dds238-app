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

  const APP_VERSION = "2.03";
  const AUTO_REFRESH_MS = 60000;
  const OTA_ACK_TIMEOUT_MS = 12000;
  const OTA_POLL_MS = 5000;
  const OTA_TOTAL_TIMEOUT_MS = 300000;
  const OTA_PIN = "12134";
  const OTA_MANIFEST_URL = "https://raw.githubusercontent.com/ApostolosGit/ESP8266-OTA/main/manifest.txt";
  const OTA_RAW_BASE_URL = "https://raw.githubusercontent.com/ApostolosGit/ESP8266-OTA/main/";
  const devices = new Map();
  const csvBuffers = new Map();
  const adminBusy = new Set();

  let client = null;
  let autoRefreshTimer = null;
  let toastTimeout = null;
  let deferredInstallPrompt = null;
  let adminTargetId = null;
  let otaTargetId = null;
  let otaPendingManifest = null;
  let otaManifestLoading = false;
  let otaAwaitingStart = null;
  let otaSession = null;
  let otaAckTimer = null;
  let otaPollTimer = null;
  let otaTimeoutTimer = null;
  let otaElapsedTimer = null;
  let editingUtilityId = null;
  let utilityEntryStep = 0;
  let utilityHistoryRows = [];
  let utilityHistoryDeviceId = null;
  let utilityListIntent = "summary";
  const MIN_DEVIATION_KWH = 1.0;

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
    utilityReadingSettings: $("utilityReadingSettings"),
    utilityReadingTitle: $("utilityReadingTitle"),
    utilityLatestSummary: $("utilityLatestSummary"),
    startUtilityReadingBtn: $("startUtilityReadingBtn"),
    utilityEntryDialog: $("utilityEntryDialog"),
    utilityEntryTitle: $("utilityEntryTitle"),
    utilityStepLabel: $("utilityStepLabel"),
    utilityStepType: $("utilityStepType"),
    utilityStepDate: $("utilityStepDate"),
    utilityStepTime: $("utilityStepTime"),
    utilityStepReading: $("utilityStepReading"),
    utilityStepConfirm: $("utilityStepConfirm"),
    utilityKindFinal: $("utilityKindFinal"),
    utilityKindIntermediate: $("utilityKindIntermediate"),
    utilityTariffLabel: $("utilityTariffLabel"),
    utilityConfirmSummary: $("utilityConfirmSummary"),
    closeUtilityEntryBtn: $("closeUtilityEntryBtn"),
    utilityDateInput: $("utilityDateInput"),
    utilityTimeInput: $("utilityTimeInput"),
    monoReadingFields: $("monoReadingFields"),
    dualReadingFields: $("dualReadingFields"),
    utilityZInput: $("utilityZInput"),
    utilityZ1Input: $("utilityZ1Input"),
    utilityZ2Input: $("utilityZ2Input"),
    saveUtilityReadingBtn: $("saveUtilityReadingBtn"),
    utilityHistoryBtn: $("utilityHistoryBtn"),
    utilityHistoryDialog: $("utilityHistoryDialog"),
    utilityHistoryTitle: $("utilityHistoryTitle"),
    utilityHistoryContent: $("utilityHistoryContent"),
    closeUtilityHistoryBtn: $("closeUtilityHistoryBtn"),
    adminStatus: $("adminStatus"),
    otaTargetInfo: $("otaTargetInfo"),
    otaUpdateBtn: $("otaUpdateBtn"),
    otaPinDialog: $("otaPinDialog"),
    otaPinForm: $("otaPinForm"),
    otaPinInput: $("otaPinInput"),
    otaPinTarget: $("otaPinTarget"),
    otaPinError: $("otaPinError"),
    closeOtaPinBtn: $("closeOtaPinBtn"),
    cancelOtaPinBtn: $("cancelOtaPinBtn"),
    otaProgressDialog: $("otaProgressDialog"),
    otaProgressTitle: $("otaProgressTitle"),
    otaProgressStatus: $("otaProgressStatus"),
    otaProgressDevice: $("otaProgressDevice"),
    otaProgressVersions: $("otaProgressVersions"),
    otaProgressDetails: $("otaProgressDetails"),
    otaProgressVisual: $("otaProgressVisual"),
    otaProgressCloseBtn: $("otaProgressCloseBtn"),
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
          <p class="eyebrow">ΤΙΜΟΛΟΓΙΟ</p>
          <h3>Μετρητής Ζ ή Ζ1 / Ζ2</h3>
        </div>
        <label class="switch-label">
          <input id="dualZoneToggle" type="checkbox">
          <span>Ζ1 / Ζ2</span>
        </label>
      </div>

      <p id="dualZoneUnsupported" class="admin-help hidden">
        Η νέα λειτουργία απαιτεί firmware v3.00 ή νεότερο.
      </p>

      <div id="dualZoneDetails" class="hidden">
        <div class="tariff-schedule">
          <strong>Ωράριο Διζωνικού Συστήματος</strong>
          <p><b>Ζ1:</b> όλες οι ώρες εκτός Ζ2.</p>
          <p><b>Ζ2:</b> μειωμένη ζώνη.</p>
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
      </div>

      <button id="saveDualZoneBtn" class="primary-btn admin-btn full-btn" type="button">
        ΑΠΟΘΗΚΕΥΣΗ ΤΥΠΟΥ ΜΕΤΡΗΤΗ
      </button>
    `;

    ui.utilityReadingSettings.parentNode.insertBefore(section, ui.utilityReadingSettings);
  }

  injectDualZoneUi();

  ui.dualZoneToggle = $("dualZoneToggle");
  ui.dualZoneDetails = $("dualZoneDetails");
  ui.dualZoneUnsupported = $("dualZoneUnsupported");
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
    const missing = value === null || value === undefined || value === "";
    const display = missing ? "—" : formatNumber(value, 2);
    return `
      <div class="tariff-row ${extra}">
        <span class="tariff-row-label">${escapeHtml(label)}</span>
        <span class="tariff-row-colon">:</span>
        <b class="tariff-row-value">${escapeHtml(display)}${!missing && unit ? ` <small>${escapeHtml(unit)}</small>` : ""}</b>
      </div>`;
  }

  function renderTariffEnergy(state) {
    const dual = state.dual_zone === true || state.tariff_mode === "dual";
    const hasUtility = state.has_utility === true;
    const estimateValid = state.estimate_valid === true;

    const rowValue = (value, digits = 2) =>
      Number.isFinite(Number(value)) ? Number(value) : null;

    if (dual) {
      const zone = String(state.tariff_zone || "-");
      const isZ2 = zone === "Z2";
      const z1Ref = hasUtility ? rowValue(state.z1_ref) : null;
      const z2Ref = hasUtility ? rowValue(state.z2_ref) : null;
      const z1Now = estimateValid ? rowValue(state.z1_now) : null;
      const z2Now = estimateValid ? rowValue(state.z2_now) : null;
      const z1Diff = estimateValid ? rowValue(state.z1_diff) : null;
      const z2Diff = estimateValid ? rowValue(state.z2_diff) : null;

      return `
        <section class="tariff-dashboard">
          <div class="section-title-row">
            <h3>Μετρητής ΔΕΗ Ζ1 / Ζ2</h3>
            <span class="zone-now ${isZ2 ? "cheap" : "normal"}">Τώρα ${escapeHtml(zone)}</span>
          </div>
          <div class="tariff-zone-grid">
            <article class="tariff-zone-card">
              <h4>Ζ1</h4>
              ${tariffRow("Διαφορά", z1Diff, "kWh", diffTone(z1Diff))}
              ${tariffRow("Εκτίμηση τώρα", z1Now, "kWh")}
              ${tariffRow("Τελευταία ΔΕΗ", z1Ref, "kWh")}
            </article>
            <article class="tariff-zone-card cheap-zone-card">
              <h4>Ζ2</h4>
              ${tariffRow("Διαφορά", z2Diff, "kWh", diffTone(z2Diff))}
              ${tariffRow("Εκτίμηση τώρα", z2Now, "kWh")}
              ${tariffRow("Τελευταία ΔΕΗ", z2Ref, "kWh")}
            </article>
          </div>
          ${hasUtility
            ? (!estimateValid
                ? '<div class="tariff-meta">Η τελευταία μέτρηση ΔΕΗ αποθηκεύτηκε, αλλά δεν υπάρχει αρκετό εσωτερικό ιστορικό για εκτίμηση τώρα.</div>'
                : "")
            : '<div class="tariff-meta">Καταχώρησε την πρώτη επίσημη μέτρηση ΔΕΗ από τις Ρυθμίσεις.</div>'}
        </section>`;
    }

    const zRef = hasUtility ? rowValue(state.z_ref) : null;
    const zNow = estimateValid ? rowValue(state.z_now) : null;
    const zDiff = estimateValid ? rowValue(state.z_diff) : null;

    return `
      <section class="tariff-dashboard single-zone-dashboard">
        <div class="section-title-row">
          <h3>Μετρητής ΔΕΗ Ζ</h3>
          <span class="section-meta">${escapeHtml(state.datetime || "")}</span>
        </div>
        <div class="tariff-zone-grid single-zone-grid">
          <article class="tariff-zone-card single-zone-card">
            <h4>Ζ</h4>
            ${tariffRow("Διαφορά", zDiff, "kWh", diffTone(zDiff))}
            ${tariffRow("Εκτίμηση τώρα", zNow, "kWh")}
            ${tariffRow("Τελευταία ΔΕΗ", zRef, "kWh")}
          </article>
        </div>
        ${hasUtility
          ? (!estimateValid
              ? '<div class="tariff-meta">Η τελευταία μέτρηση ΔΕΗ αποθηκεύτηκε, αλλά δεν υπάρχει αρκετό εσωτερικό ιστορικό για εκτίμηση τώρα.</div>'
              : "")
          : '<div class="tariff-meta">Καταχώρησε την πρώτη επίσημη μέτρηση ΔΕΗ από τις Ρυθμίσεις.</div>'}
      </section>`;
  }

  function renderDdsBody(device) {
    const s = device.state;
    const power = Number(s.power) || 0;
    const current = Math.abs(Number(s.current) || 0);
    const dual = s.dual_zone === true || s.tariff_mode === "dual";

    const hasUtility = s.has_utility === true;
    const estimateValid = s.estimate_valid === true;
    const zRef = hasUtility ? s.z_ref : null;
    const zNow = estimateValid ? s.z_now : null;
    const zDiff = estimateValid ? s.z_diff : null;

    const singleZoneMeter = dual ? "" : `
      <div class="dds-inline-column dds-meter-column">
        <div class="embedded-tariff-title">Μετρητής ΔΕΗ Ζ</div>
        ${tariffRow("Διαφορά", zDiff, "kWh", diffTone(zDiff))}
        ${tariffRow("Εκτίμηση τώρα", zNow, "kWh")}
        ${tariffRow("Τελευταία ΔΕΗ", zRef, "kWh")}
        ${!hasUtility ? '<div class="tariff-meta">Καταχώρησε πρώτη μέτρηση ΔΕΗ.</div>' : ""}
      </div>`;

    return `
      <section class="single-phase-grid">
        <article class="phase-card single-phase-card">
          <div class="dds-inline-grid">
            <div class="dds-inline-column dds-measurement-column">
              <div class="phase-head"><strong>Μονοφασικό</strong></div>
              ${phaseRow("Ισχύς", formatNumber(power, 0), "W", `phase-power-row ${powerTone(power)}`)}
              ${phaseRow("Ρεύμα", formatNumber(current, 2), "A")}
              ${phaseRow("Τάση", formatNumber(s.voltage, 1), "V")}
              ${phaseRow("Συχν.", formatNumber(s.frequency, 2), "Hz")}
              ${phaseRow("PF", formatNumber(s.pf, 3))}
            </div>
            ${singleZoneMeter}
          </div>
        </article>
      </section>
      ${dual ? renderTariffEnergy(s) : ""}`;
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
              <div class="device-title-line">
                <h2>${escapeHtml(deviceTitle(device))}</h2>
                ${totalPowerLine}
              </div>
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

  function localDateInputValue(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function localTimeInputValue(date = new Date()) {
    const h = String(date.getHours()).padStart(2, "0");
    const m = String(date.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }

  function refreshDualZoneSettings(device) {
    const s = device.state || {};
    const supported =
      firmwareAtLeast(s.firmware, 3, 0) &&
      Object.prototype.hasOwnProperty.call(s, "has_utility");

    const dual = supported && (s.dual_zone === true || s.tariff_mode === "dual");

    ui.dualZoneUnsupported.classList.toggle("hidden", supported);
    ui.dualZoneToggle.disabled = !supported;
    ui.saveDualZoneBtn.disabled = !supported;
    ui.dualZoneToggle.checked = dual;
    ui.dualZoneDetails.classList.toggle("hidden", !dual);

    ui.monoReadingFields.classList.toggle("hidden", dual);
    ui.dualReadingFields.classList.toggle("hidden", !dual);

    if (!ui.utilityDateInput.value) {
      ui.utilityDateInput.value = localDateInputValue();
    }

    ui.saveDualZoneBtn.textContent = "ΑΠΟΘΗΚΕΥΣΗ ΤΥΠΟΥ ΜΕΤΡΗΤΗ";
  }

  function firmwareAtLeast(value, requiredMajor, requiredMinor) {
    const match = String(value || "").trim().match(/^(\d+)\.(\d+)/);
    if (!match) return false;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    return major > requiredMajor || (major === requiredMajor && minor >= requiredMinor);
  }

  function compareFirmwareVersions(a, b) {
    const parse = (value) => {
      const match = String(value || "").trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
      if (!match) return null;
      return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
    };

    const av = parse(a);
    const bv = parse(b);
    if (!av || !bv) return 0;

    for (let i = 0; i < 3; i += 1) {
      if (av[i] > bv[i]) return 1;
      if (av[i] < bv[i]) return -1;
    }
    return 0;
  }

  function parseOtaManifest(text) {
    const data = {};
    String(text || "").split(/\r?\n/).forEach((line) => {
      const pos = line.indexOf("=");
      if (pos <= 0) return;
      const key = line.slice(0, pos).trim();
      const value = line.slice(pos + 1).trim();
      if (key) data[key] = value;
    });

    const size = Number(data.size);
    if (!data.version ||
        !/^[A-Za-z0-9._-]+\.bin$/.test(data.file || "") ||
        !Number.isInteger(size) || size <= 0 ||
        !/^[0-9a-f]{32}$/i.test(data.md5 || "")) {
      throw new Error("Μη έγκυρο OTA manifest.");
    }

    return {
      version: data.version,
      file: data.file,
      size,
      md5: data.md5.toLowerCase(),
      meter: String(data.meter || "").toUpperCase(),
      oled: String(data.oled || "")
    };
  }

  function otaManifestMatchesDevice(manifest, device) {
    const type = meterType(device);
    if (manifest.meter.includes("JSY") && type !== "JSY") return false;
    if (manifest.meter.includes("DDS") && type !== "DDS") return false;
    return true;
  }

  async function loadOtaManifest() {
    const manifestUrl = `${OTA_MANIFEST_URL}?cb=${Date.now()}`;
    const response = await fetch(manifestUrl, {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`OTA manifest HTTP ${response.status}`);
    }
    return parseOtaManifest(await response.text());
  }

  function clearOtaAckTimer() {
    if (otaAckTimer) clearTimeout(otaAckTimer);
    otaAckTimer = null;
  }

  function clearOtaSessionTimers() {
    if (otaPollTimer) clearInterval(otaPollTimer);
    if (otaTimeoutTimer) clearTimeout(otaTimeoutTimer);
    if (otaElapsedTimer) clearInterval(otaElapsedTimer);
    otaPollTimer = null;
    otaTimeoutTimer = null;
    otaElapsedTimer = null;
  }

  function otaElapsedSeconds() {
    if (!otaSession || !otaSession.startedAt) return 0;
    return Math.max(0, Math.round((Date.now() - otaSession.startedAt) / 1000));
  }

  function setOtaProgressUi(mode, status, details = "") {
    const running = mode === "running";
    const success = mode === "success";
    const error = mode === "error";

    ui.otaProgressVisual.classList.toggle("is-running", running);
    ui.otaProgressVisual.classList.toggle("is-success", success);
    ui.otaProgressVisual.classList.toggle("is-error", error);

    ui.otaProgressTitle.textContent = success
      ? "Η αναβάθμιση ολοκληρώθηκε"
      : (error ? "Η αναβάθμιση απέτυχε" : "Αναβάθμιση λογισμικού");

    ui.otaProgressStatus.textContent = status;
    ui.otaProgressDetails.textContent = details;
    ui.otaProgressCloseBtn.classList.toggle("hidden", running);
    ui.otaProgressCloseBtn.disabled = running;
  }

  function updateOtaRunningDetails(extra = "") {
    if (!otaSession) return;
    const elapsed = otaElapsedSeconds();
    const onlineText = otaSession.sawOffline
      ? (otaSession.sawOnlineAfterStart ? "επανήλθε online" : "offline / αναβάθμιση")
      : "αναμονή επανεκκίνησης";

    const lines = [
      `Συσκευή: ${otaSession.id}`,
      `Έκδοση: ${otaSession.fromVersion} → ${otaSession.targetVersion}`,
      `Χρόνος: ${elapsed}s`,
      `Κατάσταση MQTT: ${onlineText}`
    ];

    if (extra) lines.push(extra);
    ui.otaProgressDetails.textContent = lines.join("\n");
  }

  function failOtaBeforeStart(reason, debug = "") {
    clearOtaAckTimer();

    const pending = otaAwaitingStart;
    otaAwaitingStart = null;

    if (pending) {
      adminBusy.delete(pending.id);
      updateAdminButtons();
    }

    const message = `OTA δεν ξεκίνησε: ${reason}`;
    setAdminStatus(debug ? `${message} · ${debug}` : message, "error");
    showToast(message, 6000);
  }

  function failActiveOta(reason, debug = "") {
    if (!otaSession) return;

    clearOtaSessionTimers();

    const session = otaSession;
    otaSession = null;

    const details = [
      `Συσκευή: ${session.id}`,
      `Από: ${session.fromVersion}`,
      `Στόχος: ${session.targetVersion}`,
      `Χρόνος: ${Math.max(0, Math.round((Date.now() - session.startedAt) / 1000))}s`,
      debug ? `Debug: ${debug}` : ""
    ].filter(Boolean).join("\n");

    setOtaProgressUi("error", reason, details);
    showToast(`${session.id}: OTA αποτυχία`, 6000);
  }

  function completeActiveOta(currentVersion) {
    if (!otaSession) return;

    clearOtaSessionTimers();

    const session = otaSession;
    otaSession = null;

    const details = [
      `Συσκευή: ${session.id}`,
      `Προηγούμενη: ${session.fromVersion}`,
      `Νέα: ${currentVersion}`,
      "Το ESP8266 επανήλθε online και επιβεβαίωσε τη νέα έκδοση."
    ].join("\n");

    setOtaProgressUi(
      "success",
      `Firmware ${currentVersion} ενεργό.`,
      details
    );
    showToast(`${session.id}: OTA ${currentVersion} ολοκληρώθηκε`, 6000);
  }

  function beginConfirmedOta(id, responseData) {
    if (!otaAwaitingStart || otaAwaitingStart.id !== id) return;

    clearOtaAckTimer();

    const pending = otaAwaitingStart;
    otaAwaitingStart = null;
    adminBusy.delete(id);
    updateAdminButtons();

    otaSession = {
      id,
      fromVersion: pending.fromVersion,
      targetVersion: pending.targetVersion,
      manifest: pending.manifest,
      startedAt: Date.now(),
      sawOffline: false,
      sawOnlineAfterStart: false,
      ack: responseData
    };

    if (ui.adminDialog.open) ui.adminDialog.close();

    ui.otaProgressDevice.textContent = id;
    ui.otaProgressVersions.textContent =
      `${pending.fromVersion} → ${pending.targetVersion}`;

    setOtaProgressUi(
      "running",
      "Ο ESP8266 αποδέχτηκε το OTA. Γίνεται λήψη, έλεγχος MD5 και εγκατάσταση…"
    );
    updateOtaRunningDetails("ACK OTA: state=starting");

    if (!ui.otaProgressDialog.open) ui.otaProgressDialog.showModal();

    otaElapsedTimer = setInterval(() => updateOtaRunningDetails(), 1000);

    otaPollTimer = setInterval(() => {
      if (!otaSession || otaSession.id !== id) return;
      if (client && client.connected) requestUpdate(id, false);
    }, OTA_POLL_MS);

    otaTimeoutTimer = setTimeout(() => {
      if (!otaSession || otaSession.id !== id) return;
      const device = devices.get(id);
      const lastFw = device ? String((device.state || {}).firmware || "?") : "?";
      failActiveOta(
        "Δεν επιβεβαιώθηκε η νέα έκδοση μέσα σε 5 λεπτά.",
        `Τελευταία γνωστή έκδοση: ${lastFw}. Έλεγξε OLED / Recovery / MQTT.`
      );
    }, OTA_TOTAL_TIMEOUT_MS);

    setTimeout(() => {
      if (otaSession && otaSession.id === id) requestUpdate(id, false);
    }, 7000);
  }

  function openOtaPinDialog(id, manifest) {
    const device = devices.get(id);
    if (!device) return;

    const fw = String((device.state || {}).firmware || "");
    otaTargetId = id;
    otaPendingManifest = manifest;

    ui.otaPinInput.value = "";
    ui.otaPinError.textContent = "";
    ui.otaPinError.classList.add("hidden");
    ui.otaPinTarget.textContent =
      `Συσκευή: ${id} · ${fw} → ${manifest.version}`;
    ui.otaPinDialog.showModal();
    setTimeout(() => ui.otaPinInput.focus(), 50);
  }

  function sendPendingRemoteOta() {
    const id = otaTargetId;
    const manifest = otaPendingManifest;

    otaTargetId = null;
    otaPendingManifest = null;

    if (!id || !manifest) {
      setAdminStatus("Δεν υπάρχει έτοιμη OTA εντολή.", "error");
      return;
    }

    const device = devices.get(id);
    if (!device) {
      showToast("Η συσκευή δεν είναι πλέον διαθέσιμη.");
      return;
    }

    if (!client || !client.connected) {
      setAdminStatus("Δεν υπάρχει σύνδεση με HiveMQ.", "error");
      showToast("Δεν υπάρχει σύνδεση με HiveMQ.");
      return;
    }

    clearOtaAckTimer();

    const fromVersion = String((device.state || {}).firmware || "?");
    otaAwaitingStart = {
      id,
      fromVersion,
      targetVersion: manifest.version,
      manifest,
      sentAt: Date.now()
    };

    adminBusy.add(id);
    updateAdminButtons();
    setAdminStatus(
      `Αποστολή OTA ${fromVersion} → ${manifest.version}. Αναμονή επιβεβαίωσης από ESP8266…`
    );

    const firmwareUrl = OTA_RAW_BASE_URL + encodeURIComponent(manifest.file);
    const command =
      `ota_https|${manifest.size}|${manifest.md5}|${firmwareUrl}`;

    const sent = publish(id, "admin/request", command, (err) => {
      if (!err) return;
      if (!otaAwaitingStart || otaAwaitingStart.id !== id) return;
      failOtaBeforeStart(
        "Αποτυχία MQTT publish.",
        err.message || String(err)
      );
    });

    if (!sent) {
      failOtaBeforeStart("Δεν υπάρχει ενεργή MQTT σύνδεση.");
      return;
    }

    otaAckTimer = setTimeout(() => {
      if (!otaAwaitingStart || otaAwaitingStart.id !== id) return;
      failOtaBeforeStart(
        "Δεν ελήφθη επιβεβαίωση έναρξης από τον ESP8266.",
        "Timeout 12s στο admin/response."
      );
    }, OTA_ACK_TIMEOUT_MS);
  }

  async function startRemoteOta(id) {
    const device = devices.get(id);
    if (!device) {
      showToast("Η συσκευή δεν είναι πλέον διαθέσιμη.");
      return;
    }
    if (!client || !client.connected) {
      showToast("Δεν υπάρχει σύνδεση με HiveMQ.");
      return;
    }

    const fw = String((device.state || {}).firmware || "");
    if (!firmwareAtLeast(fw, 2, 29)) {
      setAdminStatus("Το remote OTA απαιτεί πρώτα firmware 2.29+.", "error");
      showToast(`${id}: απαιτεί firmware 2.29+`);
      return;
    }

    otaManifestLoading = true;
    updateAdminButtons();
    setAdminStatus("Έλεγχος διαθέσιμου OTA firmware…");

    try {
      const manifest = await loadOtaManifest();

      if (!otaManifestMatchesDevice(manifest, device)) {
        throw new Error(`Το διαθέσιμο firmware ${manifest.meter || "?"} δεν αντιστοιχεί στη συσκευή.`);
      }

      const currentFw = String((device.state || {}).firmware || "?");
      const oledText = manifest.oled ? ` · ${manifest.oled}` : "";
      const versionComparison = compareFirmwareVersions(manifest.version, currentFw);

      if (versionComparison < 0) {
        setAdminStatus(
          `Το διαθέσιμο OTA v${manifest.version} είναι παλαιότερο από το τρέχον v${currentFw}. Το downgrade μπλοκαρίστηκε.`,
          "error"
        );
        showToast(`${id}: OTA downgrade μπλοκαρίστηκε`, 5000);
        return;
      }

      const isNewer = versionComparison > 0;
      const newBadge = isNewer ? " · NEW!" : "";

      ui.otaTargetInfo.textContent =
        `ESP8266: ${currentFw} · Available OTA: ${manifest.version}${newBadge}`;

      const confirmed = window.confirm(
        `OTA αναβάθμιση ${id}\n\n` +
        `Τρέχουσα έκδοση ESP8266: ${currentFw}\n` +
        `Available OTA: ${manifest.version}${oledText}${newBadge}\n\n` +
        "Ο ESP θα αποσυνδεθεί προσωρινά από MQTT και θα επανεκκινήσει. Συνέχεια;"
      );

      if (!confirmed) {
        setAdminStatus("Το OTA ακυρώθηκε.");
        return;
      }

      // v1.11: πρώτα εμφανίζονται current/available version και NEW!,
      // μετά η τελική επιβεβαίωση και τελευταίο βήμα το PIN.
      // Καμία MQTT OTA εντολή δεν αποστέλλεται πριν επαληθευτεί το PIN.
      openOtaPinDialog(id, manifest);
      setAdminStatus(
        `ESP8266 ${currentFw} → OTA ${manifest.version}${newBadge} · αναμονή PIN.`
      );
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      setAdminStatus(`OTA: ${message}`, "error");
      showToast(`${id}: ${message}`, 5000);
    } finally {
      otaManifestLoading = false;
      updateAdminButtons();
    }
  }

  function utilityCurrentDual() {
    if (!adminTargetId) return false;
    const device = devices.get(adminTargetId);
    if (!device) return false;
    return device.state.dual_zone === true || device.state.tariff_mode === "dual";
  }

  function utilityKindValue() {
    return ui.utilityKindIntermediate.checked ? "ek" : "tk";
  }

  function resetUtilityEditor() {
    editingUtilityId = null;
    utilityEntryStep = 0;
    ui.utilityEntryTitle.textContent = "Νέα καταχώρηση";
    ui.utilityKindFinal.checked = true;
    ui.utilityKindIntermediate.checked = false;
    ui.utilityDateInput.value = localDateInputValue();
    ui.utilityTimeInput.value = localTimeInputValue();
    ui.utilityZInput.value = "";
    ui.utilityZ1Input.value = "";
    ui.utilityZ2Input.value = "";
    setUtilityEntryStep(0);
  }

  function setUtilityEntryStep(step) {
    utilityEntryStep = Math.max(0, Math.min(4, step));
    const steps = [
      ui.utilityStepType,
      ui.utilityStepDate,
      ui.utilityStepTime,
      ui.utilityStepReading,
      ui.utilityStepConfirm
    ];
    steps.forEach((node, index) => node.classList.toggle("hidden", index !== utilityEntryStep));
    ui.utilityStepLabel.textContent = `Βήμα ${utilityEntryStep + 1} από 5`;
  }

  function updateUtilityReadingMode() {
    const dual = utilityCurrentDual();
    ui.monoReadingFields.classList.toggle("hidden", dual);
    ui.dualReadingFields.classList.toggle("hidden", !dual);
    ui.utilityTariffLabel.textContent = `Τιμολόγιο: ${dual ? "Διζωνικό Ζ1 / Ζ2" : "Μονοζωνικό Ζ"}`;
  }

  function openUtilityEntry(row = null) {
    if (!adminTargetId) return;
    const device = devices.get(adminTargetId);
    if (!device) return;

    if (!firmwareAtLeast((device.state || {}).firmware, 3, 4)) {
      setAdminStatus("Οι καταχωρήσεις Τ.Κ./Ε.Κ. απαιτούν firmware v3.04+.", "error");
      return;
    }

    const currentMode = utilityCurrentDual() ? "dual" : "mono";
    if (row && row.mode !== currentMode) {
      showToast("Για διόρθωση, το τιμολόγιο Ζ / Ζ1-Ζ2 πρέπει να είναι ίδιο με την εγγραφή.");
      return;
    }

    resetUtilityEditor();
    editingUtilityId = row ? row.id : null;
    ui.utilityEntryTitle.textContent = row ? "Διόρθωση καταχώρησης" : "Νέα καταχώρηση";

    if (row) {
      ui.utilityKindFinal.checked = row.kind !== "ek";
      ui.utilityKindIntermediate.checked = row.kind === "ek";
      ui.utilityDateInput.value = row.date;
      ui.utilityTimeInput.value = row.timeToken === "window" ? "" : row.timeToken;
      if (row.mode === "dual") {
        ui.utilityZ1Input.value = row.z1.toFixed(2);
        ui.utilityZ2Input.value = row.z2.toFixed(2);
      } else {
        ui.utilityZInput.value = row.z.toFixed(2);
      }
    }

    updateUtilityReadingMode();
    setUtilityEntryStep(0);
    if (!ui.utilityEntryDialog.open) ui.utilityEntryDialog.showModal();
  }

  function utilityStepValid(step) {
    if (step === 0) return ui.utilityKindFinal.checked || ui.utilityKindIntermediate.checked;

    if (step === 1) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ui.utilityDateInput.value.trim())) {
        showToast("Επίλεξε έγκυρη ημερομηνία μέτρησης.");
        return false;
      }
      return true;
    }

    if (step === 2) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(ui.utilityTimeInput.value.trim())) {
        showToast("Επίλεξε την ώρα που πήρες την ένδειξη.");
        return false;
      }
      return true;
    }

    if (step === 3) {
      if (utilityCurrentDual()) {
        const z1 = Number(ui.utilityZ1Input.value);
        const z2 = Number(ui.utilityZ2Input.value);
        if (!Number.isFinite(z1) || !Number.isFinite(z2) ||
            z1 <= 0 || z2 <= 0 || z1 >= 999999 || z2 >= 999999) {
          showToast("Γράψε έγκυρες ενδείξεις Ζ1 και Ζ2.");
          return false;
        }
      } else {
        const z = Number(ui.utilityZInput.value);
        if (!Number.isFinite(z) || z <= 0 || z >= 999999) {
          showToast("Γράψε έγκυρη ένδειξη Ζ.");
          return false;
        }
      }
      return true;
    }

    return true;
  }

  function prepareUtilityConfirmation() {
    const form = readUtilityForm();
    if (!form) return false;
    const kindLabel = form.kind === "ek"
      ? "Ε.Κ. — Ενδιάμεση Καταχώρηση"
      : "Τ.Κ. — Τελική Καταχώρηση";

    const values = form.dual
      ? `<div class="utility-confirm-values"><strong>Ζ1: ${formatNumber(form.z1, 2)} kWh</strong><strong>Ζ2: ${formatNumber(form.z2, 2)} kWh</strong></div>`
      : `<div class="utility-confirm-values"><strong>Ζ: ${formatNumber(form.z, 2)} kWh</strong></div>`;

    ui.utilityConfirmSummary.innerHTML = `
      ${values}
      <div>Τιμολόγιο: <b>${form.dual ? "Διζωνικό Ζ1 / Ζ2" : "Μονοζωνικό Ζ"}</b></div>
      <div>Τύπος: <b>${kindLabel}</b></div>
      <div>Ημερομηνία: <b>${escapeHtml(form.date)}</b></div>
      <div>Ώρα: <b>${escapeHtml(form.time)}</b></div>
    `;
    return true;
  }

  function openAdmin(id) {
    const device = devices.get(id);
    if (!device) return;

    adminTargetId = id;
    utilityHistoryRows = [];
    utilityHistoryDeviceId = null;
    resetUtilityEditor();

    ui.adminEyebrow.textContent = `${meterName(device)} SETTINGS`;
    ui.adminTitle.textContent = `Ρυθμίσεις · ${id}`;
    refreshDualZoneSettings(device);

    const fw = String((device.state || {}).firmware || "?");
    ui.otaTargetInfo.textContent = firmwareAtLeast(fw, 2, 29)
      ? `Τρέχον firmware: ${fw}. Έτοιμο για remote OTA.`
      : `Τρέχον firmware: ${fw}. Το remote OTA απαιτεί 2.29+.`;

    const supportsEntryTypes = firmwareAtLeast(fw, 3, 4);
    setAdminStatus(
      supportsEntryTypes
        ? "Έτοιμο."
        : (firmwareAtLeast(fw, 3, 0)
            ? "Οι καταχωρήσεις Τ.Κ./Ε.Κ. απαιτούν firmware v3.04+."
            : "Οι μετρήσεις απαιτούν firmware v3.00+."),
      supportsEntryTypes ? "ok" : "error"
    );

    renderUtilityLatestSummary(id);
    updateAdminButtons();
    ui.adminDialog.showModal();

    if (firmwareAtLeast(fw, 3, 0) && client && client.connected) {
      setTimeout(() => refreshUtilityRows(id, false), 0);
    }
  }

  function setAdminStatus(message, kind = "") {
    ui.adminStatus.textContent = message;
    ui.adminStatus.classList.remove("is-ok", "is-error");
    if (kind) ui.adminStatus.classList.add(`is-${kind}`);
  }

  function updateAdminButtons() {
    const busy = adminTargetId && adminBusy.has(adminTargetId);
    const connected = Boolean(client && client.connected);
    const device = adminTargetId ? devices.get(adminTargetId) : null;
    const state = device ? (device.state || {}) : {};
    const supportsV3 = Boolean(device && firmwareAtLeast(state.firmware, 3, 0));
    const supportsTypes = Boolean(device && firmwareAtLeast(state.firmware, 3, 4));

    if (ui.utilityHistoryBtn) {
      ui.utilityHistoryBtn.disabled = !adminTargetId || busy || !connected || !supportsV3;
    }
    if (ui.startUtilityReadingBtn) {
      ui.startUtilityReadingBtn.disabled = !adminTargetId || busy || !connected || !supportsTypes;
    }
    if (ui.saveDualZoneBtn) {
      ui.saveDualZoneBtn.disabled = !adminTargetId || busy || !connected || !supportsV3;
    }
    if (ui.saveUtilityReadingBtn) {
      ui.saveUtilityReadingBtn.disabled = !adminTargetId || busy || !connected || !supportsTypes;
    }

    [
      ui.utilityDateInput,
      ui.utilityTimeInput,
      ui.utilityZInput,
      ui.utilityZ1Input,
      ui.utilityZ2Input,
      ui.utilityKindFinal,
      ui.utilityKindIntermediate,
      ui.dualZoneToggle
    ].forEach((control) => {
      if (control) control.disabled =
        !adminTargetId || busy || !connected ||
        (control === ui.dualZoneToggle ? !supportsV3 : !supportsTypes);
    });

    if (ui.otaUpdateBtn) {
      const fwForOta = String(state.firmware || "");
      ui.otaUpdateBtn.disabled =
        !adminTargetId || busy || !connected || otaManifestLoading ||
        !firmwareAtLeast(fwForOta, 2, 29);
    }
  }

  function readUtilityForm() {
    if (!adminTargetId) return null;
    const device = devices.get(adminTargetId);
    if (!device) return null;

    const dual = utilityCurrentDual();
    const kind = utilityKindValue();
    const date = ui.utilityDateInput.value.trim();
    const time = ui.utilityTimeInput.value.trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setAdminStatus("Επίλεξε έγκυρη ημερομηνία μέτρησης.", "error");
      return null;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setAdminStatus("Επίλεξε έγκυρη ώρα μέτρησης.", "error");
      return null;
    }

    if (dual) {
      const z1 = Number(ui.utilityZ1Input.value);
      const z2 = Number(ui.utilityZ2Input.value);
      if (!Number.isFinite(z1) || !Number.isFinite(z2) ||
          z1 <= 0 || z2 <= 0 || z1 >= 999999 || z2 >= 999999) {
        setAdminStatus("Γράψε έγκυρες ενδείξεις Ζ1 και Ζ2.", "error");
        return null;
      }
      return {
        kind, dual: true, date, time, z1, z2,
        commandTail: `${kind}|dual|${date}|${time}|${z1.toFixed(2)}|${z2.toFixed(2)}`
      };
    }

    const z = Number(ui.utilityZInput.value);
    if (!Number.isFinite(z) || z <= 0 || z >= 999999) {
      setAdminStatus("Γράψε έγκυρη ένδειξη Ζ.", "error");
      return null;
    }
    return {
      kind, dual: false, date, time, z,
      commandTail: `${kind}|mono|${date}|${time}|${z.toFixed(2)}`
    };
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

  function utilitySaveMessage(data) {
    const kind = data && data.kind === "ek" ? "Ε.Κ." : "Τ.Κ.";
    if (!data || data.mapped !== true) {
      return `Η ${kind} αποθηκεύτηκε. Δεν υπάρχει αρκετό εσωτερικό ιστορικό για υπολογισμό απόκλισης.`;
    }
    return `Η ${kind} αποθηκεύτηκε.`;
  }

  function handleAdminResponse(id, text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      if (otaAwaitingStart && otaAwaitingStart.id === id) {
        failOtaBeforeStart(
          "Μη έγκυρη απάντηση από ESP8266.",
          `Payload: ${String(text).slice(0, 140)}`
        );
      } else if (adminTargetId === id) {
        setAdminStatus("Μη έγκυρη admin απάντηση.", "error");
      }
      return;
    }

    const errorMessages = {
      invalid_reading: "Τα στοιχεία της μέτρησης ΔΕΗ δεν είναι έγκυρα.",
      invalid_reading_id: "Η εγγραφή ΔΕΗ δεν είναι έγκυρη.",
      reading_not_found: "Η μέτρηση ΔΕΗ δεν βρέθηκε.",
      storage_failed: "Απέτυχε η αποθήκευση στο ESP8266.",
      tariff_mode_mismatch: "Η μέτρηση δεν ταιριάζει με τον ενεργό τύπο Ζ / Ζ1-Ζ2.",
      time_not_valid: "Ο ESP δεν έχει ακόμα έγκυρη ημερομηνία/ώρα από NTP.",
      dds238_read_failed: "Απέτυχε η ανάγνωση DDS238.",
      jsy_read_failed: "Απέτυχε η ανάγνωση JSY-MK-333.",
      missing_parameters: "Λείπουν παράμετροι OTA.",
      invalid_https_url: "Το OTA URL δεν είναι έγκυρο.",
      invalid_command: "Ο ESP8266 δεν αναγνώρισε την εντολή."
    };

    const ok = Boolean(data.ok);
    const otaResponse = data.cmd === "ota_https";
    const otaStarting = ok && otaResponse && data.state === "starting";

    if (otaStarting) {
      beginConfirmedOta(id, data);
      showToast(
        `${id}: OTA ξεκίνησε επιτυχώς · ${data.from || "?"} → ${otaSession ? otaSession.targetVersion : "?"}`,
        6500
      );
      return;
    }

    if (otaResponse && otaAwaitingStart && otaAwaitingStart.id === id) {
      const reason = ok
        ? `Μη αναμενόμενη OTA απάντηση: ${data.state || "χωρίς state"}`
        : (errorMessages[data.error] || `ESP error: ${data.error || "άγνωστο"}`);
      failOtaBeforeStart(reason, `admin/response: ${text.slice(0, 180)}`);
      return;
    }

    adminBusy.delete(id);
    updateAdminButtons();

    if (!ok) {
      const msg = errorMessages[data.error] || `Σφάλμα: ${data.error || "άγνωστο"}`;
      if (adminTargetId === id) setAdminStatus(msg, "error");
      showToast(`${id}: ${msg}`, 5000);
      return;
    }

    if (data.cmd === "utility_reading_add" ||
        data.cmd === "utility_reading_update") {
      const msg = utilitySaveMessage(data);
      if (adminTargetId === id) {
        setAdminStatus(msg, "ok");
        if (ui.utilityEntryDialog.open) ui.utilityEntryDialog.close();
        resetUtilityEditor();
      }
      showToast(`${id}: καταχώρηση αποθηκεύτηκε`, 4500);
      setTimeout(() => requestUpdate(id, false), 250);
      setTimeout(() => {
        if (adminTargetId === id) refreshUtilityRows(id, false);
      }, 450);
      return;
    }

    if (data.cmd === "utility_reading_delete") {
      if (adminTargetId === id) setAdminStatus("Η καταχώρηση διαγράφηκε.", "ok");
      showToast(`${id}: η καταχώρηση διαγράφηκε`);
      setTimeout(() => requestUpdate(id, false), 250);
      setTimeout(() => {
        if (adminTargetId === id) refreshUtilityRows(id, ui.utilityHistoryDialog.open);
      }, 400);
      return;
    }

    if (data.cmd === "tariff_mode_set") {
      if (adminTargetId === id) {
        setAdminStatus(
          `Τύπος μετρητή: ${data.mode === "dual" ? "Ζ1 / Ζ2" : "Ζ"}.`,
          "ok"
        );
        resetUtilityEditor();
      }
      setTimeout(() => requestUpdate(id, false), 250);
      return;
    }

    if (data.cmd === "utility_readings_list") {
      return;
    }

    const msg = `OK: ${data.cmd || "admin"}`;
    if (adminTargetId === id) setAdminStatus(msg, "ok");
    showToast(`${id}: ${msg}`);
  }

  function utilitySortTime(row) {
    if (row.timeToken && row.timeToken !== "window") return row.timeToken;
    return "13:00";
  }

  function parseUtilityHistoryRows(rows) {
    return rows
      .filter((row) => !row.startsWith("ID,"))
      .map((row) => {
        const f = row.split(",");
        if (f.length >= 12 && (f[3] === "tk" || f[3] === "ek")) {
          return {
            id: Number(f[0]),
            date: f[1],
            mode: f[2],
            kind: f[3],
            z: Number(f[4]),
            z1: Number(f[5]),
            z2: Number(f[6]),
            timeToken: f[7] || "window",
            mapped: f[8] === "1",
            anchor: Number(f[9]),
            anchorZ1: Number(f[10]),
            anchorZ2: Number(f[11])
          };
        }
        if (f.length < 7) return null;
        return {
          id: Number(f[0]),
          date: f[1],
          mode: f[2],
          kind: "tk",
          z: Number(f[3]),
          z1: Number(f[4]),
          z2: Number(f[5]),
          timeToken: f[6] || "window",
          mapped: false,
          anchor: NaN,
          anchorZ1: NaN,
          anchorZ2: NaN
        };
      })
      .filter((row) =>
        row &&
        Number.isFinite(row.id) &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.date)
      )
      .sort((a, b) =>
        a.date.localeCompare(b.date) ||
        utilitySortTime(a).localeCompare(utilitySortTime(b)) ||
        a.id - b.id
      );
  }

  function formatUtilityDate(date) {
    const m = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(date || "—");
  }

  function utilityDateTimeLabel(row) {
    const time = row.timeToken && row.timeToken !== "window" ? row.timeToken : "—";
    return `${formatUtilityDate(row.date)} ${time}`;
  }

  function utilityKindBadge(row) {
    const isEk = row.kind === "ek";
    return `<span class="reading-kind ${isEk ? "kind-ek" : "kind-tk"}" title="${isEk ? "Ενδιάμεση Καταχώρηση" : "Τελική Καταχώρηση"}">${isEk ? "Ε.Κ." : "Τ.Κ."}</span>`;
  }

  function utilityDeviation(previous, row) {
    if (!previous || !previous.mapped || !row.mapped || previous.mode !== row.mode) return null;

    let realDelta;
    let espDelta;
    if (row.mode === "dual") {
      realDelta = (row.z1 + row.z2) - (previous.z1 + previous.z2);
      if (![row.anchorZ1, row.anchorZ2, previous.anchorZ1, previous.anchorZ2].every(Number.isFinite)) return null;
      espDelta = (row.anchorZ1 + row.anchorZ2) - (previous.anchorZ1 + previous.anchorZ2);
    } else {
      realDelta = row.z - previous.z;
      if (![row.anchor, previous.anchor].every(Number.isFinite)) return null;
      espDelta = row.anchor - previous.anchor;
    }

    if (!Number.isFinite(realDelta) || !Number.isFinite(espDelta) ||
        realDelta < MIN_DEVIATION_KWH || espDelta < 0) return null;
    return ((espDelta - realDelta) / realDelta) * 100;
  }

  function deviationText(value) {
    if (!Number.isFinite(value)) return "—";
    const sign = value > 0 ? "+" : "";
    return `${sign}${formatNumber(value, 2)}%`;
  }

  function utilityActionButtons(row, currentMode, firmware) {
    const canEdit = row.mode === currentMode && firmwareAtLeast(firmware, 3, 4);
    return `
      <div class="history-actions">
        <button class="secondary-btn history-btn" type="button"
          data-utility-action="edit" data-utility-id="${row.id}"
          ${canEdit ? "" : "disabled"}>ΔΙΟΡΘΩΣΗ</button>
        <button class="danger-outline-btn history-btn" type="button"
          data-utility-action="delete" data-utility-id="${row.id}">ΔΙΑΓΡΑΦΗ</button>
      </div>`;
  }

  function renderUtilityLatestSummary(id) {
    const device = devices.get(id);
    if (!device || !ui.utilityLatestSummary) return;

    const dualNow = device.state.dual_zone === true || device.state.tariff_mode === "dual";
    if (utilityHistoryDeviceId !== id) {
      ui.utilityLatestSummary.innerHTML = `
        <div class="utility-latest-values"><strong>Φόρτωση τελευταίας μέτρησης…</strong></div>
        <div class="utility-latest-meta">Τιμολόγιο: ${dualNow ? "Διζωνικό Ζ1 / Ζ2" : "Μονοζωνικό Ζ"}</div>
        <div class="utility-latest-meta">Ημερομηνία – Ώρα: —</div>`;
      return;
    }

    const finals = utilityHistoryRows.filter((row) => row.kind !== "ek");
    const latest = finals.length ? finals[finals.length - 1] : null;
    if (!latest) {
      ui.utilityLatestSummary.innerHTML = `
        <div class="utility-latest-values"><strong>Τελευταία μέτρηση ΔΕΗ: —</strong></div>
        <div class="utility-latest-meta">Τιμολόγιο: ${dualNow ? "Διζωνικό Ζ1 / Ζ2" : "Μονοζωνικό Ζ"}</div>
        <div class="utility-latest-meta">Ημερομηνία – Ώρα: —</div>`;
      return;
    }

    const values = latest.mode === "dual"
      ? `<span><small>Ζ1</small><strong>${formatNumber(latest.z1, 2)} kWh</strong></span><span><small>Ζ2</small><strong>${formatNumber(latest.z2, 2)} kWh</strong></span>`
      : `<span><small>Ζ</small><strong>${formatNumber(latest.z, 2)} kWh</strong></span>`;

    ui.utilityLatestSummary.innerHTML = `
      <div class="utility-latest-values">${values}</div>
      <div class="utility-latest-meta">Τιμολόγιο: ${latest.mode === "dual" ? "Διζωνικό Ζ1 / Ζ2" : "Μονοζωνικό Ζ"}</div>
      <div class="utility-latest-meta">Ημερομηνία – Ώρα: ${escapeHtml(utilityDateTimeLabel(latest))}</div>`;
  }

  function renderUtilityHistory(id) {
    const device = devices.get(id);
    if (!device) return;
    const currentMode =
      device.state.dual_zone === true || device.state.tariff_mode === "dual"
        ? "dual" : "mono";
    const firmware = String((device.state || {}).firmware || "");
    const monoRows = utilityHistoryRows.filter((row) => row.mode === "mono");
    const dualRows = utilityHistoryRows.filter((row) => row.mode === "dual");
    const sections = [];

    if (monoRows.length) {
      let previous = null;
      const body = monoRows.map((row) => {
        const diff = previous ? row.z - previous.z : null;
        const deviation = utilityDeviation(previous, row);
        const html = `
          <tr>
            <td>${escapeHtml(utilityDateTimeLabel(row))}</td>
            <td>${utilityKindBadge(row)}</td>
            <td><b>${diff === null ? "—" : formatNumber(diff, 2)}</b></td>
            <td>${formatNumber(row.z, 2)}</td>
            <td class="deviation-cell"><b>${deviationText(deviation)}</b></td>
            <td>${utilityActionButtons(row, currentMode, firmware)}</td>
          </tr>`;
        previous = row;
        return html;
      }).join("");

      sections.push(`
        <h3>Μετρήσεις Ζ</h3>
        <div class="history-table-wrap">
          <table class="utility-history-table">
            <thead><tr><th>Ημερομηνία / Ώρα</th><th>Τύπος</th><th>Διαφορά</th><th>Ζ</th><th>Απόκλιση</th><th></th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>`);
    }

    if (dualRows.length) {
      let previous = null;
      const body = dualRows.map((row) => {
        const dz1 = previous ? row.z1 - previous.z1 : null;
        const dz2 = previous ? row.z2 - previous.z2 : null;
        const total = previous ? dz1 + dz2 : null;
        const deviation = utilityDeviation(previous, row);
        const html = `
          <tr>
            <td>${escapeHtml(utilityDateTimeLabel(row))}</td>
            <td>${utilityKindBadge(row)}</td>
            <td><b>${dz1 === null ? "—" : formatNumber(dz1, 2)}</b></td>
            <td>${formatNumber(row.z1, 2)}</td>
            <td><b>${dz2 === null ? "—" : formatNumber(dz2, 2)}</b></td>
            <td>${formatNumber(row.z2, 2)}</td>
            <td><b>${total === null ? "—" : formatNumber(total, 2)}</b></td>
            <td class="deviation-cell"><b>${deviationText(deviation)}</b></td>
            <td>${utilityActionButtons(row, currentMode, firmware)}</td>
          </tr>`;
        previous = row;
        return html;
      }).join("");

      sections.push(`
        <h3>Μετρήσεις Ζ1 / Ζ2</h3>
        <div class="history-table-wrap">
          <table class="utility-history-table utility-history-dual">
            <thead>
              <tr><th>Ημερομηνία / Ώρα</th><th>Τύπος</th><th>Δ Ζ1</th><th>Ζ1</th><th>Δ Ζ2</th><th>Ζ2</th><th>Σύνολο Δ</th><th>Απόκλιση</th><th></th></tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>`);
    }

    if (sections.length) {
      sections.push(`<p class="history-note">Η % απόκλιση είναι συμβουλευτική και συγκρίνει τη μεταβολή του ESP με τη μεταβολή ανάμεσα σε δύο διαδοχικές πραγματικές καταχωρήσεις. Για μεταβολή κάτω από ${formatNumber(MIN_DEVIATION_KWH, 1)} kWh εμφανίζεται —.</p>`);
    }

    ui.utilityHistoryTitle.textContent = `Πίνακας μετρήσεων · ${id}`;
    ui.utilityHistoryContent.innerHTML = sections.length
      ? sections.join("")
      : '<p class="admin-help">Δεν έχει καταχωρηθεί ακόμη μέτρηση.</p>';

    if (!ui.utilityHistoryDialog.open) ui.utilityHistoryDialog.showModal();
  }

  function startUtilityEdit(row) {
    if (!row || !adminTargetId) return;
    openUtilityEntry(row);
    if (ui.utilityHistoryDialog.open) ui.utilityHistoryDialog.close();
  }

  function refreshUtilityRows(id, openHistory) {
    if (!id || !client || !client.connected) return;
    utilityListIntent = openHistory ? "history" : "summary";
    csvBuffers.delete(id);
    sendAdmin(
      "utility_readings_list",
      openHistory ? "Λήψη πίνακα μετρήσεων…" : "Λήψη τελευταίας μέτρησης…"
    );
  }

  function handleCsv(id, text) {
    if (text.startsWith("BEGIN|UTILITY|")) {
      csvBuffers.set(id, { type: "utility", rows: [] });
      if (adminTargetId === id) setAdminStatus("Λήψη καταχωρήσεων…");
      return;
    }

    if (text.startsWith("ROW|")) {
      const buffer = csvBuffers.get(id);
      if (!buffer) return;
      const separator = text.indexOf("|", 4);
      if (separator >= 0) buffer.rows.push(text.slice(separator + 1));
      return;
    }

    if (text === "END") {
      const buffer = csvBuffers.get(id);
      if (!buffer) return;

      csvBuffers.delete(id);
      adminBusy.delete(id);
      updateAdminButtons();

      if (buffer.type === "utility") {
        utilityHistoryRows = parseUtilityHistoryRows(buffer.rows);
        utilityHistoryDeviceId = id;
        if (adminTargetId === id) {
          setAdminStatus("Οι καταχωρήσεις φορτώθηκαν.", "ok");
          renderUtilityLatestSummary(id);
        }
        if (utilityListIntent === "history") renderUtilityHistory(id);
        utilityListIntent = "summary";
      }
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

        if (otaSession && otaSession.id === device.id) {
          if (!device.online) {
            otaSession.sawOffline = true;
            ui.otaProgressStatus.textContent =
              "Ο ESP8266 είναι προσωρινά offline. Η αναβάθμιση / επανεκκίνηση βρίσκεται σε εξέλιξη…";
            updateOtaRunningDetails("MQTT status: offline");
          } else if (otaSession.sawOffline) {
            otaSession.sawOnlineAfterStart = true;
            ui.otaProgressStatus.textContent =
              "Ο ESP8266 επανήλθε online. Επιβεβαιώνεται η νέα έκδοση…";
            updateOtaRunningDetails("MQTT status: online μετά το OTA");
            setTimeout(() => requestUpdate(device.id, false), 250);
          }
        }

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

          if (otaSession && otaSession.id === device.id) {
            const currentFw = String((device.state || {}).firmware || "?");
            if (compareFirmwareVersions(currentFw, otaSession.targetVersion) === 0) {
              completeActiveOta(currentFw);
            } else if (
              otaSession.sawOffline &&
              otaSession.sawOnlineAfterStart &&
              Date.now() - otaSession.startedAt > 8000
            ) {
              failActiveOta(
                "Ο ESP8266 επανήλθε, αλλά δεν τρέχει τη ζητούμενη έκδοση.",
                `Τρέχουσα: ${currentFw} · αναμενόμενη: ${otaSession.targetVersion}`
              );
            } else {
              updateOtaRunningDetails(`Τελευταία state έκδοση: ${currentFw}`);
            }
          }

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

  ui.otaUpdateBtn.addEventListener("click", () => {
    if (adminTargetId) startRemoteOta(adminTargetId);
  });

  ui.closeOtaPinBtn.addEventListener("click", () => {
    otaTargetId = null;
    otaPendingManifest = null;
    ui.otaPinDialog.close();
    setAdminStatus("Το OTA ακυρώθηκε.");
  });

  ui.cancelOtaPinBtn.addEventListener("click", () => {
    otaTargetId = null;
    otaPendingManifest = null;
    ui.otaPinDialog.close();
    setAdminStatus("Το OTA ακυρώθηκε.");
  });

  ui.otaPinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const entered = ui.otaPinInput.value.trim();

    if (entered !== OTA_PIN) {
      ui.otaPinError.textContent = "Λάθος PIN.";
      ui.otaPinError.classList.remove("hidden");
      ui.otaPinInput.select();
      return;
    }

    ui.otaPinDialog.close();
    sendPendingRemoteOta();
  });

  ui.otaProgressCloseBtn.addEventListener("click", () => {
    if (otaSession) return;
    ui.otaProgressDialog.close();
  });

  ui.otaProgressDialog.addEventListener("cancel", (event) => {
    if (otaSession) {
      event.preventDefault();
      return;
    }
  });

  ui.startUtilityReadingBtn.addEventListener("click", () => openUtilityEntry());

  ui.closeUtilityEntryBtn.addEventListener("click", () => {
    ui.utilityEntryDialog.close();
    resetUtilityEditor();
  });

  ui.utilityEntryDialog.addEventListener("click", (event) => {
    const button = event.target.closest("[data-entry-action]");
    if (!button) return;
    const action = button.dataset.entryAction;

    if (action === "back") {
      setUtilityEntryStep(utilityEntryStep - 1);
      return;
    }

    if (action === "next") {
      if (!utilityStepValid(utilityEntryStep)) return;
      if (utilityEntryStep === 3 && !prepareUtilityConfirmation()) return;
      setUtilityEntryStep(utilityEntryStep + 1);
    }
  });

  ui.saveUtilityReadingBtn.addEventListener("click", () => {
    const form = readUtilityForm();
    if (!form) return;

    const command = editingUtilityId
      ? `utility_reading_update|${editingUtilityId}|${form.commandTail}`
      : `utility_reading_add|${form.commandTail}`;
    const label = form.kind === "ek" ? "Ε.Κ." : "Τ.Κ.";

    sendAdmin(
      command,
      editingUtilityId
        ? `Αποθήκευση διόρθωσης ${label}…`
        : `Καταχώρηση ${label}…`
    );
  });

  ui.utilityHistoryBtn.addEventListener("click", () => {
    if (!adminTargetId) return;
    refreshUtilityRows(adminTargetId, true);
  });

  ui.closeUtilityHistoryBtn.addEventListener("click", () => {
    ui.utilityHistoryDialog.close();
  });

  ui.utilityHistoryContent.addEventListener("click", (event) => {
    const button = event.target.closest("[data-utility-action]");
    if (!button) return;

    const id = Number(button.dataset.utilityId);
    const row = utilityHistoryRows.find((item) => item.id === id);
    if (!row) return;

    if (button.dataset.utilityAction === "edit") {
      startUtilityEdit(row);
      return;
    }

    if (button.dataset.utilityAction === "delete") {
      const kind = row.kind === "ek" ? "Ε.Κ." : "Τ.Κ.";
      if (!window.confirm(`Να διαγραφεί η ${kind} ${utilityDateTimeLabel(row)};`)) return;
      if (ui.utilityHistoryDialog.open) ui.utilityHistoryDialog.close();
      sendAdmin(
        `utility_reading_delete|${row.id}`,
        "Διαγραφή καταχώρησης…"
      );
    }
  });

  ui.dualZoneToggle.addEventListener("change", () => {
    const enabled = ui.dualZoneToggle.checked;
    ui.dualZoneDetails.classList.toggle("hidden", !enabled);
    ui.monoReadingFields.classList.toggle("hidden", enabled);
    ui.dualReadingFields.classList.toggle("hidden", !enabled);
    if (ui.utilityTariffLabel) {
      ui.utilityTariffLabel.textContent = `Τιμολόγιο: ${enabled ? "Διζωνικό Ζ1 / Ζ2" : "Μονοζωνικό Ζ"}`;
    }
  });

  ui.saveDualZoneBtn.addEventListener("click", () => {
    if (!adminTargetId) return;

    const device = devices.get(adminTargetId);
    if (!device || !firmwareAtLeast((device.state || {}).firmware, 3, 0)) {
      setAdminStatus("Απαιτεί firmware v3.00 ή νεότερο.", "error");
      return;
    }

    const enabled = ui.dualZoneToggle.checked;
    const currentDual =
      device.state.dual_zone === true ||
      device.state.tariff_mode === "dual";

    if (enabled === currentDual) {
      setAdminStatus(
        `Ο τύπος είναι ήδη ${enabled ? "Ζ1 / Ζ2" : "Ζ"}.`,
        "ok"
      );
      return;
    }

    const warning = enabled
      ? "Αλλαγή σε Ζ1 / Ζ2. Οι εσωτερικοί accumulators Ζ1/Ζ2 θα ξεκινήσουν από τώρα. Συνέχεια;"
      : "Αλλαγή σε μονοζωνικό Ζ. Συνέχεια;";

    if (!window.confirm(warning)) {
      ui.dualZoneToggle.checked = currentDual;
      ui.dualZoneDetails.classList.toggle("hidden", !currentDual);
      ui.monoReadingFields.classList.toggle("hidden", currentDual);
      ui.dualReadingFields.classList.toggle("hidden", !currentDual);
      return;
    }

    sendAdmin(
      `tariff_mode_set|${enabled ? "dual" : "mono"}`,
      "Αποθήκευση τύπου μετρητή…"
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
    const hadServiceWorkerController = Boolean(navigator.serviceWorker.controller);
    let reloadingForAppUpdate = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadServiceWorkerController || reloadingForAppUpdate) return;
      reloadingForAppUpdate = true;
      window.location.reload();
    });

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
        .then((registration) => {
          const checkForAppUpdate = () => {
            registration.update().catch((err) => {
              console.warn("Service worker update check failed", err);
            });
          };

          // Έλεγχος αμέσως σε κάθε άνοιγμα και περιοδικά όσο το app μένει ανοιχτό.
          checkForAppUpdate();
          setInterval(checkForAppUpdate, 5 * 60 * 1000);

          // Αν το κινητό επιστρέψει στο app μετά από ώρα, ελέγχουμε αμέσως.
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") checkForAppUpdate();
          });
          window.addEventListener("focus", checkForAppUpdate);
        })
        .catch((err) => {
          console.warn("Service worker registration failed", err);
        });
    });
  }

  const footerSpans = document.querySelectorAll("footer span");
  if (footerSpans[0]) footerSpans[0].textContent = `Energy DDS / JSY v${APP_VERSION}`;
  if (footerSpans[1]) footerSpans[1].textContent = "Auto discovery · Z1/Z2 · refresh 60″";

  restoreSettings();
  renderAll();
  setBrokerState("warn", "Αποσυνδεδεμένο");
  setTimeout(() => ui.settingsDialog.showModal(), 250);
})();
