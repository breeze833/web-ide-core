// Single-Line ANSI Terminal Progress Bar & Braille Spinner for Environment Boot

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class BootProgress {
  constructor(terminal, options = {}) {
    this.terminal = terminal;
    this.noticePrefix = options.noticePrefix || 'Notice';
    this.frameIdx = 0;
    this.currentLabel = '';
    this.currentPct = null;
    this.currentDetail = '';
    this.timer = null;
    this.isFinished = false;
  }

  _startSpinner() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.isFinished && this.currentLabel) {
        this.frameIdx = (this.frameIdx + 1) % SPINNER_FRAMES.length;
        this._render();
      }
    }, 80);
  }

  _stopSpinner() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  _render() {
    if (!this.terminal || this.isFinished) return;
    const spinner = SPINNER_FRAMES[this.frameIdx];
    let bar = '';
    if (typeof this.currentPct === 'number' && !Number.isNaN(this.currentPct)) {
      const pct = Math.max(0, Math.min(100, Math.round(this.currentPct)));
      const barLen = 14;
      const filled = Math.round((pct / 100) * barLen);
      const empty = barLen - filled;
      bar = ` \x1b[36m[\x1b[1;32m${'█'.repeat(filled)}\x1b[90m${'░'.repeat(empty)}\x1b[36m]\x1b[0m ${pct}%`;
    }
    const detail = this.currentDetail ? ` \x1b[90m(${this.currentDetail})\x1b[0m` : '';
    this.terminal.write(`\r\x1b[K\x1b[36m${spinner}\x1b[0m ${this.currentLabel}...${bar}${detail}`);
  }

  start(label) {
    if (this.isFinished) return;
    this.currentLabel = label;
    this.currentPct = null;
    this.currentDetail = '';
    this._startSpinner();
    this._render();
  }

  update(percent, detail = '') {
    if (this.isFinished) return;
    this.currentPct = percent;
    if (detail) {
      this.currentDetail = detail;
    }
    this._render();
  }

  completeCurrent(detail = '') {
    if (this.isFinished || !this.currentLabel) return;
    const info = detail ? ` \x1b[90m(${detail})\x1b[0m` : '';
    this.terminal.write(`\r\x1b[K\x1b[32m✓\x1b[0m ${this.currentLabel}${info}\r\n`);
    this.currentLabel = '';
    this.currentPct = null;
    this.currentDetail = '';
  }

  fail(detail = '') {
    this._stopSpinner();
    if (!this.terminal) return;
    if (this.currentLabel) {
      this.terminal.write(`\r\x1b[K\x1b[33m!\x1b[0m ${this.currentLabel} (${detail || 'warning'})\r\n`);
      this.currentLabel = '';
    } else if (detail) {
      this.terminal.write(`\r\x1b[K\x1b[33m${this.noticePrefix}: ${detail}\x1b[0m\r\n`);
    }
  }

  finish(welcomeText = '') {
    if (this.isFinished) return;
    this.isFinished = true;
    this._stopSpinner();
    if (!this.terminal) return;
    this.terminal.write('\r\x1b[K');
    if (welcomeText) {
      this.terminal.write(welcomeText);
    }
  }
}
