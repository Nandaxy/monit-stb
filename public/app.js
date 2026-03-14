const HISTORY_LIMIT = 30;

const ui = {
  serverStatus: document.getElementById('serverStatus'),
  serverSeen: document.getElementById('serverSeen'),
  cpuPercent: document.getElementById('cpuPercent'),
  ramPercent: document.getElementById('ramPercent'),
  ramDetail: document.getElementById('ramDetail'),
  temperature: document.getElementById('temperature'),
  zramPercent: document.getElementById('zramPercent'),
  zramDetail: document.getElementById('zramDetail'),
  responseTime: document.getElementById('responseTime'),
  uptime: document.getElementById('uptime'),
  downloadSpeed: document.getElementById('downloadSpeed'),
  uploadSpeed: document.getElementById('uploadSpeed'),
  totalDownload: document.getElementById('totalDownload'),
  totalUpload: document.getElementById('totalUpload'),
  pingTarget: document.getElementById('pingTarget'),
  ping: document.getElementById('ping'),
  diskCards: document.getElementById('diskCards'),
  systemInfo: document.getElementById('systemInfo'),
  wsDot: document.getElementById('wsDot'),
  wsText: document.getElementById('wsText'),
  lastUpdate: document.getElementById('lastUpdate'),
  cpuChartHint: document.getElementById('cpuChartHint'),
  ramChartHint: document.getElementById('ramChartHint'),
};

const chartState = {
  labels: [],
  cpu: [],
  ram: [],
};

function makeChart(el, lineColor, fillColor) {
  return new Chart(el, {
    type: 'line',
    data: {
      labels: chartState.labels,
      datasets: [{
        data: [],
        borderColor: lineColor,
        backgroundColor: fillColor,
        fill: true,
        borderWidth: 1.8,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHitRadius: 18,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false,
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          displayColors: false,
          callbacks: {
            label: (ctx) => `${ctx.parsed.y?.toFixed(1) ?? 'N/A'}%`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#8da4c3', maxRotation: 0, autoSkip: true, maxTicksLimit: 5 },
          grid: { color: 'rgba(140, 164, 194, 0.1)' },
        },
        y: {
          min: 0,
          max: 100,
          ticks: {
            color: '#8da4c3',
            callback: (v) => `${v}%`,
          },
          grid: { color: 'rgba(140, 164, 194, 0.1)' },
        },
      },
    },
  });
}

const cpuChart = makeChart(
  document.getElementById('cpuChart'),
  '#4ea2ff',
  'rgba(78, 162, 255, 0.14)'
);

const ramChart = makeChart(
  document.getElementById('ramChart'),
  '#9a7bff',
  'rgba(154, 123, 255, 0.16)'
);

const diskCharts = new Map();
const diskIoCharts = new Map();
const diskIoHistory = new Map();
const DISK_IO_HISTORY_LIMIT = 24;

function formatRate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
  let next = Math.max(0, value);
  let unitIndex = 0;
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex += 1;
  }
  const precision = next >= 100 ? 0 : next >= 10 ? 1 : 2;
  return `${next.toFixed(precision)} ${units[unitIndex]}`;
}

function toPercentText(value) {
  return typeof value === 'number' ? `${value.toFixed(1)}%` : 'N/A';
}

function toTempText(value) {
  return typeof value === 'number' ? `${value.toFixed(1)}°C` : 'N/A';
}

function toMsText(value) {
  return typeof value === 'number' ? `${Math.round(value)}ms` : 'N/A';
}

function animateValue(el, text) {
  if (el.textContent === text) return;
  el.textContent = text;
  el.classList.add('bump');
  window.setTimeout(() => el.classList.remove('bump'), 250);
}

function applyChartData(chart, dataset) {
  chart.data.labels = [...chartState.labels];
  chart.data.datasets[0].data = [...dataset];
  chart.update('none');
}

