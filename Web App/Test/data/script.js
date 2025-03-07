Highcharts.setOptions({ time: { useUTC: false } });

function logStatus(message) {
  console.log(message);
  const statusBar = document.getElementById("statusBar");
  if (statusBar) statusBar.textContent = "Status: " + message;
}

let db;
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("DEToolData", 1);
    request.onupgradeneeded = function(event) {
      db = event.target.result;
      if (!db.objectStoreNames.contains("seriesData")) {
        db.createObjectStore("seriesData", { keyPath: "tag" });
      }
    };
    request.onsuccess = function(event) {
      db = event.target.result;
      resolve(db);
    };
    request.onerror = function(event) {
      reject("IndexedDB error");
    };
  });
}
function getSeriesData(tag) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["seriesData"], "readonly");
    const store = transaction.objectStore("seriesData");
    const request = store.get(tag);
    request.onsuccess = () => resolve(request.result ? request.result.data : []);
    request.onerror = () => reject("Error getting data");
  });
}
function putSeriesData(tag, data) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["seriesData"], "readwrite");
    const store = transaction.objectStore("seriesData");
    const request = store.put({ tag: tag, data: data });
    request.onsuccess = () => resolve();
    request.onerror = () => reject("Error storing data");
  });
}

function loadLogo(callback) {
  const logoImage = new Image();
  logoImage.crossOrigin = "anonymous";
  // Logo is stored in /data folder as logo.png
  logoImage.src = "/data/logo.png";
  logoImage.onload = function () {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = logoImage.width;
      canvas.height = logoImage.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(logoImage, 0, 0);
      callback(canvas.toDataURL("image/png"));
    } catch (err) {
      console.error("Error processing logo image:", err);
      callback(null);
    }
  };
  logoImage.onerror = function (err) {
    console.error("Error loading logo image:", err);
    callback(null);
  };
}
function getCurrentDateString() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}
function generateFileName() {
  const bargeName = document.getElementById("bargeNameInput").value || "UnknownBarge";
  const fhNumber = document.getElementById("bargeNumberInput").value || "0000";
  return `FH ${fhNumber} ${bargeName} ${getCurrentDateString()}`;
}
function formatDateTimeForInput(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function generateMultiLevelHeader(seriesHeaders) {
  const headerParts = seriesHeaders.map(header => {
    const parts = header.split(".");
    while (parts.length < 3) parts.push("");
    return parts;
  });
  const row1 = [], row2 = [], row3 = [];
  let col = 0;
  while (col < headerParts.length) {
    let colSpan = 1;
    while (col + colSpan < headerParts.length && headerParts[col + colSpan][0] === headerParts[col][0]) {
      colSpan++;
    }
    row1.push({ content: headerParts[col][0], colSpan });
    let subCol = col;
    while (subCol < col + colSpan) {
      let subColSpan = 1;
      while (subCol + subColSpan < col + colSpan && headerParts[subCol + subColSpan][1] === headerParts[subCol][1]) {
        subColSpan++;
      }
      row2.push({ content: headerParts[subCol][1], colSpan: subColSpan });
      for (let i = 0; i < subColSpan; i++) {
        row3.push({ content: headerParts[subCol + i][2] });
      }
      subCol += subColSpan;
    }
    col += colSpan;
  }
  return [row1, row2, row3];
}

let oldExtremes = [];
function zoom() {
  oldExtremes = [chart.xAxis[0].min, chart.xAxis[0].max];
  chart.xAxis[0].setExtremes(1356998400000, 1366998400000);
}
function zoomBack() {
  chart.xAxis[0].setExtremes(oldExtremes[0], oldExtremes[1]);
}

const today = new Date();
const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0);
const currentTime = new Date();
flatpickr("#startDate", {
  enableTime: true,
  time_24hr: true,
  dateFormat: "Y-m-d H:i",
  defaultDate: startOfDay
});
flatpickr("#endDate", {
  enableTime: true,
  time_24hr: true,
  dateFormat: "Y-m-d H:i",
  defaultDate: currentTime
});

let fullTagList = [];
let displayTagList = [];
let selectedTags = new Set();
let rawSeriesData = {};
let lastSeriesData = [];
let chart = null;
let sortOrder = localStorage.getItem("sortOrder") || "asc";
let groupingMode = localStorage.getItem("groupingMode") || "0";
let dataOffset = parseInt(localStorage.getItem("dataOffset") || "-1");
let autoRefreshInterval = 5000;
let autoRefreshTimer = null;
let queryStartTimes = {};
let globalEndMultiplier = 1;

function deepClone(data) {
  return JSON.parse(JSON.stringify(data));
}
function applyDisplayOffset(seriesData) {
  const displayOffsetMs = -dataOffset * 3600 * 1000;
  return seriesData.map(series => ({
    name: series.name,
    data: series.data.map(pt => [pt[0] + displayOffsetMs, pt[1]])
  }));
}

function adjustLayout() {
  const content = document.getElementById("content");
  const chartContainer = document.getElementById("chartContainer");
  if (chart && content && chartContainer) {
    chart.setSize(content.clientWidth, chartContainer.clientHeight, false);
  }
}
window.addEventListener("resize", adjustLayout);
adjustLayout();
document.addEventListener("DOMContentLoaded", function () {
  const chartContainer = document.getElementById("chartContainer");
  if (chartContainer) {
    chartContainer.style.height = "600px";
  }
});

