/**
 * dp-rastreo-server — DistritoPhone.
 * Servidor Express que hace scraping de las páginas de rastreo
 * de mensajerías colombianas y devuelve el estado en JSON.
 *
 * Deploy en Render.com (free tier):
 *   - Build command: npm install
 *   - Start command: node server.js
 */

const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const cheerio = require('cheerio');

const app  = express();
const PORT = process.env.PORT || 10000;

/* ── CORS: permite llamadas desde GitHub Pages y localhost ── */
const ALLOWED_ORIGINS = [
  'https://cuenta2020.github.io',
  'http://localhost',
  'http://127.0.0.1',
  'null' /* file:// en celular */
];
app.use(cors({
  origin: function (origin, cb) {
    if (!origin || ALLOWED_ORIGINS.some(o => origin.startsWith(o))) return cb(null, true);
    cb(null, true); /* abierto por ahora — restringir en producción si se necesita */
  }
}));
app.use(express.json());

/* ── Headers de seguridad ── */
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

/* ══════════════════════════════════════════════
   HELPERS
══════════════════════════════════════════════ */

/** Timeout para fetch */
const fetchWithTimeout = (url, options = {}, ms = 12000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
};

const HEADERS_BROWSER = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-CO,es;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive'
};

/* ══════════════════════════════════════════════
   SCRAPERS POR EMPRESA
══════════════════════════════════════════════ */

/* ── Coordinadora ── */
async function trackCoordinadora(guia) {
  const url = `https://www.coordinadora.com/portafolio-de-servicios/servicios-en-linea/rastrear-guias/?guia=${encodeURIComponent(guia)}`;
  const res = await fetchWithTimeout(url, { headers: HEADERS_BROWSER });
  const html = await res.text();
  const $ = cheerio.load(html);

  const events = [];
  /* La página de Coordinadora usa una tabla o lista de eventos */
  $('table.table-tracking tr, .tracking-detail tr, .rastreo-detalle tr').each((i, row) => {
    const cells = $(row).find('td');
    if (cells.length >= 2) {
      const fecha  = $(cells[0]).text().trim();
      const estado = $(cells[1]).text().trim();
      const ciudad = cells.length >= 3 ? $(cells[2]).text().trim() : '';
      if (fecha || estado) events.push({ fecha, estado, ciudad });
    }
  });

  /* Estado actual — primer resultado o texto de estado principal */
  const estadoActual = $('.estado-guia, .tracking-status, .estado-actual, h3.status').first().text().trim()
    || (events[0] ? events[0].estado : '');

  return {
    carrier: 'Coordinadora',
    guia,
    estadoActual: estadoActual || 'Sin información disponible',
    eventos: events.slice(0, 10),
    url,
    rawFound: events.length > 0
  };
}

/* ── Servientrega ── */
async function trackServientrega(guia) {
  /* Servientrega tiene una API JSON interna */
  const url = `https://www.servientrega.com/wps/portal/tracking-masivo`;
  const formData = `id=${encodeURIComponent(guia)}`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      ...HEADERS_BROWSER,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData
  });
  const html = await res.text();
  const $ = cheerio.load(html);

  const events = [];
  $('.tracking-item, .timeline-item, table.tracking tr').each((i, el) => {
    const fecha  = $(el).find('.date, td:nth-child(1)').text().trim();
    const estado = $(el).find('.status, .description, td:nth-child(2)').text().trim();
    const ciudad = $(el).find('.city, td:nth-child(3)').text().trim();
    if (estado) events.push({ fecha, estado, ciudad });
  });

  const estadoActual = $('.current-status, .estado-principal, h2.status').first().text().trim()
    || (events[0] ? events[0].estado : '');

  return {
    carrier: 'Servientrega',
    guia,
    estadoActual: estadoActual || 'Sin información disponible',
    eventos: events.slice(0, 10),
    url: `https://www.servientrega.com/wps/portal/tracking-masivo?id=${guia}`,
    rawFound: events.length > 0
  };
}