function updateCharts(nextCpu, nextRam, tsIso) {
  const label = tsIso ? new Date(tsIso).toLocaleTimeString('en-US', { hour12: false }) : '--:--:--';

  chartState.labels.push(label);
  chartState.cpu.push(typeof nextCpu === 'number' ? Math.max(0, Math.min(100, nextCpu)) : null);
  chartState.ram.push(typeof nextRam === 'number' ? Math.max(0, Math.min(100, nextRam)) : null);

  if (chartState.labels.length > HISTORY_LIMIT) {
    chartState.labels.shift();
    chartState.cpu.shift();
    chartState.ram.shift();
  }

  applyChartData(cpuChart, chartState.cpu);
  applyChartData(ramChart, chartState.ram);
}

function clearChartSelection(chart, hintEl, defaultText) {
  chart.setActiveElements([]);
  chart.tooltip.setActiveElements([], { x: 0, y: 0 });
  chart.update('none');
  hintEl.textContent = defaultText;
}

function bindChartClick(chart, hintEl, metricLabel) {
  const defaultText = 'Tap chart to inspect a point';
  hintEl.textContent = defaultText;

  chart.canvas.addEventListener('click', (event) => {
    const points = chart.getElementsAtEventForMode(
      event,
      'nearest',
      { intersect: false },
      true
    );

    if (!points || points.length === 0) {
      clearChartSelection(chart, hintEl, defaultText);
      return;
    }

    const point = points[0];
    const value = chart.data.datasets[point.datasetIndex]?.data?.[point.index];
    const label = chart.data.labels?.[point.index] || '--:--:--';
    const valueText = typeof value === 'number' ? `${value.toFixed(1)}%` : 'N/A';

    chart.setActiveElements([{ datasetIndex: point.datasetIndex, index: point.index }]);
    chart.tooltip.setActiveElements([{ datasetIndex: point.datasetIndex, index: point.index }], { x: event.x, y: event.y });
    chart.update('none');

    hintEl.textContent = `${metricLabel} @ ${label}: ${valueText}`;
  });

  chart.canvas.addEventListener('dblclick', () => {
    clearChartSelection(chart, hintEl, defaultText);
  });
}

function setWsState(isOnline) {
  ui.wsDot.classList.toggle('online', isOnline);
  ui.wsDot.classList.toggle('offline', !isOnline);
  ui.wsText.textContent = isOnline ? 'WebSocket Connected' : 'WebSocket Disconnected';
}

function updateStatus(status) {
  const isOnline = !!status?.online;
  ui.serverStatus.textContent = isOnline ? 'Online' : 'Offline';
  ui.serverStatus.classList.toggle('online', isOnline);
  ui.serverStatus.classList.toggle('offline', !isOnline);
  ui.serverSeen.textContent = status?.uptimeRelative || 'last seen N/A';
}

function diskStateFrom(disk) {
  const hasUsage = typeof disk.percent === 'number';
  const pct = hasUsage ? Math.max(0, Math.min(100, disk.percent)) : 0;
  const isMounted = !!disk.mounted;
  const isAvailable = !!disk.available;

  if (!isMounted) {
    return { level: 'inactive', status: 'Not mounted', hasUsage: false, pct };
  }

  if (!hasUsage) {
    return { level: 'inactive', status: 'Usage unavailable', hasUsage: false, pct };
  }

  if (!isAvailable) {
    return { level: 'danger', status: 'Unavailable', hasUsage: true, pct };
  }

  if (pct >= 85) return { level: 'danger', status: 'Available', hasUsage: true, pct };
  if (pct >= 65) return { level: 'warn', status: 'Available', hasUsage: true, pct };
  return { level: 'ok', status: 'Available', hasUsage: true, pct };
}

function diskKeyFor(disk) {
  return `${disk.type || 'disk'}-${disk.name || 'na'}-${disk.mountpoint || 'na'}`;
}

