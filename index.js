const express = require('express');
const { google } = require('googleapis');
const https = require('https');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// IDs de Google Sheets y Drive
const SPREADSHEET_ID = process.env.SPREADSHEET_ID; // Principal de Gastos
const SPREADSHEET_PRECIOS_ID = process.env.SPREADSHEET_PRECIOS_ID || '1Cscdoi4k3BkHLWPSB9nSxrGyZsshRXMKEtx2jbBcIQ0';
const SPREADSHEET_EXTRAS_ID = process.env.SPREADSHEET_EXTRAS_ID || '1uO9QMilrhjooFgsqF7Nu7GA4WYEV94QZRNjwQj2Jz5o';
const SPREADSHEET_PERSONAL_ID = process.env.SPREADSHEET_PERSONAL_ID || '1LU5V21D9wPILoq6HHEBqxJc9mE7EwDMJEnwpvQHnpFQ';
const DRIVE_FOLDER_EXTRAS_ID = process.env.DRIVE_FOLDER_EXTRAS_ID || '1ZTIGfyRjFa0Yn1MMUMjOzWiPi810vVvw';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const sesiones = {};

// Mapeo de Números de Teléfono a Nombres
const DIRECTORIO_USUARIOS = {
  '3336673972': 'Paty',
  '3314107902': 'Rigo',
  '3331747434': 'Miguelonches',
  '3314856080': 'Gato',
  '3313008395': 'Cris'
};

// Categorías agrupadas por Etapas de Obra
const ETAPA_1_ESTRUCTURA = [
  { id: 'CAT_1', title: '01) PREELIMINARES' },
  { id: 'CAT_2', title: '02) ALBAÑILERIA MDO' },
  { id: 'CAT_4', title: '04) PISOS RECUBR. MDO' },
  { id: 'CAT_5', title: '05) PISOS RECUBR. MAT' },
  { id: 'CAT_6', title: '06) EST. CONCRETO MDO' },
  { id: 'CAT_7', title: '07) EST. CONCRETO MAT' },
  { id: 'CAT_8', title: '08) MDO EST. METALICA' },
  { id: 'CAT_10', title: '10) CUBIERTAS LAMINA' }
];

const ETAPA_2_ACABADOS = [
  { id: 'CAT_11', title: '11) MDO HERRERIA' },
  { id: 'CAT_13', title: '13) PLAFOND Y TABLAROCA' },
  { id: 'CAT_14', title: '14) ALUMINIO Y VIDRIOS' },
  { id: 'CAT_16', title: '16) PINTURA' },
  { id: 'CAT_17', title: '17) CUBIERTAS' },
  { id: 'CAT_18', title: '18) ANUNCIO MAT' },
  { id: 'CAT_21', title: '21) INST HIDRAULICA' },
  { id: 'CAT_22', title: '22) DRENAJES' }
];

const ETAPA_3_CAMPO = [
  { id: 'CAT_15', title: '15) CARPINTERIA' },
  { id: 'CAT_19', title: '19) LIMPIEZA Y ACARREOS' },
  { id: 'CAT_23', title: '23) TERRACERIA / MOV.' },
  { id: 'CAT_24', title: '24) VIATICOS' }
];

const ETAPA_4_ADMIN = [
  { id: 'CAT_20', title: '20) VARIOS' },
  { id: 'CAT_26', title: '26) IMSS / ISN' },
  { id: 'CAT_27', title: '27) CONTABILIDAD' },
  { id: 'CAT_28', title: '28) RESIDENCIA DE OBRA' }
];

const CONTRATISTAS_VALIDOS = ['tablaroca', 'aluminio y vidrio', 'aluminio', 'cortinas', 'pintura', 'cubiertas'];

function obtenerNombreUsuario(numeroFrom) {
  if (!numeroFrom) return 'Usuario WhatsApp';
  const diezDigitos = numeroFrom.replace(/\D/g, '').slice(-10);
  return DIRECTORIO_USUARIOS[diezDigitos] || `Usuario (${diezDigitos})`;
}

let sheets, drive;

try {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );

  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });

  sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  drive = google.drive({ version: 'v3', auth: oauth2Client });
  console.log('✅ Google OAuth2 (Sheets + Drive) configurado correctamente.');
} catch (error) {
  console.error('❌ Error OAuth2 Google:', error.message);
}

function enviarPeticionMeta(payload) {
  return new Promise((resolve) => {
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
      console.error('❌ Falta WHATSAPP_TOKEN o PHONE_NUMBER_ID');
      return resolve();
    }

    const data = JSON.stringify(payload);
    const options = {
      hostname: 'graph.facebook.com',
      port: 443,
      path: `/v18.0/${PHONE_NUMBER_ID.trim()}/messages`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN.trim()}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });

    req.on('error', (error) => {
      console.error('❌ Error HTTPS Meta:', error.message);
      resolve();
    });

    req.write(data);
    req.end();
  });
}

async function enviarTexto(to, texto) {
  await enviarPeticionMeta({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: texto }
  });
}

async function enviarBotones(to, textoBody, botones) {
  const buttonsPayload = botones.map((b) => ({
    type: 'reply',
    reply: { id: b.id, title: b.title.substring(0, 20) }
  }));

  await enviarPeticionMeta({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: textoBody },
      action: { buttons: buttonsPayload }
    }
  });
}

async function enviarLista(to, textoBody, tituloBoton, tituloSeccion, opciones) {
  const rowsPayload = opciones.map(o => ({
    id: o.id,
    title: o.title.substring(0, 24),
    description: o.description ? o.description.substring(0, 72) : ''
  }));

  await enviarPeticionMeta({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: textoBody },
      action: {
        button: tituloBoton.substring(0, 20),
        sections: [{ title: tituloSeccion.substring(0, 24), rows: rowsPayload }]
      }
    }
  });
}

// GOOGLE DRIVE
async function obtenerOcrearSubcarpetaObra(nombreObra) {
  if (!drive || !DRIVE_FOLDER_EXTRAS_ID) return DRIVE_FOLDER_EXTRAS_ID;
  try {
    const q = `'${DRIVE_FOLDER_EXTRAS_ID}' in parents and name = '${nombreObra}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const res = await drive.files.list({ q, fields: 'files(id, name)' });
    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0].id;
    }
    const folderMetadata = {
      name: nombreObra,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [DRIVE_FOLDER_EXTRAS_ID]
    };
    const folder = await drive.files.create({ resource: folderMetadata, fields: 'id' });
    return folder.data.id;
  } catch (error) {
    console.error('❌ Error en Drive Subcarpeta:', error.message);
    return DRIVE_FOLDER_EXTRAS_ID;
  }
}

function descargarImagenWhatsApp(imageId) {
  return new Promise((resolve, reject) => {
    const optionsUrl = {
      hostname: 'graph.facebook.com',
      port: 443,
      path: `/v18.0/${imageId}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN.trim()}` }
    };

    https.get(optionsUrl, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          const downloadUrl = json.url;

          https.get(downloadUrl, { headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN.trim()}` } }, (stream) => {
            const chunks = [];
            stream.on('data', chunk => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
          }).on('error', reject);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function subirFotoADrive(buffer, nombreArchivo, folderId) {
  if (!drive) return 'N/A';
  try {
    const Readable = require('stream').Readable;
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    const fileMetadata = { name: nombreArchivo, parents: [folderId] };
    const media = { mimeType: 'image/jpeg', body: stream };

    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id, webViewLink'
    });

    await drive.permissions.create({
      fileId: file.data.id,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    return file.data.webViewLink;
  } catch (error) {
    console.error('❌ Error subiendo a Drive:', error.message);
    return 'Error Subida';
  }
}

