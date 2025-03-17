// ------------------ Global Settings & Initialization ------------------
Highcharts.setOptions({ time: { useUTC: false } });

// Re-add Highcharts "pling" effect.
Highcharts.wrap(Highcharts.Series.prototype, 'addPoint', function (proceed, point, redraw, shift, animation) {
  proceed.apply(this, Array.prototype.slice.call(arguments, 1));
  if (!this.pulse) {
    this.pulse = this.chart.renderer.circle().add(this.markerGroup);
  }
  const xVal = Array.isArray(point) ? point[0] : point.x;
  const yVal = Array.isArray(point) ? point[1] : point.y;
  const markerRadius = (this.options.marker && this.options.marker.radius) || 4;
  setTimeout(() => {
    this.pulse
      .attr({
        x: this.xAxis.toPixels(xVal, true),
        y: this.yAxis.toPixels(yVal, true),
        r: markerRadius,
        opacity: 1,
        fill: this.color
      })
      .animate({ r: markerRadius * 5, opacity: 0 }, { duration: 1000 });
  }, 1);
});

let lastProcessedData = []; // Processed data for chart and table (filled data from server)
let chart = null;

let fullTagList = [];
let displayTagList = [];
let selectedTags = new Set();
let sortOrder = localStorage.getItem("sortOrder") || "asc";
let groupingMode = localStorage.getItem("groupingMode") || "0";
let autoRefreshInterval = 5000;
let autoRefreshTimer = null;

// ------------------ Logging Function ------------------
function logStatus(message) {
  const statusBar = document.getElementById("statusBar");
  if (statusBar) {
    statusBar.textContent = "Status: " + message;
    console.log(message);
  }
}

// ------------------ Utility Functions ------------------
function loadLogo(callback) {
  const logoImage = new Image();
  logoImage.crossOrigin = "anonymous";
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

// Note: We remove any extra fillSeriesData call since the server now returns filled data.

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
      // Use the filled data returned by the server directly.
      const found = series.data.find(p => p[0] === ts);
      row.push(found ? found[1] : "");
    });
    rows.push(row);
  });
  return rows;
}

function renderDataTable(seriesData) {
  const container = document.getElementById("dataTableContainer");
  let html = "<table style='width:100%; border-collapse:collapse;'><thead>";
  html += "<tr><th rowspan='3' style='border:1px solid #ccc; padding:5px; text-align:center;'>Timestamp</th>";
  const multiHeader = generateMultiLevelHeader(seriesData.map(s => s.name));
  multiHeader[0].forEach(cell => {
    html += `<th colspan='${cell.colSpan}' style='border:1px solid #ccc; padding:5px; text-align:center; border-bottom:2px solid #000;'>${cell.content}</th>`;
  });
  html += "</tr><tr>";
  multiHeader[1].forEach(cell => {
    html += `<th colspan='${cell.colSpan}' style='border:1px solid #ccc; padding:5px; text-align:center;'>${cell.content}</th>`;
  });
  html += "</tr><tr>";
  multiHeader[2].forEach(cell => {
    html += `<th style='border:1px solid #ccc; padding:5px; text-align:center; border-bottom:2px solid #000;'>${cell.content}</th>`;
  });
  html += "</tr></thead>";
  const rows = mergeSeriesData(seriesData);
  html += "<tbody>";
  for (let i = 1; i < rows.length; i++) {
    html += "<tr>";
    rows[i].forEach(cell => {
      html += `<td style='border:1px solid #ccc; padding:5px; white-space:nowrap; text-align:center;'>${cell}</td>`;
    });
    html += "</tr>";
  }
  html += "</tbody></table>";
  container.innerHTML = html;
}

function getVisibleSeriesData() {
  if (chart && chart.xAxis && typeof chart.xAxis[0].min === "number") {
    const min = chart.xAxis[0].min;
    const max = chart.xAxis[0].max;
    return lastProcessedData.map(series => ({
      name: series.name,
      data: series.data.filter(point => point[0] >= min && point[0] <= max)
    }));
  }
  return lastProcessedData;
}

