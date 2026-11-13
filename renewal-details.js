"use strict";

const detailTeacher = document.getElementById("detail-teacher");
const detailGrade = document.getElementById("detail-grade");
const detailType = document.getElementById("detail-type");
const studentRole = document.getElementById("student-role");
const studentSearch = document.getElementById("student-search");
const studentPeriod = document.getElementById("student-period");
const clearClass = document.getElementById("clear-class");

let classData;
let detailHistory = [];
let detailIndex = -1;
let chosenClass = "";
let enrollmentClasses = new Map();
let renewalClassNames = new Map();
let renewalTypes = new Map();

async function refreshClassSnapshots() {
  try {
    setClassSnapshot(await readDetailJson("./class-snapshot.json"));
  } catch {
    // Preserve the most recent verified class snapshot during a refresh failure.
  }
}

function setClassSnapshot(next) {
  if (!next?.time || !Array.isArray(next.classes) || !Array.isArray(next.renewals) || next.time === classData?.time) return;
  classData = next;
  enrollmentClasses = new Map(next.classes.map(row => [classKey(row), row]));
  renewalClassNames = new Map();
  for (const [student, teacher, grade, , type, name] of next.renewals) {
    const key = JSON.stringify([student, teacher, grade]);
    renewalClassNames.set(key, renewalClassNames.has(key) ? null : [type, name]);
  }
  renewalTypes = new Map();
  for (const [teacher, grade, type] of next.classes) {
    const key = JSON.stringify([teacher, grade]);
    const types = renewalTypes.get(key) || new Set();
    types.add(type);
    renewalTypes.set(key, types);
  }
}

function classKey(row) {
  return JSON.stringify(row.slice(0, 4));
}

function typeFor(teacher, grade) {
  const types = renewalTypes.get(JSON.stringify([teacher, grade]));
  return types?.size === 1 ? types.values().next().value : "";
}

function classFor(student, teacher, grade) {
  return renewalClassNames.get(JSON.stringify([student, teacher, grade])) || [typeFor(teacher, grade), ""];
}

function fitsDetailFilters(teacher, grade, type) {
  return (!detailTeacher.value || detailTeacher.value === teacher)
    && (!detailGrade.value || detailGrade.value === grade)
    && (!detailType.value || detailType.value === type);
}

function optionList(select, label, values) {
  const choices = [...new Set(values.filter(Boolean))].sort(nameOrder.compare);
  setOptions(select, label, choices.map(value => [value, value]), select.value);
}

function emptyTable(id, columns, message) {
  const cell = textElement("td", message, "muted");
  cell.colSpan = columns;
  const row = document.createElement("tr");
  row.append(cell);
  byId(id).replaceChildren(row);
}

function classRows(snapshot) {
  const rows = [...enrollmentClasses.values()].map(row => [...row.slice(0, 5), 0]);
  const byKey = new Map(rows.map(row => [classKey(row), row]));
  const unassigned = new Set();
  for (const [student, teacher, grade] of snapshot.renewals) {
    const [type, name] = classFor(student, teacher, grade);
    const row = byKey.get(classKey([teacher, grade, type, name]));
    if (row) row[5]++;
    else unassigned.add(JSON.stringify([teacher, grade]));
  }
  const enrollment = new Map();
  for (const [teacher, grade, , , enrolled] of rows) {
    const key = JSON.stringify([teacher, grade]);
    enrollment.set(key, (enrollment.get(key) ?? 0) + enrolled);
  }
  const complete = new Set(snapshot.staff
    .filter(([teacher, grade, enrolled]) => {
      const key = JSON.stringify([teacher, grade]);
      return enrollment.get(key) === enrolled && !unassigned.has(key);
    }).map(row => JSON.stringify(row.slice(0, 2))));
  return { rows, complete };
}

