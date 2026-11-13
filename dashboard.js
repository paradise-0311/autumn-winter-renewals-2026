"use strict";

const byId = id => document.getElementById(id);
const picker = byId("snapshot");
const teacherGrade = byId("teacher-grade");
const chart = byId("chart");
const buttons = [...document.querySelectorAll("[data-metric]")];
const format = new Intl.NumberFormat("zh-CN");
const nameOrder = new Intl.Collator("zh-CN");
const renewalTargetRate = 0.75;
const gradeTargets = new Map([["伴学服务 7", 313], ["伴学服务 8", 180]]);
const groupTarget = 493;
let snapshots = [];
let selected = 0;
let metric = "count";
let frame = 0;
let loading = false;

function totals(snapshot) {
  return Object.values(snapshot.grades).reduce((sum, row) => ({
    enrolled: sum.enrolled + row.enrolled,
    renewed: sum.renewed + row.renewed,
  }), { enrolled: 0, renewed: 0 });
}

function rate(renewed, enrolled) {
  return enrolled ? (100 * renewed / enrolled).toFixed(1) + "%" : "—";
}

function element(tag, value) {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}

function drawChart() {
  frame = 0;
  if (!snapshots.length) return;
  const { width, height } = chart.getBoundingClientRect();
  if (!width || !height) return;
  const ratio = window.devicePixelRatio || 1;
  chart.width = Math.round(width * ratio);
  chart.height = Math.round(height * ratio);
  const ctx = chart.getContext("2d");
  ctx.scale(ratio, ratio);
  const isRate = metric === "rate";
  const valueText = value => isRate ? value.toFixed(1) + "%" : format.format(value);
  const points = snapshots.map(snapshot => {
    const { renewed, enrolled } = totals(snapshot);
    const time = Date.parse(snapshot.time.replace(" ", "T") + "+08:00");
    return { time, value: isRate ? (enrolled ? 100 * renewed / enrolled : 0) : renewed };
  });
  const span = points[points.length - 1].time - points[0].time;
  const left = 48, right = width - 12, top = 12, bottom = height - 29;
  const unit = isRate ? 0.5 : 1;
  const step = Math.max(unit, Math.ceil(Math.max(...points.map(point => point.value)) / (unit * 4)) * unit);
  const x = point => span ? left + 4 + (right - left - 8) * (point.time - points[0].time) / span : (left + right) / 2;
  const y = value => bottom - value * (bottom - top - 5) / (step * 4);
  const styles = getComputedStyle(document.documentElement);
  const color = token => styles.getPropertyValue(token).trim();
  const line = (x1, y1, x2, y2) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  ctx.font = '12px "Inter", "Microsoft YaHei UI", sans-serif';
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.strokeStyle = color("--line");
  ctx.fillStyle = color("--muted");
  for (let tick = 0; tick <= 4; tick++) {
    const value = tick * step;
    line(left, y(value), right, y(value));
    ctx.fillText(valueText(value), left - 8, y(value));
  }
  const last = points.length - 1;
  const ticks = [0];
  for (let i = 1; i < last; i++) {
    if (x(points[i]) - x(points[ticks[ticks.length - 1]]) >= 70 && x(points[last]) - x(points[i]) >= 70) ticks.push(i);
  }
  if (last) ticks.push(last);
  ticks.forEach(i => {
    ctx.textAlign = i === last && last ? "right" : i === 0 && last ? "left" : "center";
    ctx.fillText(snapshots[i].time.slice(11, 16), x(points[i]), bottom + 16);
  });

  const focus = points[selected];
  ctx.strokeStyle = color("--muted");
  ctx.setLineDash([3, 4]);
  line(x(focus), top, x(focus), bottom);
  ctx.setLineDash([]);
  ctx.strokeStyle = ctx.fillStyle = color("--accent");
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x(points[0]), y(points[0].value));
  for (let i = 1; i <= last; i++) {
    ctx.lineTo(x(points[i]), y(points[i - 1].value));
    ctx.lineTo(x(points[i]), y(points[i].value));
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x(focus), y(focus.value), 4, 0, Math.PI * 2);
  ctx.fill();
  const unitLabel = isRate ? "净续班率" : "净续班人次";
  byId("chart-unit").textContent = unitLabel;
  chart.setAttribute("aria-label", "语文组" + unitLabel + "走势，所选快照 " + snapshots[selected].time + "，" + valueText(focus.value));
}

