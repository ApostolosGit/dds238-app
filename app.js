(() => {
  "use strict";

  const TOPICS = {
    status: "home/energy/dds238/status",
    state: "home/energy/dds238/state",
    request: "home/energy/dds238/request"
  };

  const DEFAULTS = {
    host: "b7e93fa24c0c4c86a995afecd61e93f3.s1.eu.hivemq.cloud",
    port: "8884",
    path: "/mqtt"
  };

  const AUTO_REFRESH_MS = 60000;

  let client = null;
  let updateTimeout = null;
  let autoRefreshTimer = null;
  let toastTimeout = null;
  let deferredInstallPrompt = null;

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
      newClient.subscribe([TOPICS.status, TOPICS.state], { qos: 0 }, (err) => {
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

  ui.settingsBtn.addEventListener("click", () => {
    showConnectionError();
    ui.settingsDialog.showModal();
  });

  ui.closeSettingsBtn.addEventListener("click", () => ui.settingsDialog.close());
  ui.disconnectBtn.addEventListener("click", () => disconnect(true));
  ui.updateBtn.addEventListener("click", () => requestUpdate(true));

  ui.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const settings = getSettings();
    connect(settings);
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
  setBrokerState("warn", "Αποσυνδεδεμένο");
  setDeviceState("");

  // Το password δεν αποθηκεύεται μόνιμα, επομένως οι ρυθμίσεις
  // ανοίγουν σε κάθε νέο άνοιγμα της εφαρμογής για ασφαλή σύνδεση.
  setTimeout(() => ui.settingsDialog.showModal(), 250);
})();
