import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'app.js'), 'utf8');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
function fn(name) {
  const start = source.indexOf(`  function ${name}(`); assert(start >= 0, name);
  const end = source.indexOf('\n  function ', start + 1);
  return source.slice(start, end < 0 ? source.length : end);
}
const minimumDeclaration = source.match(/  const MIN_DEVIATION_KWH = [^;]+;/)?.[0];
assert(minimumDeclaration, 'Use the production comparison minimum');
function control() {
  const classes = new Set();
  return { value: '', textContent: '', innerHTML: '', checked: false, disabled: false,
    required: false, open: false, showModal() { this.open = true; },
    classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); } } };
}
const uiNames = ['utilityHistoryTitle', 'utilityHistoryContent', 'utilityHistoryDialog',
  'utilityEntryTitle', 'utilityKindFinal', 'utilityKindIntermediate', 'utilityTimeExact',
  'utilityTimeEstimated', 'utilityTimeField', 'utilityDateInput', 'utilityTimeInput',
  'utilityZInput', 'utilityZ1Input', 'utilityZ2Input', 'utilityStepType', 'utilityStepDate',
  'utilityStepTime', 'utilityStepReading', 'utilityStepConfirm', 'utilityStepLabel',
  'monoReadingFields', 'dualReadingFields', 'utilityTariffLabel', 'utilityEntryDialog',
  'utilityConfirmSummary'];
const ui = Object.fromEntries(uiNames.map(name => [name, control()]));
for (const name of uiNames) assert(html.includes(`id="${name}"`), `Real HTML control ${name}`);
const ctx = vm.createContext({ utilityHistoryRows: [], adminTargetId: 'test',
  editingUtilityId: null, utilityEntryStep: 0,
  devices: new Map([['test', { state: { dual_zone: true, firmware: '4.00' } }]]), ui,
  showToast(message) { ctx.lastMessage = message; },
  setAdminStatus(message) { ctx.lastMessage = message; } });
vm.runInContext(minimumDeclaration + '\n' + [
  'escapeHtml', 'formatNumber', 'firmwareAtLeast', 'utilitySortTime', 'parseUtilityHistoryRows',
  'utilityDeviationResult', 'utilityDeviation', 'deviationText', 'utilityDeviationCell',
  'utilityInternalCounterCell', 'utilityPointLabel', 'formatUtilityDate', 'utilityDateTimeLabel',
  'utilityKindBadge', 'utilityCanDelete', 'utilityActionButtons', 'renderUtilityHistory',
  'utilityLocalTimeParts', 'localDateInputValue', 'localTimeInputValue', 'utilityCurrentDual',
  'utilityKindValue', 'resetUtilityEditor', 'utilityEntrySteps', 'utilityEntryAdjacentStep',
  'updateUtilityTimeMode', 'setUtilityEntryStep', 'updateUtilityReadingMode', 'openUtilityEntry',
  'utilityStepValid', 'readUtilityForm', 'prepareUtilityConfirmation'
].map(fn).join('\n'), ctx);
assert.equal(vm.runInContext('MIN_DEVIATION_KWH', ctx), 1.0);
const call = (name, ...args) => ctx[name](...args);
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-7, `${actual} vs ${expected}`);
const header = 'ID,Date,Mode,Kind,Z,Z1,Z2,TimeToken,Mapped,Anchor,AnchorZ1,AnchorZ2,EKFlags,PredictedWh,ActualWh,CanDelete,NetSnapshot,PointEpoch,PointSource,InternalImport,InternalExport,Z1Import,Z1Export,Z2Import,Z2Export,Generation,SampleEpoch';

