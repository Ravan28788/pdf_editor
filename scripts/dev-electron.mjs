import { spawn } from 'node:child_process';
import http from 'node:http';

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const npxCmd = isWin ? 'npx.cmd' : 'npx';
const DEV_URL = 'http://127.0.0.1:5173';

function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for Vite dev server at ${url}`));
          return;
        }
        setTimeout(check, 350);
      });
    };
    check();
  });
}

const vite = spawn(npmCmd, ['run', 'dev'], {
  stdio: 'inherit',
  shell: isWin,
});

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (vite.pid && vite.exitCode === null) {
    if (isWin) {
      spawn('taskkill', ['/pid', String(vite.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      vite.kill('SIGTERM');
    }
  }
  process.exit(code);
}

vite.on('exit', (code) => {
  if (!shuttingDown && code !== null && code !== 0) {
    process.exit(code);
  }
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

try {
  await waitForServer(DEV_URL);
  const electron = spawn(npxCmd, ['--no-install', 'electron', '.'], {
    stdio: 'inherit',
    shell: isWin,
  });
  electron.on('exit', (code) => shutdown(code ?? 0));
} catch (err) {
  console.error(err);
  shutdown(1);
}
