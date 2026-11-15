/**
 * 3DVEXORA - 3D Printing Studio
 * Dual AMS (8 Slot) Bambu Lab A1 Árazó és Költségkalkulátor
 */

const AppState = {
  filaments: [],
  settings: {},
  projects: [],
  sales: [],
  salesSummary: {},
  saleProducts: [],
  currentProject: {
    id: null,
    loaded_name: null,
    project_name: "Új Nyomtatási Projekt",
    client_name: "",
    client_contact: "",
    notes: "",
    shipping_cost: 0,
    items: []
  },
  currentItem: {
    name: "Modell 1",
    items_on_plate: 1,
    quantity: 1,
    print_hours: 2,
    print_minutes: 30,
    profit_margin_percent: 100,
    // 8 AMS Slot
    filament_assignments: [
      { slot: 1, filament_id: null, grams: 0 },
      { slot: 2, filament_id: null, grams: 0 },
      { slot: 3, filament_id: null, grams: 0 },
      { slot: 4, filament_id: null, grams: 0 },
      { slot: 5, filament_id: null, grams: 0 },
      { slot: 6, filament_id: null, grams: 0 },
      { slot: 7, filament_id: null, grams: 0 },
      { slot: 8, filament_id: null, grams: 0 }
    ]
  }
};

const CLOUD_STORAGE_KEYS = {
  token: "3dvexora_gh_token",
  snapshot: "3dvexora_cloud_snapshot_v1",
  pendingSync: "3dvexora_cloud_pending_sync",
  baseTs: "3dvexora_cloud_base_ts"
};

const GITHUB_SYNC_REPO = {
  owner: "EnBest2",
  repo: "3dvexora",
  branch: "main",
  dataPath: "data/sync.json"
};

function isCloudMode() {
  return window.location.hostname.includes("github.io") || window.location.protocol === "file:";
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const cleanB64 = (b64 || "").replace(/\s+/g, "");
  const binary = atob(cleanB64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function getSaleSignature(sale) {
  if (!sale) return "";
  return [
    String(sale.sale_date || ""),
    String(sale.buyer_name || "").trim().toLowerCase(),
    String(Math.round(Number(sale.total_sale_price_huf) || 0)),
    String(sale.items_summary || "").trim(),
    String(sale.notes || "").trim()
  ].join("|");
}

function buildSaleProductsFromProjects(projects) {
  return (projects || []).map(p => {
    const item = (p.items && p.items.length > 0) ? p.items[0] : null;
    const calc = item ? item.calculation_summary : null;
    const qty = Math.max(1, parseInt(item?.quantity) || 1);
    const unitCost = calc
      ? Math.round(Number(calc.unit_net_cost) || 0)
      : (p.summary?.total_net_cost ? Math.round(p.summary.total_net_cost / qty) : 0);
    const unitPrice = calc
      ? Math.round(Number(calc.unit_sale_price) || 0)
      : Math.round((Number(p.total_price_huf) || 0) / qty);
    return {
      project_id: p.id,
      name: p.project_name,
      unit_cost: unitCost,
      unit_price: unitPrice
    };
  });
}

function recomputeSalesSummaryClient(sales) {
  const list = Array.isArray(sales) ? sales : [];
  let totalRev = 0;
  let totalCost = 0;
  let totalSold = 0;

  list.forEach(s => {
    totalRev += Number(s.total_sale_price_huf) || 0;
    totalCost += Number(s.total_cost_huf) || 0;
    totalSold += Number(s.items_count) || 1;
  });

  const totalProf = totalRev - totalCost;
  return {
    total_revenue: Math.round(totalRev),
    total_cost: Math.round(totalCost),
    total_profit: Math.round(totalProf),
    avg_profit_margin_percent: totalCost > 0 ? Math.round((totalProf / totalCost) * 1000) / 10 : 0,
    total_items_sold: totalSold,
    total_sales_count: list.length,
    avg_order_value: list.length > 0 ? Math.round(totalRev / list.length) : 0
  };
}

function sanitizeSettingsForCloud(settings) {
  const clean = { ...(settings || {}) };
  delete clean.github_token;
  return clean;
}

function buildCurrentCloudSnapshot() {
  const sales = Array.isArray(AppState.sales) ? AppState.sales : [];
  return {
    studio: "3DVEXORA Studio",
    exported_at: new Date().toISOString(),
    device: "3DVEXORA PWA",
    settings: sanitizeSettingsForCloud(AppState.settings),
    filaments: Array.isArray(AppState.filaments) ? AppState.filaments : [],
    projects: Array.isArray(AppState.projects) ? AppState.projects : [],
    sales: sales,
    summary: recomputeSalesSummaryClient(sales)
  };
}

function saveCloudSnapshotToLocalStorage(snapshot = null, markPending = false) {
  const snap = snapshot || buildCurrentCloudSnapshot();
  if (snap.settings) snap.settings = sanitizeSettingsForCloud(snap.settings);
  try {
    localStorage.setItem(CLOUD_STORAGE_KEYS.snapshot, JSON.stringify(snap));
    if (markPending) {
      localStorage.setItem(CLOUD_STORAGE_KEYS.pendingSync, "1");
    }
  } catch (e) {
    console.warn("localStorage mentési figyelmeztetés:", e);
  }
}

function loadLocalCloudSnapshot() {
  try {
    const raw = localStorage.getItem(CLOUD_STORAGE_KEYS.snapshot);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function applyCloudSnapshotData(data) {
  if (!data) return;
  if (Array.isArray(data.filaments)) AppState.filaments = data.filaments;
  if (Array.isArray(data.projects)) AppState.projects = data.projects;
  if (data.settings) AppState.settings = sanitizeSettingsForCloud(data.settings);
  if (Array.isArray(data.sales)) AppState.sales = data.sales;
  AppState.salesSummary = recomputeSalesSummaryClient(AppState.sales || []);
  AppState.saleProducts = buildSaleProductsFromProjects(AppState.projects || []);
}

function updateCloudStatusBadge(text) {
  const statusText = document.getElementById("sync-status-text");
  if (statusText && text) {
    statusText.innerText = text;
  }
}

function mergeRemoteNewItemsIntoLocal(localData, remoteData) {
  const merged = JSON.parse(JSON.stringify(localData || {}));
  merged.filaments = Array.isArray(merged.filaments) ? merged.filaments : [];
  merged.projects = Array.isArray(merged.projects) ? merged.projects : [];
  merged.sales = Array.isArray(merged.sales) ? merged.sales : [];
  merged.settings = { ...(remoteData?.settings || {}), ...(merged.settings || {}) };

  const filKey = f => `${(f.brand || "").trim().toLowerCase()}|${(f.material || "").trim().toLowerCase()}|${(f.color_name || "").trim().toLowerCase()}`;
  const filSet = new Set(merged.filaments.map(filKey));
  (remoteData?.filaments || []).forEach(rf => {
    if (!filSet.has(filKey(rf))) {
      merged.filaments.push(rf);
      filSet.add(filKey(rf));
    }
  });

  const projSet = new Set(merged.projects.map(p => String(p.project_name || "").trim().toLowerCase()));
  (remoteData?.projects || []).forEach(rp => {
    const key = String(rp.project_name || "").trim().toLowerCase();
    if (key && !projSet.has(key)) {
      merged.projects.push(rp);
      projSet.add(key);
    }
  });

  const saleSet = new Set(merged.sales.map(getSaleSignature));
  (remoteData?.sales || []).forEach(rs => {
    const sig = getSaleSignature(rs);
    if (sig && !saleSet.has(sig)) {
      merged.sales.push(rs);
      saleSet.add(sig);
    }
  });

  merged.sales.sort((a, b) => String(b.sale_date || "").localeCompare(String(a.sale_date || "")));
  merged.summary = recomputeSalesSummaryClient(merged.sales);
  return merged;
}

async function fetchSyncJsonFromGitHubApi(token) {
  if (!token) return null;
  const url = `https://api.github.com/repos/${GITHUB_SYNC_REPO.owner}/${GITHUB_SYNC_REPO.repo}/contents/${GITHUB_SYNC_REPO.dataPath}?ref=${GITHUB_SYNC_REPO.branch}&t=${Date.now()}`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json"
    }
  });
  if (!res.ok) {
    throw new Error(`GitHub API lekérdezési hiba (HTTP ${res.status})`);
  }
  const meta = await res.json();
  const parsed = JSON.parse(base64ToUtf8(meta.content));
  return { sha: meta.sha, data: parsed };
}

async function pushCloudSnapshotToGitHub(token, snapshot = null, existingSha = null) {
  if (!token) return false;
  const payloadSnap = snapshot || buildCurrentCloudSnapshot();
  if (payloadSnap.settings) {
    payloadSnap.settings = sanitizeSettingsForCloud(payloadSnap.settings);
  }
  const url = `https://api.github.com/repos/${GITHUB_SYNC_REPO.owner}/${GITHUB_SYNC_REPO.repo}/contents/${GITHUB_SYNC_REPO.dataPath}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    let sha = attempt === 0 ? existingSha : null;
    if (!sha) {
      try {
        const remote = await fetchSyncJsonFromGitHubApi(token);
        sha = remote?.sha || null;
      } catch (e) {
        if (!e.message.includes("404")) throw e;
      }
    }

    const body = {
      message: `3DVEXORA Mobil/PWA szinkron (${new Date().toISOString().slice(0, 19)})`,
      content: utf8ToBase64(JSON.stringify(payloadSnap, null, 2)),
      branch: GITHUB_SYNC_REPO.branch
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (putRes.ok) {
      localStorage.setItem(CLOUD_STORAGE_KEYS.baseTs, payloadSnap.exported_at);
      localStorage.removeItem(CLOUD_STORAGE_KEYS.pendingSync);
      localStorage.removeItem("3dvexora_offline_sales");
      saveCloudSnapshotToLocalStorage(payloadSnap, false);
      return true;
    }

    if (putRes.status === 409 && attempt === 0) {
      continue;
    }

    const errText = await putRes.text();
    throw new Error(`GitHub feltöltési hiba (HTTP ${putRes.status}): ${errText}`);
  }
  return false;
}

async function persistCloudMutation() {
  AppState.salesSummary = recomputeSalesSummaryClient(AppState.sales || []);
  AppState.saleProducts = buildSaleProductsFromProjects(AppState.projects || []);
  saveCloudSnapshotToLocalStorage(null, true);

  const token = localStorage.getItem(CLOUD_STORAGE_KEYS.token);
  if (token) {
    try {
      const ok = await pushCloudSnapshotToGitHub(token);
      if (ok) {
        updateCloudStatusBadge("Felhő: Szinkronizálva ☁️");
        return { synced: true };
      }
    } catch (e) {
      console.warn("Háttér felhőszinkron sikertelen, helyben tárolva:", e);
    }
  }
  updateCloudStatusBadge("HelyiPWA: Módosítva 📱");
  return { synced: false };
}

// --- Initialization ---
document.addEventListener("DOMContentLoaded", async () => {
  const isLocalHost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  // Helyi PC módban ne cache-elje elavult Service Worker az appot; csak távoli/PWA módban aktiváljuk
  if ('serviceWorker' in navigator) {
    if (isLocalHost) {
      navigator.serviceWorker.getRegistrations()
        .then(regs => regs.forEach(r => r.unregister()))
        .catch(() => {});
    } else {
      navigator.serviceWorker.register('./sw.js?v=5')
        .then(reg => {
          if (reg && typeof reg.update === 'function') reg.update();
          console.log('3DVEXORA Service Worker aktív:', reg.scope);
        })
        .catch(err => console.log('Service Worker figyelmeztetés:', err));
    }
  }

  setupNavigation();
  setupDropzone();

  if (isCloudMode()) {
    await loadAllFromCloudSyncFile();
    populateSettingsForm();
    renderFilamentTable();
    renderProjectsList();
    renderSalesKpis();
    renderSalesTable();
    updateSaleProductsDropdowns();
  } else {
    await loadSettings();
    await loadFilaments();
    await loadProjects();
    await loadSales();
  }

  initSaleForm();
  renderAmsSlots();
  bindFormInputs();
  recalculateCurrentItem();
  updateProjectHeaderStatus();
  checkSyncStatusOnStartup();
});

// --- Tab Navigation ---
function setupNavigation() {
  const allNavBtns = document.querySelectorAll(".nav-btn, .mobile-nav-btn");
  allNavBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetTab = btn.getAttribute("data-tab");
      document.querySelectorAll(".nav-btn").forEach(b => {
        b.classList.toggle("active", b.getAttribute("data-tab") === targetTab);
      });
      document.querySelectorAll(".mobile-nav-btn").forEach(b => {
        b.classList.toggle("active", b.getAttribute("data-tab") === targetTab);
      });
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
      
      const pane = document.getElementById(targetTab);
      if (pane) pane.classList.add("active");
      window.scrollTo({ top: 0, behavior: 'smooth' });

      if (targetTab === "tab-quote") {
        renderQuoteView();
      } else if (targetTab === "tab-history") {
        renderProjectsList();
      } else if (targetTab === "tab-sales") {
        loadSales();
      }
    });
  });
}

// --- Stepper Controls (+ / -) ---
function stepUp(inputId, step = 1) {
  const el = document.getElementById(inputId);
  if (!el) return;
  let val = parseInt(el.value) || 0;
  val += step;
  el.value = val;
  el.dispatchEvent(new Event('input'));
}

function stepDown(inputId, step = 1) {
  const el = document.getElementById(inputId);
  if (!el) return;
  let val = parseInt(el.value) || 1;
  const minVal = el.min !== "" ? parseInt(el.min) : 0;
  if (val - step >= minVal) {
    val -= step;
  } else {
    val = minVal;
  }
  el.value = val;
  el.dispatchEvent(new Event('input'));
}

// --- API Helpers ---
async function apiGet(endpoint) {
  if (isCloudMode()) return null;
  try {
    const res = await fetch(endpoint);
    return await res.json();
  } catch (err) {
    console.error(`API GET ${endpoint} error:`, err);
    return null;
  }
}

async function apiPost(endpoint, data) {
  if (isCloudMode()) return null;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    return await res.json();
  } catch (err) {
    console.error(`API POST ${endpoint} error:`, err);
    return null;
  }
}

// --- Load Data with Cloud / Static Fallback ---
async function loadAllFromCloudSyncFile() {
  let remoteData = null;
  const token = localStorage.getItem(CLOUD_STORAGE_KEYS.token);

  if (token) {
    try {
      const apiRes = await fetchSyncJsonFromGitHubApi(token);
      if (apiRes && apiRes.data) remoteData = apiRes.data;
    } catch (e) {
      console.warn("GitHub API betöltési fallback sync.json-ra:", e.message);
    }
  }

  if (!remoteData) {
    try {
      const res = await fetch(`./data/sync.json?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        remoteData = await res.json();
      }
    } catch (err) {
      console.error("Hiba a cloud sync betöltésekor:", err);
    }
  }

  const localSnap = loadLocalCloudSnapshot();
  const isPending = localStorage.getItem(CLOUD_STORAGE_KEYS.pendingSync) === "1";

  let finalData = null;
  if (remoteData) {
    if (isPending && localSnap) {
      finalData = mergeRemoteNewItemsIntoLocal(localSnap, remoteData);
    } else {
      finalData = remoteData;
      if (remoteData.exported_at) {
        localStorage.setItem(CLOUD_STORAGE_KEYS.baseTs, remoteData.exported_at);
      }
    }
  } else if (localSnap) {
    finalData = localSnap;
  }

  if (!finalData) return false;

  // Legacy offline eladások egyszeri átvétele duplikálás nélkül
  let addedLegacy = false;
  try {
    const legacySales = JSON.parse(localStorage.getItem("3dvexora_offline_sales") || "[]");
    if (Array.isArray(legacySales) && legacySales.length > 0) {
      finalData.sales = Array.isArray(finalData.sales) ? finalData.sales : [];
      const sigSet = new Set(finalData.sales.map(getSaleSignature));
      legacySales.forEach(ls => {
        const sig = getSaleSignature(ls);
        if (sig && !sigSet.has(sig)) {
          finalData.sales.unshift(ls);
          sigSet.add(sig);
          addedLegacy = true;
        }
      });
      if (!addedLegacy && !isPending) {
        localStorage.removeItem("3dvexora_offline_sales");
      }
    }
  } catch (e) {}

  applyCloudSnapshotData(finalData);
  saveCloudSnapshotToLocalStorage(buildCurrentCloudSnapshot(), isPending || addedLegacy);
  return true;
}

