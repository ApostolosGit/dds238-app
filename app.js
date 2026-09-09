(() => {
  "use strict";

  const TOPICS = {
    status: "home/energy/dds238/status",
    state: "home/energy/dds238/state",
    request: "home/energy/dds238/request",
    adminRequest: "home/energy/dds238/admin/request",
    adminResponse: "home/energy/dds238/admin/response",
    adminCsv: "home/energy/dds238/admin/csv"
  };

  const DEFAULTS = {
    host: "b7e93fa24c0c4c86a995afecd61e93f3.s1.eu.hivemq.cloud",
    port: "8884",
    path: "/mqtt"
  };

  const AUTO_REFRESH_MS = 60000;
  const SWIPE_REFRESH_DISTANCE = 80;
  const SWIPE_MAX_DURATION_MS = 1200;

  let client = null;
  let updateTimeout = null;
  let autoRefreshTimer = null;
  let toastTimeout = null;
  let deferredInstallPrompt = null;
  let appWasHidden = document.hidden;
  let lastForegroundRefreshAt = 0;
  let adminPendingCommand = null;
  let adminTimeout = null;
  let csvExportActive = false;
  let csvRows = [];

  let swipeStartX = null;
  let swipeStartY = null;
  let swipeStartAt = 0;
  let swipeStartedAtTop = false;
  let swipeStartedAtBottom = false;

  const $ = (id) => document.getElementById(id);

  const ui = {
    brokerDot: $("brokerDot"),
    brokerStatus: $("brokerStatus"),
    deviceDot: $("deviceDot"),
    deviceStatus: $("deviceStatus"),
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
    dehAdminInput: $("dehAdminInput"),
    storeDehBtn: $("storeDehBtn"),
    resetStoreDehBtn: $("resetStoreDehBtn"),
    exportDailyBtn: $("exportDailyBtn"),
    clearDailyBtn: $("clearDailyBtn"),
    adminStatus: $("adminStatus"),
    updateBtn: $("updateBtn"),
    updateText: $("updateText"),
    toast: $("toast")
  };

  const metricIds = {
    voltage: "voltage",
    current: "current",
    power: "power",
    pf: "pf",
    frequency: "frequency",
    deh_reference: "dehReference",
    deh_now: "dehNow",
    diff: "diff",
    energy_fwd: "energyFwd",
    energy_rev: "energyRev",
    rssi: "rssi"
  };

  function setDot(element, state) {
    element.classList.remove("dot-good", "dot-bad", "dot-warn", "dot-muted");
    element.classList.add(`dot-${state}`);
  }

  function setBrokerState(state, label) {
    setDot(ui.brokerDot, state);
    ui.brokerStatus.textContent = label;
    ui.updateBtn.disabled = !(client && client.connected);
    updateAdminControls();
  }

  function setDeviceState(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "online") {
      setDot(ui.deviceDot, "good");
      ui.deviceStatus.textContent = "ONLINE";
    } else if (normalized === "offline") {
      setDot(ui.deviceDot, "bad");
      ui.deviceStatus.textContent = "OFFLINE";
    } else {
      setDot(ui.deviceDot, "muted");
      ui.deviceStatus.textContent = normalized ? normalized.toUpperCase() : "Άγνωστο";
    }
  }

  function formatNumber(value, digits) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    return n.toLocaleString("el-GR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function renderState(data) {
    const digits = {
      voltage: 1,
      current: 2,
      power: 0,
      pf: 3,
      frequency: 2,
      deh_reference: 2,
      deh_now: 2,
      diff: 2,
      energy_fwd: 2,
      energy_rev: 2,
      rssi: 0
    };

    Object.entries(metricIds).forEach(([key, elementId]) => {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        $(elementId).textContent = formatNumber(data[key], digits[key]);
      }
    });

    $("deviceDateTime").textContent = data.datetime || "Χωρίς ημερομηνία";
    $("lastReceived").textContent = new Date().toLocaleTimeString("el-GR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });

    stopUpdateLoading();
  }

  function showToast(message, timeout = 2600) {
    clearTimeout(toastTimeout);
    ui.toast.textContent = message;
    ui.toast.classList.remove("hidden");
    toastTimeout = setTimeout(() => ui.toast.classList.add("hidden"), timeout);
  }

  function showConnectionError(message = "") {
    if (!message) {
      ui.connectionError.textContent = "";
      ui.connectionError.classList.add("hidden");
      return;
    }
    ui.connectionError.textContent = message;
    ui.connectionError.classList.remove("hidden");
  }

  function setAdminStatus(message, kind = "") {
    ui.adminStatus.textContent = message;
    ui.adminStatus.classList.remove("is-ok", "is-error");
    if (kind) ui.adminStatus.classList.add(`is-${kind}`);
  }

  function updateAdminControls() {
    const connected = Boolean(client && client.connected);
    const busy = Boolean(adminPendingCommand);
    [ui.storeDehBtn, ui.resetStoreDehBtn, ui.exportDailyBtn, ui.clearDailyBtn].forEach((button) => {
      button.disabled = !connected || busy;
    });
    ui.dehAdminInput.disabled = !connected || busy;

    if (!connected && !busy) {
      setAdminStatus("Απαιτεί ενεργή σύνδεση MQTT.");
    } else if (connected && !busy && ui.adminStatus.textContent === "Απαιτεί ενεργή σύνδεση MQTT.") {
      setAdminStatus("Έτοιμο για απομακρυσμένη διαχείριση.", "ok");
    }
  }

  function finishAdminCommand() {
    clearTimeout(adminTimeout);
    adminTimeout = null;
    adminPendingCommand = null;
    updateAdminControls();
  }

  function sendAdminCommand(payload, commandName, pendingMessage) {
    if (!client || !client.connected) {
      showToast("Δεν υπάρχει σύνδεση με HiveMQ");
      return;
    }
    if (adminPendingCommand) {
      showToast("Υπάρχει ήδη εντολή σε εξέλιξη");
      return;
    }

    adminPendingCommand = commandName;
    setAdminStatus(pendingMessage);
    updateAdminControls();

    clearTimeout(adminTimeout);
    adminTimeout = setTimeout(() => {
      finishAdminCommand();
      setAdminStatus("Δεν ήρθε απάντηση από το DDS238.", "error");
      showToast("Η admin εντολή δεν απάντησε");
    }, 10000);

    client.publish(TOPICS.adminRequest, payload, { qos: 0, retain: false }, (err) => {
      if (!err) return;
      finishAdminCommand();
      setAdminStatus(`Αποτυχία αποστολής: ${err.message || err}`, "error");
      showToast("Αποτυχία αποστολής admin εντολής");
    });
  }

  function getAdminDehValue() {
    const raw = ui.dehAdminInput.value.trim();
    const value = Number(raw);
    if (!raw || !Number.isFinite(value) || value <= 0 || value >= 999999) {
      setAdminStatus("Γράψε έγκυρη νέα τιμή DEH.", "error");
      ui.dehAdminInput.focus();
      return null;
    }
    return raw;
  }

  function handleAdminResponse(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      finishAdminCommand();
      setAdminStatus("Μη έγκυρη απάντηση admin από το DDS238.", "error");
      return;
    }

    finishAdminCommand();

    if (!data.ok) {
      const errors = {
        invalid_deh: "Η τιμή DEH δεν είναι έγκυρη.",
        dds238_read_failed: "Απέτυχε η ανάγνωση DDS238. Δεν άλλαξε τίποτα.",
        invalid_command: "Η admin εντολή δεν αναγνωρίστηκε."
      };
      const message = errors[data.error] || `Σφάλμα admin: ${data.error || "άγνωστο"}`;
      setAdminStatus(message, "error");
      showToast(message);
      return;
    }

    if (data.cmd === "store_deh") {
      const drift = Number.isFinite(Number(data.drift)) ? ` · Drift ${formatNumber(data.drift, 2)} kWh` : "";
      const message = `DEH ${formatNumber(data.deh, 2)} kWh αποθηκεύτηκε${drift}.`;
      setAdminStatus(message, "ok");
      showToast("Νέο DEH reference αποθηκεύτηκε");
      return;
    }

    if (data.cmd === "reset_store_deh") {
      setAdminStatus(`RESET + STORE ολοκληρώθηκε: ${formatNumber(data.deh, 2)} kWh.`, "ok");
      showToast("RESET + STORE ολοκληρώθηκε");
      return;
    }

    if (data.cmd === "clear_daily") {
      setAdminStatus("Τα daily stats καθαρίστηκαν. Το drift history διατηρήθηκε.", "ok");
      showToast("Daily stats καθαρίστηκαν");
      return;
    }

    if (data.cmd === "export_daily") {
      setAdminStatus(`Export ολοκληρώθηκε (${Number(data.rows) || 0} εγγραφές).`, "ok");
    }
  }

  function downloadDailyCsv() {
    if (!csvRows.length) {
      setAdminStatus("Το CSV δεν περιείχε δεδομένα.", "error");
      return;
    }

    const content = `\uFEFF${csvRows.join("\r\n")}\r\n`;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `dds238_daily_stats_${date}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Το Daily CSV κατέβηκε");
  }

  function handleAdminCsv(text) {
    if (text.startsWith("BEGIN|")) {
      csvExportActive = true;
      csvRows = [];
      setAdminStatus("Λήψη Daily CSV…");
      return;
    }

    if (text.startsWith("ROW|") && csvExportActive) {
      const separator = text.indexOf("|", 4);
      if (separator >= 0) csvRows.push(text.slice(separator + 1));
      return;
    }

    if (text === "END" && csvExportActive) {
      csvExportActive = false;
      downloadDailyCsv();
      if (adminPendingCommand === "export_daily") {
        finishAdminCommand();
        setAdminStatus("Το Daily CSV δημιουργήθηκε.", "ok");
      }
    }
  }

  function getSettings() {
    return {
      host: ui.hostInput.value.trim(),
      port: ui.portInput.value.trim(),
      path: ui.pathInput.value.trim() || "/mqtt",
      username: ui.usernameInput.value.trim(),
      password: ui.passwordInput.value
    };
  }

  function saveNonSecretSettings(settings) {
    localStorage.setItem("dds238.host", settings.host);
    localStorage.setItem("dds238.port", settings.port);
    localStorage.setItem("dds238.path", settings.path);
    localStorage.setItem("dds238.username", settings.username);
  }

  function restoreSettings() {
    ui.hostInput.value = localStorage.getItem("dds238.host") || DEFAULTS.host;
    ui.portInput.value = localStorage.getItem("dds238.port") || DEFAULTS.port;
    ui.pathInput.value = localStorage.getItem("dds238.path") || DEFAULTS.path;
    ui.usernameInput.value = localStorage.getItem("dds238.username") || "";
    ui.passwordInput.value = "";
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  function scheduleAutoRefresh() {
    stopAutoRefresh();
    if (!client || !client.connected) return;

    autoRefreshTimer = setInterval(() => {
      requestUpdate(false);
    }, AUTO_REFRESH_MS);
  }

  function disconnect(showMessage = true) {
    clearTimeout(updateTimeout);
    clearTimeout(adminTimeout);
    adminTimeout = null;
    adminPendingCommand = null;
    csvExportActive = false;
    csvRows = [];
    stopAutoRefresh();
    if (client) {
      try { client.end(true); } catch (_) { /* ignore */ }
    }
    client = null;
    setBrokerState("warn", "Αποσυνδεδεμένο");
    stopUpdateLoading();
    if (showMessage) showToast("Αποσυνδέθηκε από το HiveMQ");
  }

  function connect(settings) {
    if (typeof mqtt === "undefined") {
      showConnectionError("Δεν φορτώθηκε η βιβλιοθήκη MQTT.js. Έλεγξε τη σύνδεση Internet.");
      return;
    }

    disconnect(false);
    showConnectionError();
    saveNonSecretSettings(settings);

    const cleanPath = settings.path.startsWith("/") ? settings.path : `/${settings.path}`;
    const url = `wss://${settings.host}:${settings.port}${cleanPath}`;
    const clientId = `dds238-web-${Math.random().toString(16).slice(2, 10)}`;

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
      newClient.subscribe([TOPICS.status, TOPICS.state, TOPICS.adminResponse, TOPICS.adminCsv], { qos: 0 }, (err) => {
        if (err) {
          showToast(`Σφάλμα subscribe: ${err.message || err}`);
          return;
        }

        showToast("Συνδέθηκε στο HiveMQ");
        scheduleAutoRefresh();

        // Μία άμεση μέτρηση κατά τη σύνδεση και μετά αυτόματα κάθε 60 δευτερόλεπτα.
        setTimeout(() => requestUpdate(false), 300);
      });
      if (ui.settingsDialog.open) ui.settingsDialog.close();
    });

    newClient.on("reconnect", () => {
      if (client === newClient) {
        stopAutoRefresh();
        setBrokerState("warn", "Επανασύνδεση…");
      }
    });
    newClient.on("offline", () => {
      if (client === newClient) {
        stopAutoRefresh();
        setBrokerState("bad", "Offline");
      }
    });
    newClient.on("close", () => {
      if (client === newClient) {
        stopAutoRefresh();
        setBrokerState("warn", "Αποσυνδεδεμένο");
      }
    });

    newClient.on("error", (err) => {
      if (client !== newClient) return;
      const message = err && err.message ? err.message : String(err);
      setBrokerState("bad", "Σφάλμα");
      showConnectionError(`MQTT: ${message}`);
    });

    newClient.on("message", (topic, payload) => {
      if (client !== newClient) return;
      const text = payload.toString();

      if (topic === TOPICS.status) {
        setDeviceState(text);
        return;
      }

      if (topic === TOPICS.state) {
        try {
          const data = JSON.parse(text);
          renderState(data);
        } catch (err) {
          stopUpdateLoading();
          showToast("Το state μήνυμα δεν είναι έγκυρο JSON");
          console.error("Invalid DDS238 JSON", text, err);
        }
      }

      if (topic === TOPICS.adminResponse) {
        handleAdminResponse(text);
        return;
      }

      if (topic === TOPICS.adminCsv) {
        handleAdminCsv(text);
      }
    });
  }

  function startUpdateLoading() {
    ui.updateBtn.classList.add("loading");
    ui.updateText.textContent = "ΑΝΑΜΟΝΗ…";
    clearTimeout(updateTimeout);
    updateTimeout = setTimeout(() => {
      stopUpdateLoading();
      showToast("Δεν ήρθε απάντηση από το DDS238");
    }, 7000);
  }

  function stopUpdateLoading() {
    clearTimeout(updateTimeout);
    ui.updateBtn.classList.remove("loading");
    ui.updateText.textContent = "ΑΝΑΝΕΩΣΗ";
  }

  function requestUpdate(manual = true) {
    if (!client || !client.connected) {
      if (manual) showToast("Δεν υπάρχει σύνδεση με HiveMQ");
      return;
    }

    if (manual) {
      startUpdateLoading();
      // Με χειροκίνητη ανανέωση, το επόμενο αυτόματο update θα γίνει 60" αργότερα.
      scheduleAutoRefresh();
    }

    client.publish(TOPICS.request, "update", { qos: 0, retain: false }, (err) => {
      if (err) {
        if (manual) {
          stopUpdateLoading();
          showToast(`Αποτυχία αποστολής: ${err.message || err}`);
        } else {
          console.warn("Automatic DDS238 update failed", err);
        }
      }
    });
  }

  function refreshAfterForeground() {
    const now = Date.now();
    if (now - lastForegroundRefreshAt < 1500) return;
    lastForegroundRefreshAt = now;

    if (!client || !client.connected) return;

    // Μόλις η εφαρμογή επιστρέψει στο προσκήνιο, ζητά νέα μέτρηση αμέσως
    // και ξεκινά ξανά ο κύκλος αυτόματης ανανέωσης των 60 δευτερολέπτων.
    requestUpdate(false);
    scheduleAutoRefresh();
  }

  function resetSwipeTracking() {
    swipeStartX = null;
    swipeStartY = null;
    swipeStartAt = 0;
    swipeStartedAtTop = false;
    swipeStartedAtBottom = false;
  }

  function isInteractiveSwipeTarget(target) {
    return Boolean(target && target.closest("button, input, textarea, select, a, label, dialog, form, summary"));
  }

  function handleTouchStart(event) {
    if (event.touches.length !== 1 || ui.settingsDialog.open || isInteractiveSwipeTarget(event.target)) {
      resetSwipeTracking();
      return;
    }

    const touch = event.touches[0];
    const doc = document.documentElement;
    const maxScrollY = Math.max(0, doc.scrollHeight - window.innerHeight);

    swipeStartX = touch.clientX;
    swipeStartY = touch.clientY;
    swipeStartAt = Date.now();
    swipeStartedAtTop = window.scrollY <= 3;
    swipeStartedAtBottom = window.scrollY >= maxScrollY - 3;
  }

  function handleTouchEnd(event) {
    if (swipeStartX === null || swipeStartY === null || event.changedTouches.length !== 1) {
      resetSwipeTracking();
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - swipeStartX;
    const deltaY = touch.clientY - swipeStartY;
    const duration = Date.now() - swipeStartAt;
    const verticalDistance = Math.abs(deltaY);
    const horizontalDistance = Math.abs(deltaX);

    const isClearVerticalSwipe =
      verticalDistance >= SWIPE_REFRESH_DISTANCE &&
      verticalDistance > horizontalDistance * 1.35 &&
      duration <= SWIPE_MAX_DURATION_MS;

    const isPullDownFromTop = isClearVerticalSwipe && deltaY > 0 && swipeStartedAtTop;
    const isPullUpFromBottom = isClearVerticalSwipe && deltaY < 0 && swipeStartedAtBottom;

    resetSwipeTracking();

    if (isPullDownFromTop || isPullUpFromBottom) {
      requestUpdate(true);
    }
  }

  ui.settingsBtn.addEventListener("click", () => {
    showConnectionError();
    ui.settingsDialog.showModal();
  });

  ui.closeSettingsBtn.addEventListener("click", () => ui.settingsDialog.close());
  ui.disconnectBtn.addEventListener("click", () => disconnect(true));
  ui.updateBtn.addEventListener("click", () => requestUpdate(true));

  ui.storeDehBtn.addEventListener("click", () => {
    const value = getAdminDehValue();
    if (value === null) return;
    sendAdminCommand(`store_deh|${value}`, "store_deh", "Αποθήκευση νέου DEH reference…");
  });

  ui.resetStoreDehBtn.addEventListener("click", () => {
    const value = getAdminDehValue();
    if (value === null) return;
    const ok = window.confirm("RESET + STORE θα διαγράψει ΟΛΑ τα daily stats και το drift/calibration history και θα ξεκινήσει καθαρά από τη νέα τιμή DEH. Συνέχεια;");
    if (!ok) return;
    sendAdminCommand(`reset_store_deh|${value}`, "reset_store_deh", "RESET + STORE σε εξέλιξη…");
  });

  ui.exportDailyBtn.addEventListener("click", () => {
    csvExportActive = false;
    csvRows = [];
    sendAdminCommand("export_daily", "export_daily", "Προετοιμασία Daily CSV…");
  });

  ui.clearDailyBtn.addEventListener("click", () => {
    const ok = window.confirm("Να καθαριστούν μόνο τα daily statistics; Το Register/drift history θα παραμείνει.");
    if (!ok) return;
    sendAdminCommand("clear_daily", "clear_daily", "Καθαρισμός daily stats…");
  });

  ui.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const settings = getSettings();
    connect(settings);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      appWasHidden = true;
      stopAutoRefresh();
      return;
    }

    if (!appWasHidden) return;
    appWasHidden = false;
    setTimeout(refreshAfterForeground, 150);
  });

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      setTimeout(refreshAfterForeground, 150);
    }
  });

  // Swipe-to-refresh χωρίς να συγκρούεται με το native pull-to-refresh του browser.
  document.documentElement.style.overscrollBehaviorY = "contain";
  document.body.style.overscrollBehaviorY = "contain";
  document.addEventListener("touchstart", handleTouchStart, { passive: true });
  document.addEventListener("touchend", handleTouchEnd, { passive: true });
  document.addEventListener("touchcancel", resetSwipeTracking, { passive: true });

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
  setBrokerState("warn", "Αποσυνδεδεμένο");
  setDeviceState("");
  updateAdminControls();

  // Το password δεν αποθηκεύεται μόνιμα, επομένως οι ρυθμίσεις
  // ανοίγουν σε κάθε νέο άνοιγμα της εφαρμογής για ασφαλή σύνδεση.
  setTimeout(() => ui.settingsDialog.showModal(), 250);
})();