function createDiskCard(key) {
  const card = document.createElement('article');
  card.className = 'disk-card disk-card-inactive';
  card.dataset.diskKey = key;
  card.innerHTML = `
    <div class="disk-head">
      <div class="disk-title-wrap">
        <h3 data-field="label">Disk</h3>
        <span class="disk-status" data-field="status">N/A</span>
      </div>
    </div>

    <div class="disk-main">
      <div class="disk-donut-wrap">
        <div class="disk-donut-shell disk-donut-inactive" data-field="donut-shell">
          <canvas class="disk-donut-canvas" role="img" aria-label="Disk usage chart"></canvas>
          <div class="disk-center-text">
            <strong data-field="centerPercent">N/A</strong>
            <small data-field="centerLabel">Usage unavailable</small>
          </div>
        </div>
        <strong class="disk-used-detail" data-field="usedDetail">N/A</strong>
      </div>

      <div class="disk-meta compact">
        <div class="disk-row"><span>Device</span><strong data-field="device">N/A</strong></div>
        <div class="disk-row"><span>Mount</span><strong data-field="mount">N/A</strong></div>
      </div>
    </div>

    <div class="disk-io">
      <p class="disk-io-title">Disk I/O</p>
      <div class="disk-io-trend">
        <canvas class="disk-io-canvas" role="img" aria-label="Disk I/O read write trend"></canvas>
      </div>
      <small class="disk-io-hint" data-field="ioHint">Tap trend chart to inspect read/write</small>
      <div class="disk-io-grid">
        <div class="disk-io-block">
          <small>Read speed</small>
          <strong data-field="readSpeed">N/A</strong>
        </div>
        <div class="disk-io-block">
          <small>Write speed</small>
          <strong data-field="writeSpeed">N/A</strong>
        </div>
        <div class="disk-io-block">
          <small>Total read</small>
          <strong data-field="totalRead">N/A</strong>
        </div>
        <div class="disk-io-block">
          <small>Total write</small>
          <strong data-field="totalWrite">N/A</strong>
        </div>
      </div>
    </div>
  `;
  return card;
}

function setFieldText(card, field, value) {
  const el = card.querySelector(`[data-field="${field}"]`);
  if (!el) return;
  const next = value == null || value === '' ? 'N/A' : String(value);
  if (el.textContent !== next) el.textContent = next;
}

function diskDonutColors(level) {
  if (level === 'danger') {
    return {
      used: 'rgba(240, 103, 103, 0.94)',
      free: 'rgba(240, 103, 103, 0.18)',
    };
  }
  if (level === 'warn') {
    return {
      used: 'rgba(245, 184, 74, 0.96)',
      free: 'rgba(245, 184, 74, 0.2)',
    };
  }
  if (level === 'inactive') {
    return {
      used: 'rgba(146, 161, 182, 0.66)',
      free: 'rgba(146, 161, 182, 0.22)',
    };
  }
  return {
    used: 'rgba(66, 212, 145, 0.96)',
    free: 'rgba(66, 212, 145, 0.18)',
  };
}

function toPositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : null;
}

function pushDiskIoPoint(key, io) {
  const prev = diskIoHistory.get(key) || {
    labels: [],
    read: [],
    write: [],
  };

  prev.labels.push('');
  prev.read.push(toPositiveNumber(io?.readPerSec));
  prev.write.push(toPositiveNumber(io?.writePerSec));

  if (prev.labels.length > DISK_IO_HISTORY_LIMIT) {
    prev.labels.shift();
    prev.read.shift();
    prev.write.shift();
  }

  diskIoHistory.set(key, prev);
  return prev;
}