async function tryLoadFromCloudData() {
  return await loadAllFromCloudSyncFile();
}

async function loadSettings() {
  let data = await apiGet("/api/settings");
  if (!data) {
    await tryLoadFromCloudData();
    data = AppState.settings;
  }
  if (data) {
    AppState.settings = data;
    populateSettingsForm();
  }
}

async function loadFilaments() {
  let data = await apiGet("/api/filaments");
  if (!Array.isArray(data)) {
    await tryLoadFromCloudData();
    data = AppState.filaments;
  }
  if (Array.isArray(data)) {
    AppState.filaments = data;
    renderFilamentTable();
    renderAmsSlots();
  }
}

async function loadProjects() {
  let data = await apiGet("/api/projects");
  if (!Array.isArray(data)) {
    await tryLoadFromCloudData();
    data = AppState.projects;
  }
  if (Array.isArray(data)) {
    AppState.projects = data;
    renderProjectsList();
    loadSales();
  }
}

// --- AMS Slots Management (8 Slot) ---
function renderAmsSlots() {
  const unit1 = document.getElementById("ams-unit-1-container");
  const unit2 = document.getElementById("ams-unit-2-container");
  if (!unit1 || !unit2) return;

  const renderSlotCard = (slotData, idx) => {
    const slotNum = idx + 1;
    const selectedFil = AppState.filaments.find(f => f.id === slotData.filament_id);
    const colorHex = selectedFil ? selectedFil.color_hex : "#4B5563";
    const isActive = (slotData.grams > 0);

    return `
      <div class="ams-slot-card ${isActive ? 'active-slot' : ''}" data-slot-index="${idx}">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span class="slot-tag">SLOT #${slotNum}</span>
          <span class="color-dot" style="background-color: ${colorHex};"></span>
        </div>
        
        <div class="form-group" style="margin-bottom:6px;">
          <select class="ams-filament-select" data-slot-index="${idx}" style="font-size:12px; padding:6px;">
            <option value="">-- Üres / Nincs --</option>
            ${AppState.filaments.map(f => `
              <option value="${f.id}" ${f.id === slotData.filament_id ? 'selected' : ''}>
                ${f.brand} ${f.material} - ${f.color_name} (${f.cost_per_gram} Ft/g)
              </option>
            `).join('')}
          </select>
        </div>

        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:10px;">Súly (gramm)</label>
          <input type="number" step="0.1" min="0" class="ams-grams-input" 
                 data-slot-index="${idx}" value="${slotData.grams || 0}" style="font-size:13px; padding:6px;">
        </div>
      </div>
    `;
  };

  // Unit 1: Slot 1-4
  unit1.innerHTML = AppState.currentItem.filament_assignments.slice(0, 4).map((s, i) => renderSlotCard(s, i)).join('');
  // Unit 2: Slot 5-8
  unit2.innerHTML = AppState.currentItem.filament_assignments.slice(4, 8).map((s, i) => renderSlotCard(s, i + 4)).join('');

  // Event listeners
  document.querySelectorAll(".ams-filament-select").forEach(sel => {
    sel.addEventListener("change", (e) => {
      const slotIdx = parseInt(e.target.getAttribute("data-slot-index"));
      const val = e.target.value ? parseInt(e.target.value) : null;
      AppState.currentItem.filament_assignments[slotIdx].filament_id = val;
      recalculateCurrentItem();
    });
  });

  document.querySelectorAll(".ams-grams-input").forEach(inp => {
    inp.addEventListener("input", (e) => {
      const slotIdx = parseInt(e.target.getAttribute("data-slot-index"));
      const val = Math.max(0, parseFloat(e.target.value) || 0);
      AppState.currentItem.filament_assignments[slotIdx].grams = val;
      recalculateCurrentItem();
    });
  });
}

// --- Bind Form Inputs ---
function bindFormInputs() {
  const fields = [
    { id: "item-name", key: "name", type: "string" },
    { id: "item-plate-qty", key: "items_on_plate", type: "int", min: 1 },
    { id: "item-qty", key: "quantity", type: "int", min: 1 },
    { id: "item-hours", key: "print_hours", type: "float", min: 0 },
    { id: "item-minutes", key: "print_minutes", type: "float", min: 0 },
    { id: "item-profit", key: "profit_margin_percent", type: "float", min: 0 }
  ];

  fields.forEach(f => {
    const el = document.getElementById(f.id);
    if (!el) return;
    el.addEventListener("input", (e) => {
      let val = e.target.value;
      if (f.type === "int") {
        val = parseInt(val);
        if (isNaN(val)) val = f.min !== undefined ? f.min : 1;
        if (f.min !== undefined && val < f.min) val = f.min;
      }
      if (f.type === "float") {
        val = parseFloat(val);
        if (isNaN(val)) val = 0;
        if (f.min !== undefined && val < f.min) val = f.min;
      }

      AppState.currentItem[f.key] = val;

      // Ha a tálcán lévő darabszámot módosítjuk:
      if (f.key === "items_on_plate") {
        const qtyEl = document.getElementById("item-qty");
        // Ha a megrendelt darabszám még 1 volt, vagy kisebb mint a tálca, tartsuk szinkronban
        if (qtyEl && (parseInt(qtyEl.value) <= 1 || parseInt(qtyEl.value) < val)) {
          qtyEl.value = val;
          AppState.currentItem.quantity = val;
        }
      }

      recalculateCurrentItem();
    });
  });

  const projNameEl = document.getElementById("project-name");
  if (projNameEl) {
    projNameEl.addEventListener("input", (e) => {
      const val = e.target.value.trim();
      AppState.currentProject.project_name = val;
      // Ha betöltött projektünk volt, de átírták a nevét (pl. cica -> medve),
      // automatikusan leválasztjuk az ID-t, hogy új projektként mentődjön el!
      if (AppState.currentProject.id && AppState.currentProject.loaded_name && val !== AppState.currentProject.loaded_name) {
        AppState.currentProject.id = null;
        updateProjectHeaderStatus();
      }
    });
  }

  const clientNameEl = document.getElementById("client-name");
  if (clientNameEl) {
    clientNameEl.addEventListener("input", (e) => {
      AppState.currentProject.client_name = e.target.value;
    });
  }

  // Save Project button
  const saveProjBtn = document.getElementById("btn-save-project");
  if (saveProjBtn) {
    saveProjBtn.addEventListener("click", () => saveProjectToDb(false));
  }
}