function buildFlatTree(list) {
  let sorted = list.slice().sort((a, b) => a.Tag.localeCompare(b.Tag));
  if (sortOrder === "desc") sorted.reverse();
  return sorted;
}
function buildOneGroup(list) {
  let groups = {};
  list.forEach(item => {
    let parts = item.Tag.split(".");
    const group = parts.length >= 2 ? parts[0] : item.Tag;
    const display = parts.length >= 2 ? parts.slice(1).join(".") : item.Tag;
    if (!groups[group]) groups[group] = [];
    groups[group].push({ full: item.Tag, display });
  });
  return groups;
}
function buildTwoGroup(list) {
  let mainGroups = {};
  list.forEach(item => {
    let parts = item.Tag.split(".");
    const main = parts[0];
    const sub = parts.length >= 2 ? parts[1] : null;
    const display = parts.length > 2 ? parts.slice(2).join(".") : (sub || main);
    if (!mainGroups[main]) mainGroups[main] = {};
    if (!(sub in mainGroups[main])) mainGroups[main][sub] = [];
    mainGroups[main][sub].push({ full: item.Tag, display });
  });
  return mainGroups;
}
function buildTreeFromDisplay(list) {
  displayTagList = list;
  const container = document.getElementById("tagTree");
  container.innerHTML = "";
  if (groupingMode === "0") {
    const ul = document.createElement("ul");
    buildFlatTree(list).forEach(item => {
      const li = document.createElement("li");
      li.textContent = item.Tag;
      li.classList.toggle("selected", selectedTags.has(item.Tag));
      li.addEventListener("click", e => {
        e.stopPropagation();
        selectedTags.has(item.Tag) ? selectedTags.delete(item.Tag) : selectedTags.add(item.Tag);
        buildTreeFromDisplay(list);
      });
      ul.appendChild(li);
    });
    container.appendChild(ul);
    logStatus(`Tag list updated in flat mode with ${list.length} tags.`);
  } else if (groupingMode === "1") {
    const groups = buildOneGroup(list);
    const ul = document.createElement("ul");
    Object.keys(groups)
      .sort((a, b) => sortOrder === "desc" ? b.localeCompare(a) : a.localeCompare(b))
      .forEach(group => {
        const groupLi = document.createElement("li");
        groupLi.textContent = group;
        const toggleBtn = document.createElement("button");
        toggleBtn.textContent = "Toggle All";
        toggleBtn.className = "action-btn";
        toggleBtn.style.marginLeft = "10px";
        toggleBtn.addEventListener("click", e => {
          e.stopPropagation();
          const allSelected = groups[group].every(item => selectedTags.has(item.full));
          groups[group].forEach(item => {
            allSelected ? selectedTags.delete(item.full) : selectedTags.add(item.full);
          });
          buildTreeFromDisplay(list);
        });
        groupLi.appendChild(toggleBtn);
        ul.appendChild(groupLi);
        const subUl = document.createElement("ul");
        groups[group]
          .sort((a, b) => sortOrder === "desc" ? b.display.localeCompare(a.display) : a.display.localeCompare(b.display))
          .forEach(item => {
            const li = document.createElement("li");
            li.textContent = item.display;
            li.classList.toggle("selected", selectedTags.has(item.full));
            li.addEventListener("click", e => {
              e.stopPropagation();
              selectedTags.has(item.full) ? selectedTags.delete(item.full) : selectedTags.add(item.full);
              buildTreeFromDisplay(list);
            });
            subUl.appendChild(li);
          });
        ul.appendChild(subUl);
      });
    container.appendChild(ul);
    logStatus(`Tag list updated in one-group mode with ${Object.keys(groups).length} groups.`);
  } else if (groupingMode === "2") {
    const mainGroups = buildTwoGroup(list);
    const ul = document.createElement("ul");
    Object.keys(mainGroups)
      .sort((a, b) => sortOrder === "desc" ? b.localeCompare(a) : a.localeCompare(b))
      .forEach(main => {
        const mainLi = document.createElement("li");
        mainLi.textContent = main;
        ul.appendChild(mainLi);
        Object.keys(mainGroups[main])
          .sort((a, b) => sortOrder === "desc" ? b.localeCompare(a) : a.localeCompare(b))
          .forEach(sub => {
            if (sub !== null && sub !== "null") {
              const subLi = document.createElement("li");
              subLi.style.marginLeft = "20px";
              subLi.textContent = sub;
              const toggleBtn = document.createElement("button");
              toggleBtn.textContent = "Toggle All";
              toggleBtn.className = "action-btn";
              toggleBtn.style.marginLeft = "10px";
              toggleBtn.addEventListener("click", e => {
                e.stopPropagation();
                const allSelected = mainGroups[main][sub].every(item => selectedTags.has(item.full));
                mainGroups[main][sub].forEach(item => {
                  allSelected ? selectedTags.delete(item.full) : selectedTags.add(item.full);
                });
                buildTreeFromDisplay(list);
              });
              subLi.appendChild(toggleBtn);
              ul.appendChild(subLi);
              const tagUl = document.createElement("ul");
              tagUl.style.marginLeft = "40px";
              mainGroups[main][sub]
                .sort((a, b) => sortOrder === "desc" ? b.display.localeCompare(a.display) : a.display.localeCompare(b.display))
                .forEach(item => {
                  const li = document.createElement("li");
                  li.textContent = item.display;
                  li.classList.toggle("selected", selectedTags.has(item.full));
                  li.addEventListener("click", e => {
                    e.stopPropagation();
                    selectedTags.has(item.full) ? selectedTags.delete(item.full) : selectedTags.add(item.full);
                    buildTreeFromDisplay(list);
                  });
                  tagUl.appendChild(li);
                });
              ul.appendChild(tagUl);
            }
          });
      });
    container.appendChild(ul);
    logStatus(`Tag list updated in two-group mode with ${Object.keys(mainGroups).length} main categories.`);
  }
  updateSelectionSummary();
}

