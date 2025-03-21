/*******************************************************
 * script.js
 * - Addresses "Cannot set properties of undefined" by
 *   fully re-initializing Highcharts if forwardFill or
 *   major changes occur.
 * - Removes NumericTimestamp from table; "Timestamp"
 *   always first column.
 * - Multi-row 3-level headers in #dataTableHeaderContainer
 *   and data rows in #dataTableBodyContainer.
 * - Settings slider fully hides with style.right='-300px'.
 *******************************************************/

let WORKING_TABLE    = [];
let DISPLAYED_DATA   = [];
let selectedTags     = new Set();
let fullTagList      = [];
let displayTagList   = [];
let groupStates      = {};
let filterActive     = false;
let previousGroupStates= null;
let chart            = null;
let ratio            = 0.5;
let sortOrder        = "asc";
let groupingMode     = "2";
let dataOffset       = 1;
let bargeName        = "";
let bargeNumber      = "";
let forwardFill      = false;
let pollInterval     = 5000;
let autoRefreshTimer = null;
let CURRENT_XMIN     = null;
let CURRENT_XMAX     = null;
let startDateStr     = "";
let endDateStr       = "";

window.addEventListener("beforeunload", ()=>{
  navigator.sendBeacon("/clear_cache");
  
});

document.addEventListener("DOMContentLoaded", function(){
  console.log("DEBUG: DOMContentLoaded fired!");

  attachEventListeners();
  initResizer();
  initDatePickers();

  console.log("DEBUG: About to call loadSiteSettings()");
  loadSiteSettings()
    .then(() => {
      console.log("DEBUG: loadSiteSettings done, now loadTagList");
      return loadTagList(false);
    })
    .then(() => {
      console.log("DEBUG: loadTagList done, adjusting layout");
      adjustLayout();
    })
    .then(() => {
      console.log("DEBUG: All done => Ready.");
      logStatus("Ready.");
    })
    .catch(err => console.error("Startup chain error:", err));
});

/** LOGGING *********************************************/
async function sendLogEvent(type, message){
  try {
    await fetch("/log_event", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ type, message })
    });
  } catch {}
}
function logStatus(msg){
  console.log(msg);
  const sb = document.getElementById("statusBar");
  if(sb) sb.textContent = "Status: " + msg;
  sendLogEvent("script", msg);
}