function updateProjectHeaderStatus() {
  const badge = document.getElementById("project-active-badge");
  const badgeName = document.getElementById("project-active-name");
  const saveBtn = document.getElementById("btn-save-project");
  const saveAsNewBtn = document.getElementById("btn-save-as-new");

  if (AppState.currentProject.id && AppState.currentProject.loaded_name) {
    if (badge && badgeName) {
      badge.style.display = "block";
      badgeName.innerText = `${AppState.currentProject.loaded_name}`;
    }
    if (saveBtn) {
      saveBtn.innerHTML = `🔄 Módosítások Mentése`;
      saveBtn.title = `A '${AppState.currentProject.loaded_name}' projekt frissítése`;
    }
    if (saveAsNewBtn) {
      saveAsNewBtn.style.display = "block";
    }
  } else {
    if (badge) badge.style.display = "none";
    if (saveBtn) {
      saveBtn.innerHTML = `💾 Projekt Mentése`;
      saveBtn.title = "Mentés új projektként az adatbázisba";
    }
    if (saveAsNewBtn) {
      saveAsNewBtn.style.display = "none";
    }
  }
}

function startNewCalculation() {
  AppState.currentProject.id = null;
  AppState.currentProject.loaded_name = null;
  AppState.currentProject.project_name = "Új Nyomtatási Projekt";
  AppState.currentProject.client_name = "";
  
  const projNameEl = document.getElementById("project-name");
  if (projNameEl) projNameEl.value = "Új Nyomtatási Projekt";
  const clientNameEl = document.getElementById("client-name");
  if (clientNameEl) clientNameEl.value = "";
  const itemNameEl = document.getElementById("item-name");
  if (itemNameEl) itemNameEl.value = "Modell 1";
  
  const hoursEl = document.getElementById("item-hours");
  if (hoursEl) hoursEl.value = "2";
  const minutesEl = document.getElementById("item-minutes");
  if (minutesEl) minutesEl.value = "30";
  const plateQtyEl = document.getElementById("item-plate-qty");
  if (plateQtyEl) plateQtyEl.value = "1";
  const qtyEl = document.getElementById("item-qty");
  if (qtyEl) qtyEl.value = "1";
  const profitEl = document.getElementById("item-profit");
  if (profitEl) profitEl.value = "100";

  AppState.currentItem = {
    name: "Modell 1",
    items_on_plate: 1,
    quantity: 1,
    print_hours: 2,
    print_minutes: 30,
    profit_margin_percent: 100,
    filament_assignments: [
      { slot: 1, filament_id: null, grams: 0 },
      { slot: 2, filament_id: null, grams: 0 },
      { slot: 3, filament_id: null, grams: 0 },
      { slot: 4, filament_id: null, grams: 0 },
      { slot: 5, filament_id: null, grams: 0 },
      { slot: 6, filament_id: null, grams: 0 },
      { slot: 7, filament_id: null, grams: 0 },
      { slot: 8, filament_id: null, grams: 0 }
    ]
  };

  const dropText = document.getElementById("dropzone-status-text");
  if (dropText) {
    dropText.innerHTML = `Húzd ide a <strong>.3mf</strong> vagy <strong>.gcode</strong> fájlt, vagy <span style="color:var(--orange-primary); text-decoration:underline;">kattints a tallózáshoz</span>`;
  }

  renderAmsSlots();
  recalculateCurrentItem();
  updateProjectHeaderStatus();
}

// --- Live Recalculation ---
let debounceTimer = null;
function recalculateCurrentItem() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    let calc = isCloudMode() ? null : await apiPost("/api/calculate", AppState.currentItem);
    if (!calc) {
      // Kliensoldali azonnali számítás (offline / iPhone GitHub Pages esetén)
      calc = calculateItemCostClient(AppState.currentItem, AppState.settings);
    }
    if (calc) {
      AppState.currentItem.calc = calc;
      updateSidebarDisplay(calc);
    }
  }, 80);
}

function calculateItemCostClient(itemData, settings = {}) {
  const itemsOnPlate = Math.max(1, parseInt(itemData.items_on_plate) || 1);
  const quantity = Math.max(1, parseInt(itemData.quantity) || itemsOnPlate);
  const printHours = Math.max(0, parseFloat(itemData.print_hours) || 0);
  const printMinutes = Math.max(0, parseFloat(itemData.print_minutes) || 0);
  const rawMargin = parseFloat(itemData.profit_margin_percent);
  const profitMargin = Number.isFinite(rawMargin) ? Math.max(0, rawMargin) : 100;

  const rawPower = parseFloat(settings.printer_avg_power_watts ?? settings.printer_power_watts);
  const powerWatts = Number.isFinite(rawPower) ? rawPower : 120;
  const rawElec = parseFloat(settings.electricity_kwh_cost);
  const elecKwhCost = Number.isFinite(rawElec) ? rawElec : 70;

  let plateMaterialCost = 0;
  let plateTotalGrams = 0;
  const assignments = itemData.filament_assignments || [];

  assignments.forEach(fa => {
    const grams = Math.max(0, parseFloat(fa.grams) || 0);
    if (grams <= 0) return;
    const fil = (AppState.filaments || []).find(f => f.id === fa.filament_id);
    const costPerG = fil ? fil.cost_per_gram : 8.5;
    plateMaterialCost += grams * costPerG;
    plateTotalGrams += grams;
  });

  const plateHours = printHours + (printMinutes / 60.0);
  const plateKwh = (powerWatts / 1000.0) * plateHours;
  const plateElecCost = plateKwh * elecKwhCost;

  const unitGrams = Math.round((plateTotalGrams / itemsOnPlate) * 100) / 100;
  const unitPrintHours = plateHours / itemsOnPlate;
  const unitKwh = plateKwh / itemsOnPlate;

  const unitMaterialCost = plateMaterialCost / itemsOnPlate;
  const unitElectricityCost = plateElecCost / itemsOnPlate;
  const unitNetCost = Math.round(unitMaterialCost + unitElectricityCost);

  const unitProfit = Math.round(unitNetCost * (profitMargin / 100.0));
  const unitSalePrice = unitNetCost + unitProfit;

  const totalNetCost = Math.round(unitNetCost * quantity);
  const totalProfit = Math.round(unitProfit * quantity);
  const totalPrice = Math.round(unitSalePrice * quantity);

  const totalMaterialCost = Math.round(unitMaterialCost * quantity);
  const totalElectricityCost = Math.round(unitElectricityCost * quantity);
  const totalGrams = Math.round(unitGrams * quantity * 10) / 10;
  const totalKwh = Math.round(unitKwh * quantity * 1000) / 1000;

  const uH = Math.floor(unitPrintHours);
  const uM = Math.round((unitPrintHours - uH) * 60);
  const unitTimeFormatted = uH > 0 ? `${uH}ó ${uM}p` : `${uM} perc`;

  const totH = unitPrintHours * quantity;
  const tH = Math.floor(totH);
  const tM = Math.round((totH - tH) * 60);
  const totalTimeFormatted = `${tH}ó ${tM}p`;

  const combined = unitMaterialCost + unitElectricityCost;
  const matPct = combined > 0 ? Math.round((unitMaterialCost / combined) * 1000) / 10 : 50;
  const elecPct = combined > 0 ? Math.round((unitElectricityCost / combined) * 1000) / 10 : 50;

  return {
    items_on_plate: itemsOnPlate,
    quantity: quantity,
    unit_grams: unitGrams,
    unit_time_formatted: unitTimeFormatted,
    unit_material_cost: Math.round(unitMaterialCost),
    unit_electricity_cost: Math.round(unitElectricityCost),
    unit_net_cost: unitNetCost,
    unit_profit: unitProfit,
    unit_sale_price: unitSalePrice,
    total_grams: totalGrams,
    total_print_hours: Math.round(totH * 100) / 100,
    print_time_formatted: totalTimeFormatted,
    plate_time_formatted: `${Math.floor(printHours)}ó ${Math.floor(printMinutes)}p`,
    total_kwh_used: totalKwh,
    total_material_cost: totalMaterialCost,
    total_electricity_cost: totalElectricityCost,
    total_net_cost: totalNetCost,
    total_profit: totalProfit,
    total_price: totalPrice,
    cost_percentages: { material: matPct, electricity: elecPct }
  };
}

function updateSidebarDisplay(calc) {
  const grandPriceEl = document.getElementById("sidebar-grand-price");
  const unitPriceEl = document.getElementById("sidebar-unit-price");
  const costPillEl = document.getElementById("sidebar-cost-pill");
  const profitPillEl = document.getElementById("sidebar-profit-pill");

  if (grandPriceEl) grandPriceEl.innerText = `${calc.total_price.toLocaleString('hu-HU')} Ft`;
  if (unitPriceEl) unitPriceEl.innerText = `${calc.unit_sale_price.toLocaleString('hu-HU')} Ft / db (${calc.quantity} db összesen)`;
  if (costPillEl) costPillEl.innerText = `1 db önköltség: ${calc.unit_net_cost.toLocaleString('hu-HU')} Ft`;
  if (profitPillEl) profitPillEl.innerText = `Haszon: +${calc.total_profit.toLocaleString('hu-HU')} Ft`;

  document.getElementById("cost-material").innerText = `${calc.total_material_cost.toLocaleString('hu-HU')} Ft (1 db: ${calc.unit_material_cost.toLocaleString('hu-HU')} Ft)`;
  document.getElementById("cost-electricity").innerText = `${calc.total_electricity_cost.toLocaleString('hu-HU')} Ft (1 db: ${calc.unit_electricity_cost.toLocaleString('hu-HU')} Ft)`;
  document.getElementById("cost-total-net").innerText = `${calc.total_net_cost.toLocaleString('hu-HU')} Ft (1 db: ${calc.unit_net_cost.toLocaleString('hu-HU')} Ft)`;
  document.getElementById("cost-profit").innerText = `+${calc.total_profit.toLocaleString('hu-HU')} Ft`;

  document.getElementById("stat-total-grams").innerText = `${calc.total_grams} g (1 db: ${calc.unit_grams} g)`;
  document.getElementById("stat-print-time").innerText = `${calc.print_time_formatted} (Tálca idő: ${calc.plate_time_formatted})`;
  document.getElementById("stat-kwh").innerText = `${calc.total_kwh_used} kWh`;

  const p = calc.cost_percentages;
  document.getElementById("bar-material").style.width = `${p.material}%`;
  document.getElementById("bar-elec").style.width = `${p.electricity}%`;
}

// --- Bambu Studio File Dropzone ---
function setupDropzone() {
  const dropzone = document.getElementById("bambu-dropzone");
  const fileInput = document.getElementById("bambu-file-input");
  if (!dropzone || !fileInput) return;

  dropzone.addEventListener("click", () => fileInput.click());

  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });

  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragover");
  });

  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleBambuFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      handleBambuFile(e.target.files[0]);
    }
  });
}

