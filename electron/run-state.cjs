// One authoritative run snapshot for the workbench and native game toolbar.
class RunState {
  constructor() { this.value = null; this.completed = new Set(); }
  start(project, iterations = 1, file = null, source = 'case') {
    this.completed.clear();
    const steps = (project.steps || []).map((step, index) => ({
      index, name: step.name, action: step.action, repeatTotal: step.repeat || 1,
      status: step.enabled === false ? 'skipped' : 'pending',
    }));
    this.value = {case: project.name, path: file, source, status: 'running', started: Date.now(),
      iterations, steps, current: null, completed: 0, passed: 0, failed: 0, stopped: 0,
      total: steps.filter(step => step.status !== 'skipped').reduce((sum, step) => sum + step.repeatTotal, 0) * iterations,
      error: '', reportId: null};
  }
  step(event) {
    if (!this.value || this.value.status !== 'running') return;
    const row = this.value.steps[event.index];
    if (!row) return;
    const current = {...event}; delete current.kind;
    current.started = event.status === 'running' ? Date.now() : this.value.current?.started;
    this.value.current = current;
    Object.assign(row, current);
    if (['passed', 'failed', 'stopped'].includes(event.status)) {
      const key = `${event.iteration}:${event.index}:${event.repeat}`;
      if (!this.completed.has(key)) {
        this.completed.add(key); this.value.completed++; this.value[event.status]++;
      }
    }
  }
  finish(result, directory) {
    if (!this.value || this.value.status !== 'running') return;
    for (const record of result.steps || []) this.step(record);
    this.value.status = result.status;
    this.value.error = result.error || '';
    this.value.finished = Date.now();
    this.value.reportId = directory?.split(/[\\/]/).at(-1) || null;
  }
  fail(error) {
    if (!this.value || this.value.status !== 'running') return;
    if (this.value.current?.status === 'running') {
      this.step({...this.value.current, status: 'failed', error: String(error)});
    }
    this.finish({status: 'failed', error: String(error)});
  }
  snapshot() { return this.value ? JSON.parse(JSON.stringify(this.value)) : null; }
}
module.exports = {RunState};