function scheduleChart() {
  if (!frame) frame = requestAnimationFrame(drawChart);
}

function groupTeachers(snapshot, selectedGrade = "") {
  const grouped = new Map();
  for (const { name, grade, enrolled, renewed } of snapshot.teachers || []) {
    if (selectedGrade && grade !== selectedGrade) continue;
    const teacher = grouped.get(name) || { name, enrolled: 0, renewed: 0 };
    teacher.enrolled += enrolled;
    teacher.renewed += renewed;
    grouped.set(name, teacher);
  }
  return grouped;
}

function renderTeachers(snapshot) {
  const body = byId("teacher-rows");
  const grouped = groupTeachers(snapshot, teacherGrade.value);
  const teachers = [...grouped.values()].sort((a, b) => b.renewed - a.renewed || nameOrder.compare(a.name, b.name));
  if (!teachers.length) {
    const row = document.createElement("tr");
    const cell = element("td", "该快照暂无教师数据");
    cell.colSpan = 5;
    row.append(cell);
    body.replaceChildren(row);
    return;
  }
  body.replaceChildren(...teachers.map(({ name, enrolled, renewed }) => {
    const row = document.createElement("tr");
    const heading = element("th", name);
    heading.scope = "row";
    const renewedCell = element("td", format.format(renewed));
    if (renewed) renewedCell.className = "renewed";
    row.append(heading, element("td", format.format(enrolled)), renewedCell,
      element("td", rate(renewed, enrolled)), element("td", rate(renewed, enrolled * renewalTargetRate)));
    return row;
  }));
}

function renderTeacherChanges(previous, current) {
  const section = byId("teacher-changes");
  const list = byId("teacher-change-list");
  const rows = [];
  if (previous?.teachers?.length && current.teachers?.length) {
    const before = groupTeachers(previous);
    const after = groupTeachers(current);
    for (const name of new Set([...before.keys(), ...after.keys()])) {
      const priorCount = before.get(name)?.renewed ?? 0;
      const currentCount = after.get(name)?.renewed ?? 0;
      if (priorCount !== currentCount) rows.push({ name, delta: currentCount - priorCount, priorCount, currentCount });
    }
  }
  rows.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || nameOrder.compare(a.name, b.name));
  section.hidden = rows.length === 0;
  list.replaceChildren(...rows.map(({ name, delta, priorCount, currentCount }) => {
    const item = document.createElement("li");
    const label = element("span", (delta > 0 ? "新增 " : "减少 ") + format.format(Math.abs(delta)) + " 人次");
    label.className = "change-kind";
    label.dataset.kind = delta > 0 ? "新增" : "移除";
    item.append(element("strong", name), label, element("p", format.format(priorCount) + " → " + format.format(currentCount) + " 人次"));
    return item;
  }));
  return rows.length;
}

function render() {
  const snapshot = snapshots[selected];
  const { enrolled, renewed } = totals(snapshot);
  byId("enrolled").textContent = format.format(enrolled);
  byId("renewed").textContent = format.format(renewed);
  byId("rate").textContent = rate(renewed, enrolled);
  byId("attainment").textContent = rate(renewed, groupTarget);
  byId("teacher-count").textContent = snapshot.teacherCount;
  const selectedGrade = teacherGrade.value;
  const gradeNames = Object.keys(snapshot.grades);
  teacherGrade.replaceChildren(new Option("全部年级", ""), ...gradeNames.map(grade => new Option(grade, grade)));
  teacherGrade.value = gradeNames.includes(selectedGrade) ? selectedGrade : "";
  teacherGrade.disabled = !snapshot.teachers?.length;
  renderTeachers(snapshot);
  byId("grade-rows").replaceChildren(...Object.entries(snapshot.grades).map(([grade, row]) => {
    const tr = document.createElement("tr");
    const heading = element("th", grade);
    heading.scope = "row";
    tr.append(heading, ...[format.format(row.enrolled), format.format(row.renewed),
      rate(row.renewed, row.enrolled), rate(row.renewed, gradeTargets.get(grade)),
      format.format(row.sameTeacher)].map(value => element("td", value)));
    return tr;
  }));

  const previous = snapshots[selected - 1];
  const teacherChanges = renderTeacherChanges(previous, snapshot);
  const list = byId("change-list");
  const changes = snapshot.changes;
  const hasChanges = changes && Object.values(changes).some(value => value > 0);
  byId("change-summary").textContent = previous
    ? (hasChanges || teacherChanges ? "对比 " : "本轮无变动 · 对比 ") + previous.time.slice(5, 16)
    : "首份快照";
  list.hidden = !hasChanges;
  list.replaceChildren(...(hasChanges ? [["新增", changes.added], ["移除", changes.removed], ["更正", changes.corrected]].map(([label, count]) => {
    const item = document.createElement("li");
    item.append(element("strong", label), element("span", format.format(count) + " 人次"));
    return item;
  }) : []));
  scheduleChart();
}