function displayClassRow(values, previous, isClass) {
  const [teacher, grade, type, name, enrolled, renewed] = values;
  const tr = document.createElement("tr");
  const title = textElement("th", name || teacher + " · " + type);
  title.scope = "row";
  if (isClass) tr.className = "class-item";
  const action = textElement("button", renewed === null ? "待核实" : numberFormat.format(renewed), "plain-button");
  action.type = "button";
  action.disabled = renewed === null;
  action.setAttribute("aria-label", title.textContent + (renewed === null ? "，净续班待核实" : "，查看 " + renewed + " 人次净续班"));
  action.addEventListener("click", () => {
    detailTeacher.value = teacher;
    detailGrade.value = grade;
    detailType.value = type;
    studentRole.value = "1";
    studentSearch.value = "";
    chosenClass = name;
    renderDetails();
    byId("student-renewals").scrollIntoView({ block: "start" });
  });
  const count = document.createElement("td");
  count.append(action);
  const delta = previous === null || renewed === null ? null : renewed - previous;
  tr.append(title, textElement("td", grade), textElement("td", numberFormat.format(enrolled)), count,
    textElement("td", renewed === null ? "—" : rate(renewed, enrolled)),
    textElement("td", delta === null ? "—" : delta > 0 ? "+" + delta : String(delta)));
  return tr;
}