// ------------------ Grouping Functions for Tag Tree ------------------
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
      if (selectedTags.has(item.Tag)) {
        li.classList.add("selected");
      }
      li.addEventListener("click", e => {
        e.stopPropagation();
        if (selectedTags.has(item.Tag)) {
          selectedTags.delete(item.Tag);
        } else {
          selectedTags.add(item.Tag);
        }
        updateSelectionSummary();
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
        groupLi.classList.add("group-header");
        const toggleBtn = document.createElement("button");
        toggleBtn.textContent = "Toggle All";
        toggleBtn.className = "action-btn";
        toggleBtn.style.marginLeft = "10px";
        toggleBtn.addEventListener("click", e => {
          e.stopPropagation();
          const allSelected = groups[group].every(item => selectedTags.has(item.full));
          groups[group].forEach(item => {
            if (allSelected) { selectedTags.delete(item.full); }
            else { selectedTags.add(item.full); }
          });
          updateSelectionSummary();
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
            if (selectedTags.has(item.full)) {
              li.classList.add("selected");
            }
            li.addEventListener("click", e => {
              e.stopPropagation();
              if (selectedTags.has(item.full)) { selectedTags.delete(item.full); }
              else { selectedTags.add(item.full); }
              updateSelectionSummary();
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
        mainLi.classList.add("group-header");
        ul.appendChild(mainLi);
        Object.keys(mainGroups[main])
          .sort((a, b) => sortOrder === "desc" ? b.localeCompare(a) : a.localeCompare(b))
          .forEach(sub => {
            if (sub !== null && sub !== "null") {
              const subLi = document.createElement("li");
              subLi.style.marginLeft = "20px";
              subLi.textContent = sub;
              subLi.classList.add("group-header");
              const toggleBtn = document.createElement("button");
              toggleBtn.textContent = "Toggle All";
              toggleBtn.className = "action-btn";
              toggleBtn.style.marginLeft = "10px";
              toggleBtn.addEventListener("click", e => {
                e.stopPropagation();
                const allSelected = mainGroups[main][sub].every(item => selectedTags.has(item.full));
                mainGroups[main][sub].forEach(item => {
                  if (allSelected) { selectedTags.delete(item.full); }
                  else { selectedTags.add(item.full); }
                });
                updateSelectionSummary();
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
                  if (selectedTags.has(item.full)) {
                    li.classList.add("selected");
                  }
                  li.addEventListener("click", e => {
                    e.stopPropagation();
                    if (selectedTags.has(item.full)) { selectedTags.delete(item.full); }
                    else { selectedTags.add(item.full); }
                    updateSelectionSummary();
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
  document.getElementById("selectionSummary").textContent = `${selectedTags.size} / ${total}`;
}

// ------------------ Settings Display & Event Listeners ------------------
function updateSettingsDisplay() {
  // Additional UI updates can be done here if needed.
}
updateSettingsDisplay();

function loadSettings() {
  if (!localStorage.getItem("darkMode")) localStorage.setItem("darkMode", "true");
  const darkMode = localStorage.getItem("darkMode") === "true";
  document.body.classList.toggle("dark-mode", darkMode);
  document.getElementById("darkModeToggle").checked = darkMode;
  groupingMode = localStorage.getItem("groupingMode") || "0";
  sortOrder = localStorage.getItem("sortOrder") || "asc";
  updateSettingsDisplay();
}
function fetchTagList() {
  fetch("/taglist")
    .then(response => response.json())
    .then(data => {
      fullTagList = data;
      displayTagList = data;
      buildTreeFromDisplay(data);
      logStatus("Tag list fetched.");
    })
    .catch(err => {
      console.error("Error fetching tag list:", err);
      logStatus("Error fetching tag list.");
    });
}
document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  // Initialize flatpickr with default start = today's 00:00 and end = current time
  flatpickr("#startDate", { 
    enableTime: true, 
    time_24hr: true, 
    dateFormat: "Y-m-d H:i",
    defaultDate: new Date(new Date().setHours(0,0,0,0))
  });
  flatpickr("#endDate", { 
    enableTime: true, 
    time_24hr: true, 
    dateFormat: "Y-m-d H:i",
    defaultDate: new Date()
  });
  fetchTagList();

  // Grouping options event listeners
  document.querySelectorAll(".grouping-option").forEach(btn => {
    btn.addEventListener("click", () => {
      groupingMode = btn.getAttribute("data-value");
      localStorage.setItem("groupingMode", groupingMode);
      document.querySelectorAll(".grouping-option").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      buildTreeFromDisplay(displayTagList);
    });
  });

  // Sort order buttons event listeners
  document.querySelectorAll(".sort-order-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      sortOrder = btn.getAttribute("data-order");
      localStorage.setItem("sortOrder", sortOrder);
      document.querySelectorAll(".sort-order-btn").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      buildTreeFromDisplay(displayTagList);
    });
  });
});

// ------------------ Data Fetching & Chart Rendering ------------------
async function fetchCompleteData() {
  if (selectedTags.size === 0) {
    alert("Please select at least one tag before graphing.");
    return;
  }
  logStatus("Fetching complete data...");
  const startInput = document.getElementById("startDate").value;
  const endInput = document.getElementById("endDate").value;
  const startDate = new Date(startInput);
  const endDate = new Date(endInput);
  if (isNaN(startDate) || isNaN(endDate)) {
    logStatus("Invalid start or end date/time.");
    return;
  }
  const baseStartUnix = Math.floor(startDate.getTime() / 1000);
  const endUnix = Math.floor(endDate.getTime() / 1000);
  const tags = Array.from(selectedTags).join(",");
  const url = `/complete_data?startDateUnixSeconds=${baseStartUnix}&endDateUnixSeconds=${endUnix}` +
              (tags ? `&tags=${encodeURIComponent(tags)}` : "");
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("HTTP error " + response.status);
    const completeData = await response.json();
    lastProcessedData = completeData.processed_values;
    buildTreeFromDisplay(completeData.taglist);
    displayTagList = completeData.taglist;
    renderDataTable(getVisibleSeriesData());
    if (chart) {
      while (chart.series.length > lastProcessedData.length) {
        chart.series[chart.series.length - 1].remove(false);
      }
      lastProcessedData.forEach((s, i) => {
        if (chart.series[i]) {
          chart.series[i].setData(s.data, false);
          chart.series[i].update({ name: s.name }, false);
        } else {
          chart.addSeries(s, false);
        }
      });
      chart.redraw();
    } else {
      renderChart(lastProcessedData);
    }
    logStatus("Data fetched and graph rendered.");
  } catch (error) {
    console.error("Error fetching complete data:", error);
    logStatus("Error fetching data: " + error.message);
  }
}

function renderChart(processedData) {
  const isDark = document.body.classList.contains("dark-mode");
  const textColor = isDark ? "#e0e0e0" : "#000000";
  const bgColor = isDark ? "#2e2e2e" : "#ffffff";
  const chartConfig = {
    chart: {
      type: "line",
      zoomType: "xy",
      panning: { enabled: true, type: "xy" },
      backgroundColor: bgColor
    },
    rangeSelector: { enabled: false },
    navigator: { enabled: true },
    scrollbar: { enabled: true },
    title: { text: "Graph", style: { color: textColor } },
    xAxis: {
      type: "datetime",
      labels: { style: { color: textColor }, format: '{value:%H:%M:%S}' },
      lineColor: textColor,
      tickColor: textColor,
      events: { afterSetExtremes: function(){ renderDataTable(getVisibleSeriesData()); } }
    },
    yAxis: {
      title: { text: "Value", style: { color: textColor } },
      labels: { style: { color: textColor } },
      lineColor: textColor,
      tickColor: textColor
    },
    legend: { enabled: true, itemStyle: { color: textColor } },
    tooltip: { shared: true, crosshairs: true, style: { color: textColor }, backgroundColor: bgColor },
    plotOptions: { series: { allowPointSelect: true, marker: { enabled: false } } },
    series: processedData,
    credits: { enabled: false }
  };
  chart = Highcharts.stockChart("chartContainer", chartConfig);
}

// ------------------ Auto Refresh / Incremental Data ------------------
async function fetchIncrementalData() {
  if (selectedTags.size === 0) return;
  const currentTimeUnix = Math.floor(Date.now() / 1000);
  try {
    const response = await fetch("/incremental_data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tags: Array.from(selectedTags), endDateUnixSeconds: currentTimeUnix })
    });
    if (!response.ok) throw new Error(response.statusText);
    const data = await response.json();
    lastProcessedData = data.processed_values;
    if (chart) {
      while (chart.series.length > lastProcessedData.length) {
        chart.series[chart.series.length - 1].remove(false);
      }
      lastProcessedData.forEach((s, i) => {
        if (chart.series[i]) {
          chart.series[i].setData(s.data, false);
          chart.series[i].update({ name: s.name }, false);
        } else {
          chart.addSeries(s, false);
        }
      });
      chart.redraw();
    } else {
      renderChart(lastProcessedData);
    }
    renderDataTable(getVisibleSeriesData());
    logStatus("Auto-refresh: Data updated.");
  } catch (err) {
    logStatus("Auto-refresh error: " + err.message);
  }
}

function startAutoRefresh() {
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    if (document.getElementById("autoRefreshToggle").checked && document.visibilityState === "visible") {
      fetchIncrementalData();
    }
  }, autoRefreshInterval);
  logStatus("Auto-refresh started with interval " + autoRefreshInterval + "ms.");
}

// ------------------ Report Generation & Export ------------------
document.getElementById("generateReportBtn").addEventListener("click", onGenerateReport);
async function onGenerateReport() {
  try {
    logStatus("Generating PDF report...");
    if (selectedTags.size === 0) {
      alert("Please select at least one tag before generating a report.");
      return;
    }
    if (!lastProcessedData || lastProcessedData.length === 0) {
      logStatus("No data available. Fetching complete data first...");
      await fetchCompleteData();
      if (!lastProcessedData || lastProcessedData.length === 0) {
        logStatus("Failed to fetch data for report.");
        return;
      }
    }
    if (!chart) {
      alert("Chart is not available for report generation.");
      return;
    }
    if (typeof chart.getSVG !== "function") {
      alert("Chart export functionality not available.");
      return;
    }
    const visibleSeries = getVisibleSeriesData();
    const xExtremes = chart.xAxis[0].getExtremes();
    const mergedRows = mergeSeriesData(visibleSeries, xExtremes.min, xExtremes.max);
    const multiHeaderRows = generateMultiLevelHeader(visibleSeries.map(s => s.name));
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: "a4"
    });
    const margin = 5;
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    // Convert chart SVG to PNG
    const svg = chart.getSVG({
      chart: { width: chart.chartWidth, height: chart.chartHeight, backgroundColor: "#ffffff" }
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
        } catch (err) { reject(err); }
      };
      img.onerror = function (err) { reject(err); };
      img.src = url;
    });
    const chartImgData = canvas.toDataURL("image/png");
    
    // ---- Cover Page ----
    await new Promise((resolve) => {
      loadLogo(function (logoDataUrl) {
        if (logoDataUrl) {
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
        resolve();
      });
    });
    
    // ---- Graph Page ----
    doc.addPage();
    doc.addImage(chartImgData, "PNG", margin, 50, pageWidth - 2 * margin, pageHeight - 100);
    
    // ---- Data Table Page ----
    doc.addPage();
    doc.setFontSize(16);
    doc.text("Data Table", pageWidth / 2, 20, { align: "center" });
    const header = [
      [{ content: "Timestamp", rowSpan: 3, styles: { halign: "center", valign: "middle" } }, ...multiHeaderRows[0].map(cell => cell.content)],
      multiHeaderRows[1].map(cell => cell.content),
      multiHeaderRows[2].map(cell => cell.content)
    ];
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
  } catch (error) {
    console.error("Error generating report:", error);
    logStatus("Error generating PDF report: " + error.message);
  }
}