async function handleBambuFile(file) {
  const dropText = document.getElementById("dropzone-status-text");
  if (dropText) dropText.innerText = `⏳ "${file.name}" beolvasása folyamatban...`;

  try {
    const res = await fetch("/api/parse-file", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Filename": encodeURIComponent(file.name)
      },
      body: file
    });
    const data = await res.json();

    if (data && data.success) {
      AppState.currentItem.print_hours = data.print_hours;
      AppState.currentItem.print_minutes = data.print_minutes;
      document.getElementById("item-hours").value = data.print_hours;
      document.getElementById("item-minutes").value = data.print_minutes;

      const itemsOnPlate = Math.max(1, data.items_on_plate || 1);
      AppState.currentItem.items_on_plate = itemsOnPlate;
      AppState.currentItem.quantity = itemsOnPlate;
      
      const plateQtyEl = document.getElementById("item-plate-qty");
      if (plateQtyEl) plateQtyEl.value = itemsOnPlate;
      const qtyEl = document.getElementById("item-qty");
      if (qtyEl) qtyEl.value = itemsOnPlate;

      // Nullázzuk az összes slot grammját, majd feltöltjük a fájlból érkezőkkel
      for (let s = 0; s < 8; s++) {
        AppState.currentItem.filament_assignments[s].grams = 0;
      }

      if (data.filaments && data.filaments.length > 0) {
        data.filaments.forEach((df, i) => {
          if (i < 8) {
            AppState.currentItem.filament_assignments[i].grams = df.grams;
          }
        });
      }

      // Új fájl behúzásakor leválasztjuk a korábbi projekt azonosítót, hogy újként mentődjön
      AppState.currentProject.id = null;
      AppState.currentProject.loaded_name = null;

      const cleanFileName = file.name.replace(/\.(3mf|gcode|3dmodel)$/i, "");
      const projNameInput = document.getElementById("project-name");
      if (projNameInput) {
        projNameInput.value = cleanFileName;
      }
      const itemNameInput = document.getElementById("item-name");
      if (itemNameInput) {
        itemNameInput.value = cleanFileName;
      }
      AppState.currentItem.name = cleanFileName;
      AppState.currentProject.project_name = cleanFileName;

      renderAmsSlots();
      recalculateCurrentItem();
      updateProjectHeaderStatus();

      if (dropText) {
        dropText.innerHTML = `✅ <strong>${file.name}</strong> beolvasva: ${data.print_hours}ó ${data.print_minutes}p, összesen ${data.total_grams} g (tálcán lévő darab: <strong>${itemsOnPlate} db</strong>)`;
      }
    } else {
      const errMsg = (data && data.error) ? data.error : "Nem sikerült kiolvasni a szeletelési adatokat a fájlból.";
      alert(errMsg);
      if (dropText) dropText.innerText = "⚠️ " + errMsg;
    }
  } catch (err) {
    console.error("File upload error:", err);
    alert("Hiba történt a fájl feltöltésekor: " + err.message);
    if (dropText) dropText.innerText = "Hiba történt a fájl feltöltésekor.";
  }
}

// --- Save Project Permanently ---
async function saveProjectToDb(saveAsNew = false) {
  if (!AppState.currentItem.calc) {
    await recalculateCurrentItem();
    await new Promise(r => setTimeout(r, 150));
  }

  const projName = document.getElementById("project-name")?.value.trim() || "Új Nyomtatási Projekt";
  const clientName = document.getElementById("client-name")?.value.trim() || "";
  
  // Ha külön 'Mentés újként' lett kérve, VAGY a név eltér a betöltött névtől, új projekt lesz (id = null)
  let targetId = AppState.currentProject.id;
  if (saveAsNew || (targetId && AppState.currentProject.loaded_name && projName !== AppState.currentProject.loaded_name)) {
    targetId = null;
  }

  const payload = {
    id: targetId,
    project_name: projName,
    client_name: clientName,
    client_contact: AppState.currentProject.client_contact || "",
    notes: AppState.currentProject.notes || "",
    status: "Mentve",
    items: [{
      name: AppState.currentItem.name || projName,
      items_on_plate: AppState.currentItem.items_on_plate || 1,
      quantity: AppState.currentItem.quantity || 1,
      print_hours: AppState.currentItem.print_hours || 0,
      print_minutes: AppState.currentItem.print_minutes || 0,
      profit_margin_percent: AppState.currentItem.profit_margin_percent ?? 100,
      filament_assignments: AppState.currentItem.filament_assignments,
      calculation_summary: AppState.currentItem.calc || calculateItemCostClient(AppState.currentItem, AppState.settings),
      total_price_huf: AppState.currentItem.calc ? AppState.currentItem.calc.total_price : 0
    }]
  };

  let res = null;
  if (isCloudMode()) {
    const projects = Array.isArray(AppState.projects) ? AppState.projects : [];
    const newId = targetId || (Math.max(0, ...projects.map(p => Number(p.id) || 0)) + 1);
    const existing = projects.find(p => Number(p.id) === Number(newId));
    const nowIso = new Date().toISOString().slice(0, 19).replace("T", " ");
    const savedProject = {
      id: newId,
      project_name: payload.project_name,
      client_name: payload.client_name,
      client_contact: payload.client_contact,
      notes: payload.notes,
      status: payload.status,
      created_at: existing?.created_at || nowIso,
      updated_at: nowIso,
      total_price_huf: payload.items[0].total_price_huf,
      items: [{
        id: existing?.items?.[0]?.id || Date.now(),
        project_id: newId,
        ...payload.items[0]
      }]
    };
    if (existing) {
      AppState.projects = projects.map(p => (Number(p.id) === Number(newId) ? savedProject : p));
    } else {
      AppState.projects = [savedProject, ...projects];
    }
    await persistCloudMutation();
    res = { success: true, id: newId };
  } else {
    res = await apiPost("/api/projects", payload);
  }

  if (res && res.success) {
    AppState.currentProject.id = res.id;
    AppState.currentProject.loaded_name = projName;
    AppState.currentProject.project_name = projName;
    if (isCloudMode()) {
      renderProjectsList();
      updateSaleProductsDropdowns();
    } else {
      await loadProjects();
    }
    updateProjectHeaderStatus();
    
    // Vizuális megerősítés a gombon
    const btn = document.getElementById("btn-save-project");
    if (btn) {
      btn.innerHTML = targetId ? "✅ Módosítások Frissítve!" : "✅ Új Projektként Elmentve!";
      btn.style.background = "#10B981";
      setTimeout(() => {
        btn.style.background = "";
        updateProjectHeaderStatus();
      }, 2500);
    }
  } else {
    const err = (res && res.error) ? res.error : "Ismeretlen szerverhiba";
    alert("Hiba történt a projekt mentése során:\n" + err);
  }
}