/* ── Envía ── */
async function trackEnvia(guia) {
  const url = `https://www.envia.co/rastreo?tracking=${encodeURIComponent(guia)}`;
  const res = await fetchWithTimeout(url, { headers: HEADERS_BROWSER });
  const html = await res.text();
  const $ = cheerio.load(html);

  const events = [];
  $('.tracking-event, .timeline li, .rastreo-evento').each((i, el) => {
    const fecha  = $(el).find('.date, .fecha, time').text().trim();
    const estado = $(el).find('.description, .estado, p').first().text().trim();
    const ciudad = $(el).find('.city, .ciudad').text().trim();
    if (estado) events.push({ fecha, estado, ciudad });
  });

  const estadoActual = $('.tracking-status, .estado-actual, .current-status').first().text().trim()
    || (events[0] ? events[0].estado : '');

  return {
    carrier: 'Envía',
    guia,
    estadoActual: estadoActual || 'Sin información disponible',
    eventos: events.slice(0, 10),
    url,
    rawFound: events.length > 0
  };
}

/* ── TCC ── */
async function trackTCC(guia) {
  const url = `https://www.tcc.com.co/rastrear?guia=${encodeURIComponent(guia)}`;
  const res = await fetchWithTimeout(url, { headers: HEADERS_BROWSER });
  const html = await res.text();
  const $ = cheerio.load(html);

  const events = [];
  $('table tr, .tracking-row, .event-row').each((i, el) => {
    const fecha  = $(el).find('td:nth-child(1), .date').text().trim();
    const estado = $(el).find('td:nth-child(2), .status').text().trim();
    const ciudad = $(el).find('td:nth-child(3), .city').text().trim();
    if (estado && estado.length > 2) events.push({ fecha, estado, ciudad });
  });

  const estadoActual = $('.estado-actual, .current-status, h3').first().text().trim()
    || (events[0] ? events[0].estado : '');

  return {
    carrier: 'TCC',
    guia,
    estadoActual: estadoActual || 'Sin información disponible',
    eventos: events.slice(0, 10),
    url,
    rawFound: events.length > 0
  };
}

/* ── Interrapídisimo ── */
async function trackInterrapidisimo(guia) {
  const url = `https://interrapidisimo.com/rastreo/?codigo=${encodeURIComponent(guia)}`;
  const res = await fetchWithTimeout(url, { headers: HEADERS_BROWSER });
  const html = await res.text();
  const $ = cheerio.load(html);

  const events = [];
  $('.tracking-table tr, .rastreo tr, table.table tr').each((i, el) => {
    const fecha  = $(el).find('td:nth-child(1)').text().trim();
    const estado = $(el).find('td:nth-child(2)').text().trim();
    const ciudad = $(el).find('td:nth-child(3)').text().trim();
    if (estado && estado.length > 2) events.push({ fecha, estado, ciudad });
  });

  const estadoActual = events[0] ? events[0].estado : '';

  return {
    carrier: 'Interrapídisimo',
    guia,
    estadoActual: estadoActual || 'Sin información disponible',
    eventos: events.slice(0, 10),
    url,
    rawFound: events.length > 0
  };
}

/* ── Mapa de scrapers ── */
const SCRAPERS = {
  coordinadora:    trackCoordinadora,
  servientrega:    trackServientrega,
  envia:           trackEnvia,
  tcc:             trackTCC,
  interrapidisimo: trackInterrapidisimo
};

/* ══════════════════════════════════════════════
   RUTAS
══════════════════════════════════════════════ */

/* Health check */
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'DistritoPhone Rastreo API', version: '1.0.0' });
});

/* Rastreo principal */
app.get('/track', async (req, res) => {
  const { carrier, guia } = req.query;

  if (!carrier || !guia) {
    return res.status(400).json({ error: 'Parámetros requeridos: carrier, guia' });
  }

  const carrierId = carrier.toLowerCase().trim();
  const guiaClean = guia.trim();

  if (!SCRAPERS[carrierId]) {
    return res.status(400).json({
      error: 'Empresa no soportada',
      soportadas: Object.keys(SCRAPERS)
    });
  }

  try {
    const result = await SCRAPERS[carrierId](guiaClean);
    return res.json({ ok: true, ...result });
  } catch (err) {
    console.error(`[${carrierId}] Error rastreando ${guiaClean}:`, err.message);
    return res.status(502).json({
      ok: false,
      error: 'No se pudo obtener el estado. La empresa puede estar bloqueando el acceso.',
      carrier: carrierId,
      guia: guiaClean,
      url: SCRAPERS[carrierId] ? `https://www.${carrierId}.com` : null
    });
  }
});

/* Lista de empresas soportadas */
app.get('/carriers', (req, res) => {
  res.json({
    carriers: Object.keys(SCRAPERS).map(id => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1)
    }))
  });
});

app.listen(PORT, () => {
  console.log(`DistritoPhone Rastreo API corriendo en puerto ${PORT}`);
});