// Official values/times are the user's readings. Internal counters below are
// synthetic replay inputs, deliberately matching the signed official deltas.
const startEpoch = Date.parse('2026-10-03T17:45:00+03:00') / 1000;
const endEpoch = Date.parse('2026-10-04T20:46:32+03:00') / 1000;
const rows = call('parseUtilityHistoryRows', [header,
  `2,2026-10-04,dual,ek,0,94817.10,28083.80,20:46,1,115,63.7,51.3,15,-29900,-29900,1,1,${endEpoch},1,115,64.9,63.7,20,51.3,44.9,1,${endEpoch}`,
  `1,2026-10-03,dual,tk,0,94823.40,28107.40,17:45,1,100,60,40,0,0,0,1,0,${startEpoch},1,100,20,60,10,40,10,1,${startEpoch}`
]);
assert.equal(rows.map(row => row.id).join(','), '1,2');
near(rows[1].z1 - rows[0].z1, -6.3); near(rows[1].z2 - rows[0].z2, -23.6);
assert.equal(rows[1].netSnapshot, true); assert.equal(rows[1].sampleEpoch, endEpoch);
assert.equal(call('utilityDeviation', rows[0], rows[1]), 0);
const raw = call('utilityDeviationResult', rows[0], { ...rows[1], netSnapshot: false });
near(raw.actualKwh, -29.9); near(raw.espKwh, -29.9); near(raw.value, 0);
assert.equal(call('utilityDeviation', null, rows[1]), 0);
assert.equal(call('utilityDeviation', { z: 999 }, rows[1]), 0);
near(call('utilityDeviation', null, { ...rows[1], predictedWh: -30000 }), -100 / 299);
near(call('utilityDeviation', null, { ...rows[1], predictedWh: 2000, actualWh: 1500 }), 100 / 3);
assert.equal(call('utilityDeviation', null, { ...rows[1], predictedWh: 0, actualWh: 1000 }), -100);
assert.equal(call('utilityDeviation', null, { ...rows[1], predictedWh: 0, actualWh: -1000 }), 100);
assert.equal(call('utilityDeviation', null, { ...rows[1], actualWh: -999 }), null);
assert.equal(call('utilityDeviation', null, { ...rows[1], actualWh: 999 }), null);
assert.equal(call('utilityDeviation', null, { ...rows[1], actualWh: 0 }), null);
assert.equal(call('utilityDeviation', null, { ...rows[1], predictedWh: NaN }), null);
assert.match(call('utilityDeviationResult', null, { ...rows[1], ekFlags: 5 }).reason, /Δεν υπάρχει πλήρης βάση/);
assert.match(call('utilityDeviationResult', null, { ...rows[1], ekFlags: 13 }).reason, /Μηδενικό/);
assert.match(call('utilityDeviationResult', rows[0], { ...rows[1], netSnapshot: false, generation: 2 }).reason, /Διακοπή συνέχειας/);
assert.equal(call('utilityDeviation', rows[0], { ...rows[1], netSnapshot: false, pointEpoch: startEpoch - 1 }), null);
assert.equal(call('utilityDeviation', rows[0], { ...rows[1], netSnapshot: false, z1Import: 59 }), null);
assert.equal(call('utilityDeviation', rows[0], { ...rows[1], netSnapshot: false, z2Export: NaN }), null);
assert.equal(call('utilityDeviation', { ...rows[0], mode: 'mono' }, { ...rows[1], netSnapshot: false }), null);
const measurementOnly = call('utilityDeviationResult', null, rows[0]);
assert.equal(measurementOnly.value, null);
assert.match(measurementOnly.reason, /Μέτρηση ΔΕΗ/);

const legacy = call('parseUtilityHistoryRows', [
  '1,2026-10-03,mono,tk,100,0,0,10:00,1,10,0,0',
  '2,2026-10-04,mono,ek,101.5,0,0,11:00,1,12,0,0,15,2000,1500,1'
]);
assert.equal(legacy[1].netSnapshot, false);
assert.equal(call('utilityDeviation', legacy[0], legacy[1]), null);
assert.match(call('utilityDeviationResult', legacy[0], legacy[1]).reason, /πλήρεις εσωτερικοί μετρητές/);
const oldCell = call('utilityInternalCounterCell', legacy[1], 'z');
assert.match(oldCell, /<b>—<\/b>/); assert(!oldCell.includes('12,000'));
const measurementCell = call('utilityInternalCounterCell', rows[0], 'z1');
assert.match(measurementCell, /<b>—<\/b>/);
const old = call('parseUtilityHistoryRows', ['1,2026-10-04,mono,100,0,0,window']);
assert.equal(old[0].kind, 'tk'); assert(!old[0].mapped);
const invalidMetadata = { ...rows[1], pointSource: 0, netSnapshot: false, internalImport: 0, internalExport: 0 };
assert.equal(call('utilityDeviation', rows[0], invalidMetadata), null);
assert.match(call('utilityInternalCounterCell', invalidMetadata, 'z'), /<b>—<\/b>/);