// --- Render Saved Projects List ---
function renderProjectsList() {
  const container = document.getElementById("projects-history-list");
  if (!container) return;

  if (AppState.projects.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📂</div>
        <h3>Még nincsenek elmentett projektek</h3>
        <p>A kalkulátorban kattints a <strong>"💾 Projekt Mentése"</strong> gombra, és a számításod itt bármikor újratölthető lesz!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = AppState.projects.map(p => {
    const item = (p.items && p.items.length > 0) ? p.items[0] : null;
    const calc = item ? item.calculation_summary : null;
    const unitPrice = calc ? (calc.unit_sale_price || Math.round(p.total_price_huf / (item.quantity || 1))) : 0;
    const qty = item ? item.quantity : 1;
    const plateQty = item ? (item.items_on_plate || 1) : 1;

    return `
      <div class="card" style="margin-bottom:14px; border-left: 4px solid var(--orange-primary);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
          <div style="min-width:0; flex:1 1 220px;">
            <h3 style="color:var(--silver-primary); font-size:17px; margin-bottom:4px; word-break:break-word;">
              ${p.project_name}
            </h3>
            <p style="font-size:12px; color:var(--text-muted);">
              Megrendelő: <strong>${p.client_name || 'Nincs megadva'}</strong> • 
              Dátum: ${p.updated_at} • 
              Mennyiség: <strong>${qty} db</strong> (tálcán: ${plateQty} db)
            </p>
          </div>
          <div class="project-item-actions" style="text-align:right;">
            <div style="font-size:22px; font-weight:900; color:var(--orange-primary);">
              ${(p.total_price_huf || 0).toLocaleString('hu-HU')} Ft
            </div>
            <div style="font-size:12px; color:var(--silver-muted); margin-bottom:8px;">
              ${(unitPrice || 0).toLocaleString('hu-HU')} Ft / db
            </div>
            <div class="project-item-btns">
              <button class="btn btn-primary btn-sm" onclick="loadProjectIntoCalc(${p.id})">
                📂 Megnyitás
              </button>
              <button class="btn btn-secondary btn-sm" onclick="openQuoteForProject(${p.id})">
                📑 Árajánlat
              </button>
              <button class="btn btn-danger btn-sm" onclick="deleteProjectFromDb(${p.id})">
                🗑️
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function loadProjectIntoCalc(projId) {
  const proj = AppState.projects.find(p => p.id === projId);
  if (!proj || !proj.items || proj.items.length === 0) return;

  const item = proj.items[0];
  AppState.currentProject.id = proj.id;
  AppState.currentProject.loaded_name = proj.project_name;
  AppState.currentProject.project_name = proj.project_name;
  AppState.currentProject.client_name = proj.client_name;

  document.getElementById("project-name").value = proj.project_name;
  document.getElementById("client-name").value = proj.client_name;
  document.getElementById("item-name").value = item.name;
  
  document.getElementById("item-plate-qty").value = item.items_on_plate || 1;
  document.getElementById("item-qty").value = item.quantity || 1;
  document.getElementById("item-hours").value = item.print_hours || 0;
  document.getElementById("item-minutes").value = item.print_minutes || 0;
  document.getElementById("item-profit").value = item.profit_margin_percent || 100;

  AppState.currentItem.name = item.name;
  AppState.currentItem.items_on_plate = item.items_on_plate || 1;
  AppState.currentItem.quantity = item.quantity || 1;
  AppState.currentItem.print_hours = item.print_hours || 0;
  AppState.currentItem.print_minutes = item.print_minutes || 0;
  AppState.currentItem.profit_margin_percent = item.profit_margin_percent || 100;

  // AMS slotok visszaállítása
  for (let s = 0; s < 8; s++) {
    AppState.currentItem.filament_assignments[s] = { slot: s + 1, filament_id: null, grams: 0 };
  }
  if (item.filament_assignments) {
    item.filament_assignments.forEach(fa => {
      const idx = (fa.slot || 1) - 1;
      if (idx >= 0 && idx < 8) {
        AppState.currentItem.filament_assignments[idx] = fa;
      }
    });
  }

  renderAmsSlots();
  recalculateCurrentItem();
  updateProjectHeaderStatus();

  // Váltás a kalkulátor fülre
  document.querySelector('.nav-btn[data-tab="tab-calc"]').click();
}

function openQuoteForProject(projId) {
  loadProjectIntoCalc(projId);
  document.querySelector('.nav-btn[data-tab="tab-quote"]').click();
}

async function deleteProjectFromDb(projId) {
  if (!confirm("Biztosan törölni szeretnéd ezt a mentett projektet?")) return;
  if (isCloudMode()) {
    AppState.projects = (AppState.projects || []).filter(p => Number(p.id) !== Number(projId));
    if (Number(AppState.currentProject.id) === Number(projId)) {
      startNewCalculation();
    }
    await persistCloudMutation();
    renderProjectsList();
    updateSaleProductsDropdowns();
    return;
  }
  const res = await fetch(`/api/projects/${projId}`, { method: "DELETE" });
  const data = await res.json();
  if (data && data.success) {
    if (AppState.currentProject.id === projId) {
      startNewCalculation();
    }
    await loadProjects();
  }
}

// --- Filament Library Management ---
function renderFilamentTable() {
  const tbody = document.getElementById("filament-table-body");
  const countBadge = document.getElementById("filament-count-badge");
  if (!tbody) return;

  if (countBadge) countBadge.innerText = `${AppState.filaments.length} db filament`;

  if (AppState.filaments.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state" style="padding:30px;">
          <div style="font-size:32px; margin-bottom:8px;">🧵</div>
          <strong>A filament készleted jelenleg üres.</strong><br>
          <span style="font-size:12px; color:var(--text-muted);">
            Vigyél fel egy új filamentet a fenti űrlap kitöltésével és a "Mentés" gombbal!
          </span>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = AppState.filaments.map(f => `
    <tr>
      <td>
        <span class="color-dot" style="background-color: ${f.color_hex};"></span>
        <strong>${f.color_name}</strong>
      </td>
      <td><strong>${f.brand}</strong></td>
      <td><span class="slot-tag" style="background:rgba(255,255,255,0.06); color:var(--text-main);">${f.material}</span></td>
      <td>${f.spool_price_huf.toLocaleString('hu-HU')} Ft</td>
      <td>${f.spool_weight_g} g</td>
      <td><strong style="color:var(--orange-primary); font-size:14px;">${f.cost_per_gram} Ft/g</strong></td>
      <td>${f.remaining_g} g</td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deleteFilament(${f.id})">🗑️ Törlés</button>
      </td>
    </tr>
  `).join('');
}

async function addFilamentSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const weightVal = parseFloat(form.spool_weight_g.value);
  const priceVal = parseFloat(form.spool_price_huf.value);
  const remRaw = form.remaining_g.value.trim();
  const remVal = remRaw === "" ? weightVal : parseFloat(remRaw);

  const payload = {
    brand: form.brand.value.trim(),
    material: form.material.value.trim(),
    color_name: form.color_name.value.trim(),
    color_hex: form.color_hex.value || "#FF6E00",
    spool_weight_g: weightVal,
    spool_price_huf: priceVal,
    remaining_g: Number.isFinite(remVal) ? remVal : weightVal,
    notes: form.notes.value.trim() || ""
  };

  if (!payload.brand || !payload.material || !payload.color_name || !Number.isFinite(weightVal) || weightVal <= 0 || !Number.isFinite(priceVal) || priceVal < 0) {
    alert("⚠️ Kérlek add meg helyesen a gyártót, anyagtípust, színt, valamint a tekercs súlyát és árát!");
    return;
  }

  if (isCloudMode()) {
    const filaments = Array.isArray(AppState.filaments) ? AppState.filaments : [];
    const newId = Math.max(0, ...filaments.map(f => Number(f.id) || 0)) + 1;
    const costPerGram = Math.round((payload.spool_price_huf / Math.max(1, payload.spool_weight_g)) * 100) / 100;
    AppState.filaments = [...filaments, { id: newId, ...payload, cost_per_gram: costPerGram }];
    const syncRes = await persistCloudMutation();
    form.reset();
    renderFilamentTable();
    renderAmsSlots();
    recalculateCurrentItem();
    if (syncRes && syncRes.synced) {
      alert("✅ Új filament hozzáadva és szinkronizálva a felhőbe!");
    } else {
      alert("✅ Új filament hozzáadva ezen az eszközön!\n⚠️ A felhőbe / PC-re szinkronizáláshoz add meg a GitHub tokent a '☁️ Felhő' menüben.");
    }
    return;
  }

  const res = await apiPost("/api/filaments", payload);
  if (res && res.success) {
    if (Array.isArray(res.filaments)) {
      AppState.filaments = res.filaments;
      renderFilamentTable();
      renderAmsSlots();
      recalculateCurrentItem();
    } else {
      await loadFilaments();
    }
    form.reset();
    alert("✅ Új filament sikeresen hozzáadva a készlethez!");
  } else {
    const errMsg = res && res.error
      ? res.error
      : "Nem érhető el a helyi 3DVEXORA háttérszerver (indítsd el újra a 3DVEXORA programot)!";
    alert("❌ Hiba történt a filament mentésekor:\n" + errMsg);
  }
}

async function deleteFilament(id) {
  if (!confirm("Biztosan törölni szeretnéd ezt a filamentet a készletedből?")) return;
  if (isCloudMode()) {
    AppState.filaments = (AppState.filaments || []).filter(f => Number(f.id) !== Number(id));
    await persistCloudMutation();
    renderFilamentTable();
    renderAmsSlots();
    recalculateCurrentItem();
    return;
  }
  try {
    const res = await fetch(`/api/filaments/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (data && data.success) {
      if (Array.isArray(data.filaments)) {
        AppState.filaments = data.filaments;
        renderFilamentTable();
        renderAmsSlots();
        recalculateCurrentItem();
      } else {
        await loadFilaments();
      }
    } else {
      alert("❌ Hiba a filament törlésekor: " + (data?.error || "Ismeretlen hiba"));
    }
  } catch (err) {
    alert("❌ Nem sikerült törölni a filamentet (nem fut a helyi szerver): " + err.message);
  }
}

// --- Settings Form ---
function populateSettingsForm() {
  const s = AppState.settings;
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  setVal("set-power", s.printer_avg_power_watts || 120);
  setVal("set-elec", s.electricity_kwh_cost || 70);
  setVal("set-profit", s.default_profit_margin_percent ?? 100);
  setVal("set-tax", s.tax_rate_percent || 0);
}

async function saveSettingsSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const payload = {
    printer_avg_power_watts: parseFloat(form.power.value),
    electricity_kwh_cost: parseFloat(form.elec.value),
    default_profit_margin_percent: parseFloat(form.profit.value),
    tax_rate_percent: parseFloat(form.tax.value)
  };

  if (isCloudMode()) {
    AppState.settings = sanitizeSettingsForCloud({ ...(AppState.settings || {}), ...payload });
    await persistCloudMutation();
    alert("✅ Beállítások sikeresen elmentve!");
    recalculateCurrentItem();
    return;
  }

  const res = await apiPost("/api/settings", payload);
  if (res && res.success) {
    AppState.settings = res.settings;
    alert("✅ Beállítások sikeresen elmentve!");
    recalculateCurrentItem();
  } else {
    alert("❌ Hiba a beállítások mentésekor: " + (res?.error || "Nem fut a helyi háttérszerver!"));
  }
}

// --- Quotation Generator ---
function renderQuoteView() {
  const container = document.getElementById("quote-document-container");
  if (!container) return;

  const item = AppState.currentItem;
  const calc = item.calc || { unit_sale_price: 0, total_price: 0 };
  const shipCost = parseFloat(document.getElementById("quote-ship-cost")?.value) || 0;
  const grandTotal = calc.total_price + shipCost;

  const today = new Date().toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' });
  const quoteNum = `3DV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const filText = item.filament_assignments
    .filter(fa => fa.grams > 0)
    .map(fa => {
      const f = AppState.filaments.find(x => x.id === fa.filament_id);
      return f ? `${f.brand} ${f.material} (${f.color_name})` : `Slot #${fa.slot}`;
    }).join(', ') || '3D Nyomtatási filament';

  container.innerHTML = `
    <div class="quote-paper">
      <div class="quote-header">
        <div>
          <h1 style="font-size:24px; font-weight:900; color:#1A202C; letter-spacing:1px;">
            3DVEXORA <span style="color:#FF6E00;">STUDIO</span>
          </h1>
          <p style="font-size:11px; color:#718096; text-transform:uppercase; letter-spacing:1.5px; margin-top:2px;">
            3D Printing Studio • Bambu Lab Precision
          </p>
          <p style="font-size:12px; color:#4A5568; margin-top:4px;">
            Email: ${AppState.settings.studio_email || 'info@3dvexora.hu'}
          </p>
        </div>
        <div>
          <img src="${isCloudMode() ? 'assets/apple-touch-icon.png' : '/api/logo'}" alt="3DVEXORA">
        </div>
      </div>

      <div class="quote-meta-grid">
        <div>
          <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#718096; margin-bottom:3px;">Megrendelő</div>
          <div style="font-size:16px; font-weight:700; color:#1A202C;">
            ${AppState.currentProject.client_name || 'Tisztelt Megrendelőnk'}
          </div>
          <div style="font-size:13px; color:#4A5568; word-break:break-word;">
            Projekt: <strong>${AppState.currentProject.project_name}</strong>
          </div>
        </div>
        <div class="quote-meta-right" style="text-align:right;">
          <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#718096; margin-bottom:3px;">Ajánlat részletei</div>
          <div style="font-size:13px; color:#1A202C;"><strong>Azonosító:</strong> ${quoteNum}</div>
          <div style="font-size:13px; color:#4A5568;"><strong>Dátum:</strong> ${today}</div>
        </div>
      </div>

      <div class="table-responsive" style="margin-bottom:24px;">
        <table style="width:100%; border-collapse:collapse;">
          <thead>
            <tr style="background:#F7FAFC; border-bottom:2px solid #CBD5E0; text-align:left; font-size:11px; text-transform:uppercase; color:#4A5568;">
              <th style="padding:10px;">Tétel / Modell</th>
              <th style="padding:10px;">Anyag & Szín (AMS)</th>
              <th style="padding:10px; text-align:center;">Mennyiség</th>
              <th style="padding:10px; text-align:right;">Egységár (1 db)</th>
              <th style="padding:10px; text-align:right;">Összesen</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom:1px solid #E2E8F0;">
              <td style="padding:12px 10px;"><strong>${item.name}</strong></td>
              <td style="padding:12px 10px; color:#4A5568; font-size:12px;">${filText}</td>
              <td style="padding:12px 10px; text-align:center;"><strong>${item.quantity} db</strong></td>
              <td style="padding:12px 10px; text-align:right; white-space:nowrap;">${calc.unit_sale_price.toLocaleString('hu-HU')} Ft / db</td>
              <td style="padding:12px 10px; text-align:right; font-weight:700; color:#FF6E00; white-space:nowrap;">${calc.total_price.toLocaleString('hu-HU')} Ft</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="quote-totals-box">
        <div style="display:flex; justify-content:space-between; padding:5px 0;">
          <span>Nyomtatási díj:</span>
          <strong>${calc.total_price.toLocaleString('hu-HU')} Ft</strong>
        </div>
        ${shipCost > 0 ? `
          <div style="display:flex; justify-content:space-between; padding:5px 0;">
            <span>Szállítási díj:</span>
            <span>${shipCost.toLocaleString('hu-HU')} Ft</span>
          </div>
        ` : ''}
        <div style="display:flex; justify-content:space-between; padding:8px 0; border-top:1px solid #CBD5E0; margin-top:6px; font-size:18px; font-weight:800; color:#FF6E00;">
          <span>Fizetendő végösszeg:</span>
          <span>${grandTotal.toLocaleString('hu-HU')} Ft</span>
        </div>
      </div>

      <div style="margin-top:40px; padding-top:16px; border-top:1px solid #E2E8F0; font-size:11px; color:#718096; display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px;">
        <div>Köszönjük a megrendelést! • 3DVEXORA 3D Printing Studio</div>
        <div>Érvényes: 14 napig</div>
      </div>
    </div>
  `;
}