function updateSelectionSummary() {
  const total = fullTagList.length;
  document.getElementById("selectionSummary").textContent = `${selectedTags.size}/${total}`;
}

document.getElementById("selectAllBtn").addEventListener("click", () => {
  displayTagList.forEach(item => selectedTags.add(item.Tag));
  buildTreeFromDisplay(displayTagList);
});
document.getElementById("deselectAllBtn").addEventListener("click", () => {
  displayTagList.forEach(item => selectedTags.delete(item.Tag));
  buildTreeFromDisplay(displayTagList);
});
document.getElementById("tagFilter").addEventListener("input", () => {
  const text = document.getElementById("tagFilter").value.trim().toLowerCase();
  if (!text) {
    buildTreeFromDisplay(fullTagList);
    displayTagList = fullTagList;
    return;
  }
  const filtered = fullTagList.filter(item => item.Tag.toLowerCase().includes(text));
  displayTagList = filtered;
  buildTreeFromDisplay(filtered);
});

// ---------- Fetch Tag List (with Status Updates) ----------
async function asyncFetchTagList() {
  logStatus("Fetching tag list...");
  try {
    const response = await fetch("/taglist");
    if (!response.ok) throw new Error("HTTP error " + response.status);
    const tagListData = await response.json();
    fullTagList = tagListData;
    localStorage.setItem("tagList", JSON.stringify(tagListData));
    buildTreeFromDisplay(tagListData);
    logStatus("Tag list fetched successfully.");
  } catch (error) {
    logStatus("Failed to fetch tag list: " + error.message);
    console.error("Failed to fetch tag list:", error);
  }
}
function loadTagListFromCache() {
  const cached = localStorage.getItem("tagList");
  if (cached) {
    try {
      const cachedTagList = JSON.parse(cached);
      fullTagList = cachedTagList;
      displayTagList = cachedTagList;
      buildTreeFromDisplay(cachedTagList);
      logStatus("Tag list loaded from cache.");
    } catch (e) {
      console.error("Error parsing cached tag list:", e);
    }
  }
}
loadTagListFromCache();
asyncFetchTagList();
document.getElementById("refreshTagsBtn").addEventListener("click", () => { asyncFetchTagList(); });
window.addEventListener("beforeunload", function() {
  localStorage.removeItem("tagList");
  navigator.sendBeacon("/clear_cache");
});

// ---------- Settings & Options ----------
function saveSettings() {
  try {
    const darkMode = document.getElementById("darkModeToggle").checked;
    localStorage.setItem("darkMode", darkMode);
    localStorage.setItem("groupingMode", groupingMode);
    localStorage.setItem("sortOrder", sortOrder);
    const offsetVal = document.getElementById("dataOffsetInput").value;
    localStorage.setItem("dataOffset", offsetVal);
    dataOffset = parseInt(offsetVal);
    const bargeName = document.getElementById("bargeNameInput").value;
    const fhNumber = document.getElementById("bargeNumberInput").value;
    localStorage.setItem("bargeName", bargeName);
    localStorage.setItem("bargeNumber", fhNumber);
  } catch (e) {
    console.error("Error saving settings:", e);
  }
}
function updateGroupingOptionsUI() {
  document.querySelectorAll(".grouping-option").forEach(btn => {
    if (btn.getAttribute("data-value") === groupingMode)
      btn.classList.add("selected");
    else
      btn.classList.remove("selected");
  });
  saveSettings();
  buildTreeFromDisplay(displayTagList);
}
function loadSettings() {
  try {
    if (localStorage.getItem("darkMode") === null)
      localStorage.setItem("darkMode", "true");
    const darkMode = localStorage.getItem("darkMode") === "true";
    document.body.classList.toggle("dark-mode", darkMode);
    document.getElementById("darkModeToggle").checked = darkMode;
    groupingMode = localStorage.getItem("groupingMode") || "0";
    sortOrder = localStorage.getItem("sortOrder") || "asc";
    dataOffset = parseInt(localStorage.getItem("dataOffset") || "1");
    document.getElementById("dataOffsetInput").value = dataOffset;
    document.getElementById("bargeNameInput").value = localStorage.getItem("bargeName") || "";
    document.getElementById("bargeNumberInput").value = localStorage.getItem("bargeNumber") || "";
  } catch (e) {
    console.error("LocalStorage error, using defaults", e);
    document.body.classList.add("dark-mode");
    document.getElementById("darkModeToggle").checked = true;
    groupingMode = "0";
    sortOrder = "asc";
    dataOffset = 1;
    document.getElementById("dataOffsetInput").value = dataOffset;
  }
  updateGroupingOptionsUI();
}
document.getElementById("darkModeToggle").addEventListener("change", () => {
  const enabled = document.getElementById("darkModeToggle").checked;
  document.body.classList.toggle("dark-mode", enabled);
  saveSettings();
  updateChartBackground();
});
document.querySelectorAll(".grouping-option").forEach(btn => {
  btn.addEventListener("click", () => { groupingMode = btn.getAttribute("data-value"); updateGroupingOptionsUI(); });
});
document.querySelectorAll(".sort-order-btn").forEach(btn => {
  btn.addEventListener("click", () => { sortOrder = btn.getAttribute("data-order"); saveSettings(); buildTreeFromDisplay(displayTagList); });
});
loadSettings();
function updateChartBackground() {
  if (chart) {
    const appDark = document.body.classList.contains("dark-mode");
    const chartBg = appDark ? "#2e2e2e" : "#ffffff";
    const textColor = appDark ? "#e0e0e0" : "#000";
    const legendColor = appDark ? "white" : "#000";
    chart.update({
      chart: { backgroundColor: chartBg },
      title: { style: { color: textColor } },
      xAxis: { labels: { style: { color: textColor }, format: '{value:%H:%M:%S}' }, lineColor: textColor, tickColor: textColor },
      yAxis: { labels: { style: { color: textColor } }, title: { style: { color: textColor } }, lineColor: textColor, tickColor: textColor },
      legend: { itemStyle: { color: legendColor } }
    });
  }
}