function syncDiskDonutCharts(disks) {
  const aliveKeys = new Set();
  const cardMap = new Map();

  for (const node of ui.diskCards.children) {
    if (node instanceof HTMLElement && node.dataset.diskKey) {
      cardMap.set(node.dataset.diskKey, node);
    }
  }

  for (let i = 0; i < disks.length; i += 1) {
    const disk = disks[i] || {};
    const state = diskStateFrom(disk);
    const key = diskKeyFor(disk);
    aliveKeys.add(key);

    const card = cardMap.get(key);
    if (!card) continue;

    const canvas = card.querySelector('.disk-donut-canvas');
    if (!canvas) continue;

    const { used, free } = diskDonutColors(state.level);
    const usedValue = state.hasUsage ? state.pct : 100;
    const freeValue = state.hasUsage ? Math.max(0, 100 - state.pct) : 0;
    const data = [usedValue, freeValue];

    const existing = diskCharts.get(key);
    if (existing && existing.canvas !== canvas) {
      existing.destroy();
      diskCharts.delete(key);
    }

    let current = diskCharts.get(key);
    if (current && current.$hasUsage !== state.hasUsage) {
      current.destroy();
      diskCharts.delete(key);
      current = null;
    }

    if (current) {
      current.$hasUsage = state.hasUsage;
      current.$status = state.status;
      current.data.datasets[0].data = data;
      current.data.datasets[0].backgroundColor = [used, free];
      current.update('none');
      continue;
    }

    const donut = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Used', 'Free'],
        datasets: [{
          data,
          backgroundColor: [used, free],
          borderWidth: 0,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        animation: {
          duration: 450,
          easing: 'easeOutQuart',
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: state.hasUsage,
            displayColors: false,
            callbacks: {
              label: (ctx) => (ctx.chart.$hasUsage ? `${ctx.label}: ${ctx.parsed.toFixed(1)}%` : ctx.chart.$status),
            },
          },
        },
      },
    });

    donut.$hasUsage = state.hasUsage;
    donut.$status = state.status;

    diskCharts.set(key, donut);
  }

  for (const [key, chart] of diskCharts.entries()) {
    if (aliveKeys.has(key)) continue;
    chart.destroy();
    diskCharts.delete(key);
  }
}

function syncDiskIoCharts(disks) {
  const aliveKeys = new Set();
  const cardMap = new Map();

  for (const node of ui.diskCards.children) {
    if (node instanceof HTMLElement && node.dataset.diskKey) {
      cardMap.set(node.dataset.diskKey, node);
    }
  }

  for (let i = 0; i < disks.length; i += 1) {
    const disk = disks[i] || {};
    const key = diskKeyFor(disk);
    aliveKeys.add(key);

    const card = cardMap.get(key);
    if (!card) continue;

    const canvas = card.querySelector('.disk-io-canvas');
    if (!canvas) continue;

    const series = pushDiskIoPoint(key, disk.io || {});

    const existing = diskIoCharts.get(key);
    if (existing && existing.canvas !== canvas) {
      existing.destroy();
      diskIoCharts.delete(key);
    }

    const chart = diskIoCharts.get(key);
    if (chart) {
      chart.data.labels = [...series.labels];
      chart.data.datasets[0].data = [...series.read];
      chart.data.datasets[1].data = [...series.write];
      chart.$cardRef = card;
      chart.update('none');
      continue;
    }

    const ioChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: [...series.labels],
        datasets: [
          {
            label: 'Read',
            data: [...series.read],
            borderColor: 'rgba(78, 162, 255, 0.95)',
            backgroundColor: 'rgba(78, 162, 255, 0.16)',
            borderWidth: 1.8,
            tension: 0.35,
            pointRadius: 0,
            fill: false,
          },
          {
            label: 'Write',
            data: [...series.write],
            borderColor: 'rgba(154, 123, 255, 0.95)',
            backgroundColor: 'rgba(154, 123, 255, 0.16)',
            borderWidth: 1.8,
            tension: 0.35,
            pointRadius: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: {
          mode: 'index',
          axis: 'x',
          intersect: false,
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            displayColors: true,
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatRate(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            display: false,
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { display: false },
            grid: {
              color: 'rgba(128, 155, 193, 0.18)',
              drawTicks: false,
            },
          },
        },
        onClick: (event, _activeEls, chart) => {
          const points = chart.getElementsAtEventForMode(
            event,
            'index',
            { intersect: false },
            true
          );

          if (!points || points.length === 0) {
            chart.setActiveElements([]);
            chart.tooltip.setActiveElements([], { x: 0, y: 0 });
            chart.update('none');
            if (chart.$cardRef) {
              setFieldText(chart.$cardRef, 'ioHint', 'Tap trend chart to inspect read/write');
            }
            return;
          }

          chart.setActiveElements(points);
          chart.tooltip.setActiveElements(points, { x: event.x, y: event.y });
          chart.update('none');

          if (chart.$cardRef) {
            const readPoint = points.find((p) => p.datasetIndex === 0);
            const writePoint = points.find((p) => p.datasetIndex === 1);
            const readVal = readPoint ? chart.data.datasets[0]?.data?.[readPoint.index] : null;
            const writeVal = writePoint ? chart.data.datasets[1]?.data?.[writePoint.index] : null;
            setFieldText(chart.$cardRef, 'ioHint', `Read ${formatRate(readVal)} • Write ${formatRate(writeVal)}`);
          }
        },
      },
    });

    ioChart.$cardRef = card;

    canvas.addEventListener('dblclick', () => {
      ioChart.setActiveElements([]);
      ioChart.tooltip.setActiveElements([], { x: 0, y: 0 });
      ioChart.update('none');
      setFieldText(card, 'ioHint', 'Tap trend chart to inspect read/write');
    });

    diskIoCharts.set(key, ioChart);
  }

  for (const [key, chart] of diskIoCharts.entries()) {
    if (aliveKeys.has(key)) continue;
    chart.destroy();
    diskIoCharts.delete(key);
    diskIoHistory.delete(key);
  }
}