// ==========================================
// --- Sales & Profit Tracking (NEW) ---
// ==========================================

async function loadSales() {
  try {
    if (isCloudMode()) {
      AppState.sales = Array.isArray(AppState.sales) ? AppState.sales : [];
      AppState.salesSummary = recomputeSalesSummaryClient(AppState.sales);
      AppState.saleProducts = buildSaleProductsFromProjects(AppState.projects || []);
      renderSalesKpis();
      renderSalesTable();
      updateSaleProductsDropdowns();
      return;
    }

    let res = await apiGet("/api/sales");
    if (!res || !res.success) {
      await loadAllFromCloudSyncFile();
      res = {
        success: true,
        sales: AppState.sales || [],
        summary: recomputeSalesSummaryClient(AppState.sales || []),
        products: buildSaleProductsFromProjects(AppState.projects || [])
      };
    }

    if (res && res.success) {
      AppState.sales = res.sales || [];
      AppState.salesSummary = res.summary || {};
      AppState.saleProducts = res.products || [];
      renderSalesKpis();
      renderSalesTable();
      updateSaleProductsDropdowns();
    }
  } catch (err) {
    console.error("Hiba az eladások betöltésekor:", err);
  }
}

function renderSalesKpis() {
  const sum = AppState.salesSummary || {};
  const revEl = document.getElementById("kpi-revenue");
  const costEl = document.getElementById("kpi-cost");
  const profitEl = document.getElementById("kpi-profit");
  const marginEl = document.getElementById("kpi-margin");
  const itemsEl = document.getElementById("kpi-items");
  const countEl = document.getElementById("kpi-sales-count");
  const avgOrderEl = document.getElementById("kpi-avg-order");

  const rev = sum.total_revenue || 0;
  const cost = sum.total_cost || 0;
  const profit = sum.total_profit || 0;
  const margin = sum.avg_profit_margin_percent || 0;
  const items = sum.total_items_sold || 0;
  const count = sum.total_sales_count || 0;
  const avgOrder = sum.avg_order_value || 0;

  if (revEl) revEl.innerText = `${rev.toLocaleString('hu-HU')} Ft`;
  if (costEl) costEl.innerText = `${cost.toLocaleString('hu-HU')} Ft`;
  if (profitEl) {
    profitEl.innerText = `${profit >= 0 ? '+' : ''}${profit.toLocaleString('hu-HU')} Ft`;
    profitEl.className = profit >= 0 ? "kpi-value profit-green" : "kpi-value profit-neg";
  }
  if (marginEl) marginEl.innerText = `${margin >= 0 ? '+' : ''}${margin}%`;
  if (itemsEl) itemsEl.innerText = `${items} db`;
  if (countEl) countEl.innerText = `${count} db rendelésben`;
  if (avgOrderEl) avgOrderEl.innerText = `Átlagos rendelés: ${avgOrder.toLocaleString('hu-HU')} Ft`;
}

