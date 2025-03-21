document.addEventListener("DOMContentLoaded", function () {

  // ------------------------------------------------
  // GLOBAL STATE
  // ------------------------------------------------
  let WORKING_TABLE = [];    
  let DISPLAYED_DATA = [];   
  let selectedTags   = new Set(); 
  let fullTagList    = [];   
  let displayTagList = [];   
  let previousGroupStates = null; 
  let groupStates    = {};
  let filterActive   = false;
  let chart          = null;
  let ratio          = 0.5;
  let sortOrder      = "asc";
  let groupingMode   = "2";
  let dataOffset     = 1;
  let bargeName      = "";
  let bargeNumber    = "";
  let forwardFill    = false;
  let pollInterval   = 5000;
  let autoRefreshTimer = null;
  let CURRENT_XMIN   = null;
  let CURRENT_XMAX   = null;

  // CHANGED: We'll store the date/time from site settings
  let startDateStr   = "";
  let endDateStr     = "";

  // ------------------------------------------------
  // LOGGING
  // ------------------------------------------------
  async function sendLogEvent(type, message) {
    try {
      await fetch("/log_event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, message })
      });
    } catch {}
  }
  function logStatus(msg) {
    console.log(msg);
    const sb = document.getElementById("statusBar");
    if (sb) sb.textContent = "Status: " + msg;
    sendLogEvent("script", msg);
  }

  // ------------------------------------------------
  // UI LAYOUT & RESIZING
  // ------------------------------------------------
  function adjustLayout() {
    const header = document.querySelector("header.header");
    const mainContainer = document.getElementById("mainContainer");
    const content = document.getElementById("content");
    if (!header || !mainContainer || !content) return;
    const wh = window.innerHeight;
    const hh = header.offsetHeight || 44;
    const available = wh - hh;
    mainContainer.style.height = available + "px";
    content.style.height = available + "px";
    setHeightsFromRatio();
  }
  window.addEventListener("resize", adjustLayout);

  function setHeightsFromRatio() {
    const content = document.getElementById("content");
    const chartC  = document.getElementById("chartContainer");
    const dataTH  = document.getElementById("dataTableHeaderContainer");
    const dataTB  = document.getElementById("dataTableBodyContainer");
    if (!content || !chartC || !dataTH || !dataTB) return;

    const cr = content.getBoundingClientRect();
    const controlsH = document.getElementById("controls").offsetHeight;
    const total = cr.height - controlsH;
    let ch = ratio * total;
    let dt = total - ch - 5;
    if (ch < 80) ch = 80;
    if (dt < 80) dt = 80;

    chartC.style.height = ch + "px";
    dataTH.style.height = "auto";
    const hh = dataTH.offsetHeight || 50;
    let bodyH = dt - hh;
    if (bodyH < 50) bodyH = 50;
    dataTB.style.height = bodyH + "px";

    if (chart) {
      chart.setSize(null, ch, false);
      chart.reflow();
    }
  }

  (function initResizer(){
    let isResizing = false;
    const resizer = document.getElementById("resizer");
    resizer.addEventListener("mousedown", (e)=>{
      isResizing = true;
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e)=>{
      if (!isResizing) return;
      const content = document.getElementById("content");
      const cr = content.getBoundingClientRect();
      const topOff = document.getElementById("controls").offsetHeight;
      const total = cr.height - topOff;
      const ch = e.clientY - (cr.top + topOff);
      ratio = ch / total;
      if (ratio < 0.1) ratio = 0.1;
      if (ratio > 0.9) ratio = 0.9;
      setHeightsFromRatio();
    });
    document.addEventListener("mouseup", ()=>{
      if (isResizing) {
        isResizing = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    });
  })();

  // ------------------------------------------------
  // TAG LIST & TREE
  // ------------------------------------------------
  async function loadTagList(refresh=false) {
    try {
      const url = refresh ? "/taglist?refresh=true" : "/taglist";
      logStatus("Fetching tag list...");
      const r = await fetch(url);
      if (r.ok) {
        const data = await r.json();
        if (data.error) {
          logStatus("Tag list error: " + data.error);
          return;
        }
        fullTagList = data;
        displayTagList = [...fullTagList];
        buildFilteredTree(document.getElementById("tagFilter").value.trim());
        logStatus("Tag list loaded.");
      } else {
        logStatus("Tag list fetch error: HTTP " + r.status);
      }
    } catch(e) {
      logStatus("Tag list fetch error: " + e.message);
    }
  }

  function buildFilteredTree(str) {
    if (!str) {
      if (filterActive) {
        filterActive = false;
        if (previousGroupStates) {
          groupStates = { ...previousGroupStates };
        }
        previousGroupStates = null;
      }
      displayTagList = [...fullTagList];
    } else {
      if (!filterActive) {
        filterActive = true;
        previousGroupStates = { ...groupStates };
      }
      displayTagList = fullTagList.filter(t => t.Tag.toLowerCase().includes(str.toLowerCase()));
    }
    buildTreeWithGrouping();
  }

  function isExpanded(path) {
    if (filterActive) return true;
    return !!groupStates[path];
  }

  function buildTreeWithGrouping() {
    const container = document.getElementById("tagTree");
    if (!container) return;
    container.innerHTML = "";

    const mode = parseInt(groupingMode, 10) || 0;
    if (mode === 0) {
      // No grouping
      let sorted = [...displayTagList].sort((a,b) => a.Tag.localeCompare(b.Tag));
      if (sortOrder === "desc") sorted.reverse();
      const ul = document.createElement("ul");
      sorted.forEach(item => {
        const li = document.createElement("li");
        li.textContent = item.Tag;
        li.classList.toggle("selected", selectedTags.has(item.Tag));
        li.addEventListener("click", (e) => {
          e.stopPropagation();
          if (selectedTags.has(item.Tag)) selectedTags.delete(item.Tag);
          else selectedTags.add(item.Tag);
          buildTreeWithGrouping();
        });
        ul.appendChild(li);
      });
      container.appendChild(ul);
    }
    else if (mode === 1) {
      // Single-level grouping
      let groups = {};
      displayTagList.forEach(t => {
        let parts = t.Tag.split(".");
        let g1 = parts[0] || t.Tag;
        let leftover = parts.slice(1).join(".") || t.Tag;
        if (!groups[g1]) groups[g1] = [];
        groups[g1].push({ full: t.Tag, display: leftover });
      });
      let g1Keys = Object.keys(groups).sort();
      if (sortOrder === "desc") g1Keys.reverse();

      const ul = document.createElement("ul");
      g1Keys.forEach(g1 => {
        const path = g1;
        const expanded = isExpanded(path);
        const liH = document.createElement("li");
        liH.classList.add("group-header");
        liH.classList.toggle("collapsed", !expanded);

        const icon = document.createElement("span");
        icon.className = "expand-collapse-icon";
        icon.textContent = expanded ? "-" : "+";
        liH.appendChild(icon);
        liH.appendChild(document.createTextNode(g1));
        liH.addEventListener("click",(e)=>{
          e.stopPropagation();
          groupStates[path] = !expanded;
          buildTreeWithGrouping();
        });
        ul.appendChild(liH);

        const subUl = document.createElement("ul");
        let arr = groups[g1];
        if (sortOrder === "desc") {
          arr.sort((a,b) => b.display.localeCompare(a.display));
        } else {
          arr.sort((a,b) => a.display.localeCompare(b.display));
        }
        arr.forEach(obj => {
          const li = document.createElement("li");
          li.textContent = obj.display;
          li.classList.toggle("selected", selectedTags.has(obj.full));
          li.addEventListener("click",(e)=>{
            e.stopPropagation();
            if (selectedTags.has(obj.full)) selectedTags.delete(obj.full);
            else selectedTags.add(obj.full);
            buildTreeWithGrouping();
          });
          subUl.appendChild(li);
        });
        if (!expanded) subUl.style.display = "none";
        ul.appendChild(subUl);
      });
      container.appendChild(ul);
    }
    else {
      // Two-level grouping
      let mainGroups = {};
      displayTagList.forEach(t => {
        let parts = t.Tag.split(".");
        let g1 = parts[0] || "";
        let g2 = parts[1] || "";
        let leftover = parts.slice(2).join(".") || (parts[1] || t.Tag);
        if (!mainGroups[g1]) mainGroups[g1] = {};
        if (!mainGroups[g1][g2]) mainGroups[g1][g2] = [];
        mainGroups[g1][g2].push({ full: t.Tag, display: leftover });
      });
      let g1Keys = Object.keys(mainGroups).sort();
      if (sortOrder === "desc") g1Keys.reverse();

      const ul = document.createElement("ul");
      g1Keys.forEach(g1 => {
        const path1 = g1;
        const expanded1 = isExpanded(path1);

        const li1 = document.createElement("li");
        li1.classList.add("group-header");
        li1.classList.toggle("collapsed", !expanded1);
        const icon1 = document.createElement("span");
        icon1.className = "expand-collapse-icon";
        icon1.textContent = expanded1 ? "-" : "+";
        li1.appendChild(icon1);
        li1.appendChild(document.createTextNode(g1 || "(NoGroup)"));
        li1.addEventListener("click",(e)=>{
          e.stopPropagation();
          groupStates[path1] = !expanded1;
          buildTreeWithGrouping();
        });
        ul.appendChild(li1);

        const subUl = document.createElement("ul");
        let g2Keys = Object.keys(mainGroups[g1]).sort();
        if (sortOrder === "desc") g2Keys.reverse();
        g2Keys.forEach(g2 => {
          const path2 = g1 + "|" + g2;
          const expanded2 = isExpanded(path2);

          const li2 = document.createElement("li");
          li2.classList.add("group-header");
          li2.classList.toggle("collapsed", !expanded2);
          const icon2 = document.createElement("span");
          icon2.className = "expand-collapse-icon";
          icon2.textContent = expanded2 ? "-" : "+";
          li2.appendChild(icon2);
          li2.appendChild(document.createTextNode(g2 || "(NoSubgroup)"));
          li2.addEventListener("click",(e)=>{
            e.stopPropagation();
            groupStates[path2] = !expanded2;
            buildTreeWithGrouping();
          });
          subUl.appendChild(li2);

          const thirdUl = document.createElement("ul");
          let arr = mainGroups[g1][g2];
          if (sortOrder === "desc") {
            arr.sort((a,b)=> b.display.localeCompare(a.display));
          } else {
            arr.sort((a,b)=> a.display.localeCompare(b.display));
          }
          arr.forEach(obj => {
            const li3 = document.createElement("li");
            li3.textContent = obj.display;
            li3.classList.toggle("selected", selectedTags.has(obj.full));
            li3.addEventListener("click",(e)=>{
              e.stopPropagation();
              if (selectedTags.has(obj.full)) selectedTags.delete(obj.full);
              else selectedTags.add(obj.full);
              buildTreeWithGrouping();
            });
            thirdUl.appendChild(li3);
          });
          if (!expanded2) thirdUl.style.display = "none";
          subUl.appendChild(thirdUl);
        });
        if (!expanded1) subUl.style.display = "none";
        ul.appendChild(subUl);
      });
      container.appendChild(ul);
    }
    const s = document.getElementById("selectionSummary");
    if (s) s.textContent = `${selectedTags.size}/${displayTagList.length}`;
  }

  // ------------------------------------------------
  // UI EVENT HANDLERS
  // ------------------------------------------------
  document.getElementById("tagFilter").addEventListener("input", function(){
    buildFilteredTree(this.value.trim());
  });
  document.getElementById("selectAllBtn").addEventListener("click", ()=>{
    displayTagList.forEach(t => selectedTags.add(t.Tag));
    buildTreeWithGrouping();
    sendLogEvent("user", "User selected all displayed tags");
  });
  document.getElementById("deselectAllBtn").addEventListener("click", ()=>{
    displayTagList.forEach(t => selectedTags.delete(t.Tag));
    buildTreeWithGrouping();
    sendLogEvent("user","User deselected all displayed tags");
  });
  document.getElementById("refreshTagsBtn").addEventListener("click", async ()=>{
    await loadTagList(true);
    sendLogEvent("user","User refreshed tag list");
  });
  document.getElementById("toggleSidebarBtn").addEventListener("click", function(){
    const sb = document.getElementById("sidebar");
    if (!sb) return;
    if (sb.classList.contains("collapsed")) {
      sb.classList.remove("collapsed");
      this.textContent = "«";
      this.title = "Hide sidebar";
      sendLogEvent("user","Sidebar expanded");
    } else {
      sb.classList.add("collapsed");
      this.textContent = "»";
      this.title = "Show sidebar";
      sendLogEvent("user","Sidebar collapsed");
    }
  });

  // Settings panel
  document.getElementById("mainOptionsBtn").addEventListener("click",()=>{
    document.getElementById("mainOptionsPanel").classList.add("open");
  });
  document.getElementById("mainOptionsCloseBtn").addEventListener("click",()=>{
    document.getElementById("mainOptionsPanel").classList.remove("open");
  });

  // Dark mode toggle
  document.getElementById("darkModeToggle").addEventListener("change", async function(){
    document.body.classList.toggle("dark-mode", this.checked);
    updateChartTheme();
    await saveSiteSettings();
    sendLogEvent("user","Dark mode => "+this.checked);
  });

  // Grouping mode
  document.querySelectorAll("#groupingModeButtons .polling-btn").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      groupingMode = btn.getAttribute("data-gmode");
      document.querySelectorAll("#groupingModeButtons .polling-btn")
        .forEach(b=> b.classList.remove("selected"));
      btn.classList.add("selected");
      await saveSiteSettings();
      buildTreeWithGrouping();
      sendLogEvent("user","Grouping => "+groupingMode);
    });
  });

  // Sort order
  document.querySelectorAll(".sort-order-btn").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      sortOrder = btn.getAttribute("data-order");
      document.querySelectorAll(".sort-order-btn")
        .forEach(b=> b.classList.remove("selected"));
      btn.classList.add("selected");
      await saveSiteSettings();
      buildTreeWithGrouping();
      sendLogEvent("user","Sort order => "+sortOrder);
    });
  });

  // Data offset
  document.getElementById("dataOffsetInput").addEventListener("change", async function(){
    dataOffset = parseFloat(this.value||"1");
    await saveSiteSettings();
    await rebuildWorkingTable();
    sendLogEvent("user","Data offset => "+dataOffset);
  });

  // Barge / FH number
  document.getElementById("bargeNameInput").addEventListener("change", async function(){
    bargeName = this.value;
    await saveSiteSettings();
  });
  document.getElementById("bargeNumberInput").addEventListener("change", async function(){
    bargeNumber = this.value;
    await saveSiteSettings();
  });

  // Forward fill
  document.getElementById("forwardFillToggle").addEventListener("change", async function(){
    forwardFill = this.checked;
    await saveSiteSettings();
    await rebuildWorkingTable();
    sendLogEvent("user","Forward fill => "+forwardFill);
  });

  // Tag Options
  document.getElementById("tagOptionsGear").addEventListener("click", ()=>{
    const sel = Array.from(selectedTags);
    const c = document.getElementById("tagOptionsContainer");
    c.innerHTML = "";
    if (!sel.length) {
      c.innerHTML = "<p>No tags selected.</p>";
    } else {
      const st = JSON.parse(localStorage.getItem("tagSettings") || '{"scale_factors":{},"error_value":{},"max_decimal":{}}');
      sel.forEach(tag => {
        const row = document.createElement("div");
        row.className = "tag-option-row";
        row.dataset.tag = tag;

        const lbl = document.createElement("span");
        lbl.textContent = tag;
        lbl.style.flex = "1";

        const sc = document.createElement("input");
        sc.type = "number";
        sc.step = "0.01";
        sc.value = st.scale_factors[tag] || "1";

        const er = document.createElement("input");
        er.type = "number";
        er.step = "1";
        er.value = (st.error_value[tag] === undefined) ? "" : st.error_value[tag];

        const dc = document.createElement("input");
        dc.type = "number";
        dc.step = "1";
        dc.value = (st.max_decimal[tag] === undefined) ? "2" : st.max_decimal[tag];

        row.dataset.scale = sc.value;
        row.dataset.err   = er.value;
        row.dataset.dec   = dc.value;

        sc.addEventListener("input", ()=> { row.dataset.scale = sc.value; });
        er.addEventListener("input", ()=> { row.dataset.err   = er.value; });
        dc.addEventListener("input", ()=> { row.dataset.dec   = dc.value; });

        row.appendChild(lbl);
        row.appendChild(sc);
        row.appendChild(er);
        row.appendChild(dc);
        c.appendChild(row);
      });
    }
    document.getElementById("tagOptionsModal").style.display = "block";
  });
  document.getElementById("tagOptionsClose").addEventListener("click",()=>{
    document.getElementById("tagOptionsModal").style.display = "none";
  });
  document.getElementById("saveTagOptionsBtn").addEventListener("click", async ()=>{
    const st = JSON.parse(localStorage.getItem("tagSettings") || '{"scale_factors":{},"error_value":{},"max_decimal":{}}');
    const rows = document.getElementById("tagOptionsContainer").getElementsByClassName("tag-option-row");
    for (let r of rows) {
      const tg = r.dataset.tag;
      const sc = parseFloat(r.dataset.scale || "1");
      const ev = r.dataset.err || "";
      const dc = parseInt(r.dataset.dec || "2", 10);

      st.scale_factors[tg] = isNaN(sc) ? 1 : sc;
      if (ev === "") delete st.error_value[tg];
      else st.error_value[tg] = parseFloat(ev);
      st.max_decimal[tg] = isNaN(dc) ? 2 : dc;
    }
    localStorage.setItem("tagSettings", JSON.stringify(st));
    await saveTagSettings();
    document.getElementById("tagOptionsModal").style.display = "none";
    await rebuildWorkingTable();
    sendLogEvent("user","Tag options saved for selected tags");
  });

  // Day lines
  document.getElementById("dayLinesToggle").addEventListener("change", function(){
    if (!chart) return;
    if (!this.checked) {
      chart.xAxis[0].update({ plotLines: [] }, false);
      chart.redraw();
      return;
    }
    const ex = chart.xAxis[0].getExtremes();
    const st = ex.min;
    const en = ex.max;
    let arr = [];
    const cc = document.body.classList.contains("dark-mode") ? "#e0e0e0" : "#000";
    let d = new Date(st);
    d.setHours(0,0,0,0);
    if (d.getTime() < st) d.setDate(d.getDate() + 1);
    while (d.getTime() < en) {
      arr.push({
        value: d.getTime(),
        color: cc,
        width: 1,
        dashStyle: "ShortDash",
        zIndex: 5
      });
      d.setDate(d.getDate() + 1);
    }
    chart.xAxis[0].update({ plotLines: arr }, false);
    chart.redraw();
  });

  // ------------------------------------------------
  // AUTO REFRESH
  // ------------------------------------------------
  function isLiveData() {
    // use endDate to see if user is near "now"
    const eD = document.getElementById("endDate").value;
    const ed = new Date(eD);
    if (isNaN(ed)) return false;
    return (Date.now() - ed.getTime() < 3600000);
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    logStatus(`AutoRefresh ON (interval=${pollInterval}ms)`);
    autoRefreshTimer = setInterval(()=>{
      if (isLiveData()) {
        autoRefreshFetch();
      } else {
        document.getElementById("autoRefreshToggle").checked = false;
        stopAutoRefresh();
        logStatus("AutoRefresh turned off (end time not near now).");
      }
    }, pollInterval);
  }

  function stopAutoRefresh() {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
      logStatus("AutoRefresh OFF");
    }
  }

  async function autoRefreshFetch() {
    let nowMs = Date.now();
    let stMs = CURRENT_XMAX || null;
    if (!stMs) {
      // fallback: parse endDate
      let eD = document.getElementById("endDate").value;
      let ed = new Date(eD);
      if (isNaN(ed)) ed = new Date();
      stMs = ed.getTime();
    }
    if (stMs >= nowMs) {
      logStatus("Auto-refresh: no new range to fetch.");
      return;
    }
    const stU = Math.floor(stMs / 1000);
    const enU = Math.floor(nowMs / 1000);
    logStatus(`Auto-refresh partial from ${stU} to ${enU}...`);
    sendLogEvent("user","AutoRefresh partial fetch");
    const pay = {
      tags: Array.from(selectedTags),
      startDateUnixSeconds: stU,
      endDateUnixSeconds: enU,
      autoRefresh: true
    };
    try {
      const r = await fetch("/fetch_data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pay)
      });
      if (!r.ok) {
        logStatus("AutoRefresh fetch_data error: HTTP "+ r.status);
        return;
      }
      const j = await r.json();
      if (j.newData || j.redrawNeeded) {
        CURRENT_XMAX = nowMs;
        await rebuildWorkingTable();
      } else {
        logStatus("AutoRefresh: no new data fetched.");
      }
    } catch(e) {
      logStatus("AutoRefresh fetch_data error: " + e.message);
    }
  }

  document.getElementById("autoRefreshToggle").addEventListener("change", function(){
    if (this.checked && isLiveData()) {
      let eD = document.getElementById("endDate").value;
      let ed = new Date(eD);
      CURRENT_XMAX = isNaN(ed) ? Date.now() : ed.getTime();
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });
  document.querySelectorAll(".polling-btn[data-interval]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      pollInterval = parseInt(btn.getAttribute("data-interval") || "5000");
      document.querySelectorAll(".polling-btn[data-interval]").forEach(b=> b.classList.remove("selected"));
      btn.classList.add("selected");
      await saveSiteSettings();
      if (document.getElementById("autoRefreshToggle").checked && isLiveData()) {
        startAutoRefresh();
      }
      sendLogEvent("user","pollInterval => "+pollInterval);
    });
  });

  // ------------------------------------------------
  // MANUAL FETCH
  // ------------------------------------------------
  document.getElementById("graphBtn").addEventListener("click", ()=>{
    stopAutoRefresh();
    onGraph();
  });

  async function onGraph() {
    if (!selectedTags.size) {
      logStatus("No tags selected.");
      return;
    }
    const sD = document.getElementById("startDate").value;
    const eD = document.getElementById("endDate").value;
    const sd = new Date(sD);
    const ed2 = new Date(eD);
    if (isNaN(sd) || isNaN(ed2)) {
      logStatus("Invalid date/time.");
      return;
    }
    const stU = Math.floor(sd.getTime()/1000);
    const enU = Math.floor(ed2.getTime()/1000);
    CURRENT_XMIN = sd.getTime();
    CURRENT_XMAX = ed2.getTime();
    logStatus(`Fetching data from ${stU} to ${enU}...`);
    sendLogEvent("user", `Manual fetch for tags: ${Array.from(selectedTags).join(", ")}`);

    const pay = {
      tags: Array.from(selectedTags),
      startDateUnixSeconds: stU,
      endDateUnixSeconds: enU,
      autoRefresh: false
    };
    try {
      const r = await fetch("/fetch_data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pay)
      });
      if (!r.ok) {
        logStatus("fetch_data error: HTTP " + r.status);
        return;
      }
      const j = await r.json();
      if (j.newData || j.redrawNeeded) {
        await rebuildWorkingTable();
      } else {
        logStatus("No new data fetched.");
      }
    } catch(e) {
      logStatus("Error fetching new data: " + e.message);
    }
  }

  // ------------------------------------------------
  // BUILD/UPDATE WORKING TABLE
  // ------------------------------------------------
  async function rebuildWorkingTable() {
    try {
      const pay = { dataOffset, forwardFill };
      const r = await fetch("/build_working_table", {
        method:"POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(pay)
      });
      if (!r.ok) {
        logStatus("build_working_table error: HTTP " + r.status);
        return;
      }
      const j = await r.json();
      WORKING_TABLE = j.data || [];

      if (!WORKING_TABLE.length) {
        if (chart) { chart.destroy(); chart=null; }
        clearTable();
        logStatus("No data in working table.");
        return;
      }
      if (j.redrawNeeded || !chart) {
        buildChart(WORKING_TABLE);
      } else {
        // Just update chart data if needed, but we rely on current extremes
        const ex = chart.xAxis[0].getExtremes();
        updateDisplayedData(ex.min, ex.max);
      }
    } catch(e) {
      logStatus("rebuildWorkingTable error: " + e.message);
    }
  }

  function parseDateMs(dtStr){
    // dtStr is "dd/mm/yyyy HH:MM:SS"
    const parts = dtStr.split(" ");
    if (parts.length < 2) return NaN;
    const dPart = parts[0];
    const tPart = parts[1];
    const dArr  = dPart.split("/");
    if (dArr.length < 3) return NaN;
    const isoStr = `${dArr[2]}-${dArr[1]}-${dArr[0]} ${tPart}`;
    return Date.parse(isoStr);
  }

  function buildChart(rows){
    if (!rows.length) {
      DISPLAYED_DATA = [];
      clearTable();
      if (chart) { chart.destroy(); chart=null; }
      logStatus("No data to display.");
      return;
    }
    const augmented = rows.map(r => ({...r, __ms__: parseDateMs(r.Timestamp)}));
    let colNames = Object.keys(augmented[0]).filter(k=> k !== "Timestamp" && k !== "__ms__" && k !== "NumericTimestamp");
    // ensure numeric
    colNames = colNames.filter(c => augmented.some(a => !isNaN(parseFloat(a[c]))));
    if (!colNames.length) {
      DISPLAYED_DATA = [];
      clearTable();
      if (chart) { chart.destroy(); chart=null; }
      logStatus("No numeric data columns found.");
      return;
    }
    const seriesArr = colNames.map(c => {
      const d = augmented.map(r => [r.__ms__, parseFloat(r[c])]);
      return { name: c, data: d };
    });

    const dm = document.body.classList.contains("dark-mode");
    const bg = dm ? "#2e2e2e" : "#fff";
    const tc = dm ? "#e0e0e0" : "#000";

    if (!chart) {
      chart = Highcharts.stockChart("chartContainer", {
        chart: { type:"line", backgroundColor: bg, zoomType:"xy" },
        title: { text:"Graph", style:{ color: tc } },
        xAxis: {
          type:"datetime",
          labels: { format:"{value:%d/%m %H:%M}", style:{ color:tc } },
          lineColor: tc,
          tickColor: tc,
          plotLines: [],
          events: {
            setExtremes: function(e) {
              if (e.min == null || e.max == null) {
                DISPLAYED_DATA = [...augmented];
              } else {
                updateDisplayedData(e.min, e.max);
              }
            }
          }
        },
        yAxis: {
          title:{ text:"Value", style:{ color:tc } },
          labels:{ style:{ color:tc } },
          lineColor: tc,
          tickColor: tc
        },
        legend: { enabled: true, itemStyle:{ color: tc } },
        navigator:{ enabled: true },
        scrollbar:{ enabled: true },
        rangeSelector:{ enabled: false },
        tooltip:{ shared: true, crosshairs: true },
        series: seriesArr,
        credits:{ enabled: false }
      });
    } else {
      // update existing
      const existingSeries = chart.series.map(s => s.name);
      const toRemove = existingSeries.filter(n => !colNames.includes(n));
      const toAdd    = colNames.filter(n => !existingSeries.includes(n));
      const toUpdate = colNames.filter(n => existingSeries.includes(n));

      toRemove.forEach(rm => {
        const s = chart.series.find(xx => xx.name===rm);
        if (s) s.remove(false);
      });
      toAdd.forEach(ad => {
        const d = augmented.map(r => [r.__ms__, parseFloat(r[ad])]);
        chart.addSeries({ name:ad, data:d }, false);
      });
      toUpdate.forEach(up => {
        const s = chart.series.find(xx => xx.name===up);
        if (s) {
          const d = augmented.map(r => [r.__ms__, parseFloat(r[up])]);
          s.setData(d, false);
        }
      });
      chart.redraw();
    }
    // set display data initially
    DISPLAYED_DATA = augmented;
    if (CURRENT_XMIN != null && CURRENT_XMAX != null) {
      chart.xAxis[0].setExtremes(CURRENT_XMIN, CURRENT_XMAX, false);
      chart.redraw();
    } else {
      // no manual range
      updateDisplayedData();
    }
  }

  function updateDisplayedData(minVal, maxVal) {
    // If null, means "show all"
    if (minVal == null || maxVal == null) {
      DISPLAYED_DATA = WORKING_TABLE.map(r => ({...r, __ms__: parseDateMs(r.Timestamp)}));
    } else {
      DISPLAYED_DATA = WORKING_TABLE
        .map(r => ({...r, __ms__: parseDateMs(r.Timestamp)}))
        .filter(r => r.__ms__ >= minVal && r.__ms__ <= maxVal);
    }
    buildDataTable();
  }

  function clearTable(){
    document.getElementById("dataTableHeaderContainer").innerHTML = "";
    document.getElementById("dataTableBodyContainer").innerHTML = "";
  }

  // CHANGED: Build the data table in the client from DISPLAYED_DATA
  function buildDataTable(){
    const headerDiv = document.getElementById("dataTableHeaderContainer");
    const bodyDiv   = document.getElementById("dataTableBodyContainer");
    headerDiv.innerHTML = "";
    bodyDiv.innerHTML   = "";
    if (!DISPLAYED_DATA.length) {
      headerDiv.innerHTML = "<p>No data</p>";
      return;
    }

    // gather columns
    const columns = Object.keys(DISPLAYED_DATA[0]).filter(k => k !== "__ms__");
    // We'll just do a simple <table> with a single header row:
    let html = "<table class='server-table' border='1'><thead><tr>";
    for (let c of columns){
      html += `<th>${c}</th>`;
    }
    html += "</tr></thead><tbody>";
    DISPLAYED_DATA.forEach(row => {
      html += "<tr>";
      for (let c of columns){
        const val = (row[c] == null || row[c] === undefined) ? "" : row[c];
        html += `<td>${val}</td>`;
      }
      html += "</tr>";
    });
    html += "</tbody></table>";

    headerDiv.innerHTML = "<div class='fixed-table-header'>" + 
      columns.map(c => `<div>${c}</div>`).join("") + "</div>"; 
    // Just for display, or you can skip a separate "header" container
    bodyDiv.innerHTML = html;
    setHeightsFromRatio();
  }

  // ------------------------------------------------
  // EXPORT
  // ------------------------------------------------
  document.getElementById("exportDataBtn").addEventListener("click", async ()=>{
    let startMs, endMs;
    if (chart) {
      const ex = chart.xAxis[0].getExtremes();
      startMs = Math.floor(ex.min);
      endMs   = Math.floor(ex.max);
    } else {
      const sD = document.getElementById("startDate").value;
      const eD = document.getElementById("endDate").value;
      const sd = new Date(sD);
      const ed2= new Date(eD);
      if (isNaN(sd) || isNaN(ed2)) {
        logStatus("Invalid date/time for export");
        return;
      }
      startMs = sd.getTime();
      endMs   = ed2.getTime();
    }
    const bn = document.getElementById("bargeNameInput").value || "UnknownBarge";
    const fh = document.getElementById("bargeNumberInput").value || "0000";
    const pay = {
      startDateUnixMillis: startMs,
      endDateUnixMillis: endMs,
      bargeName: bn,
      fhNumber: fh
    };
    logStatus("Exporting data to Excel...");
    sendLogEvent("user","Excel export range = "+startMs+"-"+endMs);
    try {
      const r = await fetch("/export_excel", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify(pay)
      });
      if (!r.ok) {
        let e=null;
        try { e=await r.json(); } catch {}
        const emsg = (e && e.error) ? e.error : "HTTP " + r.status;
        logStatus("Excel export error: " + emsg);
        return;
      }
      const blob = await r.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      let cd = r.headers.get("Content-Disposition");
      let fn = "Export.xlsx";
      if (cd && cd.includes("filename=")) {
        fn = cd.split("filename=")[1].replace(/\"/g,"");
      }
      a.download = fn;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      logStatus("Excel downloaded successfully.");
    } catch(e) {
      logStatus("Excel fetch error: " + e.message);
    }
  });

  // Generate PDF
  document.getElementById("generateReportBtn").addEventListener("click", onGeneratePDF);
  async function onGeneratePDF() {
    if (!chart) {
      logStatus("No chart present for PDF.");
      return;
    }
    if (!DISPLAYED_DATA.length) {
      logStatus("No data in chart range for PDF.");
      return;
    }
    logStatus("Generating PDF report...");
    sendLogEvent("user","User requested PDF report generation");

    try {
      const { jsPDF } = window.jspdf;
      let doc = new jsPDF({ orientation:"landscape", unit:"mm", format:"a4" });
      const pageWidth  = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 10;

      // Convert chart to image
      let svg = chart.getSVG({
        chart: { backgroundColor: "#fff" },
        title: { style:{ color:"#000" } },
        xAxis: { labels:{ style:{ color:"#000" }}, lineColor:"#000", tickColor:"#000" },
        yAxis: { labels:{ style:{ color:"#000" }}, title:{ style:{ color:"#000" }}, lineColor:"#000", tickColor:"#000" },
        legend: { itemStyle:{ color:"#000" } }
      });

      let svgBlob = new Blob([svg], { type:"image/svg+xml;charset=utf-8" });
      let url = URL.createObjectURL(svgBlob);
      let canvas = document.createElement("canvas");
      canvas.width  = chart.chartWidth  || 800;
      canvas.height = chart.chartHeight || 400;
      let ctx = canvas.getContext("2d");

      await new Promise((resolve, reject)=>{
        let img = new Image();
        img.onload = ()=>{
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          resolve();
        };
        img.onerror = reject;
        img.src = url;
      });
      let chartImgData = canvas.toDataURL("image/png");

      doc.setFontSize(14);
      doc.text("Data Extraction Report", pageWidth/2, 10, { align:"center" });
      doc.addImage(chartImgData, "PNG", margin, 20, pageWidth - margin*2, pageHeight - 30);

      doc.addPage();
      doc.setFontSize(12);
      doc.text("Data Table", margin, 15);

      const colNames = Object.keys(DISPLAYED_DATA[0]).filter(k => k !== "__ms__");
      let pdfBody = [];
      DISPLAYED_DATA.forEach(r => {
        let row = colNames.map(c => (r[c] == null ? "" : ""+r[c]));
        pdfBody.push(row);
      });
      let headRow = [ colNames.map(c => ({content: c, styles:{halign:"center"}})) ];

      doc.autoTable({
        startY: 30,
        head: headRow,
        body: pdfBody,
        theme: "grid",
        styles: { fontSize:8, cellPadding:2, halign:"center" },
        margin: { left: margin, right: margin }
      });

      const now = new Date();
      const ds = now.toISOString().slice(0,10).replace(/-/g,"");
      const fh = document.getElementById("bargeNumberInput").value || "0000";
      const bn = document.getElementById("bargeNameInput").value || "UnknownBarge";
      const fileName = `FH ${fh} ${bn} ${ds}.pdf`;
      doc.save(fileName);
      logStatus("PDF saved successfully.");
    } catch(e) {
      logStatus("PDF generation error: " + e.message);
    }
  }

  function updateChartTheme(){
    if (!chart) return;
    const dm = document.body.classList.contains("dark-mode");
    const bg = dm ? "#2e2e2e" : "#fff";
    const tc = dm ? "#e0e0e0" : "#000";
    chart.update({
      chart:{ backgroundColor: bg },
      title:{ style:{ color: tc } },
      xAxis:{
        labels:{ style:{ color: tc } },
        lineColor: tc,
        tickColor: tc
      },
      yAxis:{
        labels:{ style:{ color: tc } },
        title:{ style:{ color: tc } },
        lineColor: tc,
        tickColor: tc
      },
      legend:{ itemStyle:{ color: tc } },
      tooltip:{ style:{ color: tc }, backgroundColor: dm?"#333":"#fff" }
    }, false);
    chart.redraw();
  }

  // ------------------------------------------------
  // SAVE/LOAD SETTINGS
  // ------------------------------------------------
  async function loadSiteSettings(){
    try {
      const r = await fetch("/site_settings");
      if (r.ok) {
        const d = await r.json();
        document.body.classList.toggle("dark-mode", !!d.darkMode);
        document.getElementById("darkModeToggle").checked = !!d.darkMode;
        sortOrder    = d.sortOrder     || "asc";
        groupingMode = d.groupingMode  === undefined ? "2" : d.groupingMode;
        dataOffset   = parseFloat(d.dataOffset || "1");
        bargeName    = d.bargeName     || "";
        bargeNumber  = d.bargeNumber   || "";
        forwardFill  = !!d.forwardFill;
        pollInterval = d.pollInterval  || 5000;

        // CHANGED: also load startDate / endDate
        startDateStr = d.startDate || "";
        endDateStr   = d.endDate   || "";

        document.getElementById("dataOffsetInput").value = dataOffset;
        document.getElementById("bargeNameInput").value  = bargeName;
        document.getElementById("bargeNumberInput").value= bargeNumber;
        document.getElementById("forwardFillToggle").checked = forwardFill;

        // grouping mode buttons
        document.querySelectorAll("#groupingModeButtons .polling-btn").forEach(btn=>{
          const val = btn.getAttribute("data-gmode");
          btn.classList.remove("selected");
          if (val === groupingMode) btn.classList.add("selected");
        });
        // sort order
        document.querySelectorAll(".sort-order-btn").forEach(btn=>{
          const v = btn.getAttribute("data-order");
          btn.classList.remove("selected");
          if (v===sortOrder) btn.classList.add("selected");
        });
        // poll interval
        document.querySelectorAll(".polling-btn[data-interval]").forEach(btn=>{
          const iv = parseInt(btn.getAttribute("data-interval")||"0");
          btn.classList.remove("selected");
          if (iv === pollInterval) btn.classList.add("selected");
        });

        // init the date pickers using the loaded strings
        initDatePickers(startDateStr, endDateStr);

        updateChartTheme();
      }
    } catch(e){
      console.log("loadSiteSettings error:", e);
      // fallback
      initDatePickers();
    }
  }

  function initDatePickers(sdefStr, edefStr) {
    // If not provided, fallback to defaults
    let sdef = new Date();
    sdef.setHours(0,0,0,0);
    let edef = new Date();
    if (sdefStr) {
      const maybe = new Date(sdefStr);
      if (!isNaN(maybe)) sdef = maybe;
    }
    if (edefStr) {
      const maybe2 = new Date(edefStr);
      if (!isNaN(maybe2)) edef = maybe2;
    }

    flatpickr("#startDate", {
      enableTime: true,
      time_24hr: true,
      dateFormat: "Y-m-d H:i:S",
      defaultDate: sdef,
      onChange: async (selectedDates, dateStr)=>{
        // save new date in site settings
        startDateStr = dateStr;
        await saveSiteSettings();
      }
    });
    flatpickr("#endDate", {
      enableTime: true,
      time_24hr: true,
      dateFormat: "Y-m-d H:i:S",
      defaultDate: edef,
      onChange: async (selectedDates, dateStr)=>{
        endDateStr = dateStr;
        await saveSiteSettings();
      }
    });
  }

  async function saveSiteSettings(){
    // We'll push everything we have to the server
    const pay = {
      darkMode: document.getElementById("darkModeToggle").checked,
      sortOrder,
      groupingMode,
      dataOffset: parseFloat(document.getElementById("dataOffsetInput").value||"1"),
      bargeName: document.getElementById("bargeNameInput").value||"",
      bargeNumber: document.getElementById("bargeNumberInput").value||"",
      forwardFill: document.getElementById("forwardFillToggle").checked,
      pollInterval,
      startDate: startDateStr,
      endDate: endDateStr
    };
    try {
      await fetch("/site_settings", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify(pay)
      });
    } catch(e){
      console.log("saveSiteSettings error:", e);
    }
  }

  async function loadTagSettings(){
    try {
      const r = await fetch("/tag_settings");
      if (r.ok) {
        const d = await r.json();
        localStorage.setItem("tagSettings", JSON.stringify(d));
      }
    } catch(e) {
      console.log("loadTagSettings error:", e);
    }
  }
  async function saveTagSettings(){
    const st = localStorage.getItem("tagSettings");
    if (!st) return;
    try {
      await fetch("/tag_settings", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: st
      });
    } catch(e) {
      console.log("saveTagSettings error:", e);
    }
  }

  // Clear cache
  document.getElementById("clearCacheBtn").addEventListener("click", async ()=>{
    await fetch("/clear_cache", { method:"POST" });
    selectedTags.clear();
    WORKING_TABLE = [];
    DISPLAYED_DATA = [];
    if (chart) { chart.destroy(); chart=null; }
    clearTable();
    logStatus("Cache cleared.");
  });

  // ------------------------------------------------
  // INIT
  // ------------------------------------------------
  async function init(){
    await loadSiteSettings();  // this also sets up date pickers
    await loadTagSettings();
    await loadTagList(false);
    adjustLayout();
    logStatus("Ready.");
  }
  init();

});