/** EVENT LISTENERS *************************************/
function attachEventListeners(){
  // Slide-out panel
  const moBtn   = document.getElementById("mainOptionsBtn");
  const moClose = document.getElementById("mainOptionsCloseBtn");
  const panel   = document.getElementById("mainOptionsPanel");

  // Settings panel
  document.getElementById("mainOptionsBtn").addEventListener("click",()=>{
    document.getElementById("mainOptionsPanel").classList.add("open");
  });
  document.getElementById("mainOptionsCloseBtn").addEventListener("click",()=>{
    document.getElementById("mainOptionsPanel").classList.remove("open");
  });

  // Toggle sidebar
  const tsb= document.getElementById("toggleSidebarBtn");
  if(tsb){
    tsb.addEventListener("click", ()=>{
      const sb= document.getElementById("sidebar");
      if(sb.classList.contains("collapsed")){
        sb.classList.remove("collapsed");
        tsb.textContent= "«";
        tsb.title= "Hide sidebar";
      } else {
        sb.classList.add("collapsed");
        tsb.textContent= "»";
        tsb.title= "Show sidebar";
      }
    });
  }

  // Tag Filter
  document.getElementById("tagFilter").addEventListener("input", function(){
    buildFilteredTree(this.value.trim());
  });
  // Select All / Deselect All / Refresh
  document.getElementById("selectAllBtn").addEventListener("click", ()=>{
    displayTagList.forEach(t=> selectedTags.add(t.Tag));
    buildTreeWithGrouping();
  });
  document.getElementById("deselectAllBtn").addEventListener("click", ()=>{
    displayTagList.forEach(t=> selectedTags.delete(t.Tag));
    buildTreeWithGrouping();
  });
  document.getElementById("refreshTagsBtn").addEventListener("click", async ()=>{
    await loadTagList(true);
  });

  // Tag Options gear
  document.getElementById("tagOptionsGear").addEventListener("click", openTagOptionsModal);
  // Tag Options close
  document.getElementById("tagOptionsClose").addEventListener("click", ()=> {
    document.getElementById("tagOptionsModal").style.display="none";
  });
  // Save Tag Options
  document.getElementById("saveTagOptionsBtn").addEventListener("click", saveTagOptions);

  // Dark Mode
  document.getElementById("darkModeToggle").addEventListener("change", async function(){
    document.body.classList.toggle("dark-mode", this.checked);
    updateChartTheme();
    await saveSiteSettings();
  });

  // Forward fill => full rebuild
  document.getElementById("forwardFillToggle").addEventListener("change", async function(){
    forwardFill= this.checked;
    await saveSiteSettings();
    await rebuildWorkingTable(true); // pass a param telling the function we do a full re-init
  });

  // Grouping mode
  document.querySelectorAll("#groupingModeButtons .polling-btn").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      groupingMode= btn.getAttribute("data-gmode");
      document.querySelectorAll("#groupingModeButtons .polling-btn")
        .forEach(x=> x.classList.remove("selected"));
      btn.classList.add("selected");
      await saveSiteSettings();
      buildTreeWithGrouping();
    });
  });

  // Sort order
  document.querySelectorAll(".sort-order-btn").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      sortOrder= btn.getAttribute("data-order");
      document.querySelectorAll(".sort-order-btn")
        .forEach(x=> x.classList.remove("selected"));
      btn.classList.add("selected");
      await saveSiteSettings();
      buildTreeWithGrouping();
    });
  });

  // Data Offset
  document.getElementById("dataOffsetInput").addEventListener("change", async function(){
    dataOffset= parseFloat(this.value||"1");
    await saveSiteSettings();
    await rebuildWorkingTable(true);
  });

  // Barge name / number
  document.getElementById("bargeNameInput").addEventListener("change", async function(){
    bargeName= this.value;
    await saveSiteSettings();
  });
  document.getElementById("bargeNumberInput").addEventListener("change", async function(){
    bargeNumber= this.value;
    await saveSiteSettings();
  });

  // Graph
  document.getElementById("graphBtn").addEventListener("click", ()=>{
    stopAutoRefresh();
    onGraph();
  });

  // Day Lines
  document.getElementById("dayLinesToggle").addEventListener("change", function(){
    toggleDayLines(this.checked);
  });

  // Auto Refresh
  document.getElementById("autoRefreshToggle").addEventListener("change", function(){
    if(this.checked && isLiveData()){
      let eD= document.getElementById("endDate").value;
      let ed= new Date(eD.replace(" ","T"));
      CURRENT_XMAX= isNaN(ed)? Date.now(): ed.getTime();
      startAutoRefresh();
    } else {
      stopAutoRefresh();
    }
  });

  // Polling
  document.querySelectorAll(".polling-btn[data-interval]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      pollInterval= parseInt(btn.getAttribute("data-interval")||"5000");
      document.querySelectorAll(".polling-btn[data-interval]").forEach(x=> x.classList.remove("selected"));
      btn.classList.add("selected");
      await saveSiteSettings();
      if(document.getElementById("autoRefreshToggle").checked && isLiveData()){
        startAutoRefresh();
      }
    });
  });

  // Clear cache
  document.getElementById("clearCacheBtn").addEventListener("click", async ()=>{
    await fetch("/clear_cache",{ method:"POST" });
    selectedTags.clear();
    WORKING_TABLE=[];
    DISPLAYED_DATA=[];
    if(chart){ chart.destroy(); chart=""; }
    clearTable();
    logStatus("Cache cleared.");
  });
}

/** RESIZER **********************************************/
function initResizer(){
  const rs= document.getElementById("resizer");
  if(!rs)return;
  let isResizing= false;
  rs.addEventListener("mousedown",(e)=>{
    isResizing= true;
    document.body.style.cursor="row-resize";
    document.body.style.userSelect="none";
    e.preventDefault();
  });
  document.addEventListener("mousemove",(e)=>{
    if(!isResizing) return;
    const content= document.getElementById("content");
    const cr= content.getBoundingClientRect();
    const controlsH= document.getElementById("controls").offsetHeight;
    const total= cr.height- controlsH;
    const ch= e.clientY-(cr.top+ controlsH);
    ratio= ch/ total;
    if(ratio<0.1) ratio=0.1;
    if(ratio>0.9) ratio=0.9;
    setHeightsFromRatio();
  });
  /*document.addEventListener("mouseup",()=>{
    if(isResizing){
      isResizing=false;
      document.body.style.cursor="";
      document.body.style.userSelect="";
    }
  }); */
}

/** FLATPICKR ********************************************/
function initDatePickers(){
  flatpickr("#startDate", {
    enableTime:true,
    time_24hr:true,
    dateFormat:"Y-m-d H:i:S",
    defaultDate:new Date(),
    onChange: async (sel, ds)=>{
      startDateStr= ds;
      await saveSiteSettings();
    }
  });
  flatpickr("#endDate", {
    enableTime:true,
    time_24hr:true,
    dateFormat:"Y-m-d H:i:S",
    defaultDate:new Date(),
    onChange: async (sel, ds)=>{
      endDateStr= ds;
      await saveSiteSettings();
    }
  });
}

/** SITE SETTINGS ****************************************/
async function saveSiteSettings() {
  // Gather your current settings from the DOM or from variables
  const newSettings = {
    darkMode: document.getElementById("darkModeToggle").checked,
    sortOrder,
    groupingMode,
    dataOffset,
    bargeName,
    bargeNumber,
    forwardFill,
    pollInterval,
    startDate: startDateStr,
    endDate: endDateStr
  };

  // Send them to the server via POST
  const resp = await fetch("/site_settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(newSettings)
  });
  if (!resp.ok) {
    console.error("Error saving site settings", resp.status);
    return;
  }
  console.log("Site settings saved to server");
}

