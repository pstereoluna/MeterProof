import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const html = readFileSync('web/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
const recording = JSON.parse(readFileSync('web/replay.json', 'utf8'));

// Execute the shipped page functions with inert DOM nodes. Only automatic API
// initialization is removed: these checks never fetch or write local/cloud data.
function page() {
  const elements = new Map<string, any>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: '', textContent: '', className: '', hidden: false, dataset: {},
      classList: { toggle() {} }, addEventListener() {},
      querySelector() { return { classList: { toggle() {} } }; },
    });
    return elements.get(id)!;
  };
  const context = createContext({
    document: { getElementById: element },
    window: { location: { search: '' } }, URLSearchParams,
    fetch() { throw new Error('Display checks must not issue API requests'); },
  });
  assert.match(script, /\s+void initialize\(\);\s*$/);
  runInContext(script.replace(/\s+void initialize\(\);\s*$/, ''), context);
  return {
    element,
    run(code: string, values: Record<string, unknown> = {}) {
      Object.assign(context, values);
      return runInContext(code, context);
    },
  };
}

function largePeriod() {
  const base = structuredClone(recording.steps.at(-1).period);
  const sample = base.events[0];
  base.events = [
    ['on-large', Number.MAX_SAFE_INTEGER, 'ON_TIME'], ['on-small', 2, 'ON_TIME'],
    ['late-large', Number.MAX_SAFE_INTEGER, 'POST_CLOSE'], ['late-small', 2, 'POST_CLOSE'],
  ].map(([event_id, units, classification]) => ({ ...sample, event_id, units, amount_cents: units, classification }));
  base.latest_version = 1;
  base.snapshots = [{ ...base.snapshots[0], units: '9007199254740993', amount_cents: '9007199254740993', event_ids: ['on-large', 'on-small'] }];
  base.pending = { units: '9007199254740993', amount_cents: '9007199254740993', event_ids: ['late-large', 'late-small'] };
  base.aggregate.units = '9007199254740992';
  base.aggregate.amount_cents = '9007199254740992';
  return base;
}

test('page currency and grouping preserve cents above the safe integer range', () => {
  const ui = page();
  assert.equal(ui.run("money('9007199254740993')"), '$90,071,992,547,409.93');
  assert.equal(ui.run('money(Number.MAX_SAFE_INTEGER)'), '$90,071,992,547,409.91');
  assert.equal(ui.run("number('9007199254740993')"), '9,007,199,254,740,993');
  assert.equal(ui.run('money(750)'), '$7.50');
  assert.equal(ui.run('money(0)'), '$0.00');
  assert.equal(ui.run('money(-1)'), '-$0.01');
  assert.equal(ui.run("count('1','unit')"), '1 unit');
});

test('live summary, derivation and projection differences preserve large totals', () => {
  const ui = page();
  ui.run('period = input; render();', { input: largePeriod() });
  assert.equal(ui.element('original-value').textContent, '$90,071,992,547,409.93');
  assert.equal(ui.element('adjustment-value').textContent, '+$90,071,992,547,409.93');
  assert.equal(ui.element('event-count').textContent, '4 events · 18,014,398,509,481,986 units accepted');
  assert.match(ui.element('derivation').innerHTML, /9,007,199,254,740,993 units/);
  assert.match(ui.element('ledger-comparison').innerHTML, /1 on-time unit not yet reflected/);
  ui.run("period.aggregate.units = '9007199254740994'; renderComparison();");
  assert.match(ui.element('ledger-comparison').innerHTML, /1 unit above the on-time ledger shown/);
  ui.run("period.aggregate.units = '9007199254740993'; renderComparison();");
  assert.match(ui.element('ledger-comparison').innerHTML, /On-time totals match in this read/);
  assert.doesNotMatch(ui.element('ledger-comparison').innerHTML, /comparison-lag waiting/);
  ui.run('scenarioMode = true; render();');
  assert.equal(ui.element('adjustment-value').textContent, '+$90,071,992,547,409.93');
  ui.run("period.pending.units = '0'; period.pending.amount_cents = '0'; period.pending.event_ids = []; render();");
  assert.equal(ui.element('adjustment-value').textContent, '$0.00');
});

test('recorded acceptance scene sums safe event numbers exactly before applying the rate', () => {
  const ui = page();
  const fixture = structuredClone(recording);
  fixture.steps[0].period.events = largePeriod().events.filter((event: any) => event.classification === 'ON_TIME');
  ui.run('replay = input; renderReplayScene(replay.steps[0]);', { input: fixture });
  assert.match(ui.element('replay-scene').innerHTML, /\$90,071,992,547,409\.93/);
  assert.match(ui.element('replay-scene').innerHTML, /= 9,007,199,254,740,993 units/);
});

test('all six saved demo scenes still render their original amounts and preservation proof', () => {
  const ui = page();
  ui.run('replay = input;', { input: recording });
  for (const [index, step] of recording.steps.entries()) {
    ui.run('renderReplayScene(replay.steps[stepIndex]);', { stepIndex: index });
    const scene = ui.element('replay-scene').innerHTML;
    assert.match(scene, /\$7\.50/, step.id);
    assert.doesNotMatch(scene, /NaN|undefined/, step.id);
    if (step.id === 'late') assert.match(scene, /\+\$1\.00/);
    if (step.id === 'adjust') assert.match(scene, /\$8\.50/);
    if (step.id === 'verify') assert.match(scene, /Original preserved\./);
  }
});