function renderSalesTable(filteredSales = null) {
  const tbody = document.getElementById("sales-table-body");
  if (!tbody) return;

  const list = filteredSales !== null ? filteredSales : (AppState.sales || []);

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding: 40px 20px; color:var(--text-muted);">
          <div style="font-size:32px; margin-bottom:8px;">🛒</div>
          <strong style="color:var(--text-main); font-size:15px; display:block; margin-bottom:4px;">Még nincsenek rögzített eladásaid</strong>
          <span>Rögzítsd az első eladásodat a fenti űrlapon egyenként vagy több modellt csomagban összefogva!</span>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map(s => {
    const isBundle = s.is_bundle;
    const itemsBadge = isBundle 
      ? `<span class="badge-bundle" title="${s.items_summary}">📦 Csomag (${s.items_count} db): ${s.items_summary}</span>`
      : `<span style="font-weight:600; color:var(--silver-primary);">${s.items_summary}</span>`;

    const channelBadge = s.channel 
      ? `<span class="badge-channel">${s.channel}</span>` 
      : '';
    const buyerText = s.buyer_name 
      ? `<strong>${s.buyer_name}</strong>` 
      : '<span style="color:var(--text-dim);">Névtelen vevő</span>';

    const profitClass = s.profit_huf >= 0 ? 'profit-pos' : 'profit-neg';
    const profitSign = s.profit_huf >= 0 ? '+' : '';

    return `
      <tr>
        <td style="white-space:nowrap; color:var(--text-muted); font-size:12px;">
          📅 ${s.sale_date}
        </td>
        <td>
          ${itemsBadge}
          ${s.notes ? `<div style="font-size:11px; color:var(--text-dim); margin-top:3px;">💬 ${s.notes}</div>` : ''}
        </td>
        <td>
          <div style="display:flex; flex-direction:column; gap:3px;">
            <div>${buyerText}</div>
            <div>${channelBadge}</div>
          </div>
        </td>
        <td style="text-align:right; color:var(--text-muted); white-space:nowrap;">
          ${Math.round(s.total_cost_huf).toLocaleString('hu-HU')} Ft
        </td>
        <td style="text-align:right; font-weight:700; color:var(--orange-primary); white-space:nowrap;">
          ${Math.round(s.total_sale_price_huf).toLocaleString('hu-HU')} Ft
        </td>
        <td style="text-align:right; white-space:nowrap;" class="${profitClass}">
          ${profitSign}${Math.round(s.profit_huf).toLocaleString('hu-HU')} Ft
        </td>
        <td style="text-align:right; font-size:12px; white-space:nowrap;" class="${profitClass}">
          ${profitSign}${s.profit_margin_percent}%
        </td>
        <td style="text-align:center;">
          <button type="button" class="btn btn-danger btn-sm" onclick="deleteSaleFromDb(${s.id})" title="Eladás törlése" style="padding:4px 8px;">
            🗑️
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// --- Sale Item Form Builder ---
let saleItemRowCounter = 0;

function initSaleForm() {
  const dateInput = document.getElementById("sale-date");
  if (dateInput && !dateInput.value) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;
  }

  const container = document.getElementById("sale-items-builder-list");
  if (container && container.children.length === 0) {
    addSaleItemRow();
  }
}

function addSaleItemRow(defaultName = '', defaultCost = 0, defaultQty = 1, defaultProjId = null) {
  const container = document.getElementById("sale-items-builder-list");
  if (!container) return;

  saleItemRowCounter++;
  const rowId = `sale-row-${saleItemRowCounter}`;

  let optionsHtml = `<option value="">-- Válassz a mentett modellekből --</option>`;
  if (AppState.saleProducts && AppState.saleProducts.length > 0) {
    AppState.saleProducts.forEach(p => {
      const selected = (defaultProjId && defaultProjId === p.project_id) || (defaultName && defaultName === p.name) ? 'selected' : '';
      optionsHtml += `
        <option value="${p.project_id}" data-name="${p.name}" data-cost="${p.unit_cost}" data-price="${p.unit_price}" ${selected}>
          ${p.name} (1 db önköltség: ${p.unit_cost} Ft)
        </option>
      `;
    });
  }
  optionsHtml += `<option value="custom">➕ Egyedi / Nem mentett termék...</option>`;

  const rowDiv = document.createElement("div");
  rowDiv.className = "sale-item-row";
  rowDiv.id = rowId;
  rowDiv.innerHTML = `
    <div class="sale-item-product">
      <span class="sale-mobile-label">Termék / Modell</span>
      <select class="sale-row-select" onchange="onSaleProductSelectChanged('${rowId}', this)" style="width:100%; font-size:12px; padding:6px 8px; background:var(--bg-input); border:1px solid var(--border-color); border-radius:var(--radius-sm); color:var(--text-main); margin-bottom:4px;">
        ${optionsHtml}
      </select>
      <input type="text" class="sale-row-name" placeholder="Modell megnevezése" value="${defaultName}" 
             style="width:100%; font-size:12px; padding:5px 8px; background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--radius-sm); color:var(--text-main);">
    </div>

    <div>
      <span class="sale-mobile-label">Darabszám (db)</span>
      <input type="number" class="sale-row-qty" min="1" step="1" value="${defaultQty}" 
             oninput="onSaleItemRowUpdated('${rowId}')" 
             style="width:100%; font-size:13px; font-weight:700; padding:6px 8px; background:var(--bg-input); border:1px solid var(--border-color); border-radius:var(--radius-sm); color:var(--text-main); text-align:center;">
    </div>

    <div>
      <span class="sale-mobile-label">1 db Önköltség (Ft)</span>
      <input type="number" class="sale-row-cost" min="0" step="1" value="${defaultCost}" 
             oninput="onSaleItemRowUpdated('${rowId}')" placeholder="0"
             style="width:100%; font-size:13px; padding:6px 8px; background:var(--bg-input); border:1px solid var(--border-color); border-radius:var(--radius-sm); color:var(--text-main); text-align:right;">
    </div>

    <div class="sale-row-actions">
      <div style="text-align:right; font-weight:700; color:var(--silver-primary); font-size:13px;">
        <span class="sale-mobile-label" style="text-align:left; margin-bottom:0;">Sor költsége:</span>
        <span class="sale-row-total-cost">0 Ft</span>
      </div>

      <div style="text-align:center;">
        <button type="button" class="btn btn-danger btn-sm" onclick="removeSaleItemRow('${rowId}')" title="Tétel törlése" style="padding:4px 8px; border-radius:4px;">
          ✕
        </button>
      </div>
    </div>
  `;

  container.appendChild(rowDiv);
  onSaleItemRowUpdated(rowId);
}

function removeSaleItemRow(rowId) {
  const row = document.getElementById(rowId);
  const container = document.getElementById("sale-items-builder-list");
  if (row) {
    row.remove();
  }
  if (container && container.children.length === 0) {
    addSaleItemRow();
  }
  recalculateSaleForm();
}

function onSaleProductSelectChanged(rowId, selectEl) {
  const row = document.getElementById(rowId);
  if (!row) return;

  const nameInput = row.querySelector(".sale-row-name");
  const costInput = row.querySelector(".sale-row-cost");
  const selectedOpt = selectEl.options[selectEl.selectedIndex];

  if (selectedOpt && selectedOpt.value && selectedOpt.value !== "custom") {
    const prodName = selectedOpt.getAttribute("data-name") || "";
    const prodCost = parseFloat(selectedOpt.getAttribute("data-cost") || 0);
    const prodPrice = parseFloat(selectedOpt.getAttribute("data-price") || 0);

    if (nameInput) nameInput.value = prodName;
    if (costInput) costInput.value = prodCost;

    const totalPriceInput = document.getElementById("sale-total-price-input");
    if (totalPriceInput && (!totalPriceInput.value || totalPriceInput.value === "0")) {
      totalPriceInput.value = prodPrice > 0 ? prodPrice : "";
    }
  } else if (selectedOpt && selectedOpt.value === "custom") {
    if (nameInput) {
      nameInput.value = "";
      nameInput.focus();
    }
  }

  onSaleItemRowUpdated(rowId);
}

function onSaleItemRowUpdated(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;

  const qtyInput = row.querySelector(".sale-row-qty");
  const costInput = row.querySelector(".sale-row-cost");
  const totalCostSpan = row.querySelector(".sale-row-total-cost");

  const qty = Math.max(1, parseInt(qtyInput?.value) || 1);
  const cost = Math.max(0, parseFloat(costInput?.value) || 0);
  const rowTotal = Math.round(qty * cost);

  if (totalCostSpan) {
    totalCostSpan.innerText = `${rowTotal.toLocaleString('hu-HU')} Ft`;
  }

  recalculateSaleForm();
}

function recalculateSaleForm() {
  const container = document.getElementById("sale-items-builder-list");
  if (!container) return;

  let totalCost = 0;
  const rows = container.querySelectorAll(".sale-item-row");

  rows.forEach(r => {
    const qty = Math.max(1, parseInt(r.querySelector(".sale-row-qty")?.value) || 1);
    const cost = Math.max(0, parseFloat(r.querySelector(".sale-row-cost")?.value) || 0);
    totalCost += (qty * cost);
  });

  const salePriceInput = document.getElementById("sale-total-price-input");
  const salePrice = Math.max(0, parseFloat(salePriceInput?.value) || 0);

  const profit = Math.round(salePrice - totalCost);
  const margin = totalCost > 0 ? Math.round((profit / totalCost) * 100) : 0;

  const costPreview = document.getElementById("sale-preview-cost");
  const profitPreview = document.getElementById("sale-preview-profit");
  const marginPreview = document.getElementById("sale-preview-margin");

  if (costPreview) costPreview.innerText = `${Math.round(totalCost).toLocaleString('hu-HU')} Ft`;
  if (profitPreview) {
    profitPreview.innerText = `${profit >= 0 ? '+' : ''}${profit.toLocaleString('hu-HU')} Ft`;
    profitPreview.style.color = profit >= 0 ? "var(--green)" : "var(--red)";
  }
  if (marginPreview) {
    marginPreview.innerText = `${margin >= 0 ? '+' : ''}${margin}%`;
    marginPreview.style.color = profit >= 0 ? "var(--blue)" : "var(--red)";
  }
}

function updateSaleProductsDropdowns() {
  const container = document.getElementById("sale-items-builder-list");
  if (!container) return;

  const selects = container.querySelectorAll(".sale-row-select");
  selects.forEach(sel => {
    const currentVal = sel.value;
    let optionsHtml = `<option value="">-- Válassz a mentett modellekből --</option>`;
    if (AppState.saleProducts && AppState.saleProducts.length > 0) {
      AppState.saleProducts.forEach(p => {
        const selected = (currentVal && currentVal == p.project_id) ? 'selected' : '';
        optionsHtml += `
          <option value="${p.project_id}" data-name="${p.name}" data-cost="${p.unit_cost}" data-price="${p.unit_price}" ${selected}>
            ${p.name} (1 db önköltség: ${p.unit_cost} Ft)
          </option>
        `;
      });
    }
    optionsHtml += `<option value="custom" ${currentVal === 'custom' ? 'selected' : ''}>➕ Egyedi / Nem mentett termék...</option>`;
    sel.innerHTML = optionsHtml;
  });
}

async function handleSaleSubmit(e) {
  e.preventDefault();

  const saleDate = document.getElementById("sale-date")?.value || new Date().toISOString().split('T')[0];
  const buyerName = document.getElementById("sale-buyer-name")?.value.trim() || "";
  const channel = document.getElementById("sale-channel")?.value || "Vinted";
  const notes = document.getElementById("sale-notes")?.value.trim() || "";
  const totalPrice = parseFloat(document.getElementById("sale-total-price-input")?.value || 0);

  if (totalPrice <= 0) {
    alert("Kérlek add meg a tényleges eladási árat (bevételt)!");
    return;
  }

  const container = document.getElementById("sale-items-builder-list");
  const rows = container ? container.querySelectorAll(".sale-item-row") : [];
  const items = [];

  rows.forEach(r => {
    const sel = r.querySelector(".sale-row-select");
    const nameInput = r.querySelector(".sale-row-name");
    const qtyInput = r.querySelector(".sale-row-qty");
    const costInput = r.querySelector(".sale-row-cost");

    const name = nameInput?.value.trim() || (sel?.options[sel.selectedIndex]?.getAttribute("data-name")) || "Nyomtatott Modell";
    const qty = Math.max(1, parseInt(qtyInput?.value) || 1);
    const unitCost = Math.max(0, parseFloat(costInput?.value) || 0);
    const projId = sel?.value && sel.value !== "custom" ? parseInt(sel.value) : null;

    items.push({
      project_id: projId,
      item_name: name,
      quantity: qty,
      unit_cost_huf: unitCost,
      total_cost_huf: Math.round(qty * unitCost)
    });
  });

  if (items.length === 0) {
    alert("Kérlek adj hozzá legalább egy eladott terméket!");
    return;
  }

  const payload = {
    sale_date: saleDate,
    buyer_name: buyerName,
    channel: channel,
    notes: notes,
    total_sale_price_huf: totalPrice,
    items: items
  };

  const btn = document.getElementById("btn-submit-sale");
  if (btn) {
    btn.disabled = true;
    btn.innerText = "⏳ Mentés folyamatban...";
  }

  try {
    let res = isCloudMode() ? null : await apiPost("/api/sales", payload);
    if (!res || !res.success) {
      if (!isCloudMode() && res && res.error) {
        alert("Hiba történt az eladás mentésekor: " + res.error);
        if (btn) {
          btn.disabled = false;
          btn.innerText = "💾 Eladás Rögzítése & Mentése";
        }
        return;
      }

      // Offline / Statikus PWA mód: Mentés memóriába, localStorage-ba és kétirányú GitHub szinkronba
      const currentSales = Array.isArray(AppState.sales) ? AppState.sales : [];
      const newSaleId = Math.max(0, ...currentSales.map(s => Number(s.id) || 0)) + 1;
      const totalCost = Math.round(payload.items.reduce((acc, it) => acc + (Number(it.total_cost_huf) || 0), 0));
      const profit = Math.round(payload.total_sale_price_huf - totalCost);
      const offlineSale = {
        id: newSaleId,
        sale_date: payload.sale_date,
        buyer_name: payload.buyer_name,
        channel: payload.channel,
        notes: payload.notes,
        total_sale_price_huf: payload.total_sale_price_huf,
        total_cost_huf: totalCost,
        profit_huf: profit,
        profit_margin_percent: totalCost > 0 ? Math.round((profit / totalCost) * 1000) / 10 : 0,
        items_count: payload.items.reduce((acc, it) => acc + (it.quantity || 1), 0),
        items_summary: payload.items.map(it => `${it.item_name} (${it.quantity}x)`).join(", "),
        is_bundle: payload.items.length > 1,
        items: payload.items
      };

      AppState.sales = [offlineSale, ...currentSales];
      await persistCloudMutation();

      res = { success: true, sales: AppState.sales, summary: AppState.salesSummary };
    }

    if (res && res.success) {
      AppState.sales = res.sales || [];
      AppState.salesSummary = res.summary || {};
      renderSalesKpis();
      renderSalesTable();

      if (document.getElementById("sale-buyer-name")) document.getElementById("sale-buyer-name").value = "";
      if (document.getElementById("sale-notes")) document.getElementById("sale-notes").value = "";
      if (document.getElementById("sale-total-price-input")) document.getElementById("sale-total-price-input").value = "";

      if (container) {
        container.innerHTML = "";
        addSaleItemRow();
      }

      if (btn) {
        btn.innerText = "✅ Eladás Sikeresen Rögzítve!";
        btn.style.background = "#10B981";
        setTimeout(() => {
          btn.disabled = false;
          btn.innerText = "💾 Eladás Rögzítése & Mentése";
          btn.style.background = "";
        }, 2200);
      }
    } else {
      alert("Hiba történt az eladás mentésekor: " + (res?.error || "Ismeretlen hiba"));
      if (btn) {
        btn.disabled = false;
        btn.innerText = "💾 Eladás Rögzítése & Mentése";
      }
    }
  } catch (err) {
    console.error("Sale submit error:", err);
    alert("Hálózati hiba történt: " + err.message);
    if (btn) {
      btn.disabled = false;
      btn.innerText = "💾 Eladás Rögzítése & Mentése";
    }
  }
}

async function deleteSaleFromDb(saleId) {
  if (confirm("Biztosan törölni szeretnéd ezt az eladási tételt a nyilvántartásból?")) {
    if (isCloudMode()) {
      AppState.sales = (AppState.sales || []).filter(s => Number(s.id) !== Number(saleId));
      await persistCloudMutation();
      renderSalesKpis();
      renderSalesTable();
      return;
    }
    try {
      const res = await fetch(`/api/sales/${saleId}`, { method: "DELETE" });
      const data = await res.json();
      if (data && data.success) {
        AppState.sales = data.sales || [];
        AppState.salesSummary = data.summary || {};
        renderSalesKpis();
        renderSalesTable();
      }
    } catch (err) {
      alert("Hiba az eladás törlésekor: " + err.message);
    }
  }
}

function filterSalesTable() {
  const query = document.getElementById("sales-search-input")?.value.toLowerCase().trim() || "";
  const period = document.getElementById("sales-period-select")?.value || "all";

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
  const thisMonthPrefix = `${currentYear}-${currentMonth}`;

  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthPrefix = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
  const thisYearPrefix = `${currentYear}`;

  let filtered = AppState.sales || [];

  if (period === "this_month") {
    filtered = filtered.filter(s => (s.sale_date || "").startsWith(thisMonthPrefix));
  } else if (period === "prev_month") {
    filtered = filtered.filter(s => (s.sale_date || "").startsWith(prevMonthPrefix));
  } else if (period === "this_year") {
    filtered = filtered.filter(s => (s.sale_date || "").startsWith(thisYearPrefix));
  }

  if (query) {
    filtered = filtered.filter(s => {
      const bName = (s.buyer_name || "").toLowerCase();
      const ch = (s.channel || "").toLowerCase();
      const n = (s.notes || "").toLowerCase();
      const sum = (s.items_summary || "").toLowerCase();
      return bName.includes(query) || ch.includes(query) || n.includes(query) || sum.includes(query);
    });
  }

  renderSalesTable(filtered);
}

function exportSalesToCsv() {
  const list = AppState.sales || [];
  if (list.length === 0) {
    alert("Nincsenek exportálható eladások!");
    return;
  }

  const headers = ["Azonosito", "Datum", "Vevo", "Csatorna", "Termekek", "Gyartasi_Koltseg_HUF", "Eladasi_Ar_HUF", "Profit_HUF", "Haszonkulcs_Szazalek", "Megjegyzes"];
  const rows = [headers.join(";")];

  list.forEach(s => {
    const row = [
      s.id,
      `"${s.sale_date}"`,
      `"${(s.buyer_name || '').replace(/"/g, '""')}"`,
      `"${(s.channel || '').replace(/"/g, '""')}"`,
      `"${(s.items_summary || '').replace(/"/g, '""')}"`,
      Math.round(s.total_cost_huf),
      Math.round(s.total_sale_price_huf),
      Math.round(s.profit_huf),
      s.profit_margin_percent,
      `"${(s.notes || '').replace(/"/g, '""')}"`
    ];
    rows.push(row.join(";"));
  });

  const csvContent = "\uFEFF" + rows.join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `3DVEXORA_Eladasok_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ==========================================
// --- Mobil PWA, QR Kód & Felhőszinkron Modals ---
// ==========================================

function refreshAllCloudViews() {
  populateSettingsForm();
  renderFilamentTable();
  renderAmsSlots();
  renderProjectsList();
  renderSalesKpis();
  renderSalesTable();
  updateSaleProductsDropdowns();
  recalculateCurrentItem();
}

async function syncCloudBidirectional(tokenInputValue = null) {
  const savedToken = localStorage.getItem(CLOUD_STORAGE_KEYS.token);
  const token = (tokenInputValue || savedToken || "").trim();
  const isPending = localStorage.getItem(CLOUD_STORAGE_KEYS.pendingSync) === "1";

  if (!token) {
    const ok = await loadAllFromCloudSyncFile();
    if (ok) refreshAllCloudViews();
    return {
      mode: "pull_only",
      needsToken: isPending
    };
  }

  localStorage.setItem(CLOUD_STORAGE_KEYS.token, token);

  let remoteMeta = null;
  try {
    remoteMeta = await fetchSyncJsonFromGitHubApi(token);
  } catch (e) {
    if (!e.message.includes("404")) throw e;
  }

  if (remoteMeta && remoteMeta.data) {
    if (isPending) {
      const merged = mergeRemoteNewItemsIntoLocal(buildCurrentCloudSnapshot(), remoteMeta.data);
      applyCloudSnapshotData(merged);
      await pushCloudSnapshotToGitHub(token, buildCurrentCloudSnapshot(), remoteMeta.sha);
      refreshAllCloudViews();
      return { mode: "merged_and_pushed" };
    } else {
      applyCloudSnapshotData(remoteMeta.data);
      localStorage.setItem(CLOUD_STORAGE_KEYS.baseTs, remoteMeta.data.exported_at || new Date().toISOString());
      localStorage.removeItem(CLOUD_STORAGE_KEYS.pendingSync);
      localStorage.removeItem("3dvexora_offline_sales");
      saveCloudSnapshotToLocalStorage(buildCurrentCloudSnapshot(), false);
      refreshAllCloudViews();
      return { mode: "pulled_latest" };
    }
  } else {
    await pushCloudSnapshotToGitHub(token, buildCurrentCloudSnapshot(), null);
    refreshAllCloudViews();
    return { mode: "pushed_initial" };
  }
}

async function checkSyncStatusOnStartup() {
  if (isCloudMode()) {
    const isPending = localStorage.getItem(CLOUD_STORAGE_KEYS.pendingSync) === "1";
    const hasToken = !!localStorage.getItem(CLOUD_STORAGE_KEYS.token);
    if (isPending && hasToken) {
      try {
        await syncCloudBidirectional();
        updateCloudStatusBadge("Felhő: Szinkronizálva ☁️");
        return;
      } catch (e) {}
    }
    updateCloudStatusBadge(isPending ? "HelyiPWA: Várakozik 📱" : (hasToken ? "Felhő: Kétirányú ☁️" : "Felhő: Élő ☁️"));
    return;
  }

  try {
    const info = await apiGet("/api/sync/info");
    if (info && info.success) {
      updateCloudStatusBadge(info.is_cloud_synced ? "Felhő: Aktív ☁️" : "Wi-Fi: Kész 📶");
    }
  } catch (e) {
    // Offline / Statikus módban normális
  }
}

async function showMobileConnectModal() {
  const modal = document.getElementById("modal-mobile-connect");
  if (!modal) return;
  modal.style.display = "flex";

  let wifiUrl = isCloudMode()
    ? `${window.location.origin}${window.location.pathname}`
    : window.location.origin;

  if (!isCloudMode()) {
    try {
      const info = await apiGet("/api/sync/info");
      if (info && info.wifi_url) {
        wifiUrl = info.wifi_url;
      }
    } catch (e) {
      // Statikus fallback
    }
  }

  const wifiInput = document.getElementById("local-wifi-url");
  if (wifiInput) wifiInput.value = wifiUrl;

  const qrImg = document.getElementById("qr-code-img");
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(wifiUrl)}`;
  }
}