async function loadSiteSettings(){
  try{
    let r= await fetch("/site_settings");
    if(r.ok){
      let d= await r.json();
      document.body.classList.toggle("dark-mode", !!d.darkMode);
      document.getElementById("darkModeToggle").checked= !!d.darkMode;
      sortOrder     = d.sortOrder;
      groupingMode  = d.groupingMode;
      dataOffset    = parseFloat(d.dataOffset);
      bargeName     = d.bargeName;
      bargeNumber   = d.bargeNumber;
      forwardFill   = !!d.forwardFill;
      pollInterval  = parseInt(d.pollInterval);
      startDateStr  = d.startDate;
      endDateStr    = d.endDate;

      document.getElementById("forwardFillToggle").checked= forwardFill;
      document.getElementById("dataOffsetInput").value= dataOffset;
      document.getElementById("bargeNameInput").value= bargeName;
      document.getElementById("bargeNumberInput").value= bargeNumber;

      document.querySelectorAll("#groupingModeButtons .polling-btn").forEach(x=>{
        x.classList.remove("selected");
        if(x.getAttribute("data-gmode")=== groupingMode) x.classList.add("selected");
      });
      document.querySelectorAll(".sort-order-btn").forEach(x=>{
        x.classList.remove("selected");
        if(x.getAttribute("data-order")=== sortOrder) x.classList.add("selected");
      });
      document.querySelectorAll(".polling-btn[data-interval]").forEach(x=>{
        x.classList.remove("selected");
        if(parseInt(x.getAttribute("data-interval")||"0")=== pollInterval){
          x.classList.add("selected");
        }
      });

      if(startDateStr) document.getElementById("startDate")._flatpickr.setDate(startDateStr);
      if(endDateStr)   document.getElementById("endDate")._flatpickr.setDate(endDateStr);

      updateChartTheme();
    }
  }catch(e){
    console.log("loadSiteSettings error:", e);
    
  }
}
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

/** TAG LIST & GROUPING **********************************/
async function loadTagList(refresh=false){
  try{
    let url= refresh? "/taglist?refresh=true": "/taglist";
    let r= await fetch(url);
    if(!r.ok){
      logStatus("taglist => HTTP "+r.status);
      return;
    }
    let j= await r.json();
    fullTagList= j;
    displayTagList= [...fullTagList];
    buildFilteredTree(document.getElementById("tagFilter").value.trim());
  }catch(e){
    logStatus("loadTagList error => "+ e.message);
  }
}