async function fetchSnapshots(url) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error("Snapshot request timed out"));
    }, 8000);
  });
  try {
    const request = fetch(url, {
      cache: "no-store",
      credentials: "omit",
      ...(controller ? { signal: controller.signal } : {}),
    }).then(response => {
      if (!response.ok) throw new Error("Snapshot unavailable");
      return response.json();
    });
    const data = await Promise.race([request, deadline]);
    if (!Array.isArray(data) || !data.length || !data[data.length - 1]?.time) throw new Error("Snapshot missing");
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function showSnapshots(data) {
  const latest = data[data.length - 1];
  const current = snapshots[snapshots.length - 1];
  if (current && latest.time < current.time) return;
  if (latest.time !== current?.time || data.length !== snapshots.length) {
    const previousTime = selected === snapshots.length - 1 ? null : snapshots[selected]?.time;
    snapshots = data;
    const lastIndex = snapshots.length - 1;
    const previousIndex = previousTime ? snapshots.findIndex(row => row.time === previousTime) : -1;
    selected = previousIndex >= 0 ? previousIndex : lastIndex;
    picker.replaceChildren(...snapshots.map((snapshot, index) => new Option(
      (index === lastIndex ? "最新 · " : "") + snapshot.time.slice(5), String(index)
    )).reverse());
    picker.value = String(selected);
    picker.disabled = false;
    buttons.forEach(button => { button.disabled = false; });
    render();
  }
  const status = byId("data-status");
  const message = "快照截至 " + latest.time.slice(5, 16) + "（UTC+8）";
  delete status.dataset.state;
  if (status.textContent !== message) status.textContent = message;
}

async function load() {
  if (loading) return;
  loading = true;
  const source = document.documentElement.dataset.snapshotSource;
  const urls = source ? ["./snapshots.json", source] : ["./snapshots.json"];
  try {
    const results = await Promise.all(urls.map(async url => {
      try {
        showSnapshots(await fetchSnapshots(url));
        return true;
      } catch {
        return false;
      }
    }));
    if (results.some(Boolean)) return;
    const status = byId("data-status");
    const latest = snapshots[snapshots.length - 1];
    status.dataset.state = "error";
    if (latest) {
      status.textContent = "暂时无法读取新快照 · 上次同步 " + latest.time.slice(5, 16) + "（UTC+8）";
    } else {
      status.textContent = "暂时无法读取快照，网页会自动重试。";
      byId("change-summary").textContent = "快照暂不可用";
      byId("grade-rows").querySelector("td").textContent = "快照暂不可用";
      byId("teacher-rows").querySelector("td").textContent = "快照暂不可用";
    }
  } finally {
    loading = false;
  }
}

picker.addEventListener("change", () => {
  selected = Number(picker.value);
  render();
});
teacherGrade.addEventListener("change", () => renderTeachers(snapshots[selected]));
for (const button of buttons) {
  button.addEventListener("click", () => {
    metric = button.dataset.metric;
    buttons.forEach(option => option.setAttribute("aria-pressed", String(option === button)));
    scheduleChart();
  });
}
if (typeof ResizeObserver === "function") {
  new ResizeObserver(scheduleChart).observe(chart);
} else {
  window.addEventListener("resize", scheduleChart);
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
});
setInterval(() => {
  if (!document.hidden) load();
}, 30_000);
load();