// ------------------ Export Data (using server endpoint) ------------------
document.getElementById("exportDataBtn").addEventListener("click", async () => {
  if (selectedTags.size === 0) {
    alert("Please select at least one tag before exporting data.");
    return;
  }
  const startInput = document.getElementById("startDate").value;
  const endInput = document.getElementById("endDate").value;
  const startDate = new Date(startInput);
  const endDate = new Date(endInput);
  if (isNaN(startDate) || isNaN(endDate)) {
    logStatus("Invalid date/time for export.");
    return;
  }
  const startUnix = Math.floor(startDate.getTime() / 1000);
  const endUnix = Math.floor(endDate.getTime() / 1000);
  const tags = Array.from(selectedTags).join(",");
  const url = `/export_excel?startDateUnixSeconds=${startUnix}&endDateUnixSeconds=${endUnix}` +
              (tags ? `&tags=${encodeURIComponent(tags)}` : "");
  logStatus("Exporting data...");
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.status) {
      logStatus(data.status + ": " + data.filepath);
    } else {
      logStatus("Export failed.");
    }
  } catch (err) {
    logStatus("Export error: " + err.message);
  }
});

// ------------------ UI Event Listeners ------------------
document.getElementById("darkModeToggle").addEventListener("change", function(){
  const enabled = this.checked;
  localStorage.setItem("darkMode", enabled);
  document.body.classList.toggle("dark-mode", enabled);
});
document.getElementById("graphBtn").addEventListener("click", () => {
  fetchCompleteData();
  clearInterval(autoRefreshTimer);
});
document.getElementById("selectAllBtn").addEventListener("click", () => {
  displayTagList.forEach(item => selectedTags.add(item.Tag ? item.Tag : item));
  updateSelectionSummary();
  buildTreeFromDisplay(displayTagList);
});
document.getElementById("deselectAllBtn").addEventListener("click", () => {
  displayTagList.forEach(item => selectedTags.delete(item.Tag ? item.Tag : item));
  updateSelectionSummary();
  buildTreeFromDisplay(displayTagList);
});
document.getElementById("tagFilter").addEventListener("input", (e) => {
  const filter = e.target.value.toLowerCase();
  const filtered = fullTagList.filter(item => {
    const tagName = item.Tag ? item.Tag : item;
    return tagName.toLowerCase().includes(filter);
  });
  displayTagList = filtered;
  buildTreeFromDisplay(filtered);
});
document.getElementById("refreshTagsBtn").addEventListener("click", () => { fetchTagList(); });