// ---------- Toggle Settings Panel ----------
function toggleSettingsPanel() {
  const panel = document.getElementById("mainOptionsPanel");
  if (panel.classList.contains("open")) {
    panel.classList.remove("open");
    logStatus("Settings panel closed.");
  } else {
    panel.classList.add("open");
    logStatus("Settings panel opened.");
  }
}
document.getElementById("mainOptionsBtn").addEventListener("click", toggleSettingsPanel);
document.getElementById("mainOptionsCloseBtn").addEventListener("click", toggleSettingsPanel);
document.getElementById("saveSettingsBtn").addEventListener("click", () => { saveSettings(); toggleSettingsPanel(); });

// ---------- Tag Options Modal ----------
function openTagOptionsModal() {
  const modal = document.getElementById("tagOptionsModal");
  const container = document.getElementById("tagOptionsContainer");
  container.innerHTML = "";
  const selTags = Array.from(selectedTags);
  if (selTags.length === 0)
    container.innerHTML = "<p>No tags selected.</p>";
  else {
    const tagSettings = JSON.parse(localStorage.getItem("tagSettings") || '{"scale_factors":{},"error_values":{},"max_decimal":{}}');
    selTags.forEach(tag => {
      const div = document.createElement("div");
      div.className = "tag-option-row";
      
      const label = document.createElement("label");
      label.textContent = tag;
      label.className = "tag-col";
      
      const scaleInput = document.createElement("input");
      scaleInput.type = "number";
      scaleInput.step = "0.01";
      scaleInput.value = (tagSettings.scale_factors && tagSettings.scale_factors[tag]) ? tagSettings.scale_factors[tag] : 1.0;
      scaleInput.className = "settings-col";
      scaleInput.style.width = "60px";
      
      const errorInput = document.createElement("input");
      errorInput.type = "number";
      errorInput.step = "0.01";
      errorInput.value = (tagSettings.error_values && tagSettings.error_values[tag]) ? tagSettings.error_values[tag] : "";
      errorInput.className = "settings-col";
      errorInput.style.width = "60px";
      
      const maxDecInput = document.createElement("input");
      maxDecInput.type = "number";
      maxDecInput.step = "1";
      maxDecInput.value = (tagSettings.max_decimal && tagSettings.max_decimal[tag]) ? tagSettings.max_decimal[tag] : 2;
      maxDecInput.className = "settings-col";
      maxDecInput.style.width = "60px";
      
      div.dataset.tag = tag;
      div.dataset.scale = scaleInput.value;
      div.dataset.error = errorInput.value;
      div.dataset.maxDec = maxDecInput.value;
      
      scaleInput.addEventListener("input", () => { div.dataset.scale = scaleInput.value; });
      errorInput.addEventListener("input", () => { div.dataset.error = errorInput.value; });
      maxDecInput.addEventListener("input", () => { div.dataset.maxDec = maxDecInput.value; });
      
      div.appendChild(label);
      div.appendChild(scaleInput);
      div.appendChild(errorInput);
      div.appendChild(maxDecInput);
      
      container.appendChild(div);
    });
  }
  modal.style.display = "block";
}

function closeTagOptionsModal() {
  document.getElementById("tagOptionsModal").style.display = "none";
}
document.getElementById("tagOptionsGear").addEventListener("click", openTagOptionsModal);
document.getElementById("tagOptionsClose").addEventListener("click", closeTagOptionsModal);
document.getElementById("saveTagOptionsBtn").addEventListener("click", () => {
  const container = document.getElementById("tagOptionsContainer");
  const rows = container.getElementsByClassName("tag-option-row");
  const newSettings = { scale_factors: {}, error_values: {}, max_decimal: {} };
  for (let row of rows) {
    const tag = row.dataset.tag;
    let scaleVal = parseFloat(row.dataset.scale);
    let errorVal = row.dataset.error.trim() === "" ? null : parseFloat(row.dataset.error);
    let maxDec = parseInt(row.dataset.maxDec, 10);
    newSettings.scale_factors[tag] = isNaN(scaleVal) ? 1.0 : scaleVal;
    newSettings.error_values[tag] = (errorVal === null || isNaN(errorVal)) ? null : errorVal;
    newSettings.max_decimal[tag] = isNaN(maxDec) ? 2 : maxDec;
  }
  localStorage.setItem("tagSettings", JSON.stringify(newSettings));
  logStatus("Tag options saved.");
  closeTagOptionsModal();
  if (Object.keys(rawSeriesData).length > 0) {
    Promise.all(Array.from(selectedTags).map(async tag => {
      let stored = await getSeriesData(tag);
      return { name: tag, data: stored };
    })).then(seriesArr => {
      lastSeriesData = fillSeriesData(seriesArr);
      renderDataTable(lastSeriesData);
      if (chart) {
        const currentExtremes = chart.xAxis[0].getExtremes();
        while (chart.series.length > lastSeriesData.length) {
          chart.series[chart.series.length - 1].remove(false);
        }
        lastSeriesData.forEach((s, i) => {
          if (chart.series[i]) {
            chart.series[i].setData(s.data, false);
            chart.series[i].update({ name: s.name }, false);
          } else {
            chart.addSeries(s, false);
          }
        });
        chart.redraw();
        chart.xAxis[0].setExtremes(currentExtremes.min, currentExtremes.max, false);
        logStatus("Chart updated with new tag settings.");
      }
    });
  } else {
    onGraph(false);
  }
});