async function showCloudSyncModal() {
  const modal = document.getElementById("modal-cloud-sync");
  if (!modal) return;
  modal.style.display = "flex";

  const tokenInput = document.getElementById("github-token-input");
  const cloudToken = isCloudMode() ? localStorage.getItem(CLOUD_STORAGE_KEYS.token) : null;
  if (tokenInput) {
    tokenInput.value = cloudToken || AppState.settings?.github_token || "";
  }

  const statusEl = document.getElementById("sync-modal-status-text");
  if (statusEl && isCloudMode()) {
    const isPending = localStorage.getItem(CLOUD_STORAGE_KEYS.pendingSync) === "1";
    if (isPending) {
      statusEl.innerText = "📱 Helyi módosítások várnak feltöltésre";
    } else if (cloudToken) {
      statusEl.innerText = "☁️ Kétirányú GitHub szinkron aktív ezen az eszközön";
    } else {
      statusEl.innerText = "📥 GitHub adatbetöltés aktív (add meg a tokent a feltöltéshez)";
    }
  }

  const lastTimeEl = document.getElementById("sync-last-time");
  const lastTs = (isCloudMode() ? localStorage.getItem(CLOUD_STORAGE_KEYS.baseTs) : null) || AppState.settings?.last_cloud_sync;
  if (lastTimeEl && lastTs) {
    try {
      const d = new Date(lastTs);
      lastTimeEl.innerText = `Utolsó szinkron: ${d.toLocaleString('hu-HU')}`;
    } catch (e) {
      lastTimeEl.innerText = `Utolsó szinkron: ${lastTs}`;
    }
  }
}

function closeModals() {
  const m1 = document.getElementById("modal-mobile-connect");
  const m2 = document.getElementById("modal-cloud-sync");
  if (m1) m1.style.display = "none";
  if (m2) m2.style.display = "none";
}

function copyToClipboard(text) {
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      alert("Cím a vágólapra másolva:\n" + text);
    }).catch(() => {
      prompt("Másold ki ezt a címet:", text);
    });
  } else {
    prompt("Másold ki ezt a címet:", text);
  }
}

async function triggerManualSync() {
  const statusEl = document.getElementById("sync-modal-status-text");
  const btn = document.getElementById("btn-trigger-sync");
  if (statusEl) statusEl.innerText = "⏳ Szinkronizáció folyamatban...";
  if (btn) btn.disabled = true;

  try {
    if (isCloudMode()) {
      const inputVal = document.getElementById("github-token-input")?.value.trim();
      const res = await syncCloudBidirectional(inputVal || null);
      if (res.mode === "pull_only") {
        if (res.needsToken) {
          if (statusEl) statusEl.innerText = "⚠️ Add meg alul a GitHub tokent, hogy a mobil módosítások felmenjenek a PC-re!";
        } else {
          if (statusEl) statusEl.innerText = "✅ Friss adatok letöltve a GitHub-ról!";
        }
      } else {
        if (statusEl) statusEl.innerText = "✅ Kétirányú szinkron sikeres (GitHub <-> Mobil)!";
      }
      updateCloudStatusBadge("Felhő: Szinkronizálva ☁️");
      return;
    }

    const res = await apiPost("/api/sync/manual", {});
    if (res && res.status === "success") {
      if (statusEl) statusEl.innerText = "✅ Sikeresen szinkronizálva a felhővel!";
      await loadSettings();
      await loadFilaments();
      await loadProjects();
      await loadSales();
    } else if (res && res.status === "no_token") {
      if (statusEl) statusEl.innerText = "⚠️ Még nincs megadva GitHub token az automatikus felhőhöz!";
    } else {
      if (statusEl) statusEl.innerText = "⚠️ Szinkron figyelmeztetés: " + (res?.error || "Ellenőrizd az internetkapcsolatot!");
    }
  } catch (err) {
    if (statusEl) statusEl.innerText = "⚠️ Hiba: " + err.message;
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deployToGitHubFromUI() {
  const tokenInput = document.getElementById("github-token-input");
  const token = tokenInput?.value.trim();
  const resDiv = document.getElementById("deploy-gh-result");
  const btn = document.getElementById("btn-deploy-gh");

  if (!token) {
    alert("Kérlek add meg a GitHub Personal Access Token-edet (repo jogosultsággal)!");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerText = isCloudMode() ? "⏳ Felhőszinkron mentése..." : "⏳ Feltöltés és GitHub Pages aktiválás folyamatban...";
  }
  if (resDiv) {
    resDiv.innerHTML = `<span style="color:var(--orange-primary);">🚀 ${isCloudMode() ? "Adatok szinkronizálása a GitHub-ra" : "Fájlok feltöltése a GitHub-ra"} folyamatban...</span>`;
  }

  try {
    if (isCloudMode()) {
      await syncCloudBidirectional(token);
      if (resDiv) {
        resDiv.innerHTML = `<div style="color:#10B981; padding:8px 0; font-weight:700;">✅ Token elmentve ezen az eszközön és minden adat kétirányúan szinkronizálva a GitHub-ra!</div>`;
      }
      if (btn) {
        btn.disabled = false;
        btn.innerText = "✅ Szinkronizálva!";
      }
      return;
    }

    const res = await apiPost("/api/sync/github-deploy", {
      token: token,
      username: "EnBest2",
      repo_name: "3dvexora"
    });

    if (res && res.success) {
      if (resDiv) {
        resDiv.innerHTML = `
          <div style="background:rgba(16,185,129,0.15); border:1px solid #10B981; border-radius:8px; padding:12px; margin-top:8px;">
            <div style="font-weight:700; color:#10B981; margin-bottom:4px;">🎉 SIKERES FELTÖLTÉS & GITHUB PAGES AKTIVÁLVA!</div>
            <div style="margin-bottom:6px;">A PWA webalkalmazásod elérhető az alábbi címen:</div>
            <a href="${res.url}" target="_blank" style="color:var(--orange-primary); font-weight:700; text-decoration:underline; font-size:13px; word-break:break-all;">
              ${res.url}
            </a>
            <div style="font-size:11px; color:var(--text-muted); margin-top:6px;">
              Megjegyzés: A GitHub Pages az első aktiváláskor 1-2 percet vehet igénybe, amíg a DNS életbe lép.
            </div>
          </div>
        `;
      }
      if (btn) btn.innerText = "✅ Feltöltve & Bekapcsolva!";
      await loadSettings();
    } else {
      if (resDiv) {
        resDiv.innerHTML = `<div style="color:var(--red); padding:8px 0;">❌ Hiba a feltöltéskor: ${res?.error || "Ismeretlen hiba"}</div>`;
      }
      if (btn) {
        btn.disabled = false;
        btn.innerText = "🚀 Újrapróbálás";
      }
    }
  } catch (err) {
    if (resDiv) {
      resDiv.innerHTML = `<div style="color:var(--red); padding:8px 0;">❌ Hiba: ${err.message}</div>`;
    }
    if (btn) {
      btn.disabled = false;
      btn.innerText = "🚀 Újrapróbálás";
    }
  }
}
