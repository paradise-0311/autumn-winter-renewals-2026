"use strict";

const byId = id => document.getElementById(id);
const snapshotPicker = byId("snapshot");
const gradePicker = byId("grade");
const refreshButton = byId("refresh");
const chart = byId("chart");
const metricButtons = [...document.querySelectorAll("[data-metric]")];
const numberFormat = new Intl.NumberFormat("zh-CN");
const nameOrder = new Intl.Collator("zh-CN", { numeric: true });
const refreshInterval = 30_000;

let snapshots = [];
let currentTime = "";
let metric = "count";
let loading = false;
let chartFrame = 0;

function groupTotals(snapshot) {
  const rows = Object.values(snapshot.group);
  return {
    enrolled: rows.reduce((total, row) => total + Number(row[0]), 0),
    renewed: rows.reduce((total, row) => total + Number(row[1]), 0)
  };
}

function rate(renewed, enrolled) {
  return enrolled ? (100 * renewed / enrolled).toFixed(1) + "%" : "—";
}

function selectedIndex() {
  return currentTime ? snapshots.findIndex(snapshot => snapshot.time === currentTime) : snapshots.length - 1;
}

function textElement(tag, value, className) {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

function setOptions(select, first, choices, selected) {
  select.replaceChildren(new Option(first, ""), ...choices.map(([value, label]) => new Option(label, value)));
  select.value = selected;
  if (select.selectedIndex < 0) select.selectedIndex = 0;
  select.disabled = false;
}

function drawTeachers(snapshot) {
  const totals = new Map();
  for (const [name, grade, enrolled, renewed, same] of snapshot.staff) {
    if (gradePicker.value && grade !== gradePicker.value) continue;
    const row = totals.get(name) || { name, enrolled: 0, renewed: 0, same: 0 };
    row.enrolled += enrolled;
    row.renewed += renewed;
    row.same += same;
    totals.set(name, row);
  }
  const sorted = [...totals.values()].sort((a, b) => b.renewed - a.renewed || nameOrder.compare(a.name, b.name));
  byId("staff-rows").replaceChildren(...sorted.map(({ name, enrolled, renewed, same }) => {
    const tr = document.createElement("tr");
    const th = textElement("th", name);
    th.scope = "row";
    tr.append(th, textElement("td", numberFormat.format(enrolled)),
      textElement("td", numberFormat.format(renewed), renewed ? "renewed" : ""),
      textElement("td", rate(renewed, enrolled)), textElement("td", numberFormat.format(same)));
    return tr;
  }));
}

function compareRenewals(previous, current) {
  const byStudent = new Map();
  for (const [side, records] of [previous, current].entries()) {
    for (const [student, autumn, grade, winter] of records) {
      if (!byStudent.has(student)) byStudent.set(student, [[], []]);
      byStudent.get(student)[side].push([autumn, winter || "待核实", grade]);
    }
  }

  const changes = [];
  for (const [student, [before, after]] of byStudent) {
    const uniqueName = before.length === 1 && after.length === 1;
    const added = after.filter(fields => {
      const match = before.findIndex(row => row.every((value, index) => value === fields[index]));
      if (match < 0) return true;
      before.splice(match, 1);
      return false;
    });
    if (uniqueName && added.length === 1) {
      const fields = added[0].map((value, index) =>
        before[0][index] === value ? value : before[0][index] + " → " + value);
      changes.push({ student, kind: "更正", fields, before: before[0], after: added[0] });
    } else {
      added.forEach(fields => changes.push({ student, kind: "新增", fields, after: fields }));
      before.forEach(fields => changes.push({ student, kind: "移除", fields, before: fields }));
    }
  }
  return changes.sort((a, b) => nameOrder.compare(a.fields[2], b.fields[2]) || nameOrder.compare(a.student, b.student));
}

function drawChanges(current, previous) {
  const summary = byId("change-summary");
  const list = byId("change-list");
  const changes = previous ? compareRenewals(previous.renewals, current.renewals) : [];
  byId("change-count").textContent = changes.length ? changes.length + " 条" : "";
  list.hidden = !changes.length;
  if (!previous) {
    summary.textContent = "这是首份实名快照，暂无可对比的上次名单。";
  } else {
    const compared = "对比 " + previous.time.slice(5, 16);
    summary.textContent = changes.length ? compared : "本轮名单无变化 · " + compared;
  }
  list.replaceChildren(...changes.map(({ student, kind, fields: [autumn, winter, grade] }) => {
    const item = document.createElement("li");
    const kindLabel = textElement("span", kind, "change-kind");
    kindLabel.dataset.kind = kind;
    const teachers = autumn === winter && kind !== "更正"
      ? "秋季及续班老师 " + autumn
      : "秋季老师 " + autumn + " · 续班老师 " + winter;
    item.append(textElement("strong", student), kindLabel, textElement("p", grade + " · " + teachers));
    return item;
  }));
}

function scheduleChart() {
  if (!chartFrame) chartFrame = requestAnimationFrame(drawChart);
}

function drawChart() {
  chartFrame = 0;
  const index = selectedIndex();
  if (index < 0) return;
  const { width, height } = chart.getBoundingClientRect();
  if (!width || !height) return;
  const ratio = window.devicePixelRatio || 1;
  chart.width = Math.round(width * ratio);
  chart.height = Math.round(height * ratio);
  const ctx = chart.getContext("2d");
  ctx.scale(ratio, ratio);
  const styles = getComputedStyle(document.documentElement);
  const color = token => styles.getPropertyValue(token).trim();
  const left = 47, right = width - 12, top = 12, bottom = height - 30;
  const isRate = metric === "rate";
  const points = snapshots.map(snapshot => {
    const { renewed, enrolled } = groupTotals(snapshot);
    return { time: Date.parse(snapshot.time.replace(" ", "T") + "+08:00"), value: isRate ? (enrolled ? 100 * renewed / enrolled : 0) : renewed };
  });
  const first = points[0].time;
  const span = points[points.length - 1].time - first;
  const max = points.reduce((value, point) => Math.max(value, point.value), 0);
  const unit = isRate ? 0.5 : 1;
  const step = Math.max(unit, Math.ceil(max / (unit * 4)) * unit);
  const x = point => span ? left + 4 + (right - left - 8) * (point.time - first) / span : (left + right) / 2;
  const y = value => bottom - value * (bottom - top - 5) / (step * 4);
  const formatValue = value => isRate ? value.toFixed(1) + "%" : numberFormat.format(value);

  ctx.font = '12px "Inter", "Microsoft YaHei UI", sans-serif';
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.strokeStyle = color("--line");
  ctx.fillStyle = color("--muted");
  for (let tick = 0; tick <= 4; tick++) {
    const value = tick * step;
    const axisY = y(value);
    ctx.beginPath();
    ctx.moveTo(left, axisY);
    ctx.lineTo(right, axisY);
    ctx.stroke();
    ctx.fillText(formatValue(value), left - 8, axisY);
  }

  const last = points.length - 1;
  const tickIndices = [0];
  const tickGap = Math.max(66, (right - left) / 5);
  for (let i = 1; i < last; i++) {
    if (x(points[i]) - x(points[tickIndices[tickIndices.length - 1]]) >= tickGap && x(points[last]) - x(points[i]) >= tickGap) tickIndices.push(i);
  }
  if (last > 0) tickIndices.push(last);
  for (const i of tickIndices) {
    ctx.textAlign = i === last && last > 0 ? "right" : i === 0 && last > 0 ? "left" : "center";
    ctx.fillText(snapshots[i].time.slice(11, 16), x(points[i]), bottom + 17);
  }

  const focus = points[index];
  ctx.save();
  ctx.strokeStyle = color("--muted");
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(x(focus), top);
  ctx.lineTo(x(focus), bottom);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = color("--accent");
  ctx.fillStyle = color("--accent");
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x(points[0]), y(points[0].value));
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(x(points[i]), y(points[i - 1].value));
    ctx.lineTo(x(points[i]), y(points[i].value));
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x(focus), y(focus.value), 4, 0, Math.PI * 2);
  ctx.fill();
  const unitLabel = isRate ? "净续班率" : "净续班人次";
  byId("chart-unit").textContent = unitLabel;
  chart.setAttribute("aria-label", "语文组" + unitLabel + "走势，所选快照 " + snapshots[index].time + "，" + formatValue(focus.value));
}