// Settings Panel Toggle
function toggleSettingsPanel() {
  const panel = document.getElementById("mainOptionsPanel");
  panel.classList.toggle("open");
  logStatus(panel.classList.contains("open") ? "Settings panel opened." : "Settings panel closed.");
}
document.getElementById("mainOptionsBtn").addEventListener("click", toggleSettingsPanel);
document.getElementById("mainOptionsCloseBtn").addEventListener("click", toggleSettingsPanel);
document.getElementById("saveSettingsBtn").addEventListener("click", () => {
  const newOffset = parseInt(document.getElementById("dataOffsetInput").value) || 1;
  const bargeName = document.getElementById("bargeNameInput").value || "UnknownBarge";
  const bargeNumber = document.getElementById("bargeNumberInput").value || "0000";
  const settingsPayload = { offset: newOffset, bargeName: bargeName, bargeNumber: bargeNumber };
  fetch("/update_settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settingsPayload)
  }).then(() => {
    document.body.classList.toggle("dark-mode", localStorage.getItem("darkMode") === "true");
    toggleSettingsPanel();
    logStatus("Global settings updated.");
  }).catch(err => console.error("Error updating global settings:", err));
});

// Tag Options Modal
document.getElementById("tagOptionsGear").addEventListener("click", () => {
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
      scaleInput.value = tagSettings.scale_factors[tag] || 1.0;
      scaleInput.className = "settings-col";
      scaleInput.style.width = "60px";
      const errorInput = document.createElement("input");
      errorInput.type = "number";
      errorInput.step = "0.01";
      errorInput.value = tagSettings.error_values[tag] || "";
      errorInput.className = "settings-col";
      errorInput.style.width = "60px";
      const maxDecInput = document.createElement("input");
      maxDecInput.type = "number";
      maxDecInput.step = "1";
      maxDecInput.value = tagSettings.max_decimal[tag] || 2;
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
});