// GOOGLE SHEETS
async function guardarEnSheets(datos) {
  if (!sheets || !SPREADSHEET_ID) return;
  try {
    const fechaHora = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    const metodoCompleto = datos.subMetodo ? `${datos.metodo} (${datos.subMetodo})` : datos.metodo;

    const valores = [[
      datos.idMovimiento,
      fechaHora,
      datos.obra,
      metodoCompleto,
      datos.categoria,
      datos.monto,
      datos.concepto,
      datos.usuario || 'Usuario WhatsApp',
      datos.estatusFactura || 'No Requiere 🔴',
      datos.linkFactura || 'N/A'
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:J',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: valores }
    });
    console.log(`✅ Registrado en Sheets Principal: ${datos.idMovimiento}`);
  } catch (error) {
    console.error('❌ Error guardando en Sheets:', error.message);
  }
}

async function guardarTrabajoExtra(datos) {
  if (!sheets || !SPREADSHEET_EXTRAS_ID) return;
  try {
    const fechaHora = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_EXTRAS_ID,
      range: 'Extras!A:A'
    });
    const filas = res.data.values || [];
    const numFila = Math.max(1, filas.length - 1);

    const valores = [[
      numFila,
      datos.idExtra,
      fechaHora,
      datos.obra,
      datos.descripcion,
      datos.monto,
      datos.linksFotos.join('\n'),
      datos.usuario,
      'Pendiente 🟡'
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_EXTRAS_ID,
      range: 'Extras!A:I',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: valores }
    });
    console.log(`✅ Trabajo Extra registrado: ${datos.idExtra}`);
  } catch (error) {
    console.error('❌ Error guardando trabajo extra:', error.message);
  }
}

async function guardarTrabajador(datos) {
  if (!sheets || !SPREADSHEET_PERSONAL_ID) return;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_PERSONAL_ID,
      range: 'PLANTILLA_PERSONAL!A:A'
    });
    const filas = res.data.values || [];
    const numFila = Math.max(1, filas.length - 1);

    const valores = [[
      numFila,
      datos.idTrabajador,
      datos.nombre,
      datos.obra,
      datos.tipo,
      datos.sueldo
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_PERSONAL_ID,
      range: 'PLANTILLA_PERSONAL!A:F',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: valores }
    });
    console.log(`✅ Trabajador registrado: ${datos.nombre}`);
  } catch (error) {
    console.error('❌ Error guardando trabajador:', error.message);
  }
}

async function guardarVisitaFamiliar(datos) {
  if (!sheets || !SPREADSHEET_PERSONAL_ID) return;
  try {
    const fechaSalida = new Date();
    const fechaSugerida = new Date(fechaSalida.getTime() + (45 * 24 * 60 * 60 * 1000));

    const fechaSalidaStr = fechaSalida.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });
    const fechaSugeridaStr = fechaSugerida.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_PERSONAL_ID,
      range: 'VISITAS_FAMILIARES!A:A'
    });
    const filas = res.data.values || [];
    const numFila = Math.max(1, filas.length - 1);

    const valores = [[
      numFila,
      fechaSalidaStr,
      datos.nombre,
      datos.obra,
      datos.monto,
      fechaSugeridaStr,
      datos.usuario
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_PERSONAL_ID,
      range: 'VISITAS_FAMILIARES!A:G',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: valores }
    });
    console.log(`✅ Visita Familiar registrada: ${datos.nombre}`);
  } catch (error) {
    console.error('❌ Error guardando visita familiar:', error.message);
  }
}

async function guardarPrecioHistorico(datos) {
  if (!sheets || !SPREADSHEET_PRECIOS_ID) return;
  try {
    const fechaHora = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_PRECIOS_ID,
      range: 'PRECIOS!A:A'
    });
    const filas = res.data.values || [];
    const numFila = Math.max(1, filas.length - 1);

    const valores = [[
      numFila,
      fechaHora,
      datos.obra,
      datos.material,
      datos.unidad,
      datos.precio,
      datos.proveedor,
      datos.usuario
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_PRECIOS_ID,
      range: 'PRECIOS!A:H',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: valores }
    });
    console.log(`✅ Precio histórico registrado: ${datos.material}`);
  } catch (error) {
    console.error('❌ Error guardando precio histórico:', error.message);
  }
}

async function buscarHistoricoPrecios(materialBuscado) {
  if (!sheets || !SPREADSHEET_PRECIOS_ID) return [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_PRECIOS_ID,
      range: 'PRECIOS!A:H'
    });
    const filas = res.data.values || [];
    const resultados = [];

    for (let i = 2; i < filas.length; i++) {
      const fila = filas[i];
      const fecha = fila[1] || '';
      const obra = fila[2] || '';
      const mat = (fila[3] || '').toLowerCase();
      const unidad = fila[4] || '';
      let precioStr = (fila[5] || '0').toString().replace('$', '').replace(/,/g, '').trim();
      const precio = parseFloat(precioStr) || 0;
      const proveedor = fila[6] || 'No especificado';

      if (mat.includes(materialBuscado.toLowerCase())) {
        resultados.push({ fecha, obra, material: fila[3], unidad, precio, proveedor });
      }
    }

    resultados.sort((a, b) => a.precio - b.precio);
    return resultados;
  } catch (error) {
    console.error('❌ Error buscando precios:', error.message);
    return [];
  }
}