function updateDisks(disks) {
  if (!Array.isArray(disks) || disks.length === 0) {
    for (const chart of diskCharts.values()) {
      chart.destroy();
    }
    for (const chart of diskIoCharts.values()) {
      chart.destroy();
    }
    diskCharts.clear();
    diskIoCharts.clear();
    diskIoHistory.clear();
    ui.diskCards.innerHTML = '<article class="disk-card disk-card-inactive"><h3>N/A</h3><p class="subtle">Disk info not available</p></article>';
    return;
  }

  const existingCards = new Map();
  for (const node of ui.diskCards.children) {
    if (node instanceof HTMLElement && node.dataset.diskKey) {
      existingCards.set(node.dataset.diskKey, node);
    }
  }

  const orderedCards = [];
  for (let i = 0; i < disks.length; i += 1) {
    const disk = disks[i] || {};
    const key = diskKeyFor(disk);
    const state = diskStateFrom(disk);
    const pct = state.pct;
    const pctText = state.hasUsage ? `${Math.round(pct)}%` : 'N/A';
    const mount = disk.mounted && disk.mountpoint ? disk.mountpoint : 'N/A';
    const usedText = disk.detailText || 'N/A';
    const io = disk.io || {};

    const card = existingCards.get(key) || createDiskCard(key);
    card.className = `disk-card disk-card-${state.level}`;

    const shell = card.querySelector('[data-field="donut-shell"]');
    if (shell) shell.classList.toggle('disk-donut-inactive', !state.hasUsage);

    const canvas = card.querySelector('.disk-donut-canvas');
    if (canvas) canvas.setAttribute('aria-label', `${disk.label || 'Disk'} usage chart`);

    setFieldText(card, 'label', disk.label || 'Disk');
    setFieldText(card, 'status', state.status);
    setFieldText(card, 'centerPercent', pctText);
    setFieldText(card, 'centerLabel', state.hasUsage ? 'Used' : 'Usage unavailable');
    setFieldText(card, 'ioHint', 'Tap trend chart to inspect read/write');
    setFieldText(card, 'usedDetail', usedText);
    setFieldText(card, 'device', disk.name || 'N/A');
    setFieldText(card, 'mount', mount);
    setFieldText(card, 'readSpeed', io.readPerSecText || 'N/A');
    setFieldText(card, 'writeSpeed', io.writePerSecText || 'N/A');
    setFieldText(card, 'totalRead', io.totalReadText || 'N/A');
    setFieldText(card, 'totalWrite', io.totalWriteText || 'N/A');

    orderedCards.push(card);
  }

  ui.diskCards.replaceChildren(...orderedCards);
  syncDiskDonutCharts(disks);
  syncDiskIoCharts(disks);
}