function buildFilteredTree(str){
  if(!str){
    if(filterActive){
      filterActive=false;
      if(previousGroupStates){
        groupStates= {...previousGroupStates};
      }
      previousGroupStates= null;
    }
    displayTagList= [...fullTagList];
  } else {
    if(!filterActive){
      filterActive= true;
      previousGroupStates= {...groupStates};
    }
    displayTagList= fullTagList.filter(t=> t.Tag.toLowerCase().includes(str.toLowerCase()));
  }
  buildTreeWithGrouping();
}
function buildTreeWithGrouping(){
  const container= document.getElementById("tagTree");
  if(!container)return;
  container.innerHTML="";

  let mode= parseInt(groupingMode,10)||0;
  if(mode===0){
    // No grouping
    let sorted= [...displayTagList].sort((a,b)=> a.Tag.localeCompare(b.Tag));
    if(sortOrder==="desc") sorted.reverse();
    const ul= document.createElement("ul");
    sorted.forEach(item=>{
      const li= document.createElement("li");
      li.textContent= item.Tag;
      li.classList.toggle("selected", selectedTags.has(item.Tag));
      li.addEventListener("click",(e)=>{
        e.stopPropagation();
        if(selectedTags.has(item.Tag)) selectedTags.delete(item.Tag);
        else selectedTags.add(item.Tag);
        buildTreeWithGrouping();
      });
      ul.appendChild(li);
    });
    container.appendChild(ul);
  }
  else if(mode===1){
    // single-level grouping
    let groups={};
    displayTagList.forEach(t=>{
      let parts= t.Tag.split(".");
      let g1= parts[0]|| t.Tag;
      let leftover= parts.slice(1).join(".")|| t.Tag;
      if(!groups[g1]) groups[g1]=[];
      groups[g1].push({ full:t.Tag, display:leftover });
    });
    let g1Keys= Object.keys(groups).sort();
    if(sortOrder==="desc") g1Keys.reverse();
    const ul= document.createElement("ul");
    g1Keys.forEach(g1=>{
      const path= g1;
      const expanded= !!groupStates[path];

      const liH= document.createElement("li");
      liH.classList.add("group-header");
      liH.classList.toggle("collapsed", !expanded);

      const icon= document.createElement("span");
      icon.className="expand-collapse-icon";
      icon.textContent= expanded?"-":"+";
      liH.appendChild(icon);
      liH.appendChild(document.createTextNode(g1));
      liH.addEventListener("click",(ev)=>{
        ev.stopPropagation();
        groupStates[path]= !expanded;
        buildTreeWithGrouping();
      });
      ul.appendChild(liH);

      const subUl= document.createElement("ul");
      let arr= groups[g1];
      if(sortOrder==="desc") arr.sort((a,b)=> b.display.localeCompare(a.display));
      else arr.sort((a,b)=> a.display.localeCompare(b.display));
      arr.forEach(obj=>{
        const li= document.createElement("li");
        li.textContent= obj.display;
        li.classList.toggle("selected", selectedTags.has(obj.full));
        li.addEventListener("click",(ev)=>{
          ev.stopPropagation();
          if(selectedTags.has(obj.full)) selectedTags.delete(obj.full);
          else selectedTags.add(obj.full);
          buildTreeWithGrouping();
        });
        subUl.appendChild(li);
      });
      if(!expanded) subUl.style.display="none";
      ul.appendChild(subUl);
    });
    container.appendChild(ul);
  }
  else {
    // two-level grouping
    let mainGroups={};
    displayTagList.forEach(t=>{
      let parts= t.Tag.split(".");
      let g1= parts[0]||"";
      let g2= parts[1]||"";
      let leftover= parts.slice(2).join(".")|| (parts[1]|| t.Tag);
      if(!mainGroups[g1]) mainGroups[g1]={};
      if(!mainGroups[g1][g2]) mainGroups[g1][g2]=[];
      mainGroups[g1][g2].push({ full:t.Tag, display:leftover });
    });
    let g1Keys= Object.keys(mainGroups).sort();
    if(sortOrder==="desc") g1Keys.reverse();
    const ul= document.createElement("ul");
    g1Keys.forEach(g1=>{
      const path1= g1;
      const expanded1= !!groupStates[path1];

      const li1= document.createElement("li");
      li1.classList.add("group-header");
      li1.classList.toggle("collapsed", !expanded1);
      const icon1= document.createElement("span");
      icon1.className="expand-collapse-icon";
      icon1.textContent= expanded1?"-":"+";
      li1.appendChild(icon1);
      li1.appendChild(document.createTextNode(g1||"(NoGrp)"));
      li1.addEventListener("click",(ev)=>{
        ev.stopPropagation();
        groupStates[path1]= !expanded1;
        buildTreeWithGrouping();
      });
      ul.appendChild(li1);

      const subUl= document.createElement("ul");
      let g2Keys= Object.keys(mainGroups[g1]).sort();
      if(sortOrder==="desc") g2Keys.reverse();
      g2Keys.forEach(g2=>{
        const path2= g1+"|"+g2;
        const expanded2= !!groupStates[path2];

        const li2= document.createElement("li");
        li2.classList.add("group-header");
        li2.classList.toggle("collapsed", !expanded2);
        const icon2= document.createElement("span");
        icon2.className="expand-collapse-icon";
        icon2.textContent= expanded2?"-":"+";
        li2.appendChild(icon2);
        li2.appendChild(document.createTextNode(g2||"(NoSub)"));
        li2.addEventListener("click",(ev)=>{
          ev.stopPropagation();
          groupStates[path2]= !expanded2;
          buildTreeWithGrouping();
        });
        subUl.appendChild(li2);

        const thirdUl= document.createElement("ul");
        let arr= mainGroups[g1][g2];
        if(sortOrder==="desc"){
          arr.sort((a,b)=> b.display.localeCompare(a.display));
        } else {
          arr.sort((a,b)=> a.display.localeCompare(b.display));
        }
        arr.forEach(obj=>{
          const li3= document.createElement("li");
          li3.textContent= obj.display;
          li3.classList.toggle("selected", selectedTags.has(obj.full));
          li3.addEventListener("click",(ev)=>{
            ev.stopPropagation();
            if(selectedTags.has(obj.full)) selectedTags.delete(obj.full);
            else selectedTags.add(obj.full);
            buildTreeWithGrouping();
          });
          thirdUl.appendChild(li3);
        });
        if(!expanded2) thirdUl.style.display="none";
        subUl.appendChild(thirdUl);
      });
      if(!expanded1) subUl.style.display="none";
      ul.appendChild(subUl);
    });
    container.appendChild(ul);
  }
  const selSummary= document.getElementById("selectionSummary");
  if(selSummary) selSummary.textContent= `${selectedTags.size}/${displayTagList.length}`;
}