function render() {
  const index = selectedIndex();
  const snapshot = snapshots[index];
  if (!snapshot) return;
  const { enrolled, renewed } = groupTotals(snapshot);
  byId("enrolled").textContent = numberFormat.format(enrolled);
  byId("renewed").textContent = numberFormat.format(renewed);
  byId("rate").textContent = rate(renewed, enrolled);
  byId("staff-count").textContent = new Set(snapshot.staff.map(row => row[0])).size;
  const grades = [...new Set(snapshot.staff.map(row => row[1]))].sort(nameOrder.compare);
  setOptions(gradePicker, "全部年级", grades.map(grade => [grade, grade]), gradePicker.value);
  drawTeachers(snapshot);
  drawChanges(snapshot, snapshots[index - 1]);
  renderRenewalDetails(snapshots, index);
  scheduleChart();
}

function showStatus(state, message) {
  const status = byId("data-status");
  status.dataset.state = state;
  if (status.textContent !== message) status.textContent = message;
}

async function readDetailJson(url) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error("Snapshot request timed out"));
    }, 8000);
  });
  try {
    const options = { cache: "no-store" };
    if (controller) options.signal = controller.signal;
    const request = fetch(url, options).then(response => {
      if (!response.ok) throw new Error("Snapshot unavailable");
      return response.json();
    });
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timeout);
  }
}

