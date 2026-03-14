require('dotenv').config();

const express = require('express');
const http = require('http');
const os = require('os');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const WS_INTERVAL_MS = 1500;
const PING_TARGET = process.env.PING_TARGET || '1.1.1.1';

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

function execCmd(command, args = [], timeout = 2000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, stdout: '', stderr: stderr || error.message });
        return;
      }
      resolve({ ok: true, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function safeNumber(value, fallback = null) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatBytes(bytes, fractionDigits = 2) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'N/A';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(fractionDigits)} ${units[idx]}`;
}

function formatUptime(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return 'N/A';
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor((totalSeconds / 3600) % 24);
  const days = Math.floor(totalSeconds / 86400);
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function relativeSeen(lastSeenIso) {
  if (!lastSeenIso) return 'N/A';
  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(lastSeenIso).getTime()) / 1000));
  if (diffSeconds === 0) return '0s ago';
  return `last seen ${diffSeconds}s ago`;
}

function parseProcStatLine(line) {
  const parts = line.trim().split(/\s+/);
  if (!parts[0] || parts[0] !== 'cpu') return null;
  const values = parts.slice(1).map((v) => Number(v));
  if (values.some((v) => !Number.isFinite(v))) return null;
  const idle = (values[3] || 0) + (values[4] || 0);
  const total = values.reduce((sum, cur) => sum + cur, 0);
  return { idle, total };
}

const monitorState = {
  cpuPrev: null,
  netPrev: null,
  diskIoPrev: null,
  lastSeenAt: null,
};

async function getCpuUsagePercent() {
  try {
    const statRaw = await fs.readFile('/proc/stat', 'utf8');
    const line = statRaw.split('\n')[0] || '';
    const nowSample = parseProcStatLine(line);
    if (!nowSample) return null;

    if (!monitorState.cpuPrev) {
      monitorState.cpuPrev = nowSample;
      return null;
    }

    const idleDiff = nowSample.idle - monitorState.cpuPrev.idle;
    const totalDiff = nowSample.total - monitorState.cpuPrev.total;
    monitorState.cpuPrev = nowSample;

    if (totalDiff <= 0) return null;
    const usage = (1 - idleDiff / totalDiff) * 100;
    return Number(Math.min(100, Math.max(0, usage)).toFixed(2));
  } catch {
    return null;
  }
}

async function getMemoryInfo() {
  try {
    const memRaw = await fs.readFile('/proc/meminfo', 'utf8');
    const lines = memRaw.split('\n');
    const mem = {};
    for (const line of lines) {
      const match = line.match(/^(\w+):\s+(\d+)\s+kB$/);
      if (!match) continue;
      mem[match[1]] = Number(match[2]) * 1024;
    }
    const total = mem.MemTotal;
    const available = mem.MemAvailable;
    if (!total || !available) return null;
    const used = total - available;
    const percent = (used / total) * 100;
    return {
      percent: Number(percent.toFixed(2)),
      usedBytes: used,
      totalBytes: total,
      usedText: `${formatBytes(used)} / ${formatBytes(total)}`,
    };
  } catch {
    return null;
  }
}

async function getTemperatureCelsius() {
  try {
    const zones = await fs.readdir('/sys/class/thermal');
    const thermalZones = zones.filter((name) => name.startsWith('thermal_zone'));
    for (const zone of thermalZones) {
      try {
        const tempRaw = await fs.readFile(`/sys/class/thermal/${zone}/temp`, 'utf8');
        const tempMilli = Number(tempRaw.trim());
        if (!Number.isFinite(tempMilli)) continue;
        if (tempMilli <= 0) continue;
        const c = tempMilli > 1000 ? tempMilli / 1000 : tempMilli;
        return Number(c.toFixed(1));
      } catch {
        continue;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function getZramInfo() {
  const fallback = {
    percent: null,
    usedBytes: null,
    totalBytes: null,
    text: 'N/A',
  };

  try {
    const disksizeRaw = await fs.readFile('/sys/block/zram0/disksize', 'utf8');
    const mmStatRaw = await fs.readFile('/sys/block/zram0/mm_stat', 'utf8');
    const totalBytes = safeNumber(disksizeRaw.trim(), null);
    const mmFields = mmStatRaw.trim().split(/\s+/).map((v) => Number(v));
    const usedBytes = Number.isFinite(mmFields[0]) ? mmFields[0] : null;
    if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(usedBytes) || usedBytes < 0) {
      return fallback;
    }
    const percent = Number(((usedBytes / totalBytes) * 100).toFixed(2));
    return {
      percent,
      usedBytes,
      totalBytes,
      text: `${formatBytes(usedBytes)} / ${formatBytes(totalBytes)}`,
    };
  } catch {
    return fallback;
  }
}

async function getPingMs() {
  const res = await execCmd('ping', ['-c', '1', '-W', '1', PING_TARGET], 1800);
  if (!res.ok) return null;
  const match = res.stdout.match(/time=([\d.]+)\s*ms/);
  return match ? Number(Number(match[1]).toFixed(2)) : null;
}

async function getNetworkStats() {
  try {
    const content = await fs.readFile('/proc/net/dev', 'utf8');
    const rows = content.split('\n').slice(2).map((line) => line.trim()).filter(Boolean);

    let rxTotal = 0;
    let txTotal = 0;

    for (const row of rows) {
      const [namePart, dataPart] = row.split(':');
      if (!namePart || !dataPart) continue;
      const iface = namePart.trim();
      if (iface === 'lo') continue;
      const cols = dataPart.trim().split(/\s+/);
      const rx = Number(cols[0]);
      const tx = Number(cols[8]);
      if (Number.isFinite(rx)) rxTotal += rx;
      if (Number.isFinite(tx)) txTotal += tx;
    }

    const now = Date.now();
    let rxSpeed = null;
    let txSpeed = null;

    if (monitorState.netPrev) {
      const dt = (now - monitorState.netPrev.ts) / 1000;
      if (dt > 0) {
        rxSpeed = (rxTotal - monitorState.netPrev.rxTotal) / dt;
        txSpeed = (txTotal - monitorState.netPrev.txTotal) / dt;
      }
    }

    monitorState.netPrev = { ts: now, rxTotal, txTotal };

    return {
      downloadPerSec: rxSpeed,
      uploadPerSec: txSpeed,
      totalDownload: rxTotal,
      totalUpload: txTotal,
      downloadText: rxSpeed == null ? 'N/A' : `${formatBytes(Math.max(0, rxSpeed))}/s`,
      uploadText: txSpeed == null ? 'N/A' : `${formatBytes(Math.max(0, txSpeed))}/s`,
      totalDownloadText: formatBytes(rxTotal),
      totalUploadText: formatBytes(txTotal),
    };
  } catch {
    return {
      downloadPerSec: null,
      uploadPerSec: null,
      totalDownload: null,
      totalUpload: null,
      downloadText: 'N/A',
      uploadText: 'N/A',
      totalDownloadText: 'N/A',
      totalUploadText: 'N/A',
    };
  }
}

function parseDfMap(dfStdout) {
  const lines = dfStdout.split('\n').slice(1).map((line) => line.trim()).filter(Boolean);
  const map = {};
  for (const line of lines) {
    const m = line.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(\S+)$/);
    if (!m) continue;
    map[m[6]] = {
      filesystem: m[1],
      total: Number(m[2]),
      used: Number(m[3]),
      avail: Number(m[4]),
      percent: Number(m[5]),
      mountpoint: m[6],
    };
  }
  return map;
}

function emptyDiskIo() {
  return {
    readPerSec: null,
    writePerSec: null,
    totalReadBytes: null,
    totalWriteBytes: null,
    readPerSecText: 'N/A',
    writePerSecText: 'N/A',
    totalReadText: 'N/A',
    totalWriteText: 'N/A',
  };
}

function buildDiskIo(ioMap, devName) {
  const row = ioMap[devName];
  if (!row) return emptyDiskIo();

  return {
    readPerSec: row.readPerSec,
    writePerSec: row.writePerSec,
    totalReadBytes: row.totalReadBytes,
    totalWriteBytes: row.totalWriteBytes,
    readPerSecText: row.readPerSec == null ? 'N/A' : `${formatBytes(Math.max(0, row.readPerSec))}/s`,
    writePerSecText: row.writePerSec == null ? 'N/A' : `${formatBytes(Math.max(0, row.writePerSec))}/s`,
    totalReadText: row.totalReadBytes == null ? 'N/A' : formatBytes(Math.max(0, row.totalReadBytes)),
    totalWriteText: row.totalWriteBytes == null ? 'N/A' : formatBytes(Math.max(0, row.totalWriteBytes)),
  };
}

function pickDiskIo(ioMap, primaryName, fallbackName) {
  if (primaryName && ioMap[primaryName]) return buildDiskIo(ioMap, primaryName);
  if (fallbackName && ioMap[fallbackName]) return buildDiskIo(ioMap, fallbackName);
  return emptyDiskIo();
}

async function getDiskIoMap() {
  try {
    const raw = await fs.readFile('/proc/diskstats', 'utf8');
    const now = Date.now();
    const current = {};
    const sectorSize = 512;

    for (const line of raw.split('\n')) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 14) continue;
      const name = cols[2];
      const readsCompleted = Number(cols[3]);
      const sectorsRead = Number(cols[5]);
      const writesCompleted = Number(cols[7]);
      const sectorsWritten = Number(cols[9]);

      if (!Number.isFinite(readsCompleted) || !Number.isFinite(sectorsRead)) continue;
      if (!Number.isFinite(writesCompleted) || !Number.isFinite(sectorsWritten)) continue;

      current[name] = {
        ts: now,
        sectorsRead,
        sectorsWritten,
      };
    }

    const prev = monitorState.diskIoPrev;
    const output = {};

    for (const [name, cur] of Object.entries(current)) {
      const totalReadBytes = cur.sectorsRead * sectorSize;
      const totalWriteBytes = cur.sectorsWritten * sectorSize;
      let readPerSec = null;
      let writePerSec = null;

      if (prev && prev[name]) {
        const dt = (cur.ts - prev[name].ts) / 1000;
        if (dt > 0) {
          readPerSec = ((cur.sectorsRead - prev[name].sectorsRead) * sectorSize) / dt;
          writePerSec = ((cur.sectorsWritten - prev[name].sectorsWritten) * sectorSize) / dt;
        }
      }

      output[name] = {
        readPerSec,
        writePerSec,
        totalReadBytes,
        totalWriteBytes,
      };
    }

    monitorState.diskIoPrev = current;
    return output;
  } catch {
    return {};
  }
}

function parseLsblkPairs(stdout) {
  const rows = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const obj = {};
    const re = /(\w+)="([^"]*)"/g;
    let match;
    while ((match = re.exec(trimmed)) !== null) {
      obj[match[1]] = match[2];
    }
    rows.push(obj);
  }
  return rows;
}

function classifyDisk(name, meta) {
  const nm = (name || '').toLowerCase();
  const rm = Number(meta.RM || 0);
  const rota = Number(meta.ROTA || 1);
  if (nm.startsWith('mmcblk')) return 'mmc';
  if (rm === 1) return 'sdcard';
  if (rota === 0) return 'ssd';
  return 'system';
}

function emptyDiskCard(type) {
  const labelByType = {
    mmc: 'MMC',
    sdcard: 'SD Card',
    ssd: 'SSD',
  };
  return {
    type,
    label: labelByType[type],
    name: 'N/A',
    percent: null,
    usedBytes: null,
    totalBytes: null,
    detailText: 'N/A',
    mountpoint: null,
    mounted: false,
    available: false,
    io: emptyDiskIo(),
  };
}

async function getDiskUsageInfo() {
  const base = {
    mmc: emptyDiskCard('mmc'),
    sdcard: emptyDiskCard('sdcard'),
    ssd: emptyDiskCard('ssd'),
  };

  const [dfRes, lsblkRes, ioMap] = await Promise.all([
    execCmd('df', ['-B1', '-P'], 2500),
    execCmd('lsblk', ['-P', '-b', '-o', 'NAME,SIZE,TYPE,MOUNTPOINT,RM,ROTA,PKNAME'], 2500),
    getDiskIoMap(),
  ]);

  if (!lsblkRes.ok) return Object.values(base);

  const dfMap = dfRes.ok ? parseDfMap(dfRes.stdout) : {};
  const rows = parseLsblkPairs(lsblkRes.stdout);
  const diskRows = rows.filter((r) => r.TYPE === 'disk');

  const diskByName = {};
  for (const row of diskRows) diskByName[row.NAME] = row;

  const candidates = {
    mmc: [],
    sdcard: [],
    ssd: [],
  };

  for (const row of rows) {
    const mountpoint = row.MOUNTPOINT || '';
    if (!mountpoint || row.TYPE === 'disk') continue;

    const parentName = row.PKNAME || row.NAME;
    const parentMeta = diskByName[parentName] || row;
    const diskType = classifyDisk(parentName, parentMeta);
    const slotType = diskType === 'system' ? 'ssd' : diskType;

    const df = dfMap[mountpoint];
    const usedBytes = df ? df.used : safeNumber(row.SIZE, null);
    const totalBytes = df ? df.total : safeNumber(row.SIZE, null);
    const percent = df ? df.percent : null;

    let score = 100;
    if (mountpoint === '/') score = 300;
    else if (mountpoint.startsWith('/mnt')) score = 250;
    else if (mountpoint.startsWith('/media')) score = 220;
    else if (mountpoint.startsWith('/boot')) score = 50;

    candidates[slotType].push({
      score,
      name: `/dev/${row.NAME}`,
      rowName: row.NAME,
      parentName,
      percent,
      usedBytes,
      totalBytes,
      mountpoint,
      isSystemLike: diskType === 'system',
    });
  }

  for (const slotType of ['mmc', 'sdcard', 'ssd']) {
    const target = base[slotType];
    const list = candidates[slotType];
    if (!list || list.length === 0) continue;
    list.sort((a, b) => {
      const scoreDelta = b.score - a.score;
      if (scoreDelta !== 0) return scoreDelta;
      return (b.totalBytes || 0) - (a.totalBytes || 0);
    });
    const best = list[0];
      if (best.isSystemLike && slotType === 'ssd') {
        target.label = 'SSD';
      }
    target.name = best.name;
    target.percent = best.percent;
    target.usedBytes = best.usedBytes;
    target.totalBytes = best.totalBytes;
    target.detailText = best.usedBytes != null && best.totalBytes != null
      ? `${formatBytes(best.usedBytes)} / ${formatBytes(best.totalBytes)}`
      : 'N/A';
    target.mountpoint = best.mountpoint;
    target.mounted = true;
    target.available = true;
    target.io = pickDiskIo(ioMap, best.parentName, best.rowName);
  }

  for (const row of diskRows) {
    const diskType = classifyDisk(row.NAME, row);
    const slotType = diskType === 'system' ? 'ssd' : diskType;
    const target = base[slotType];
    if (target.mounted) continue;
    target.name = `/dev/${row.NAME}`;
      if (diskType === 'system' && slotType === 'ssd') {
        target.label = 'SSD';
      }
    target.totalBytes = safeNumber(row.SIZE, null);
    target.detailText = target.totalBytes ? `0.00 B / ${formatBytes(target.totalBytes)}` : 'N/A';
    target.io = pickDiskIo(ioMap, row.NAME, null);
  }

  return [base.mmc, base.sdcard, base.ssd];
}

async function getOsInfo() {
  const hostnameCtl = await execCmd('hostnamectl', [], 1800);

  let distro = `${os.type()} ${os.release()}`;
  if (hostnameCtl.ok) {
    const m = hostnameCtl.stdout.match(/Operating System:\s+(.+)/);
    if (m) distro = m[1].trim();
  }

  return {
    hostname: os.hostname(),
    os: distro,
    kernel: os.release(),
    architecture: os.arch(),
    platform: os.platform(),
    cpuModel: os.cpus()?.[0]?.model || 'N/A',
    cores: os.cpus()?.length || null,
    totalRamBytes: os.totalmem(),
    totalRamText: formatBytes(os.totalmem()),
    nodeVersion: process.version,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'N/A',
    serverTime: new Date().toISOString(),
  };
}

async function getLoadAverage() {
  try {
    const loadRaw = await fs.readFile('/proc/loadavg', 'utf8');
    const fields = loadRaw.trim().split(/\s+/).slice(0, 3).map(Number);
    return fields.every((n) => Number.isFinite(n)) ? fields : null;
  } catch {
    return null;
  }
}

async function collectMetrics() {
  const started = Date.now();

  const [
    cpuPercent,
    memory,
    temperature,
    zram,
    network,
    pingMs,
    diskCards,
    info,
    loadAverage,
  ] = await Promise.all([
    getCpuUsagePercent(),
    getMemoryInfo(),
    getTemperatureCelsius(),
    getZramInfo(),
    getNetworkStats(),
    getPingMs(),
    getDiskUsageInfo(),
    getOsInfo(),
    getLoadAverage(),
  ]);

  const responseTimeMs = Date.now() - started;
  const uptimeSec = os.uptime();
  const nowIso = new Date().toISOString();
  monitorState.lastSeenAt = nowIso;

  return {
    ts: nowIso,
    intervalMs: WS_INTERVAL_MS,
    status: {
      online: true,
      uptimeRelative: relativeSeen(monitorState.lastSeenAt),
      lastSeenAt: monitorState.lastSeenAt,
    },
    cpu: {
      percent: cpuPercent,
      loadAverage,
    },
    ram: memory || {
      percent: null,
      usedBytes: null,
      totalBytes: null,
      usedText: 'N/A',
    },
    stats: {
      temperatureC: temperature,
      zram,
      responseTimeMs,
      uptimeSec,
      uptimeText: formatUptime(uptimeSec),
    },
    network: {
      ...network,
      pingTarget: PING_TARGET,
      pingMs,
    },
    disks: diskCards,
    system: info,
    lastUpdate: nowIso,
  };
}

let collectChain = Promise.resolve();

function collectMetricsSerialized() {
  const run = collectChain.then(() => collectMetrics());
  collectChain = run.catch(() => {});
  return run;
}

async function broadcastMetrics() {
  let payload;
  try {
    payload = await collectMetricsSerialized();
  } catch {
    payload = {
      ts: new Date().toISOString(),
      status: {
        online: false,
        uptimeRelative: relativeSeen(monitorState.lastSeenAt),
        lastSeenAt: monitorState.lastSeenAt,
      },
      error: 'Failed to collect full metrics',
    };
  }

  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

wss.on('connection', async (socket) => {
  socket.send(JSON.stringify({
    type: 'hello',
    message: 'connected',
    ts: new Date().toISOString(),
  }));

  try {
    const snapshot = await collectMetricsSerialized();
    socket.send(JSON.stringify(snapshot));
  } catch {
    socket.send(JSON.stringify({
      status: { online: false, uptimeRelative: 'N/A', lastSeenAt: monitorState.lastSeenAt },
      error: 'Initial snapshot unavailable',
      ts: new Date().toISOString(),
    }));
  }
});

async function scheduleBroadcast() {
  await broadcastMetrics();
  setTimeout(scheduleBroadcast, WS_INTERVAL_MS);
}

setTimeout(scheduleBroadcast, WS_INTERVAL_MS);

app.get('/api/sample', async (_req, res) => {
  const sample = await collectMetricsSerialized();
  res.json(sample);
});

server.listen(PORT, () => {
  console.log(`System monitor running on http://localhost:${PORT}`);
});
