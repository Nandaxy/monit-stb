# Monit - Realtime Monitoring untuk STB HG680P (Armbian)

<p align="left">
  Dashboard monitoring server Linux berbasis Node.js dan WebSocket, dirancang untuk kebutuhan pemantauan perangkat STB <strong>HG680P</strong> yang sudah menjalankan <strong>Armbian</strong>.
</p>

## Tentang Project

Monit adalah aplikasi single-page untuk menampilkan metrik perangkat secara realtime tanpa reload halaman. Data dikumpulkan dari sistem Linux dan didorong ke frontend melalui WebSocket setiap ~1.5 detik.

Project ini cocok untuk:

- Monitoring performa harian perangkat STB HG680P.
- Pemantauan resource saat menjalankan service tambahan (proxy, container ringan, script otomatisasi, dll).
- Dashboard lokal di jaringan rumah/lab untuk observasi cepat.

## Fitur Utama

- Realtime CPU dan RAM chart (line chart).
- Disk Usage dengan donut chart per storage (MMC, SD Card, SSD/system disk).
- Disk I/O realtime (read/write speed + total read/write).
- Network throughput (download/upload) dan ping latency.
- Informasi sistem penting (hostname, distro, kernel, arsitektur, model CPU, total RAM, timezone).
- Fallback aman ke `N/A` jika metrik tertentu tidak tersedia di perangkat.

## Arsitektur Singkat

- **Backend**: `Express` + `ws` di `server.js`.
- **Frontend**: HTML/CSS/JS vanilla di folder `public/`.
- **Data source Linux**: `/proc/*`, `df`, `lsblk`, `ping`, `hostnamectl`.

## Struktur Folder

```text
monit/
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── logs/
├── .env
├── .env.example
├── package.json
├── package-lock.json
└── server.js
```

## Persyaratan

- Node.js 18+ (disarankan Node.js 20+)
- npm
- Linux/Armbian (target utama: STB HG680P)

## Instalasi dan Menjalankan

### 1. Install dependency

```bash
npm install
```

### 2. Konfigurasi environment

```bash
cp .env.example .env
```

### 3. Jalankan aplikasi

```bash
# mode normal
npm start

# mode development (auto-reload)
npm run dev
```

Dashboard default tersedia di:

- `http://localhost:3000`

## Menjalankan dengan PM2

Karena file konfigurasi PM2 tidak disertakan, jalankan langsung dari entry file `server.js`.

```bash
# jalankan aplikasi via PM2
pm2 start server.js --name monit-dashboard

# cek status
pm2 status

# lihat log
pm2 logs monit-dashboard

# simpan proses agar auto-start saat reboot
pm2 save
```

## Environment Variables

<table>
  <thead>
    <tr>
      <th>Variable</th>
      <th>Default</th>
      <th>Wajib</th>
      <th>Keterangan</th>
      <th>Contoh</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>PORT</code></td>
      <td><code>3000</code></td>
      <td>Tidak</td>
      <td>Port HTTP aplikasi.</td>
      <td><code>PORT=3000</code></td>
    </tr>
    <tr>
      <td><code>PING_TARGET</code></td>
      <td><code>1.1.1.1</code></td>
      <td>Tidak</td>
      <td>Target host/IP untuk pengukuran ping latency.</td>
      <td><code>PING_TARGET=8.8.8.8</code></td>
    </tr>
  </tbody>
</table>

## Endpoint

- `GET /api/sample` -> snapshot metrik saat ini (JSON).
- `WS /` -> stream metrik realtime untuk dashboard.

## Catatan Deploy untuk HG680P

- Pastikan perangkat memiliki resource cukup dan pendinginan memadai jika berjalan 24/7.
- Disarankan menjalankan via PM2 agar service auto-restart saat crash/reboot.
- Untuk publish ke jaringan yang lebih luas, letakkan di balik reverse proxy dan akses terbatas (LAN/VPN/auth).

## Lisensi

MIT