async function refreshData() {
  if (loading) return;
  loading = true;
  refreshButton.disabled = true;
  try {
    const publishedSource = document.documentElement.dataset.detailSource;
    const data = await readDetailJson(publishedSource || "./snapshots.json");
    const next = publishedSource ? data.history : data;
    const latest = next[next.length - 1];
    if (!latest?.time || !latest.group || !Array.isArray(latest.staff) || !Array.isArray(latest.renewals)) {
      throw new Error("snapshot incomplete");
    }
    if (publishedSource) setClassSnapshot(data.classSnapshot);
    else await refreshClassSnapshots();
    if (latest.time !== snapshots[snapshots.length - 1]?.time || next.length !== snapshots.length) {
      snapshots = next;
      if (currentTime && !snapshots.some(snapshot => snapshot.time === currentTime)) currentTime = "";
      setOptions(snapshotPicker, "最新 · " + latest.time.slice(5),
        snapshots.slice(0, -1).reverse().map(snapshot => [snapshot.time, snapshot.time.slice(5)]), currentTime);
      if (!snapshotPicker.value) currentTime = "";
    }
    render();
    const latestTime = Date.parse(latest.time.replace(" ", "T") + "+08:00");
    const stale = Date.now() - latestTime > 22 * 60 * 1000;
    showStatus(stale ? "stale" : "ready",
      "最近同步 " + latest.time.slice(5, 16) + (stale ? " · 超过两轮未同步" : " · 每 10 分钟采集"));
  } catch {
    const latest = snapshots[snapshots.length - 1];
    showStatus("error", latest
      ? "暂时无法读取新快照 · 正在显示 " + latest.time.slice(5, 16) + " 的数据"
      : "暂时无法读取续班明细，请稍后刷新。");
  } finally {
    loading = false;
    refreshButton.disabled = false;
  }
}

snapshotPicker.addEventListener("change", () => {
  currentTime = snapshotPicker.value;
  render();
});
gradePicker.addEventListener("change", () => drawTeachers(snapshots[selectedIndex()]));
refreshButton.addEventListener("click", refreshData);
for (const button of metricButtons) {
  button.addEventListener("click", () => {
    metric = button.dataset.metric;
    for (const option of metricButtons) option.setAttribute("aria-pressed", String(option === button));
    scheduleChart();
  });
}
if (typeof ResizeObserver === "function") {
  new ResizeObserver(scheduleChart).observe(chart);
} else {
  window.addEventListener("resize", scheduleChart);
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshData();
});
setInterval(() => {
  if (!document.hidden) refreshData();
}, refreshInterval);
refreshData();
