const {execFile} = require('node:child_process');

function grantForeground(bridge, root) {
  return new Promise(resolve => {
    execFile(bridge.command, ['-X', 'utf8', '-m', 'nycs_studio.foreground', String(bridge.child.pid)],
      {cwd: root, windowsHide: true, timeout: 3000, env: {...process.env, PYTHONUTF8: '1'}},
      (error, output) => {
        if (error) return resolve({granted: false});
        try {resolve(JSON.parse(output));} catch {resolve({granted: false});}
      });
  });
}

class GameHandoff {
  constructor(window, grant, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    this.window = window;
    this.grant = grant;
    this.wait = wait;
    this.pending = false;
  }
  restore() {
    if (this.window.isDestroyed()) return;
    if (this.window.isMinimized()) this.window.restore();
    this.window.show();
    this.window.focus();
  }
  async call(operation, keepMinimized = false) {
    if (this.pending) throw new Error('正在切换游戏窗口，请稍候');
    this.pending = true;
    let started = false;
    try {
      // Spawn while Electron still has foreground permission, before minimizing.
      await this.grant();
      this.window.minimize();
      await this.wait(180);
      const result = await operation();
      started = true;
      return result;
    } finally {
      this.pending = false;
      if (!keepMinimized || !started) this.restore();
    }
  }
}
module.exports = {GameHandoff, grantForeground};