// ---------- Auto Refresh Controls ----------
function isLiveData() {
  const endInput = document.getElementById("endDate").value;
  const endDate = new Date(endInput);
  return (new Date() - endDate) < 3600000;
}

function startAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    if (isLiveData()) { onGraph(true); }
    else {
      document.getElementById("autoRefreshToggle").checked = false;
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
      logStatus("Auto refresh disabled (selected end time is not recent).");
    }
  }, autoRefreshInterval);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
}

document.querySelectorAll(".polling-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    autoRefreshInterval = parseInt(btn.getAttribute("data-interval"));
    document.querySelectorAll(".polling-btn").forEach(b => {
      b.classList.remove("selected");
      b.style.backgroundColor = "";
      b.style.color = "";
    });
    btn.classList.add("selected");
    if (document.getElementById("autoRefreshToggle").checked) startAutoRefresh();
  });
});

document.getElementById("autoRefreshToggle").addEventListener("change", function () {
  if (this.checked && isLiveData()) { startAutoRefresh(); }
  else { stopAutoRefresh(); }
});

// ---------- Day Lines Toggle (Thicker Line) ----------
function updateDayPlotLines() {
  const dayLinesToggle = document.getElementById("dayLinesToggle");
  if (!chart) return;
  if (dayLinesToggle && dayLinesToggle.checked) {
    const extremes = chart.xAxis[0].getExtremes();
    const xMin = extremes.min, xMax = extremes.max;
    let plotLines = [];
    let current = new Date(xMin);
    current.setHours(0, 0, 0, 0);
    if (current.getTime() < xMin) current.setDate(current.getDate() + 1);
    while (current.getTime() <= xMax) {
      plotLines.push({
        color: document.body.classList.contains("dark-mode") ? "#ffffff" : "#000000",
        dashStyle: "Dot",
        value: current.getTime(),
        width: 2,
        zIndex: 3
      });
      current.setDate(current.getDate() + 1);
    }
    chart.xAxis[0].update({ plotLines: plotLines }, false);
    chart.redraw();
  } else if (chart) {
    chart.xAxis[0].update({ plotLines: [] }, false);
    chart.redraw();
  }
}
if (document.getElementById("dayLinesToggle")) {
  document.getElementById("dayLinesToggle").addEventListener("change", updateDayPlotLines);
}

// ---------- Helper: Get Visible (Zoomed) Data ----------
function getVisibleSeriesData() {
  if (!chart || !chart.xAxis || typeof chart.xAxis[0].min !== "number" || typeof chart.xAxis[0].max !== "number") {
    return lastSeriesData;
  }
  const min = chart.xAxis[0].min;
  const max = chart.xAxis[0].max;
  return lastSeriesData.map(series => ({
    name: series.name,
    data: series.data.filter(point => point[0] >= min && point[0] <= max)
  }));
}