/** FETCH & GRAPH ***************************************/
async function onGraph(){
  if(!selectedTags.size){
    logStatus("No tags selected");
    return;
  }
  const sD= document.getElementById("startDate").value;
  const eD= document.getElementById("endDate").value;
  let sd= new Date(sD.replace(" ","T"));
  let ed2= new Date(eD.replace(" ","T"));
  if(isNaN(sd)|| isNaN(ed2)){
    logStatus("Invalid date/time");
    return;
  }
  const stU= Math.floor(sd.getTime()/1000);
  const enU= Math.floor(ed2.getTime()/1000);
  CURRENT_XMIN= sd.getTime();
  CURRENT_XMAX= ed2.getTime();
  logStatus(`Fetching data from ${stU}..${enU}`);
  const pay={
    tags: Array.from(selectedTags),
    startDateUnixSeconds: stU,
    endDateUnixSeconds: enU
  };
  try{
    let r= await fetch("/fetch_data", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(pay)
    });
    if(!r.ok){
      logStatus("fetch_data => HTTP "+ r.status);
      return;
    }
    let j= await r.json();
    if(j.newData|| j.redrawNeeded){
      await rebuildWorkingTable(true);
    } else {
      logStatus("No new data fetched");
    }
  }catch(e){
    logStatus("onGraph error => "+ e.message);
  }
}

/**
 * Rebuild working table. If forceFull is true, we destroy & re-init the chart
 * to avoid partial updates that might cause 'pointStart' or series undefined errors.
 */
async function rebuildWorkingTable(forceFull=false){
  try{
    const pay={ dataOffset, forwardFill };
    let r= await fetch("/build_working_table", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(pay)
    });
    if(!r.ok){
      logStatus("build_working_table => HTTP "+ r.status);
      return;
    }
    let j= await r.json();
    WORKING_TABLE= j.data||[];
    if(!WORKING_TABLE.length){
      if(chart){ chart.destroy(); chart=null; }
      clearTable();
      logStatus("No data in working table");
      return;
    }
    // If we need a full re-init or the server says redraw needed => do so
    if(forceFull || j.redrawNeeded || !chart){
      // destroy the old chart if it exists
      if(chart){
        chart.destroy();
        chart= null;
      }
      buildChart(WORKING_TABLE);
    } else {
      // partial update
      const ex= chart.xAxis[0].getExtremes();
      updateDisplayedData(ex.min, ex.max);
    }
  }catch(e){
    logStatus("rebuildWorkingTable error => "+ e.message);
  }
}

/** BUILD CHART & TABLE **********************************/
function parseDateMs(dtStr){
  // dtStr => "dd/mm/yyyy HH:MM:SS"
  const [dPart, tPart]= dtStr.split(" ");
  if(!tPart)return NaN;
  const [dd,mm,yyyy]= dPart.split("/");
  if(!yyyy)return NaN;
  let iso= `${yyyy}-${mm}-${dd}T${tPart}`;
  return Date.parse(iso);
}
function buildChart(rows){
  if(!rows.length){
    DISPLAYED_DATA=[];
    clearTable();
    if(chart){ chart.destroy(); chart=null;}
    logStatus("No data to display");
    return;
  }
  // remove NumericTimestamp from final
  let cleaned= rows.map(r=>{
    let cpy= {...r};
    delete cpy.NumericTimestamp; // remove
    return cpy;
  });
  let augmented= cleaned.map(r=> ({...r, __ms__: parseDateMs(r.Timestamp)}));

  // columns => ensure Timestamp is first
  let allCols= Object.keys(augmented[0]);
  if(allCols.includes("__ms__")) allCols.splice(allCols.indexOf("__ms__"),1);
  if(allCols.includes("Timestamp")){
    allCols.splice(allCols.indexOf("Timestamp"),1);
    allCols= ["Timestamp", ...allCols];
  }

  // find numeric
  let numericCols= allCols.filter(c=> augmented.some(a=> !isNaN(parseFloat(a[c])) && c!=="Timestamp"));
  if(!numericCols.length){
    DISPLAYED_DATA= augmented;
    multiRowBuildTable(augmented, allCols); // fallback table
    if(chart){ chart.destroy(); chart=null; }
    logStatus("No numeric columns found => no chart drawn");
    return;
  }
  // build series
  let seriesArr= numericCols.map(c=>{
    let d= augmented.map(rr=> [rr.__ms__, parseFloat(rr[c])]);
    return { name:c, data:d };
  });

  // build chart
  const dm= document.body.classList.contains("dark-mode");
  const bg= dm?"#2e2e2e":"#fff";
  const tc= dm?"#e0e0e0":"#000";

  chart= Highcharts.stockChart("chartContainer", {
    chart:{ type:"line", backgroundColor:bg, zoomType:"xy" },
    title:{ text:"Graph", style:{ color: tc } },
    xAxis:{
      type:"datetime",
      labels:{ format:"{value:%d/%m %H:%M}", style:{ color: tc }},
      lineColor: tc,
      tickColor: tc,
      events:{
        setExtremes:function(e){
          if(e.min==null|| e.max==null){
            DISPLAYED_DATA= [...augmented];
          } else {
            updateDisplayedData(e.min,e.max);
          }
        }
      }
    },
    yAxis:{
      title:{ text:"Value", style:{ color: tc }},
      labels:{ style:{ color: tc }},
      lineColor: tc,
      tickColor: tc
    },
    legend:{ enabled:true, itemStyle:{ color: tc }},
    navigator:{ enabled:true },
    scrollbar:{ enabled:true },
    rangeSelector:{ enabled:false },
    tooltip:{ shared:true, crosshairs:true },
    series: seriesArr,
    credits:{ enabled:false }
  });

  // store displayed data initially
  DISPLAYED_DATA= augmented;
  multiRowBuildTable(augmented, allCols);
}