function drawClassDetails(snapshot, previous) {
  const status = byId("class-status");
  if (!classData) {
    status.textContent = "";
    emptyTable("class-rows", 6, "班型明细暂不可用");
    return;
  }
  const current = classRows(snapshot);
  const old = previous ? classRows(previous) : null;
  status.textContent = "秋季班级核验 " + classData.time.slice(5, 16)
    + (current.complete.size < snapshot.staff.length ? " · 部分班级数据待核实" : "");
  const oldClass = new Map(old ? old.rows.map(row => [classKey(row), row[5]]) : []);
  const oldStaff = new Map(previous ? previous.staff.map(row => [JSON.stringify(row.slice(0, 2)), row[3]]) : []);
  const groups = new Map();
  for (const row of current.rows) {
    const [teacher, grade, type] = row;
    if (!fitsDetailFilters(teacher, grade, type)) continue;
    const key = JSON.stringify([teacher, grade, type]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  if (!groups.size) {
    emptyTable("class-rows", 6, "没有符合筛选条件的班型");
    return;
  }
  const body = byId("class-rows");
  const expanded = new Set([...body.querySelectorAll('button[data-group][aria-expanded="true"]')].map(button => button.dataset.group));
  body.replaceChildren();
  const sortedGroups = [...groups.entries()].sort((a, b) => nameOrder.compare(a[0], b[0]));
  for (const [key, rows] of sortedGroups) {
    const [teacher, grade, type] = rows[0];
    const staffKey = JSON.stringify([teacher, grade]);
    const staff = snapshot.staff.find(row => row[0] === teacher && row[1] === grade);
    const recordedEnrolled = rows.reduce((sum, row) => sum + row[4], 0);
    const singleType = staff && recordedEnrolled === staff[2] && typeFor(teacher, grade) === type;
    const enrolled = singleType && staff ? staff[2] : rows.reduce((sum, row) => sum + row[4], 0);
    const complete = current.complete.has(staffKey);
    const renewed = singleType && staff ? staff[3] : complete ? rows.reduce((sum, row) => sum + row[5], 0) : null;
    const before = singleType ? oldStaff.get(staffKey) ?? 0 : old?.complete.has(staffKey)
      ? rows.reduce((sum, row) => sum + (oldClass.get(classKey(row)) ?? 0), 0) : null;
    const parent = displayClassRow([teacher, grade, type, "", enrolled, renewed], previous ? before : null, false);
    const children = rows.sort((a, b) => nameOrder.compare(a[3], b[3])).map(row =>
      displayClassRow(complete ? row : [...row.slice(0, 5), null],
        old?.complete.has(staffKey) ? oldClass.get(classKey(row)) ?? 0 : null, true));
    const open = textElement("button", "", "plain-button class-toggle");
    open.type = "button";
    open.dataset.group = key;
    const setExpanded = value => {
      open.textContent = value ? "收起班级" : "展开 " + rows.length + " 个班级";
      open.setAttribute("aria-expanded", String(value));
      children.forEach(row => { row.hidden = !value; });
    };
    setExpanded(expanded.has(key));
    open.addEventListener("click", () => setExpanded(open.getAttribute("aria-expanded") !== "true"));
    parent.firstElementChild.append(open);
    body.append(parent, ...children);
  }
}

function drawStudentDetails(snapshot) {
  const query = studentSearch.value.trim().toLocaleLowerCase();
  const role = Number(studentRole.value);
  const rows = snapshot.renewals.map(row => [...row, ...classFor(row[0], row[1], row[2])])
    .filter(row => fitsDetailFilters(row[role], row[2], row[4])
      && (!chosenClass || chosenClass === row[5])
      && row[0].toLocaleLowerCase().includes(query))
    .sort((a, b) => nameOrder.compare(a[2], b[2]) || nameOrder.compare(a[0], b[0]));
  byId("student-count").textContent = rows.length + " 人次" + (detailTeacher.value ? " · " + detailTeacher.value : "");
  clearClass.hidden = !chosenClass;
  clearClass.textContent = chosenClass ? "清除班级筛选 · " + chosenClass : "";
  if (!rows.length) {
    emptyTable("student-rows", 5, "没有符合筛选条件的续班学员");
    return;
  }
  byId("student-rows").replaceChildren(...rows.map(([student, autumn, grade, winter, type, name]) => {
    const row = document.createElement("tr");
    const studentCell = textElement("th", student);
    studentCell.scope = "row";
    row.append(studentCell, ...[grade, [type, name].filter(Boolean).join(" · ") || "待核实", autumn, winter || "待核实"]
      .map(value => textElement("td", value)));
    return row;
  }));
}

function changeRoleMatches(fields) {
  const [autumn, winter, grade] = fields;
  const type = typeFor(autumn, grade);
  return fitsDetailFilters(autumn, grade, type) || fitsDetailFilters(winter, grade, type);
}

function drawStudentChanges(snapshot) {
  const period = studentPeriod.value;
  const end = new Date(snapshot.time.slice(0, 10) + "T00:00:00+08:00").getTime();
  const start = period === "week" ? end - 6 * 86400000 : end;
  const changes = [];
  for (let i = detailIndex; i > 0; i--) {
    const current = detailHistory[i];
    if (period === "round" && i < detailIndex || Date.parse(current.time.replace(" ", "T") + "+08:00") < start) break;
    for (const change of compareRenewals(detailHistory[i - 1].renewals, current.renewals)) {
      if ((change.before && changeRoleMatches(change.before)) || (change.after && changeRoleMatches(change.after))) {
        changes.push({ ...change, time: current.time });
      }
    }
  }
  const summary = detailIndex === 0 ? "首份实名快照，暂无上轮可对比"
    : changes.length ? changes.length + " 条" : "所选时段内没有符合筛选条件的变动";
  byId("student-change-summary").textContent = summary + (detailTeacher.value ? " · " + detailTeacher.value : "");
  byId("student-change-list").replaceChildren(...changes.map(({ student, kind, fields: [autumn, winter, grade], time }) => {
    const item = document.createElement("li");
    const tag = textElement("span", kind, "change-kind");
    tag.dataset.kind = kind;
    item.append(textElement("strong", student), tag,
      textElement("p", time.slice(5, 16) + " · " + grade + " · 秋季老师 " + autumn + " · 续班老师 " + winter));
    return item;
  }));
}

function renderDetails() {
  const snapshot = detailHistory[detailIndex];
  if (!snapshot) return;
  drawClassDetails(snapshot, detailHistory[detailIndex - 1]);
  drawStudentDetails(snapshot);
  drawStudentChanges(snapshot);
}

function renderRenewalDetails(history, index) {
  detailHistory = history;
  detailIndex = index;
  const current = history[index];
  optionList(detailTeacher, "全部老师", current.staff.map(row => row[0]).concat(current.renewals.map(row => row[3])));
  optionList(detailGrade, "全部年级", Object.keys(current.group));
  optionList(detailType, "全部班型", classData?.classes.map(row => row[2]) || []);
  renderDetails();
}

for (const filter of [detailTeacher, detailGrade, detailType, studentRole]) {
  filter.addEventListener("change", () => { chosenClass = ""; renderDetails(); });
}
studentPeriod.addEventListener("change", renderDetails);
studentSearch.addEventListener("input", () => {
  const snapshot = detailHistory[detailIndex];
  if (snapshot) drawStudentDetails(snapshot);
});
clearClass.addEventListener("click", () => { chosenClass = ""; renderDetails(); });