document.getElementById("tagOptionsClose").addEventListener("click", () => {
  document.getElementById("tagOptionsModal").style.display = "none";
});

document.getElementById("saveTagOptionsBtn").addEventListener("click", () => {
  const container = document.getElementById("tagOptionsContainer");
  const rows = container.getElementsByClassName("tag-option-row");
  const newSettings = { scale_factors: {}, error_values: {}, max_decimal: {} };
  for (let row of rows) {
    const tag = row.dataset.tag;
    newSettings.scale_factors[tag] = parseFloat(row.dataset.scale) || 1.0;
    newSettings.error_values[tag] = row.dataset.error.trim() === "" ? null : parseFloat(row.dataset.error);
    newSettings.max_decimal[tag] = parseInt(row.dataset.maxDec, 10) || 2;
  }
  localStorage.setItem("tagSettings", JSON.stringify(newSettings));
  logStatus("Tag options saved.");
  document.getElementById("tagOptionsModal").style.display = "none";
  // Update settings on the server without fetching new raw data
  fetch("/update_settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag_settings: newSettings })
  }).then(() => {
    // Reprocess cached raw data using the new tag settings
    fetch("/reprocess?tags=" + encodeURIComponent(Array.from(selectedTags).join(",")))
      .then(res => res.json())
      .then(data => {
        lastProcessedData = data.processed_values;
        if (chart) {
          while (chart.series.length > lastProcessedData.length) {
            chart.series[chart.series.length - 1].remove(false);
          }
          lastProcessedData.forEach((s, i) => {
            if (chart.series[i]) {
              chart.series[i].setData(s.data, false);
              chart.series[i].update({ name: s.name }, false);
            } else {
              chart.addSeries(s, false);
            }
          });
          chart.redraw();
        } else {
          renderChart(lastProcessedData);
        }
        renderDataTable(getVisibleSeriesData());
        logStatus("Chart updated with new tag settings (raw data unchanged).");
      });
  }).catch(err => console.error("Error updating tag settings:", err));
});