// update displayed data
function updateDisplayedData(minVal, maxVal){
  if(minVal==null || maxVal==null){
    let stripped= WORKING_TABLE.map(r=>{
      let cpy= {...r};
      delete cpy.NumericTimestamp;
      return cpy;
    });
    DISPLAYED_DATA= stripped.map(r=> ({...r, __ms__: parseDateMs(r.Timestamp)}));
  } else {
    let stripped= WORKING_TABLE.map(r=>{
      let cpy= {...r};
      delete cpy.NumericTimestamp;
      return cpy;
    });
    DISPLAYED_DATA= stripped
      .map(r=> ({...r, __ms__: parseDateMs(r.Timestamp)}))
      .filter(r=> r.__ms__>= minVal && r.__ms__<= maxVal);
  }
  let allCols= Object.keys(DISPLAYED_DATA[0]||{});
  if(allCols.includes("__ms__")) allCols.splice(allCols.indexOf("__ms__"),1);
  if(allCols.includes("Timestamp")){
    allCols.splice(allCols.indexOf("Timestamp"),1);
    allCols= ["Timestamp", ...allCols];
  }
  multiRowBuildTable(DISPLAYED_DATA, allCols);
}

/** MULTI-ROW HEADER (3-level: Group1, Group2, Tag) */
function multiRowBuildTable(rows, columns){
  // Build a separate <table> in #dataTableHeaderContainer for the 3 header rows,
  // and a second <table> in #dataTableBodyContainer for the data.

  const hdr= document.getElementById("dataTableHeaderContainer");
  const bod= document.getElementById("dataTableBodyContainer");
  hdr.innerHTML="";
  bod.innerHTML="";
  if(!rows.length){
    hdr.innerHTML= "<p>No data</p>";
    return;
  }
  // create 3 levels for each col
  // e.g. if col = "Engine1.GenA.Power", we parse into ["Engine1","GenA","Power"].
  // If "Timestamp", we treat as special => parse => ["","","Timestamp"] so it's always 3rd level = "Timestamp"?

  function parseCol3Levels(col){
    if(col==="Timestamp") return ["","","Timestamp"];
    let parts= col.split(".");
    if(parts.length===1) return ["","",parts[0]];
    if(parts.length===2) return [parts[0], "", parts[1]];
    if(parts.length>=3) return [parts[0], parts[1], parts.slice(2).join(".")];
  }

  let colLevels= columns.map(c=> parseCol3Levels(c));
  // colLevels[cIndex] => [g1, g2, leaf]
  // We'll build 3 <tr>: row0 => group1, row1 => group2, row2 => leaf
  let row0=[];
  let row1=[];
  let row2=[];
  colLevels.forEach(levels=>{
    row0.push(levels[0]||"");
    row1.push(levels[1]||"");
    row2.push(levels[2]||"");
  });

  // We'll produce a small table for the header
  let tableHdr= document.createElement("table");
  tableHdr.className= "header-table";
  tableHdr.border="1";
  tableHdr.style.borderCollapse="collapse";
  let thead= tableHdr.createTHead();

  let tr0= thead.insertRow();
  row0.forEach(txt=> tr0.insertCell().textContent= txt);
  let tr1= thead.insertRow();
  row1.forEach(txt=> tr1.insertCell().textContent= txt);
  let tr2= thead.insertRow();
  row2.forEach(txt=> tr2.insertCell().textContent= txt);

  // apply merges for consecutive duplicates in row0, row1 => e.g. if multiple same group => merge
  applyConsecutiveMerges(tr0);
  applyConsecutiveMerges(tr1);
  applyConsecutiveMerges(tr2);

  // attach the header table
  hdr.appendChild(tableHdr);

  // build a second table for the data
  let tableBody= document.createElement("table");
  tableBody.className= "body-table";
  tableBody.border="1";
  tableBody.style.borderCollapse="collapse";
  let tb= tableBody.createTBody();

  // Insert data rows
  rows.forEach(r=>{
    let rowEl= tb.insertRow();
    columns.forEach(col=>{
      let val= (r[col]===undefined|| r[col]===null)?"": r[col];
      let td= rowEl.insertCell();
      td.textContent= val;
    });
  });

  bod.appendChild(tableBody);

  // We'll do a naive approach for consistent column widths:
  // measure the header <th> widths, apply them to the body <td>.
  setTimeout(()=> alignHeaderBodyColumns(tableHdr, tableBody), 0);
}