// ---------- Graphing, Data Table, and Auto Refresh ----------
document.getElementById("graphBtn").addEventListener("click", () => { onGraph(false); stopAutoRefresh(); });
async function onGraph(isAuto = false) {
  if (selectedTags.size === 0) {
    logStatus("No tags selected for graphing.");
    return;
  }
  logStatus("Fetching data...");
  const startInput = document.getElementById("startDate").value;
  const endInput = document.getElementById("endDate").value;
  const startDate = new Date(startInput);
  const endDate = new Date(endInput);
  if (isNaN(startDate) || isNaN(endDate)) {
    logStatus("Invalid start or end date/time.");
    return;
  }
  let baseStartUnix = Math.floor(startDate.getTime() / 1000);
  const endUnix = Math.floor(endDate.getTime() / 1000);
  const pollingRateSec = autoRefreshInterval / 1000;
  const effectiveEndUnix = isAuto
    ? Math.floor(Date.now() / 1000) + globalEndMultiplier * pollingRateSec
    : endUnix;
  
  const tagsArray = Array.from(selectedTags);
  
  const fetchPromises = tagsArray.map(tag => {
    let qs = baseStartUnix;
    if (isAuto) {
      if (queryStartTimes[tag] === undefined) {
        queryStartTimes[tag] = baseStartUnix;
      }
      qs = queryStartTimes[tag];
    }
    return fetch(`/values?tag=${encodeURIComponent(tag)}&startDateUnixSeconds=${qs}&endDateUnixSeconds=${effectiveEndUnix}`)
      .then(response => {
        if (!response.ok) {
          console.error(`HTTP error ${response.status} for tag ${tag}`);
          return { tag, data: [], qs };
        }
        return response.json().then(data => ({ tag, data, qs }));
      })
      .catch(err => {
        console.error(`Fetch error for tag ${tag}:`, err);
        return { tag, data: [], qs };
      });
  });
  
  try {
    const results = await Promise.all(fetchPromises);
    let totalNewData = 0;
    const seriesData = results.map(result => {
      const dataPoints = result.data.map(point => [new Date(point.Date).getTime(), parseFloat(point.Value)]);
      totalNewData += dataPoints.length;
      if (isAuto) {
        if (dataPoints.length > 0) {
          const lastTimestamp = dataPoints[dataPoints.length - 1][0];
          queryStartTimes[result.tag] = Math.floor(lastTimestamp / 1000) + pollingRateSec;
        } else {
          queryStartTimes[result.tag] = result.qs + pollingRateSec;
        }
      }
      return { name: result.tag, data: dataPoints };
    });
    if (isAuto && rawSeriesData && Object.keys(rawSeriesData).length > 0 && chart) {
      seriesData.forEach((newSeries, i) => {
        if (!rawSeriesData[i]) rawSeriesData[i] = newSeries;
        else {
          newSeries.data.forEach(pt => {
            const lastRaw = rawSeriesData[i].data[rawSeriesData[i].data.length - 1];
            if (!lastRaw || lastRaw[0] < pt[0]) rawSeriesData[i].data.push(pt);
          });
        }
      });
    } else {
      rawSeriesData = deepClone(seriesData);
    }
    lastSeriesData = fillSeriesData(rawSeriesData);
    if (chart) {
      if (isAuto) {
        const currentExtremes = chart.xAxis[0].getExtremes();
        const globalMax = Math.max(...lastSeriesData.map(s => (s.data.length ? s.data[s.data.length - 1][0] : 0)));
        chart.xAxis[0].setExtremes(currentExtremes.min, globalMax, false);
        lastSeriesData.forEach((s, i) => {
          if (chart.series[i]) {
            chart.series[i].setData(s.data, false);
          }
        });
        chart.redraw();
      } else {
        while (chart.series.length > lastSeriesData.length) {
          chart.series[chart.series.length - 1].remove(false);
        }
        lastSeriesData.forEach((s, i) => {
          if (chart.series[i]) {
            chart.series[i].setData(s.data, false);
            chart.series[i].update({ name: s.name }, false);
          } else {
            chart.addSeries(s, false);
          }
        });
        chart.redraw();
      }
    } else {
      const appDark = document.body.classList.contains("dark-mode");
      const chartBg = appDark ? "#2e2e2e" : "#ffffff";
      const textColor = appDark ? "#e0e0e0" : "#000";
      const legendColor = appDark ? "white" : "#000";
      let chartConfig = {
        chart: {
          type: "line",
          zoomType: "xy",
          zooming: { enabled: false },
          panning: { enabled: true, type: "xy" },
          backgroundColor: chartBg,
          events: {
            load: function () {
              const chartInstance = this;
              document.addEventListener("keydown", function (e) {
                if (e.key === "Shift") {
                  chartInstance.update({ chart: { zooming: { enabled: true }, panning: { enabled: false } } });
                }
              });
              document.addEventListener("keyup", function (e) {
                if (e.key === "Shift") {
                  chartInstance.update({ chart: { zooming: { enabled: false }, panning: { enabled: true, type: "xy" } } });
                }
              });
            }
          }
        },
        rangeSelector: { enabled: false },
        navigator: { enabled: true },
        scrollbar: { enabled: true },
        title: { text: "Graph", style: { color: textColor } },
        xAxis: {
          type: "datetime",
          labels: { style: { color: textColor }, format: '{value:%H:%M:%S}' },
          lineColor: textColor,
          tickColor: textColor
        },
        yAxis: {
          title: { text: "Value", style: { color: textColor } },
          labels: { style: { color: textColor } },
          lineColor: textColor,
          tickColor: textColor
        },
        legend: { enabled: true, itemStyle: { color: legendColor } },
        tooltip: { shared: true, crosshairs: true, style: { color: textColor }, backgroundColor: appDark ? "#333333" : "#ffffff" },
        plotOptions: { series: { allowPointSelect: true, marker: { enabled: false } } },
        series: lastSeriesData,
        credits: { enabled: false }
      };
      chart = Highcharts.stockChart("chartContainer", chartConfig);
    }
    renderDataTable(lastSeriesData);
    logStatus("Data fetched successfully.");
    updateDayPlotLines();
    if (document.getElementById("autoRefreshToggle").checked && isLiveData())
      startAutoRefresh();
    else
      stopAutoRefresh();
    logStatus("Graph rendered for selected tags.");
  } catch (error) {
    console.error("Error fetching values:", error);
    logStatus("Error fetching values for graph: " + error.message);
  }
}