ctx.utilityHistoryRows = rows;
assert.match(call('utilityInternalCounterCell', rows[1], 'z1'), /<b>43,700<\/b>/);
assert.match(call('utilityInternalCounterCell', rows[1], 'z2'), /<b>6,400<\/b>/);
assert(!call('utilityInternalCounterCell', rows[1], 'z1').includes('63,700'));
assert(!call('utilityInternalCounterCell', rows[1], 'z2').includes('44,900'));
assert.match(call('utilityPointLabel', rows[1]), /Ακριβές δείγμα ESP · 20:46:32/);
assert.match(call('utilityPointLabel', rows[0]), /Μέτρηση ΔΕΗ/);
assert.match(call('utilityPointLabel', { ...rows[1], pointSource: 4 }), /08:00–18:00/);
assert.match(call('utilityPointLabel', { ...rows[1], pointSource: 2 }), /Παρεμβολή/);
assert.match(call('utilityPointLabel', { ...rows[1], pointSource: 3 }), /Κοντινό/);
call('renderUtilityHistory', 'test');
let rendered = ui.utilityHistoryContent.innerHTML;
assert.match(rendered, /ESP Ζ1 \(Ι−Ε\)/); assert.match(rendered, /ESP Ζ2 \(Ι−Ε\)/);
assert.match(rendered, /−|\-29,900/); assert.match(rendered, /0,00%/);
assert.equal((rendered.match(/class="utility-internal-cell"/g) || []).length, 4);
assert.equal((rendered.match(/<th[ >]/g) || []).length, 12);
for (const bodyRow of rendered.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)) {
  for (const tr of bodyRow[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) assert.equal((tr[1].match(/<td[ >]/g) || []).length, 12);
}
assert(call('utilityCanDelete', rows[0])); assert(call('utilityCanDelete', rows[1]));
ctx.utilityHistoryRows = [...rows, { ...rows[1], id: 3, date: '2026-10-02', canDelete: true }];
assert(!call('utilityCanDelete', rows[1])); assert(call('utilityCanDelete', ctx.utilityHistoryRows[2]));
assert.match(call('utilityActionButtons', rows[1], 'dual', '4.00'), /disabled title=/);
assert.match(call('utilityActionButtons', rows[1], 'dual', '4.00'), /data-utility-action="edit"[^>]*>/);
ctx.devices.set('test', { state: { firmware: '4.00' } });
const monoStart = { ...rows[0], mode: 'mono', z: 100 };
const monoEnd = { ...rows[1], mode: 'mono', z: 70.1, netSnapshot: false };
ctx.utilityHistoryRows = [monoStart, monoEnd];
near(call('utilityDeviation', monoStart, monoEnd), 0);
call('renderUtilityHistory', 'test');
rendered = ui.utilityHistoryContent.innerHTML;
assert.match(rendered, /ESP Ζ \(Ι−Ε\)/); assert.match(rendered, /0,00%/);
assert.equal((rendered.match(/<th[ >]/g) || []).length, 8);

// Indication DEH is the default: no date/time steps; ESP stamps it now.
call('resetUtilityEditor');
assert.equal(ui.utilityKindIntermediate.checked, true);
assert.equal(ui.utilityKindFinal.checked, false);
ui.utilityKindFinal.checked = false; ui.utilityKindIntermediate.checked = true;
ui.utilityDateInput.value = ''; ui.utilityTimeInput.value = ''; ui.utilityZInput.value = '70.10';
assert.equal(call('utilityEntrySteps').join(','), '0,3,4');
assert.equal(call('utilityEntryAdjacentStep', 1), 3);
call('setUtilityEntryStep', 3);
assert.equal(ui.utilityStepLabel.textContent, 'Βήμα 2 από 3');
assert(ui.utilityStepDate.classList.contains('hidden')); assert(ui.utilityStepTime.classList.contains('hidden'));
assert.equal(call('utilityEntryAdjacentStep', -1), 0); assert.equal(call('utilityEntryAdjacentStep', 1), 4);
const ek = call('readUtilityForm');
assert.equal(ek.commandTail, 'ek|mono|now|now|70.10'); assert(ek.automaticTime);
assert(call('prepareUtilityConfirmation')); assert.match(ui.utilityConfirmSummary.innerHTML, /από τον ESP/);
ctx.devices.get('test').state.firmware = '3.99';
assert.equal(call('readUtilityForm'), null); assert.match(ctx.lastMessage, /v3.15/);
ctx.devices.get('test').state.firmware = '4.00';

// Measurement DEH explicitly selects its historical date and optional time.
call('resetUtilityEditor');
ui.utilityKindIntermediate.checked = false;
ui.utilityKindFinal.checked = true;
ui.utilityDateInput.value = '2026-10-03'; ui.utilityZInput.value = '100';
assert.equal(call('utilityEntrySteps').join(','), '0,1,2,3,4');
assert(ui.utilityTimeEstimated.checked); assert(ui.utilityTimeInput.disabled);
assert.equal(call('readUtilityForm').commandTail, 'tk|mono|2026-10-03|window|100.00');
assert(call('utilityStepValid', 2));
ui.utilityTimeEstimated.checked = false; ui.utilityTimeExact.checked = true; call('updateUtilityTimeMode');
assert(!ui.utilityTimeInput.disabled); assert(ui.utilityTimeInput.required);
assert(!call('utilityStepValid', 2)); assert.equal(call('readUtilityForm'), null);
ui.utilityTimeInput.value = '17:45'; assert(call('utilityStepValid', 2));
assert.equal(call('readUtilityForm').commandTail, 'tk|mono|2026-10-03|17:45|100.00');
assert(call('prepareUtilityConfirmation')); assert.match(ui.utilityConfirmSummary.innerHTML, /17:45/);
ui.utilityTimeInput.value = '24:00'; assert.equal(call('readUtilityForm'), null);
assert.equal(call('localDateInputValue', new Date('2026-10-04T21:02:00Z')), '2026-10-05');
assert.equal(call('localTimeInputValue', new Date('2026-10-04T21:02:00Z')), '00:02');

// Value-only E.K. editing keeps the original source timestamp and kind.
call('openUtilityEntry', monoEnd);
assert.equal(ctx.editingUtilityId, 2); assert(ui.utilityKindFinal.disabled && ui.utilityKindIntermediate.disabled);
assert.equal(call('readUtilityForm').commandTail, 'ek|mono|2026-10-04|20:46|70.10');
assert(!call('readUtilityForm').automaticTime);
ctx.devices.get('test').state.dual_zone = true;
call('openUtilityEntry', rows[1]);
assert.equal(call('readUtilityForm').commandTail, 'ek|dual|2026-10-04|20:46|94817.10|28083.80');

// Bootstrap the unmodified application against the real document's controls.
// This catches missing IDs or event bindings outside the extracted unit functions.
const dom = new Map();
function addIds(markup) {
  for (const match of markup.matchAll(/\bid="([^"]+)"/g)) {
    if (!dom.has(match[1])) {
      const node = control(); node.handlers = new Map();
      node.addEventListener = (event, handler) => node.handlers.set(event, handler);
      node.insertAdjacentElement = (_where, child) => addIds(child.innerHTML);
      dom.set(match[1], node);
    }
  }
}
addIds(html);
const footer = [control(), control()];
vm.runInNewContext(source, {
  document: { getElementById: id => dom.get(id) || null,
    createElement: () => control(), querySelectorAll: () => footer,
    addEventListener() {} },
  window: { addEventListener() {} }, navigator: {},
  localStorage: { getItem: () => null }, setTimeout: () => 1, console
});
assert.equal(footer[0].textContent, 'MQTT.app. v2.10');
assert.equal(dom.get('brokerStatus').textContent, 'Αποσυνδεδεμένο');
assert(dom.get('utilityTimeExact').handlers.has('change'));
assert(dom.get('utilityTimeEstimated').handlers.has('change'));
assert(dom.get('utilityEntryDialog').handlers.has('click'));
console.log('PASS: signed PV replay (synthetic), frozen and matched net comparisons, missing/legacy/continuity guards, absolute I/E table, E.K./T.K. wizard, Athens rollover and timestamp-preserving edits');

assert(html.includes('Καταχώρηση Ένδειξης Μετρητή ΔΕΗ'));
assert(html.includes('Καταχώρηση Μέτρησης ΔΕΗ'));
