/**
 * dp-rastreo-server — DistritoPhone.
 * Usa la API de AfterShip para rastrear guías de cualquier mensajería.
 * La API Key se lee de la variable de entorno AFTERSHIP_API_KEY (Render).
 */

const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');

const app  = express();
const PORT = process.env.PORT || 10000;
const AFTERSHIP_KEY = process.env.AFTERSHIP_API_KEY;

app.use(cors());
app.use(express.json());

/* ── Mapa: ID interno → slug de AfterShip ── */
const CARRIER_SLUGS = {
  coordinadora:    'coordinadora',
  servientrega:    'servientrega',
  envia:           'envia-colombia',
  tcc:             'tcc-colombia',
  interrapidisimo: 'interrapidisimo',
  deprisa:         'deprisa',
  fedex:           'fedex',
  dhl:             'dhl'
};

/* ── Mapa: ID interno → URL de fallback ── */
const FALLBACK_URLS = {
  coordinadora:    'https://www.coordinadora.com/portafolio-de-servicios/servicios-en-linea/rastrear-guias/?guia=',
  servientrega:    'https://www.servientrega.com/wps/portal/tracking-masivo?id=',
  envia:           'https://www.envia.co/rastreo?tracking=',
  tcc:             'https://www.tcc.com.co/rastrear?guia=',
  interrapidisimo: 'https://interrapidisimo.com/rastreo/?codigo=',
  deprisa:         'https://www.deprisa.com/rastreo?guia=',
  fedex:           'https://www.fedex.com/fedextrack/?tracknumbers=',
  dhl:             'https://www.dhl.com/co-es/home/rastrear.html?tracking-id='
};

/* ── Health check ── */
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'DistritoPhone Rastreo API v2 (AfterShip)', version: '2.0.0' });
});

/* ── Rastreo principal ── */
app.get('/track', async (req, res) => {
  const { carrier, guia } = req.query;

  if (!carrier || !guia) {
    return res.status(400).json({ ok: false, error: 'Parámetros requeridos: carrier, guia' });
  }

  const carrierId = carrier.toLowerCase().trim();
  const guiaClean = guia.trim();
  const fallbackUrl = (FALLBACK_URLS[carrierId] || '') + encodeURIComponent(guiaClean);

  if (!AFTERSHIP_KEY) {
    return res.status(500).json({ ok: false, error: 'API key no configurada', url: fallbackUrl });
  }

  const slug = CARRIER_SLUGS[carrierId];
  if (!slug) {
    return res.status(400).json({ ok: false, error: 'Empresa no soportada', url: fallbackUrl });
  }

  try {
    /* Paso 1: crear/obtener tracking en AfterShip */
    const createRes = await fetch('https://api.aftership.com/v4/trackings', {
      method: 'POST',
      headers: {
        'aftership-api-key': AFTERSHIP_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tracking: {
          slug: slug,
          tracking_number: guiaClean
        }
      })
    });
    const createData = await createRes.json();

    /* 4001 = ya existe, también es válido */
    let trackingData = null;
    if (createData.meta && (createData.meta.code === 201 || createData.meta.code === 4001)) {
      /* Paso 2: obtener detalles */
      const getRes = await fetch(
        `https://api.aftership.com/v4/trackings/${slug}/${encodeURIComponent(guiaClean)}`,
        {
          headers: { 'aftership-api-key': AFTERSHIP_KEY }
        }
      );
      const getData = await getRes.json();
      if (getData.data && getData.data.tracking) {
        trackingData = getData.data.tracking;
      }
    } else if (createData.data && createData.data.tracking) {
      trackingData = createData.data.tracking;
    }

    if (!trackingData) {
      return res.json({
        ok: true,
        carrier: carrierId,
        guia: guiaClean,
        estadoActual: 'Sin información disponible',
        eventos: [],
        url: fallbackUrl,
        rawFound: false
      });
    }

    /* Mapear estado de AfterShip a español */
    const statusMap = {
      'Delivered':          'Entregado',
      'InTransit':          'En tránsito',
      'OutForDelivery':     'En reparto',
      'AttemptFail':        'Intento fallido de entrega',
      'Pending':            'Pendiente',
      'InfoReceived':       'Información recibida',
      'Exception':          'Novedad / Excepción',
      'Expired':            'Guía vencida',
      'AvailableForPickup': 'Disponible para recoger'
    };

    const estadoRaw = trackingData.tag || '';
    const estadoActual = trackingData.subtag_message
      || statusMap[estadoRaw]
      || estadoRaw
      || 'Sin información';

    /* Convertir checkpoints a eventos */
    const eventos = (trackingData.checkpoints || []).map(cp => ({
      fecha:  cp.checkpoint_time ? new Date(cp.checkpoint_time).toLocaleString('es-CO') : '',
      estado: cp.subtag_message || cp.message || cp.tag || '',
      ciudad: [cp.city, cp.state, cp.country_name].filter(Boolean).join(', ')
    })).filter(e => e.estado);

    return res.json({
      ok: true,
      carrier: trackingData.slug || carrierId,
      guia: guiaClean,
      estadoActual,
      destinatario: trackingData.customer_name || '',
      origen: trackingData.origin_country_iso3 || '',
      destino: trackingData.destination_country_iso3 || '',
      eventos,
      url: fallbackUrl,
      rawFound: eventos.length > 0
    });

  } catch (err) {
    console.error(`[${carrierId}] Error:`, err.message);
    return res.status(502).json({
      ok: false,
      error: 'Error consultando el estado',
      carrier: carrierId,
      guia: guiaClean,
      url: fallbackUrl
    });
  }
});

/* ── Lista de empresas ── */
app.get('/carriers', (req, res) => {
  res.json({ carriers: Object.keys(CARRIER_SLUGS) });
});

app.listen(PORT, () => {
  console.log(`DistritoPhone Rastreo API v2 corriendo en puerto ${PORT}`);
});