/** Merge consecutive duplicates in a single table row. */
function applyConsecutiveMerges(tr){
  // tr is a TableRow
  let cells= Array.from(tr.cells);
  let spanStart= 0;
  let lastTxt= cells[0].textContent;
  for(let i=1; i<cells.length; i++){
    let txt= cells[i].textContent;
    if(txt!== lastTxt){
      // merge [spanStart..(i-1)] if i-1>spanStart
      if((i-1)>spanStart){
        let colspan= i-spanStart;
        cells[spanStart].colSpan= colspan;
        for(let j= spanStart+1; j<i; j++){
          cells[j].style.display="none";
        }
      }
      spanStart= i;
      lastTxt= txt;
    }
  }
  // final
  if(spanStart< (cells.length-1)){
    let colspan= cells.length- spanStart;
    cells[spanStart].colSpan= colspan;
    for(let j= spanStart+1; j<cells.length; j++){
      cells[j].style.display="none";
    }
  }
}

/** Match column widths of header table with body table. */
function alignHeaderBodyColumns(headerTbl, bodyTbl){
  let hdrRows= headerTbl.rows;
  if(!hdrRows.length)return;
  let nCols= hdrRows[hdrRows.length-1].cells.length; // last row has final # of cells
  let bodyRows= bodyTbl.rows;
  if(!bodyRows.length) return;
  // measure final row of header for columns that are visible
  let colWidths= [];
  let finalHdrCells= Array.from(hdrRows[hdrRows.length-1].cells).filter(c=> c.style.display!=="none");
  finalHdrCells.forEach(cell=>{
    colWidths.push(cell.getBoundingClientRect().width);
  });
  // apply to each column in body
  if(bodyRows[0].cells.length=== colWidths.length){
    for(let c=0; c<colWidths.length; c++){
      let w= colWidths[c]+"px";
      // set body col widths
      for(let r=0; r<bodyRows.length; r++){
        if(bodyRows[r].cells[c]) bodyRows[r].cells[c].style.width= w;
      }
      // also set header col width
      if(finalHdrCells[c]) finalHdrCells[c].style.width= w;
    }
  }
}

/** DAY LINES */
function toggleDayLines(checked){
  if(!chart)return;
  if(!checked){
    chart.xAxis[0].update({ plotLines:[] }, false);
    chart.redraw();
    return;
  }
  let ex= chart.xAxis[0].getExtremes();
  let st= ex.min, en= ex.max;
  let arr=[];
  let cc= document.body.classList.contains("dark-mode")?"#e0e0e0":"#000";
  let d= new Date(st);
  d.setHours(0,0,0,0);
  if(d.getTime()< st) d.setDate(d.getDate()+1);
  while(d.getTime()< en){
    arr.push({
      value: d.getTime(),
      color: cc,
      width:1,
      dashStyle:"ShortDash",
      zIndex:5
    });
    d.setDate(d.getDate()+1);
  }
  chart.xAxis[0].update({ plotLines:arr }, false);
  chart.redraw();
}

/** AUTO REFRESH */
function isLiveData(){
  let eD= document.getElementById("endDate").value;
  let ed= new Date(eD.replace(" ","T"));
  if(isNaN(ed))return false;
  return (Date.now()- ed.getTime()< 3600000);
}
function startAutoRefresh(){
  stopAutoRefresh();
  logStatus(`AutoRefresh ON (interval=${pollInterval}ms)`);
  autoRefreshTimer= setInterval(()=>{
    if(isLiveData()){
      autoRefreshFetch();
    } else {
      document.getElementById("autoRefreshToggle").checked=false;
      stopAutoRefresh();
      logStatus("AutoRefresh turned off (end not near now).");
    }
  }, pollInterval);
}
function stopAutoRefresh(){
  if(autoRefreshTimer){
    clearInterval(autoRefreshTimer);
    autoRefreshTimer=null;
    logStatus("AutoRefresh OFF");
  }
}
async function autoRefreshFetch(){
  let nowMs= Date.now();
  let stMs= CURRENT_XMAX|| null;
  if(!stMs){
    let eD= document.getElementById("endDate").value;
    let ed= new Date(eD.replace(" ","T"));
    if(isNaN(ed)) ed= new Date();
    stMs= ed.getTime();
  }
  if(stMs>= nowMs){
    logStatus("Auto-refresh => no new range to fetch");
    return;
  }
  let stU= Math.floor(stMs/1000);
  let enU= Math.floor(nowMs/1000);
  logStatus(`Auto-refresh partial => ${stU}..${enU}`);
  sendLogEvent("user","autoRefresh partial fetch");
  let pay={
    tags: Array.from(selectedTags),
    startDateUnixSeconds: stU,
    endDateUnixSeconds: enU
  };
  try{
    let r= await fetch("/fetch_data",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(pay)
    });
    if(!r.ok){
      logStatus("AutoRefresh => HTTP "+ r.status);
      return;
    }
    let j= await r.json();
    if(j.newData|| j.redrawNeeded){
      CURRENT_XMAX= nowMs;
      await rebuildWorkingTable(false);
    } else {
      logStatus("AutoRefresh => no new data");
    }
  }catch(e){
    logStatus("autoRefreshFetch error => "+ e.message);
  }
}