function infoRow(label, value) {
  return `<div class="info-row"><span>${label}</span><strong>${value ?? 'N/A'}</strong></div>`;
}

function updateSystemInfo(system) {
  if (!system) {
    ui.systemInfo.innerHTML = infoRow('System', 'N/A');
    return;
  }

  ui.systemInfo.innerHTML = [
    ['Hostname', system.hostname],
    ['OS / Distro', system.os],
    ['Kernel', system.kernel],
    ['Architecture', system.architecture],
    ['Platform', system.platform],
    ['CPU Model', system.cpuModel],
    ['Cores', system.cores],
    ['Total RAM', system.totalRamText],
    ['Node.js', system.nodeVersion],
    ['Timezone', system.timezone],
    ['Current Server Time', system.serverTime ? new Date(system.serverTime).toLocaleString('en-US') : 'N/A'],
  ].map(([label, value]) => infoRow(label, value)).join('');
}

function applyMetrics(payload) {
  updateStatus(payload.status || {});

  animateValue(ui.cpuPercent, toPercentText(payload?.cpu?.percent));
  animateValue(ui.ramPercent, toPercentText(payload?.ram?.percent));
  ui.ramDetail.textContent = payload?.ram?.usedText || 'N/A';

  ui.temperature.textContent = toTempText(payload?.stats?.temperatureC);
  ui.zramPercent.textContent = toPercentText(payload?.stats?.zram?.percent);
  ui.zramDetail.textContent = payload?.stats?.zram?.text || 'N/A';
  ui.responseTime.textContent = toMsText(payload?.stats?.responseTimeMs);
  ui.uptime.textContent = payload?.stats?.uptimeText || 'N/A';

  ui.downloadSpeed.textContent = payload?.network?.downloadText || 'N/A';
  ui.uploadSpeed.textContent = payload?.network?.uploadText || 'N/A';
  ui.totalDownload.textContent = payload?.network?.totalDownloadText || 'N/A';
  ui.totalUpload.textContent = payload?.network?.totalUploadText || 'N/A';
  ui.pingTarget.textContent = `target: ${payload?.network?.pingTarget || 'N/A'}`;
  ui.ping.textContent = toMsText(payload?.network?.pingMs);

  updateDisks(payload?.disks || []);
  updateSystemInfo(payload?.system || null);

  updateCharts(payload?.cpu?.percent, payload?.ram?.percent, payload?.ts);

  ui.lastUpdate.textContent = `Last update: ${payload?.lastUpdate ? new Date(payload.lastUpdate).toLocaleTimeString('en-US') : 'N/A'}`;
}

let socket;
let reconnectTimer;
let staleTimer;

function resetStaleTimer(intervalMs) {
  window.clearTimeout(staleTimer);
  const timeout = Math.max(3000, Number(intervalMs || 1500) * 3);
  staleTimer = window.setTimeout(() => {
    setWsState(false);
    ui.serverStatus.textContent = 'Offline';
    ui.serverStatus.classList.remove('online');
    ui.serverStatus.classList.add('offline');
    if (socket && socket.readyState === WebSocket.OPEN) socket.close();
  }, timeout);
}

function connectWs() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  socket = new WebSocket(wsUrl);

  socket.addEventListener('open', () => {
    setWsState(true);
    resetStaleTimer(1500);
  });

  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === 'hello') return;
      applyMetrics(payload);
      resetStaleTimer(payload.intervalMs);
    } catch {
      return;
    }
  });

  socket.addEventListener('close', () => {
    setWsState(false);
    window.clearTimeout(staleTimer);
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(connectWs, 1500);
  });

  socket.addEventListener('error', () => {
    setWsState(false);
  });
}

setWsState(false);
bindChartClick(cpuChart, ui.cpuChartHint, 'CPU');
bindChartClick(ramChart, ui.ramChartHint, 'RAM');
connectWs();