async function cancelarUltimoRegistro() {
  if (!sheets || !SPREADSHEET_ID) return null;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:I'
    });
    const filas = res.data.values || [];
    if (filas.length < 2) return null;

    for (let i = filas.length - 1; i >= 1; i--) {
      const estatusActual = filas[i][8] || '';
      if (!estatusActual.includes('CANCELADO')) {
        const filaIndex = i + 1;
        const idMovimiento = filas[i][0];
        const concepto = filas[i][6];
        const monto = filas[i][5];

        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `Hoja 1!F${filaIndex}:I${filaIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[0, concepto, filas[i][7] || '', '❌ CANCELADO']] }
        });

        return { idMovimiento, concepto, monto };
      }
    }
    return null;
  } catch (error) {
    console.error('❌ Error cancelando registro:', error.message);
    return null;
  }
}

async function obtenerMovimientosPendientes() {
  if (!sheets || !SPREADSHEET_ID) return [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:I'
    });
    const filas = res.data.values || [];
    const pendientes = [];

    for (let i = filas.length - 1; i >= 1; i--) {
      const fila = filas[i];
      const id = fila[0];
      const obra = fila[2];
      const monto = fila[5];
      const concepto = fila[6];
      const estatus = fila[8] || '';

      if (estatus.includes('Pendiente 🟡')) {
        pendientes.push({ id, obra, concepto, monto });
      }
      if (pendientes.length >= 10) break;
    }
    return pendientes;
  } catch (error) {
    console.error('❌ Error obteniendo pendientes:', error.message);
    return [];
  }
}

async function marcarComoFacturado(idMovimiento) {
  if (!sheets || !SPREADSHEET_ID) return false;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:A'
    });
    const filas = res.data.values || [];
    for (let i = 0; i < filas.length; i++) {
      if (filas[i][0] === idMovimiento) {
        const filaIndex = i + 1;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `Hoja 1!I${filaIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [['Facturado 🟢']] }
        });
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('❌ Error actualizando estatus factura:', error.message);
    return false;
  }
}

async function calcularReporteSaldos(obraBuscada) {
  if (!sheets || !SPREADSHEET_ID) return { dotacionesCaja: 0, egresosEfectivo: 0, cajaDisponible: 0, facturadoEfectivo: 0 };
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:I'
    });
    const filas = res.data.values || [];
    let dotacionesCaja = 0;
    let egresosEfectivo = 0;
    let facturadoEfectivo = 0;

    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i];
      const obra = fila[2] || '';
      const metodo = fila[3] || '';
      let montoStr = (fila[5] || '0').toString().replace('$', '').replace(/,/g, '').trim();
      const monto = parseFloat(montoStr) || 0;
      const estatus = fila[8] || '';

      if (estatus.includes('CANCELADO')) continue;

      if (metodo.includes('Dotación Caja Chica')) {
        dotacionesCaja += monto;
      } else if (metodo.startsWith('Efectivo')) {
        if (!obraBuscada || obra.toLowerCase() === obraBuscada.toLowerCase()) {
          egresosEfectivo += monto;
          if (estatus.includes('Facturado 🟢')) {
            facturadoEfectivo += monto;
          }
        }
      }
    }

    return {
      dotacionesCaja,
      egresosEfectivo,
      cajaDisponible: dotacionesCaja - egresosEfectivo,
      facturadoEfectivo
    };
  } catch (error) {
    console.error('❌ Error en reporte saldos:', error.message);
    return { dotacionesCaja: 0, egresosEfectivo: 0, cajaDisponible: 0, facturadoEfectivo: 0 };
  }
}

async function calcularReporteContratistas(obraBuscada) {
  if (!sheets || !SPREADSHEET_ID) return {};
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:I'
    });
    const filas = res.data.values || [];
    const resultado = {};

    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i];
      const obra = fila[2] || '';
      const concepto = (fila[6] || '').toLowerCase();
      const categoria = (fila[4] || '').toLowerCase();
      let montoStr = (fila[5] || '0').toString().replace('$', '').replace(/,/g, '').trim();
      const monto = parseFloat(montoStr) || 0;
      const estatus = fila[8] || '';

      if (estatus.includes('CANCELADO')) continue;

      if (obraBuscada && obra.toLowerCase() !== obraBuscada.toLowerCase()) continue;

      CONTRATISTAS_VALIDOS.forEach(c => {
        if (!resultado[c]) resultado[c] = { totalContrato: 0, pagado: 0 };

        if (concepto.includes(`contrato ${c}`)) {
          resultado[c].totalContrato += monto;
        } else if (concepto.includes(c) || categoria.includes(c)) {
          resultado[c].pagado += monto;
        }
      });
    }
    return resultado;
  } catch (error) {
    console.error('❌ Error calculando contratistas:', error.message);
    return {};
  }
}

async function calcularReportePresupuestos() {
  if (!sheets || !SPREADSHEET_ID) return {};
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:I'
    });
    const filas = res.data.values || [];
    const obras = ['Suc. Pelicano', 'Suc. Caldera', 'Suc. Nativitas', 'Suc. Salud', 'Suc. Otro'];
    const resultado = {};

    obras.forEach(o => resultado[o] = { presupuestoTotal: 0, liberado: 0 });

    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i];
      const obra = fila[2] || '';
      const metodo = fila[3] || '';
      const concepto = (fila[6] || '').toLowerCase();
      let montoStr = (fila[5] || '0').toString().replace('$', '').replace(/,/g, '').trim();
      const monto = parseFloat(montoStr) || 0;
      const estatus = fila[8] || '';

      if (estatus.includes('CANCELADO')) continue;

      if (resultado[obra]) {
        if (concepto.includes('presupuesto total autorizado')) {
          resultado[obra].presupuestoTotal += monto;
        } else if (metodo.includes('Ingreso Presupuesto')) {
          resultado[obra].liberado += monto;
        }
      }
    }
    return resultado;
  } catch (error) {
    console.error('❌ Error calculando presupuestos:', error.message);
    return {};
  }
}

