const express = require('express');
const { google } = require('googleapis');
const https = require('https');
const stream = require('stream');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;

const sesiones = {};
const ultimosRegistros = {};

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
  console.log('✅ Google OAuth2 configurado correctamente.');
} catch (error) {
  console.error('❌ Error OAuth2 Google:', error.message);
}

function obtenerCategoria(concepto) {
  const texto = concepto.toLowerCase();
  if (/gasolina|diésel|diesel|caseta|estacionamiento|peaje|taller|flete/i.test(texto)) return 'Transporte / Vehículo';
  if (/comida|almuerzo|cena|desayuno|oxxo|7eleven|restaurante|agua|café|cafe/i.test(texto)) return 'Alimentos y Consumo';
  if (/cemento|varilla|arena|grava|pintura|cable|tubo|madera|tabique|material/i.test(texto)) return 'Materiales';
  if (/herramienta|disco|broca|pala|martillo|equipo|reparacion/i.test(texto)) return 'Herramientas y Equipo';
  if (/nomina|sueldo|raya|pago|trabajador|peon|albañil/i.test(texto)) return 'Mano de Obra';
  return 'General';
}

async function enviarPeticionMeta(payload) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return;
  try {
    await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('❌ Error Meta:', error.message);
  }
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

function descargarBufferMeta(url, token) {
  return new Promise((resolve, reject) => {
    const opciones = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Node.js'
      }
    };

    https.get(url, opciones, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return descargarBufferMeta(res.headers.location, token).then(resolve).catch(reject);
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP Error ${res.statusCode}`));
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', (err) => reject(err));
    }).on('error', (err) => reject(err));
  });
}

async function guardarArchivoEnDrive(mediaId, nombreArchivo, mimeType) {
  if (!drive || !DRIVE_FOLDER_ID) {
    console.error('❌ Drive o FOLDER_ID no están inicializados.');
    return null;
  }

  try {
    const mediaRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
    });
    const mediaData = await mediaRes.json();
    if (!mediaData.url) return null;

    const buffer = await descargarBufferMeta(mediaData.url, WHATSAPP_TOKEN);

    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);

    const driveRes = await drive.files.create({
      requestBody: {
        name: nombreArchivo,
        parents: [DRIVE_FOLDER_ID]
      },
      media: {
        mimeType: mimeType || 'application/pdf',
        body: bufferStream
      },
      fields: 'id, webViewLink'
    });

    try {
      await drive.permissions.create({
        fileId: driveRes.data.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });
    } catch (pErr) {
      console.log('Aviso Permisos:', pErr.message);
    }

    return driveRes.data.webViewLink;
  } catch (error) {
    console.error('❌ Error DETALLADO en Drive:', error?.response?.data || error.message);
    return null;
  }
}

async function obtenerUltimoMovimientoDeSheets() {
  if (!sheets || !SPREADSHEET_ID) return null;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:J'
    });

    const filas = res.data.values;
    if (!filas || filas.length < 2) return null;

    // Buscar la última fila que requiera factura y no tenga link adjunto
    for (let i = filas.length - 1; i >= 1; i--) {
      const fila = filas[i];
      const id = fila[0];
      const obra = fila[2];
      const concepto = fila[6];
      const estatus = fila[8];
      const link = fila[9];

      if ((estatus === 'Facturado 🟢' || estatus === 'Pendiente 🟡') && (!link || link === 'N/A')) {
        return { id, obra, concepto };
      }
    }
    return null;
  } catch (error) {
    console.error('❌ Error leyendo Sheets:', error.message);
    return null;
  }
}

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
      'Bot WhatsApp',
      datos.estatusFactura || 'No Requiere 🔴',
      datos.linkFactura || 'N/A'
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:J',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: valores },
    });
    console.log(`✅ Registrado en Sheets: ${datos.idMovimiento}`);
  } catch (error) {
    console.error('❌ Error en Sheets:', error.message);
  }
}

async function actualizarLinkFacturaEnSheets(idMovimiento, linkFactura) {
  if (!sheets || !SPREADSHEET_ID) return;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:A'
    });

    const filas = res.data.values;
    if (!filas) return;

    let filaIndex = -1;
    for (let i = 0; i < filas.length; i++) {
      if (filas[i][0] === idMovimiento) {
        filaIndex = i + 1;
        break;
      }
    }

    if (filaIndex !== -1) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Hoja 1!J${filaIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[linkFactura]] }
      });
      console.log(`✅ Link actualizado en Sheets: ${idMovimiento}`);
    }
  } catch (error) {
    console.error('❌ Error actualizando link:', error.message);
  }
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

    if (msg.type === 'text') {
      const textBody = msg.text.body.trim();
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

      const idMovimiento = 'MOV-' + Date.now().toString().slice(-6);
      const categoria = obtenerCategoria(concepto);

      sesiones[from] = {
        idMovimiento,
        concepto,
        monto,
        categoria,
        obra: 'General',
        metodo: 'Efectivo',
        subMetodo: '',
        estatusFactura: 'No Requiere 🔴',
        linkFactura: 'N/A'
      };

      await enviarBotones(from, `📝 *Gasto:* ${concepto} ($${monto.toFixed(2)})\n\n🏗️ *Selecciona la Sucursal:*`, [
        { id: 'OBRA_Pelicano', title: 'Pelicano' },
        { id: 'OBRA_Caldera', title: 'Caldera' },
        { id: 'OBRA_Nativitas', title: 'Nativitas' }
      ]);
    } else if (msg.type === 'interactive') {
      const sesion = sesiones[from];
      if (!sesion) {
        res.sendStatus(200);
        return;
      }

      const respuestaId = msg.interactive.button_reply?.id;

      if (respuestaId?.startsWith('OBRA_')) {
        const obraMap = {
          'OBRA_Pelicano': 'Suc. Pelicano',
          'OBRA_Caldera': 'Suc. Caldera',
          'OBRA_Nativitas': 'Suc. Nativitas'
        };
        sesion.obra = obraMap[respuestaId] || 'Suc. Salud';

        await enviarBotones(from, `🏗️ *Obra:* ${sesion.obra}\n\n💳 *¿Cómo pagaste?*`, [
          { id: 'PAY_Efectivo', title: 'Efectivo' },
          { id: 'PAY_Transf', title: 'Transferencia' },
          { id: 'PAY_Tarjeta', title: 'Tarjeta' }
        ]);
      } else if (respuestaId?.startsWith('PAY_')) {
        if (respuestaId === 'PAY_Efectivo') {
          sesion.metodo = 'Efectivo';
          await pedirFactura(from, sesion);
        } else if (respuestaId === 'PAY_Transf') {
          sesion.metodo = 'Transferencia';
          await enviarBotones(from, '🏦 *Selecciona la cuenta:*', [
            { id: 'SUB_BanamexBeto', title: 'Banamex Beto' },
            { id: 'SUB_BBVARigo', title: 'BBVA Rigo' },
            { id: 'SUB_BBVABeto', title: 'BBVA Beto' }
          ]);
        } else if (respuestaId?.startsWith('PAY_Tarjeta')) {
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
        await pedirFactura(from, sesion);
      } else if (respuestaId?.startsWith('FAC_')) {
        if (respuestaId === 'FAC_Si') {
          sesion.estatusFactura = 'Facturado 🟢';
        } else if (respuestaId === 'FAC_Pendiente') {
          sesion.estatusFactura = 'Pendiente 🟡';
        } else {
          sesion.estatusFactura = 'No Requiere 🔴';
        }
        await finalizarRegistro(from, sesion);
      }
    } else if (msg.type === 'document' || msg.type === 'image') {
      let registroPendiente = ultimosRegistros[from];

      // Si se reinició el servidor o no está en memoria, buscar la última fila pendiente en Sheets
      if (!registroPendiente) {
        registroPendiente = await obtenerUltimoMovimientoDeSheets();
      }

      if (registroPendiente) {
        await enviarTexto(from, '⏳ Subiendo factura a Google Drive...');

        const mediaId = msg.type === 'document' ? msg.document.id : msg.image.id;
        const mimeType = msg.type === 'document' ? (msg.document.mime_type || 'application/pdf') : (msg.image.mime_type || 'image/jpeg');
        const ext = msg.type === 'document' ? (msg.document.filename?.split('.').pop() || 'pdf') : 'jpg';

        const fechaObj = new Date();
        const mesAnio = `${fechaObj.getFullYear()}-${String(fechaObj.getMonth() + 1).padStart(2, '0')}`;
        const nombreLimpio = `${mesAnio}_${registroPendiente.id}_${registroPendiente.obra.replace(/\s+/g, '_')}_${registroPendiente.concepto.replace(/\s+/g, '_')}.${ext}`;

        const driveLink = await guardarArchivoEnDrive(mediaId, nombreLimpio, mimeType);

        if (driveLink) {
          await actualizarLinkFacturaEnSheets(registroPendiente.id, driveLink);
          await enviarTexto(from, `✅ *Factura adjuntada exitosamente a Google Drive*\n\n📄 *Enlace:* ${driveLink}`);
        } else {
          await enviarTexto(from, '⚠️ Ocurrió un error al subir el archivo a Drive. Revisa la consola de Render.');
        }

        delete ultimosRegistros[from];
      } else {
        await enviarTexto(from, '⚠️ No se encontró ningún gasto pendiente de factura para asociar este archivo.');
      }
    }

    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

async function pedirFactura(from, sesion) {
  await enviarBotones(from, '📄 *¿Estatus de la Factura de este gasto?*', [
    { id: 'FAC_Si', title: 'Facturado 🟢' },
    { id: 'FAC_Pendiente', title: 'Pendiente 🟡' },
    { id: 'FAC_No', title: 'No Requiere 🔴' }
  ]);
}

async function finalizarRegistro(from, sesion) {
  await guardarEnSheets(sesion);
  const metodoTexto = sesion.subMetodo ? `${sesion.metodo} (${sesion.subMetodo})` : sesion.metodo;
  
  let resumen = `✅ *Gasto Registrado con Éxito*\n\n` +
    `🆔 *ID:* ${sesion.idMovimiento}\n` +
    `💵 *Monto:* $${sesion.monto.toFixed(2)}\n` +
    `📝 *Concepto:* ${sesion.concepto}\n` +
    `🏗️ *Obra:* ${sesion.obra}\n` +
    `💳 *Pago:* ${metodoTexto}\n` +
    `📄 *Factura:* ${sesion.estatusFactura}`;

  if (sesion.estatusFactura === 'Facturado 🟢') {
    resumen += `\n\n📎 *Por favor, envía el archivo (PDF, XML o Foto) de la factura a este chat.*`;
    ultimosRegistros[from] = {
      id: sesion.idMovimiento,
      obra: sesion.obra,
      concepto: sesion.concepto
    };
  }

  await enviarTexto(from, resumen);
  delete sesiones[from];
}

app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