/** TAG OPTIONS => partial or full rebuild ***************/
function openTagOptionsModal(){
  const sel= Array.from(selectedTags);
  const c= document.getElementById("tagOptionsContainer");
  c.innerHTML="";
  if(!sel.length){
    c.innerHTML= "<p>No tags selected.</p>";
  } else {
    const st= JSON.parse(localStorage.getItem("tagSettings")||'{"scale_factors":{},"error_value":{},"max_decimal":{}}');
    sel.forEach(tg=>{
      let row= document.createElement("div");
      row.className="tag-option-row";
      row.dataset.tag= tg;

      let lbl= document.createElement("span");
      lbl.textContent= tg;
      lbl.style.flex="1";

      let sc= document.createElement("input");
      sc.type="number";
      sc.step="0.01";
      sc.value= st.scale_factors[tg]||"1";

      let er= document.createElement("input");
      er.type="number";
      er.step="1";
      er.value= (st.error_value[tg]===undefined)? "":st.error_value[tg];

      let dc= document.createElement("input");
      dc.type="number";
      dc.step="1";
      dc.value= (st.max_decimal[tg]===undefined)? "2":st.max_decimal[tg];

      row.dataset.scale= sc.value;
      row.dataset.err  = er.value;
      row.dataset.dec  = dc.value;

      sc.addEventListener("input", ()=>{ row.dataset.scale= sc.value; });
      er.addEventListener("input", ()=>{ row.dataset.err  = er.value; });
      dc.addEventListener("input", ()=>{ row.dataset.dec  = dc.value; });

      row.appendChild(lbl);
      row.appendChild(sc);
      row.appendChild(er);
      row.appendChild(dc);
      c.appendChild(row);
    });
  }
  document.getElementById("tagOptionsModal").style.display="block";
}
function saveTagOptions(){
  const st= JSON.parse(localStorage.getItem("tagSettings")||'{"scale_factors":{},"error_value":{},"max_decimal":{}}');
  const rows= document.getElementById("tagOptionsContainer").getElementsByClassName("tag-option-row");
  for(let r of rows){
    let tg= r.dataset.tag;
    let sc= parseFloat(r.dataset.scale||"1");
    let ev= r.dataset.err||"";
    let dc= parseInt(r.dataset.dec||"2",10);

    st.scale_factors[tg]= isNaN(sc)?1:sc;
    if(ev==="") delete st.error_value[tg];
    else st.error_value[tg]= parseFloat(ev);
    st.max_decimal[tg]= isNaN(dc)?2:dc;
  }
  localStorage.setItem("tagSettings", JSON.stringify(st));
  document.getElementById("tagOptionsModal").style.display="none";
  logStatus("Tag options => full rebuild");
  rebuildWorkingTable(true);
}

/** LAYOUT & THEME ***************************************/
function adjustLayout(){
  const header= document.querySelector(".header");
  const main= document.getElementById("mainContainer");
  if(!header||!main)return;
  const wh= window.innerHeight;
  const hh= header.offsetHeight||50;
  const available= wh- hh;
  main.style.height= available+"px";
  setHeightsFromRatio();
}
window.addEventListener("resize", adjustLayout);

function setHeightsFromRatio(){
  const content= document.getElementById("content");
  const chartC= document.getElementById("chartContainer");
  const dataTH= document.getElementById("dataTableHeaderContainer");
  const dataTB= document.getElementById("dataTableBodyContainer");
  if(!content||!chartC||!dataTH||!dataTB)return;

  const cr= content.getBoundingClientRect();
  const controlsH= document.getElementById("controls").offsetHeight;
  const total= cr.height- controlsH;
  let ch= ratio* total;
  let dt= total- ch-5;
  if(ch<80) ch=80;
  if(dt<80) dt=80;

  chartC.style.height= ch+"px";
  dataTH.style.height= "auto";
  let hh= dataTH.offsetHeight||50;
  let bodyH= dt- hh;
  if(bodyH<50) bodyH=50;
  dataTB.style.height= bodyH+"px";

  if(chart){
    chart.setSize(null, ch, false);
    chart.reflow();
  }
}

function updateChartTheme(){
  if(!chart)return;
  const dm= document.body.classList.contains("dark-mode");
  const bg= dm?"#2e2e2e":"#fff";
  const tc= dm?"#e0e0e0":"#000";
  chart.update({
    chart:{ backgroundColor: bg },
    title:{ style:{ color: tc }},
    xAxis:{
      labels:{ style:{ color: tc }},
      lineColor: tc,
      tickColor: tc
    },
    yAxis:{
      labels:{ style:{ color: tc }},
      title:{ style:{ color: tc }},
      lineColor: tc,
      tickColor: tc
    },
    legend:{ itemStyle:{ color: tc }},
    tooltip:{ style:{ color: tc }, backgroundColor: dm?"#333":"#fff" }
  }, false);
  chart.redraw();
}