async function desplegarMenuPrincipal(from) {
  const opciones = [
    { id: 'MENU_PERSONAL', title: '👷‍♂️ Personal Propio', description: 'Altas de trabajadores y Visitas Familiares' },
    { id: 'MENU_CONTRATISTAS', title: '🤝 Contratistas / Destajos', description: 'Asignación de contratos y consulta de saldos' },
    { id: 'MENU_EXTRAS', title: '🔨 Trabajos Extras', description: 'Registro de extras con evidencia fotográfica' },
    { id: 'MENU_PRESU', title: '🏦 Presupuestos e Ingresos', description: 'Presupuesto autorizado y cobro a clientes' },
    { id: 'MENU_PRECIOS', title: '🏷️ Precios de Materiales', description: 'Registrar precio y comparar histórico' },
    { id: 'MENU_REPORTES', title: '📊 Saldos y Reportes', description: 'Caja chica, avance y facturas pendientes' }
  ];

  await enviarLista(from, '🏗️ *MENÚ ADMINISTRATIVO DE OBRA*\n\nSelecciona la gestión que deseas realizar:', 'Abrir Menú', 'Gestión de Obra', opciones);
}

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) res.status(200).send(challenge);
  else res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object && body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]) {
    const msg = body.entry[0].changes[0].value.messages[0];
    const from = msg.from;
    const nombreUsuario = obtenerNombreUsuario(from);

    // IMÁGENES
    if (msg.type === 'image') {
      const sesionActual = sesiones[from];
      if (sesionActual && sesionActual.esperandoFotosExtra) {
        const imageId = msg.image.id;
        const subfolderId = await obtenerOcrearSubcarpetaObra(sesionActual.obra);
        const numFoto = sesionActual.linksFotos.length + 1;
        const nombreArchivo = `${sesionActual.idExtra}_${sesionActual.obra.replace(/\s+/g, '_')}_Foto${numFoto}.jpg`;

        try {
          const buffer = await descargarImagenWhatsApp(imageId);
          const driveLink = await subirFotoADrive(buffer, nombreArchivo, subfolderId);
          sesionActual.linksFotos.push(driveLink);

          await enviarBotones(from, `📸 *Foto ${numFoto} guardada correctamente en Drive.*\n\n¿Deseas agregar otra evidencia o finalizar?`, [
            { id: 'EXTRAFOTO_OTRA', title: '📸 Agregar Foto' },
            { id: 'EXTRAFOTO_FIN', title: '✅ Finalizar' }
          ]);
        } catch (e) {
          console.error('❌ Error procesando foto WhatsApp:', e.message);
          await enviarTexto(from, '⚠️ Error guardando la foto. Intenta enviarla nuevamente.');
        }
        res.sendStatus(200);
        return;
      }
    }

    if (msg.type === 'text') {
      const textBody = msg.text.body.trim();

      // DESPLEGAR MENÚ PRINCIPAL
      if (/^(menu|hola|inicio|ayuda|comandos)$/i.test(textBody)) {
        await desplegarMenuPrincipal(from);
        res.sendStatus(200);
        return;
      }

      // CANCELAR ÚLTIMO
      if (/^(cancelar|borrar ultimo)$/i.test(textBody)) {
        const cancelado = await cancelarUltimoRegistro();
        if (cancelado) {
          await enviarTexto(from, `❌ *Último registro cancelado correctamente:*\n\n🆔 *ID:* ${cancelado.idMovimiento}\n📝 *Concepto:* ${cancelado.concepto}\n💵 *Monto original:* $${cancelado.monto}\n\n*El monto ha sido ajustado a $0.00 en Sheets.*`);
        } else {
          await enviarTexto(from, '⚠️ No se encontró ningún registro previo para cancelar.');
        }
        res.sendStatus(200);
        return;
      }

      const sesionActual = sesiones[from];

      // ENTRADAS DE TEXTO LIBRE
      if (sesionActual && sesionActual.esperandoNombreTrabajadorAlta) {
        sesionActual.nombre = textBody.toUpperCase();
        delete sesionActual.esperandoNombreTrabajadorAlta;

        await enviarBotones(from, `👷‍♂️ *Trabajador:* ${sesionActual.nombre}\n\n🏗️ *¿A qué Obra/Sucursal pertenece?*`, [
          { id: 'EMPOBRA_Pelicano', title: 'Pelicano' },
          { id: 'EMPOBRA_Caldera', title: 'Caldera' },
          { id: 'EMPOBRA_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Opciones:*', [
          { id: 'EMPOBRA_Salud', title: 'Salud' },
          { id: 'EMPOBRA_Otro', title: 'Otro' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (sesionActual && sesionActual.esperandoSueldoTrabajador) {
        sesionActual.sueldo = parseFloat(textBody) || 0;
        delete sesionActual.esperandoSueldoTrabajador;

        await guardarTrabajador(sesionActual);
        await enviarTexto(from, `✅ *Trabajador Registrado con Éxito*\n\n🆔 *ID:* ${sesionActual.idTrabajador}\n👤 *Nombre:* ${sesionActual.nombre}\n🏗️ *Obra:* ${sesionActual.obra}\n📌 *Tipo:* ${sesionActual.tipo}\n💵 *Sueldo Semanal:* $${sesionActual.sueldo.toFixed(2)}`);
        delete sesiones[from];
        res.sendStatus(200);
        return;
      }

      if (sesionActual && sesionActual.esperandoNombreVisita) {
        sesionActual.nombre = textBody.toUpperCase();
        delete sesionActual.esperandoNombreVisita;
        sesionActual.esperandoMontoVisita = true;

        await enviarTexto(from, `👤 *Trabajador:* ${sesionActual.nombre}\n\n💵 *Escribe el Monto del Apoyo de Pasaje/Viáticos:*`);
        res.sendStatus(200);
        return;
      }

      if (sesionActual && sesionActual.esperandoMontoVisita) {
        sesionActual.monto = parseFloat(textBody) || 0;
        delete sesionActual.esperandoMontoVisita;

        await enviarBotones(from, `🚌 *Visita Familiar (${sesionActual.nombre}):* $${sesionActual.monto.toFixed(2)}\n\n🏗️ *¿A qué Obra/Sucursal se aplican estos viáticos?*`, [
          { id: 'VISITAOBRA_Pelicano', title: 'Pelicano' },
          { id: 'VISITAOBRA_Caldera', title: 'Caldera' },
          { id: 'VISITAOBRA_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Opciones:*', [
          { id: 'VISITAOBRA_Salud', title: 'Salud' },
          { id: 'VISITAOBRA_Otro', title: 'Otro' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (sesionActual && sesionActual.esperandoMaterialPrecio) {
        sesionActual.material = textBody;
        delete sesionActual.esperandoMaterialPrecio;
        sesionActual.esperandoMontoPrecio = true;

        await enviarTexto(from, `🏷️ *Material:* ${sesionActual.material.toUpperCase()}\n\n💵 *Escribe el Precio o Cotización:*`);
        res.sendStatus(200);
        return;
      }

      if (sesionActual && sesionActual.esperandoMontoPrecio) {
        sesionActual.precio = parseFloat(textBody) || 0;
        delete sesionActual.esperandoMontoPrecio;

        await enviarBotones(from, `🏷️ *Material:* ${sesionActual.material.toUpperCase()}\n💵 *Precio:* $${sesionActual.precio.toFixed(2)}\n\n📐 *Selecciona la Unidad de Medida:*`, [
          { id: 'UNIDAD_Bulto', title: 'Bulto / Saco' },
          { id: 'UNIDAD_Tramo', title: 'Tramo / Pza' },
          { id: 'UNIDAD_M2', title: 'm² / m³ / Ton' }
        ]);
        await enviarBotones(from, '👇 *Otras Unidades:*', [
          { id: 'UNIDAD_Cubeta', title: 'Cubeta / Litro' },
          { id: 'UNIDAD_OTRO', title: '✏️ Otro (Escribir)' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (sesionActual && sesionActual.esperandoBusquedaPrecio) {
        delete sesionActual.esperandoBusquedaPrecio;
        const resultados = await buscarHistoricoPrecios(textBody.trim());

        if (resultados.length === 0) {
          await enviarTexto(from, `⚠️ No se encontraron precios registrados para "${textBody}".`);
        } else {
          let msgTxt = `📊 *HISTÓRICO DE PRECIOS: "${textBody.toUpperCase()}"*\n\n`;
          resultados.forEach((r, idx) => {
            const emoji = idx === 0 ? '🟢' : idx === 1 ? '🟡' : '🔴';
            msgTxt += `${emoji} *$${r.precio.toFixed(2)}* / ${r.unidad}\n` +
              `   📍 ${r.obra}\n` +
              `   🏢 Proveedor: ${r.proveedor}\n` +
              `   📝 Material: ${r.material}\n` +
              `   📅 Fecha: ${r.fecha.split(',')[0]}\n\n`;
          });
          await enviarTexto(from, msgTxt);
        }
        delete sesiones[from];
        res.sendStatus(200);
        return;
      }

      if (sesionActual && sesionActual.esperandoDescripcionExtra) {
        sesionActual.descripcion = textBody;
        delete sesionActual.esperandoDescripcionExtra;
        sesionActual.esperandoMontoExtra = true;

        await enviarTexto(from, '💵 *Escribe el Monto Estimado o Valor a cobrar por este trabajo extra:*');
        res.sendStatus(200);
        return;
      }

      if (sesionActual && sesionActual.esperandoMontoExtra) {
        sesionActual.monto = parseFloat(textBody) || 0;
        delete sesionActual.esperandoMontoExtra;
        sesionActual.esperandoFotosExtra = true;

        await enviarTexto(from, `📸 *Monto registrado:* $${sesionActual.monto.toFixed(2)}\n\n*Por favor, envía la primera FOTO de evidencia por WhatsApp:*`);
        res.sendStatus(200);
        return;
      }

      if (sesionActual && sesionActual.esperandoUnidadManual) {
        sesionActual.unidad = textBody.toLowerCase();
        delete sesionActual.esperandoUnidadManual;
        
        await enviarBotones(from, `🏷️ *Material:* ${sesionActual.material.toUpperCase()}\n💵 *Precio:* $${sesionActual.precio.toFixed(2)} / ${sesionActual.unidad}\n\n🏗️ *¿En qué Sucursal se cotizó/compró?*`, [
          { id: 'PRECIOBRA_Pelicano', title: 'Pelicano' },
          { id: 'PRECIOBRA_Caldera', title: 'Caldera' },
          { id: 'PRECIOBRA_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Opciones:*', [
          { id: 'PRECIOBRA_Salud', title: 'Salud' },
          { id: 'PRECIOBRA_Otro', title: 'Otro' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (sesionActual && sesionActual.esperandoProveedor) {
        sesionActual.proveedor = textBody;
        delete sesionActual.esperandoProveedor;

        await guardarPrecioHistorico({
          obra: sesionActual.obra,
          material: sesionActual.material,
          unidad: sesionActual.unidad,
          precio: sesionActual.precio,
          proveedor: sesionActual.proveedor,
          usuario: sesionActual.usuario
        });

        await enviarTexto(from, `✅ *Precio Histórico Guardado con Éxito*\n\n📍 *Obra/Sucursal:* ${sesionActual.obra}\n📝 *Material:* ${sesionActual.material.toUpperCase()}\n📐 *Unidad:* ${sesionActual.unidad}\n💵 *Precio:* $${sesionActual.precio.toFixed(2)}\n🏢 *Proveedor:* ${sesionActual.proveedor}\n👤 *Registró:* ${sesionActual.usuario}`);
        delete sesiones[from];
        res.sendStatus(200);
        return;
      }

      // REGISTRO DIRECTO DE GASTO RÁPIDO: "concepto monto"
      const partes = textBody.split(/\s+/);
      const posibleMonto = parseFloat(partes[partes.length - 1]);
      let concepto = '';
      let monto = 0;

      if (!isNaN(posibleMonto)) {
        concepto = partes.slice(0, -1).join(' ') || 'Gasto no especificado';
        monto = posibleMonto;
      } else {
        concepto = textBody;
        monto = 0;
      }

      sesiones[from] = {
        tipoAccion: 'GASTO',
        idMovimiento: 'MOV-' + Date.now().toString().slice(-6),
        concepto,
        monto,
        categoria: '20) VARIOS',
        obra: 'General',
        metodo: 'Efectivo',
        subMetodo: '',
        estatusFactura: 'No Requiere 🔴',
        usuario: nombreUsuario
      };

      await enviarBotones(from, `📝 *Gasto:* ${concepto} ($${monto.toFixed(2)})\n\n🏗️ *Selecciona la Sucursal:*`, [
        { id: 'OBRA_Pelicano', title: 'Pelicano' },
        { id: 'OBRA_Caldera', title: 'Caldera' },
        { id: 'OBRA_Nativitas', title: 'Nativitas' }
      ]);
      await enviarBotones(from, '👇 *Otras Opciones:*', [
        { id: 'OBRA_Salud', title: 'Salud' },
        { id: 'OBRA_Otro', title: 'Otro' }
      ]);

    } else if (msg.type === 'interactive') {
      const respuestaId = msg.interactive.button_reply?.id || msg.interactive.list_reply?.id;

      // INTERACCIONES DEL MENÚ PRINCIPAL
      if (respuestaId === 'MENU_PERSONAL') {
        await enviarBotones(from, '👷‍♂️ *Gestión de Personal Propio:*', [
          { id: 'OPC_ALTA_EMP', title: '➕ Alta Trabajador' },
          { id: 'OPC_VISITA_EMP', title: '🚌 Visita Familiar' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'MENU_CONTRATISTAS') {
        await enviarBotones(from, '🤝 *Gestión de Contratistas:*', [
          { id: 'REPCONTRATISTAS_GLOBAL', title: '📊 Ver Saldos' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'MENU_EXTRAS') {
        sesiones[from] = {
          tipoAccion: 'TRABAJO_EXTRA',
          idExtra: 'EXT-' + Date.now().toString().slice(-6),
          linksFotos: [],
          usuario: nombreUsuario
        };
        await enviarBotones(from, '🔨 *Registro de Trabajo Extra*\n\n🏗️ *¿De qué Sucursal/Obra es el trabajo extra?*', [
          { id: 'EXTRAOBRA_Pelicano', title: 'Pelicano' },
          { id: 'EXTRAOBRA_Caldera', title: 'Caldera' },
          { id: 'EXTRAOBRA_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Opciones:*', [
          { id: 'EXTRAOBRA_Salud', title: 'Salud' },
          { id: 'EXTRAOBRA_Otro', title: 'Otro' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'MENU_PRECIOS') {
        await enviarBotones(from, '🏷️ *Historico de Precios:*', [
          { id: 'OPC_REG_PRECIO', title: '📝 Registrar Precio' },
          { id: 'OPC_BUS_PRECIO', title: '🔍 Comparar / Buscar' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'MENU_REPORTES') {
        await enviarBotones(from, '📊 *Saldos y Reportes:*', [
          { id: 'REP_GLOBAL', title: '💰 Caja Chica' },
          { id: 'OPC_VER_FAC', title: '📄 Facturas Pendientes' }
        ]);
        res.sendStatus(200);
        return;
      }

      // SUBOPCIONES DE MENÚ
      if (respuestaId === 'OPC_ALTA_EMP') {
        sesiones[from] = {
          tipoAccion: 'ALTA_TRABAJADOR',
          idTrabajador: 'EMP-' + Date.now().toString().slice(-6),
          esperandoNombreTrabajadorAlta: true,
          usuario: nombreUsuario
        };
        await enviarTexto(from, '✏️ *Escribe el Nombre Completo del nuevo trabajador:*');
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'OPC_VISITA_EMP') {
        sesiones[from] = {
          tipoAccion: 'VISITA_FAMILIAR',
          esperandoNombreVisita: true,
          usuario: nombreUsuario
        };
        await enviarTexto(from, '✏️ *Escribe el Nombre del trabajador que realiza la visita:*');
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'OPC_REG_PRECIO') {
        sesiones[from] = {
          tipoAccion: 'REGISTRO_PRECIO_HISTORICO',
          esperandoMaterialPrecio: true,
          usuario: nombreUsuario
        };
        await enviarTexto(from, '✏️ *Escribe el nombre del Material a registrar:* (ej: cemento tolteca, varilla 3/8)');
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'OPC_BUS_PRECIO') {
        sesiones[from] = { esperandoBusquedaPrecio: true };
        await enviarTexto(from, '🔍 *Escribe el material que deseas buscar/comparar:* (ej: cemento, impermeabilizante)');
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'OPC_VER_FAC') {
        const pendientes = await obtenerMovimientosPendientes();
        if (pendientes.length === 0) {
          await enviarTexto(from, '🎉 ¡Excelente! No hay gastos pendientes de factura.');
        } else {
          const opciones = pendientes.map(p => ({
            id: `RESOLVER_${p.id}`,
            title: p.concepto,
            description: `${p.obra} | $${p.monto} (${p.id})`
          }));
          await enviarLista(from, '📋 *Gastos Pendientes de Factura:*', 'Ver Pendientes', 'Selecciona para resolver:', opciones);
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('RESOLVER_')) {
        const idMov = respuestaId.replace('RESOLVER_', '');
        const ok = await marcarComoFacturado(idMov);
        if (ok) {
          await enviarTexto(from, `🟢 *Gasto (${idMov}) actualizado correctamente a Facturado 🟢*`);
        } else {
          await enviarTexto(from, '⚠️ No se pudo actualizar el gasto.');
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'EXTRAFOTO_OTRA') {
        await enviarTexto(from, '📸 *Envía la siguiente foto de evidencia:*');
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'EXTRAFOTO_FIN') {
        const sesion = sesiones[from];
        if (sesion) {
          await guardarTrabajoExtra(sesion);
          await enviarTexto(from, `✅ *Trabajo Extra Guardado con Éxito*\n\n🆔 *ID:* ${sesion.idExtra}\n🏗️ *Obra:* ${sesion.obra}\n📝 *Descripción:* ${sesion.descripcion}\n💵 *Monto Estimado:* $${sesion.monto.toFixed(2)}\n📷 *Fotos en Drive:* ${sesion.linksFotos.length} archivo(s)\n👤 *Registró:* ${sesion.usuario}`);
          delete sesiones[from];
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('EXTRAOBRA_')) {
        const obraMap = {
          'EXTRAOBRA_Pelicano': 'Suc. Pelicano',
          'EXTRAOBRA_Caldera': 'Suc. Caldera',
          'EXTRAOBRA_Nativitas': 'Suc. Nativitas',
          'EXTRAOBRA_Salud': 'Suc. Salud',
          'EXTRAOBRA_Otro': 'Suc. Otro'
        };
        const sesion = sesiones[from];
        if (sesion) {
          sesion.obra = obraMap[respuestaId] || 'Suc. Otro';
          sesion.esperandoDescripcionExtra = true;
          await enviarTexto(from, '✏️ *Escribe la descripción detallada del trabajo extra:* (Mediciones, conceptos de albañilería, demoliciones, etc.)');
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('EMPOBRA_')) {
        const obraMap = {
          'EMPOBRA_Pelicano': 'Suc. Pelicano',
          'EMPOBRA_Caldera': 'Suc. Caldera',
          'EMPOBRA_Nativitas': 'Suc. Nativitas',
          'EMPOBRA_Salud': 'Suc. Salud',
          'EMPOBRA_Otro': 'Suc. Otro'
        };
        const sesion = sesiones[from];
        if (sesion) {
          sesion.obra = obraMap[respuestaId] || 'Suc. Otro';
          await enviarBotones(from, '📌 *¿El trabajador es Local o Foráneo?*', [
            { id: 'EMPTIPO_Local', title: 'Local' },
            { id: 'EMPTIPO_Foraneo', title: 'Foráneo' }
          ]);
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('EMPTIPO_')) {
        const sesion = sesiones[from];
        if (sesion) {
          sesion.tipo = respuestaId === 'EMPTIPO_Local' ? 'Local' : 'Foráneo';
          sesion.esperandoSueldoTrabajador = true;
          await enviarTexto(from, '💵 *Escribe el Sueldo Semanal del trabajador:*');
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('VISITAOBRA_')) {
        const obraMap = {
          'VISITAOBRA_Pelicano': 'Suc. Pelicano',
          'VISITAOBRA_Caldera': 'Suc. Caldera',
          'VISITAOBRA_Nativitas': 'Suc. Nativitas',
          'VISITAOBRA_Salud': 'Suc. Salud',
          'VISITAOBRA_Otro': 'Suc. Otro'
        };
        const sesion = sesiones[from];
        if (sesion) {
          sesion.obra = obraMap[respuestaId] || 'Suc. Otro';

          await guardarEnSheets({
            idMovimiento: 'VIS-' + Date.now().toString().slice(-6),
            obra: sesion.obra,
            metodo: 'Efectivo',
            subMetodo: '',
            categoria: '24) VIATICOS',
            monto: sesion.monto,
            concepto: `Pasajes Visita Familiar (${sesion.nombre})`,
            usuario: sesion.usuario,
            estatusFactura: 'No Requiere 🔴',
            linkFactura: 'N/A'
          });

          await guardarVisitaFamiliar(sesion);

          const fechaProxima = new Date(Date.now() + (45 * 24 * 60 * 60 * 1000)).toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });

          await enviarTexto(from, `✅ *Visita Familiar Registrada con Éxito*\n\n👤 *Trabajador:* ${sesion.nombre}\n🏗️ *Obra Afectada:* ${sesion.obra}\n💵 *Monto Apoyo:* $${sesion.monto.toFixed(2)}\n📅 *Próxima Visita Sugerida (+45 días):* ${fechaProxima}\n\n*El gasto de $${sesion.monto.toFixed(2)} fue registrado también en el Excel principal bajo la categoría 24) VIÁTICOS.*`);
          delete sesiones[from];
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('ETAPA_')) {
        if (respuestaId === 'ETAPA_1') {
          await enviarLista(from, '🏗️ *Estructura y Muros:*', 'Ver Partidas', 'Selecciona la partida:', ETAPA_1_ESTRUCTURA);
        } else if (respuestaId === 'ETAPA_2') {
          await enviarLista(from, '🎨 *Acabados e Instalaciones:*', 'Ver Partidas', 'Selecciona la partida:', ETAPA_2_ACABADOS);
        } else if (respuestaId === 'ETAPA_3') {
          await enviarLista(from, '🚚 *Campo y Viáticos:*', 'Ver Partidas', 'Selecciona la partida:', ETAPA_3_CAMPO);
        } else if (respuestaId === 'ETAPA_4') {
          await enviarLista(from, '📋 *Admin y Servicios:*', 'Ver Partidas', 'Selecciona la partida:', ETAPA_4_ADMIN);
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('UNIDAD_')) {
        const sesion = sesiones[from];
        if (!sesion) { res.sendStatus(200); return; }

        if (respuestaId === 'UNIDAD_OTRO') {
          sesion.esperandoUnidadManual = true;
          await enviarTexto(from, '✏️ *Por favor, escribe manualmente la Unidad de Medida:* (ej: kg, millar, rollo, paquete)');
          res.sendStatus(200);
          return;
        }

        const unidadMap = {
          'UNIDAD_Bulto': 'bulto/saco',
          'UNIDAD_Tramo': 'tramo/pza',
          'UNIDAD_M2': 'm²/m³/ton',
          'UNIDAD_Cubeta': 'cubeta/litro'
        };
        sesion.unidad = unidadMap[respuestaId] || 'pza';

        await enviarBotones(from, `🏷️ *Material:* ${sesion.material.toUpperCase()}\n💵 *Precio:* $${sesion.precio.toFixed(2)} / ${sesion.unidad}\n\n🏗️ *¿En qué Sucursal se cotizó/compró?*`, [
          { id: 'PRECIOBRA_Pelicano', title: 'Pelicano' },
          { id: 'PRECIOBRA_Caldera', title: 'Caldera' },
          { id: 'PRECIOBRA_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Opciones:*', [
          { id: 'PRECIOBRA_Salud', title: 'Salud' },
          { id: 'PRECIOBRA_Otro', title: 'Otro' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('PRECIOBRA_')) {
        const obraMap = {
          'PRECIOBRA_Pelicano': 'Suc. Pelicano',
          'PRECIOBRA_Caldera': 'Suc. Caldera',
          'PRECIOBRA_Nativitas': 'Suc. Nativitas',
          'PRECIOBRA_Salud': 'Suc. Salud',
          'PRECIOBRA_Otro': 'Suc. Otro'
        };
        const sesion = sesiones[from];

        if (sesion) {
          sesion.obra = obraMap[respuestaId] || 'Suc. Otro';
          sesion.esperandoProveedor = true;
          await enviarTexto(from, '🏢 *¿En qué Proveedor o Ferretería se cotizó/compró?*\n*(Escribe el nombre del proveedor o ferretería)*');
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('REP_')) {
        const obraMap = {
          'REP_Pelicano': 'Suc. Pelicano',
          'REP_Caldera': 'Suc. Caldera',
          'REP_Nativitas': 'Suc. Nativitas',
          'REP_Salud': 'Suc. Salud',
          'REP_GLOBAL': null
        };
        const obraSel = obraMap[respuestaId];
        const rep = await calcularReporteSaldos(obraSel);

        let txt = obraSel ? `📊 *Corte de Caja - ${obraSel}*\n\n` : `📊 *Corte de Caja Chica General*\n\n`;
        txt += `💵 *Total Efectivo Ingresado:* $${rep.dotacionesCaja.toFixed(2)} MXN\n` +
          `💸 *Egresos en Efectivo:* $${rep.egresosEfectivo.toFixed(2)} MXN\n` +
          `💰 *Efectivo Disponible en Mano:* $${rep.cajaDisponible.toFixed(2)} MXN\n` +
          `📄 *Total Facturado en Efectivo:* $${rep.facturadoEfectivo.toFixed(2)} MXN`;

        await enviarTexto(from, txt);
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('REPCONTRATISTAS_')) {
        const obraMap = {
          'REPCONTRATISTAS_Pelicano': 'Suc. Pelicano',
          'REPCONTRATISTAS_Caldera': 'Suc. Caldera',
          'REPCONTRATISTAS_Nativitas': 'Suc. Nativitas',
          'REPCONTRATISTAS_Salud': 'Suc. Salud',
          'REPCONTRATISTAS_GLOBAL': null
        };
        const obraSel = obraMap[respuestaId];
        const rep = await calcularReporteContratistas(obraSel);

        let msgTexto = obraSel ? `👷‍♂️ *Contratistas en ${obraSel}:*\n\n` : `👷‍♂️ *Contratistas (Todas las Obras):*\n\n`;
        let hayDatos = false;

        Object.keys(rep).forEach(c => {
          const t = rep[c];
          if (t.totalContrato > 0 || t.pagado > 0) {
            hayDatos = true;
            const pendiente = t.totalContrato - t.pagado;
            msgTexto += `📌 *${c.toUpperCase()}*\n` +
              `  • Contrato Total: $${t.totalContrato.toFixed(2)}\n` +
              `  • Pagado a la Fecha: $${t.pagado.toFixed(2)}\n` +
              `  • Saldo Pendiente: $${pendiente.toFixed(2)}\n\n`;
          }
        });

        if (!hayDatos) msgTexto += '⚠️ No hay contratos ni pagos registrados para esta sucursal.';

        await enviarTexto(from, msgTexto);
        res.sendStatus(200);
        return;
      }

      const sesion = sesiones[from];
      if (!sesion) {
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('OBRA_')) {
        const obraMap = {
          'OBRA_Pelicano': 'Suc. Pelicano',
          'OBRA_Caldera': 'Suc. Caldera',
          'OBRA_Nativitas': 'Suc. Nativitas',
          'OBRA_Salud': 'Suc. Salud',
          'OBRA_Otro': 'Suc. Otro'
        };
        sesion.obra = obraMap[respuestaId] || 'Suc. Otro';

        await enviarBotones(from, `🏗️ *Obra:* ${sesion.obra}\n\n📌 *Selecciona la Categoría Principal:*`, [
          { id: 'CAT_3', title: '03) MAT ALB. GRUESA' },
          { id: 'CAT_9', title: '09) MAT EST. METAL' },
          { id: 'CAT_12', title: '12) MAT HERRERIA' }
        ]);

        await enviarBotones(from, `👇 *Más Principales:*`, [
          { id: 'CAT_25', title: '25) DIESEL PLANTA' },
          { id: 'CAT_29', title: '29) INDIRECTOS' },
          { id: 'CAT_30', title: '30) HONORARIOS' }
        ]);

        await enviarBotones(from, `👇 *Otras Partidas:*`, [
          { id: 'CAT_MAS', title: '➕ Ver más categorías' }
        ]);

      } else if (respuestaId?.startsWith('CAT_')) {
        if (respuestaId === 'CAT_MAS') {
          await enviarBotones(from, '📋 *Selecciona la Etapa de Obra:*', [
            { id: 'ETAPA_1', title: '🏗️ 1. Estructura/Muros' },
            { id: 'ETAPA_2', title: '🎨 2. Acabados e Inst.' },
            { id: 'ETAPA_3', title: '🚚 3. Campo y Viáticos' }
          ]);
          await enviarBotones(from, '👇 *Etapa Administrativa:*', [
            { id: 'ETAPA_4', title: '📋 4. Admin y Servicios' }
          ]);
          res.sendStatus(200);
          return;
        }

        const mapaDirecto = {
          'CAT_3': '03) MATERIAL ALBAÑILERIA GRUESA',
          'CAT_9': '09) MATERIAL ESTRUCTURA METALICA',
          'CAT_12': '12) MATERIAL HERRERIA',
          'CAT_25': '25) DIESEL PLANTA',
          'CAT_29': '29) INDIRECTOS',
          'CAT_30': '30) HONORARIOS'
        };

        if (mapaDirecto[respuestaId]) {
          sesion.categoria = mapaDirecto[respuestaId];
        } else {
          const todasSecundarias = ETAPA_1_ESTRUCTURA.concat(ETAPA_2_ACABADOS).concat(ETAPA_3_CAMPO).concat(ETAPA_4_ADMIN);
          const catSel = todasSecundarias.find(c => c.id === respuestaId);
          sesion.categoria = catSel ? catSel.title : '20) VARIOS';
        }

        if (sesion.categoria.includes('HONORARIOS')) {
          await enviarBotones(from, '👤 *¿Honorarios de quién?*', [
            { id: 'HON_Rigo', title: 'Rigo' },
            { id: 'HON_Paty', title: 'Paty' },
            { id: 'HON_Casa', title: 'Casa' }
          ]);
        } else {
          await desplegarFormasPago(from);
        }

      } else if (respuestaId?.startsWith('HON_')) {
        const beneficiarioMap = {
          'HON_Rigo': 'Rigo',
          'HON_Paty': 'Paty',
          'HON_Casa': 'Casa'
        };

        sesion.categoria = '30) HONORARIOS';
        sesion.concepto = `${sesion.concepto} (Honorarios a ${beneficiarioMap[respuestaId]})`;

        await desplegarFormasPago(from);

      } else if (respuestaId?.startsWith('PAY_')) {
        if (respuestaId === 'PAY_Efectivo') {
          sesion.metodo = 'Efectivo';
          await pedirFactura(from);
        } else if (respuestaId === 'PAY_Transf') {
          sesion.metodo = 'Transferencia';
          await enviarBotones(from, '🏦 *Selecciona la cuenta:*', [
            { id: 'SUB_BanamexBeto', title: 'Banamex Beto' },
            { id: 'SUB_BBVARigo', title: 'BBVA Rigo' },
            { id: 'SUB_BBVABeto', title: 'BBVA Beto' }
          ]);
        } else if (respuestaId === 'PAY_Tarjeta') {
          sesion.metodo = 'Tarjeta';
          await enviarBotones(from, '💳 *Selecciona la tarjeta:*', [
            { id: 'SUB_NU', title: 'NU' },
            { id: 'SUB_DIDI', title: 'DIDI' },
            { id: 'SUB_MercadoPago', title: 'MercadoPago' }
          ]);
        }

      } else if (respuestaId?.startsWith('SUB_')) {
        const subMap = {
          'SUB_BanamexBeto': 'Banamex Beto',
          'SUB_BBVARigo': 'BBVA Rigo',
          'SUB_BBVABeto': 'BBVA Beto',
          'SUB_NU': 'NU',
          'SUB_DIDI': 'DIDI',
          'SUB_MercadoPago': 'MercadoPago'
        };
        sesion.subMetodo = subMap[respuestaId] || '';
        await pedirFactura(from);

      } else if (respuestaId?.startsWith('FAC_')) {
        if (respuestaId === 'FAC_Si') {
          sesion.estatusFactura = 'Facturado 🟢';
        } else if (respuestaId === 'FAC_Pendiente') {
          sesion.estatusFactura = 'Pendiente 🟡';
        } else {
          sesion.estatusFactura = 'No Requiere 🔴';
        }

        await guardarEnSheets(sesion);

        const metodoTexto = sesion.subMetodo ? `${sesion.metodo} (${sesion.subMetodo})` : sesion.metodo;
        const resumen = `✅ *Gasto Registrado con Éxito*\n\n` +
          `🆔 *ID:* ${sesion.idMovimiento}\n` +
          `👤 *Registró:* ${sesion.usuario}\n` +
          `📌 *Categoría:* ${sesion.categoria}\n` +
          `💵 *Monto:* $${sesion.monto.toFixed(2)}\n` +
          `📝 *Concepto:* ${sesion.concepto}\n` +
          `🏗️ *Obra:* ${sesion.obra}\n` +
          `💳 *Pago:* ${metodoTexto}\n` +
          `📄 *Factura:* ${sesion.estatusFactura}`;

        await enviarTexto(from, resumen);
        delete sesiones[from];
      }
    }

    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

async function desplegarFormasPago(from) {
  await enviarBotones(from, '💳 *¿Cómo pagaste este gasto?*', [
    { id: 'PAY_Efectivo', title: 'Efectivo' },
    { id: 'PAY_Transf', title: 'Transferencia' },
    { id: 'PAY_Tarjeta', title: 'Tarjeta' }
  ]);
}

async function pedirFactura(from) {
  await enviarBotones(from, '📄 *¿Estatus de la Factura?*', [
    { id: 'FAC_Si', title: 'Facturado 🟢' },
    { id: 'FAC_Pendiente', title: 'Pendiente 🟡' },
    { id: 'FAC_No', title: 'No Requiere 🔴' }
  ]);
}

app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