// ---------- Render Data Table (with Multi-Level Header) ----------
function renderDataTable(seriesData) {
  const container = document.getElementById("dataTableContainer");
  container.innerHTML = "";
  const visibleSeries = getVisibleSeriesData();
  const multiHeader = generateMultiLevelHeader(visibleSeries.map(s => s.name));
  const table = document.createElement("table");
  table.style.width = "100%";
  table.style.borderCollapse = "collapse";
  const thead = document.createElement("thead");
  const headerRow1 = document.createElement("tr");
  const tsTh = document.createElement("th");
  tsTh.textContent = "Timestamp";
  tsTh.rowSpan = 3;
  tsTh.style.border = "1px solid #ccc";
  tsTh.style.padding = "5px";
  tsTh.style.textAlign = "center";
  headerRow1.appendChild(tsTh);
  multiHeader[0].forEach(cell => {
    const th = document.createElement("th");
    th.textContent = cell.content;
    th.colSpan = cell.colSpan;
    th.style.border = "1px solid #ccc";
    th.style.padding = "5px";
    th.style.textAlign = "center";
    th.style.borderBottom = "2px solid #000";
    headerRow1.appendChild(th);
  });
  thead.appendChild(headerRow1);
  const headerRow2 = document.createElement("tr");
  multiHeader[1].forEach(cell => {
    const th = document.createElement("th");
    th.textContent = cell.content;
    th.colSpan = cell.colSpan;
    th.style.border = "1px solid #ccc";
    th.style.padding = "5px";
    th.style.textAlign = "center";
    headerRow2.appendChild(th);
  });
  thead.appendChild(headerRow2);
  const headerRow3 = document.createElement("tr");
  multiHeader[2].forEach(cell => {
    const th = document.createElement("th");
    th.textContent = cell.content;
    th.style.border = "1px solid #ccc";
    th.style.padding = "5px";
    th.style.textAlign = "center";
    th.style.borderBottom = "2px solid #000";
    headerRow3.appendChild(th);
  });
  thead.appendChild(headerRow3);
  table.appendChild(thead);
  
  const mergedRows = mergeSeriesData(seriesData);
  const dataRows = mergedRows.slice(1);
  const tbody = document.createElement("tbody");
  dataRows.forEach(rowData => {
    const tr = document.createElement("tr");
    rowData.forEach(cellText => {
      const td = document.createElement("td");
      td.textContent = cellText;
      td.style.border = "1px solid #ccc";
      td.style.padding = "5px";
      td.style.whiteSpace = "nowrap";
      td.style.textAlign = "center";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

function mergeSeriesData(seriesData, xMin, xMax) {
  const timestampSet = new Set();
  seriesData.forEach(series => {
    series.data.forEach(point => {
      if (xMin === undefined || xMax === undefined || (point[0] >= xMin && point[0] <= xMax)) {
        timestampSet.add(point[0]);
      }
    });
  });
  const timestamps = Array.from(timestampSet).sort((a, b) => a - b);
  const header = ["Timestamp", ...seriesData.map(s => s.name)];
  const rows = [header];
  timestamps.forEach(ts => {
    const row = [formatTimestamp(ts)];
    seriesData.forEach(series => {
      const found = series.data.find(p => p[0] === ts);
      row.push(found ? found[1] : "");
    });
    rows.push(row);
  });
  return rows;
}

function formatTimestamp(ts) {
  const date = new Date(ts);
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}:${ss}`;
}

function rowsToCSV(rows) {
  return rows.map(row => row.join(",")).join("\n");
}

function fillSeriesData(seriesData) {
  seriesData.forEach(series => {
    let newData = [];
    let lastValue = null;
    series.data.sort((a, b) => a[0] - b[0]);
    series.data.forEach(pt => {
      if (pt[1] !== null && pt[1] !== undefined && pt[1] !== "") {
        lastValue = pt[1];
      }
      newData.push([pt[0], lastValue]);
    });
    series.data = newData;
  });
  const allTimestamps = new Set();
  seriesData.forEach(series => {
    series.data.forEach(pt => allTimestamps.add(pt[0]));
  });
  const timestamps = Array.from(allTimestamps).sort((a, b) => a - b);
  seriesData.forEach(series => {
    const dataMap = new Map(series.data);
    let newData = [];
    let lastVal = null;
    timestamps.forEach(ts => {
      if (dataMap.has(ts)) {
        lastVal = dataMap.get(ts);
        newData.push([ts, lastVal]);
      } else {
        newData.push([ts, lastVal]);
      }
    });
    series.data = newData;
  });
  return seriesData;
}

// ---------- Excel Export (XLSX) ----------
document.getElementById("exportDataBtn").addEventListener("click", onExportData);
async function onExportData() {
  try {
    logStatus("Exporting data...");
    if (lastSeriesData.length === 0) {
      logStatus("No data available, fetching data first...");
      await onGraph(false);
      if (lastSeriesData.length === 0) {
        logStatus("Failed to fetch data for export.");
        return;
      }
    }
    
    const visibleSeries = getVisibleSeriesData();
    const multiHeader = generateMultiLevelHeader(visibleSeries.map(s => s.name));
    
    let expRow1 = ["Timestamp"];
    multiHeader[0].forEach(cell => expRow1.push(...Array(cell.colSpan).fill(cell.content)));
    
    let expRow2 = [""];
    multiHeader[1].forEach(cell => expRow2.push(...Array(cell.colSpan).fill(cell.content)));
    
    let expRow3 = [""];
    multiHeader[2].forEach(cell => expRow3.push(cell.content));
    
    const dataRows = mergeSeriesData(visibleSeries).slice(1);
    const combined = [expRow1, expRow2, expRow3].concat(dataRows);
    
    const ws = XLSX.utils.aoa_to_sheet(combined);
    
    ws["!merges"] = ws["!merges"] || [];
    for (let r = 0; r < 3; r++) {
      let startCol = 1;
      while (startCol < expRow1.length) {
        let cellValue = combined[r][startCol];
        let endCol = startCol;
        while (endCol + 1 < expRow1.length && combined[r][endCol + 1] === cellValue && cellValue !== "") {
          endCol++;
        }
        if (endCol > startCol) {
          ws["!merges"].push({ s: { r, c: startCol }, e: { r, c: endCol } });
        }
        startCol = endCol + 1;
      }
    }
    
    const colWidths = combined[0].map((_, c) => {
      let maxLength = 10;
      for (let r = 0; r < combined.length; r++) {
        if (combined[r][c] && combined[r][c].toString().length > maxLength) {
          maxLength = combined[r][c].toString().length;
        }
      }
      return { wch: maxLength + 2 };
    });
    ws["!cols"] = colWidths;
    
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    const fileName = generateFileName() + ".xlsx";
    XLSX.writeFile(wb, fileName, { bookType: "xlsx" });
    
    logStatus("Excel file exported successfully.");
  } catch (ex) {
    console.error("Error exporting data:", ex);
    logStatus("Error exporting data: " + ex.message);
  }
}

// ---------- PDF Report Generation (Cover Page + Graph + Data Table) ----------
document.getElementById("generateReportBtn").addEventListener("click", onGenerateReport);
async function onGenerateReport() {
  try {
    logStatus("Generating report...");
    if (lastSeriesData.length === 0) {
      logStatus("No data available for report.");
      return;
    }
    if (!chart) {
      logStatus("Chart not available for report.");
      return;
    }
    if (typeof chart.getSVG !== "function") {
      logStatus("Error: chart.getSVG is not available. Ensure Highcharts Exporting module is loaded.");
      return;
    }
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4"
    });
    const margin = 5;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    // Convert chart SVG to PNG using previous scaling (fill page minus margins)
    const svg = chart.getSVG({
      chart: { width: chart.chartWidth, height: chart.chartHeight, backgroundColor: "#ffffff" },
      title: { style: { color: "#000" } },
      xAxis: { labels: { style: { color: "#000" } }, title: { style: { color: "#000" } } },
      yAxis: { labels: { style: { color: "#000" } }, title: { style: { color: "#000" } } },
      legend: { itemStyle: { color: "#000" } }
    });
    const canvas = document.createElement("canvas");
    canvas.width = chart.chartWidth || 800;
    canvas.height = chart.chartHeight || 400;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    await new Promise((resolve, reject) => {
      img.onload = function () {
        try {
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = function (err) {
        reject(err);
      };
      img.src = url;
    });
    const chartImgData = canvas.toDataURL("image/png");
    
    // ---- Cover Page ----
    loadLogo(function (logoDataUrl) {
      if (logoDataUrl) {
        // Insert logo at top left with dimensions 90 x 30
        doc.addImage(logoDataUrl, "PNG", margin, margin, 90, 30);
      }
      doc.setFontSize(18);
      doc.text("Data Extraction Report", pageWidth / 2, 50, { align: "center" });
      doc.setFontSize(12);
      const fhNumber = document.getElementById("bargeNumberInput").value || "0000";
      const bargeName = document.getElementById("bargeNameInput").value || "UnknownBarge";
      doc.text(`FH ${fhNumber} - ${bargeName}`, pageWidth / 2, 60, { align: "center" });
      const startDateStr = document.getElementById("startDate").value;
      const endDateStr = document.getElementById("endDate").value;
      doc.text(`${startDateStr} - ${endDateStr}`, pageWidth / 2, 70, { align: "center" });
      
      // Table of Contents
      doc.setFontSize(14);
      doc.text("Table of Contents", pageWidth / 2, 90, { align: "center" });
      doc.setFontSize(12);
      function formatTOCLine(title, pageNum) {
        const maxLength = 40;
        let line = title;
        while (line.length < maxLength) { line += "."; }
        return line + " " + pageNum;
      }
      doc.text(formatTOCLine("Graph", "2"), pageWidth / 2, 100, { align: "center" });
      doc.text(formatTOCLine("Data Table", "3"), pageWidth / 2, 110, { align: "center" });
      
      // ---- Graph Page ----
      doc.addPage();
      // Insert graph image scaled to fill page minus 5 mm margins on all sides
      doc.addImage(chartImgData, "PNG", margin, margin * 5, pageWidth - 2 * margin, pageHeight - 10 * margin);
      
      // ---- Data Table Page ----
      doc.addPage();
      doc.setFontSize(16);
      doc.text("Data Table", pageWidth / 2, 20, { align: "center" });
      const visibleSeries = getVisibleSeriesData();
      const xMin = chart.xAxis[0].min;
      const xMax = chart.xAxis[0].max;
      const mergedRows = mergeSeriesData(visibleSeries, xMin, xMax);
      const seriesHeaders = visibleSeries.map(s => s.name);
      const multiHeaderRows = generateMultiLevelHeader(seriesHeaders);
      const header = [
        [{ content: "Timestamp", rowSpan: 3, styles: { halign: "center", valign: "middle" } }, ...multiHeaderRows[0]],
        multiHeaderRows[1],
        multiHeaderRows[2]
      ];
      // Data table with 5 mm margins on all sides
      doc.autoTable({
        startY: 30,
        head: header,
        body: mergedRows.slice(1),
        theme: "grid",
        styles: { fontSize: 8, cellPadding: 2, halign: "center", valign: "middle" },
        margin: { top: margin, bottom: margin, left: margin, right: margin }
      });
      
      const fileName = generateFileName() + ".pdf";
      doc.save(fileName);
      logStatus("PDF report generated and downloaded.");
    });
  } catch (error) {
    console.error("Error generating report:", error);
    logStatus("Error generating PDF report: " + error.message);
  }
}