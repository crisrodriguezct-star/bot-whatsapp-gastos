const express = require('express');
const { google } = require('googleapis');

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
  if (process.env.GOOGLE_CREDENTIALS) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file'
      ],
    });
    sheets = google.sheets({ version: 'v4', auth });
    drive = google.drive({ version: 'v3', auth });
    console.log('✅ Google APIs configuradas correctamente.');
  }
} catch (error) {
  console.error('❌ Error Google APIs:', error.message);
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

async function obtenerOCrearCarpetaMes(folderIdPadre) {
  if (!drive || !folderIdPadre) return folderIdPadre;

  const fechaActual = new Date();
  const meses = ['01_Enero', '02_Febrero', '03_Marzo', '04_Abril', '05_Mayo', '06_Junio', '07_Julio', '08_Agosto', '09_Septiembre', '10_Octubre', '11_Noviembre', '12_Diciembre'];
  const nombreCarpeta = `${fechaActual.getFullYear()}/${meses[fechaActual.getMonth()]}`;

  try {
    const query = `'${folderIdPadre}' in parents and name = '${nombreCarpeta}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const res = await drive.files.list({ q: query, fields: 'files(id, name)' });

    if (res.data.files.length > 0) {
      return res.data.files[0].id;
    } else {
      const fileMetadata = {
        name: nombreCarpeta,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [folderIdPadre]
      };
      const carpetaCreada = await drive.files.create({
        resource: fileMetadata,
        fields: 'id'
      });
      return carpetaCreada.data.id;
    }
  } catch (error) {
    console.error('❌ Error carpeta Drive:', error.message);
    return folderIdPadre;
  }
}

async function guardarArchivoEnDrive(mediaId, nombreArchivo, mimeType) {
  if (!drive || !DRIVE_FOLDER_ID) return null;

  try {
    const mediaRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
    });
    const mediaData = await mediaRes.json();
    if (!mediaData.url) return null;

    const fileRes = await fetch(mediaData.url, {
      headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}` }
    });
    const arrayBuffer = await fileRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const idCarpetaDestino = await obtenerOCrearCarpetaMes(DRIVE_FOLDER_ID);

    const stream = require('stream');
    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);

    const driveRes = await drive.files.create({
      requestBody: {
        name: nombreArchivo,
        parents: [idCarpetaDestino]
      },
      media: {
        mimeType: mimeType,
        body: bufferStream
      },
      fields: 'id, webViewLink'
    });

    await drive.permissions.create({
      fileId: driveRes.data.id,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    return driveRes.data.webViewLink;
  } catch (error) {
    console.error('❌ Error subida Drive:', error.message);
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

    // 1. MENSAJE DE TEXTO (NUEVO GASTO)
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
    } 

    // 2. RECEPCIÓN DE BOTONES INTERACTIVOS
    else if (msg.type === 'interactive') {
      const sesion = sesiones[from];
      if (!sesion) {
        res.sendStatus(200);
        return;
      }

      const respuestaId = msg.interactive.button_reply?.id;

      // PASO 1: OBRA
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
      } 
      
      // PASO 2: MÉTODO DE PAGO
      else if (respuestaId?.startsWith('PAY_')) {
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
        } else if (respuestaId === 'PAY_Tarjeta') {
          sesion.metodo = 'Tarjeta';
          await enviarBotones(from, '💳 *Selecciona la tarjeta:*', [
            { id: 'SUB_NU', title: 'NU' },
            { id: 'SUB_DIDI', title: 'DIDI' },
            { id: 'SUB_MercadoPago', title: 'MercadoPago' }
          ]);
        }
      } 
      
      // PASO 3: SUB-MÉTODO (CUENTA O TARJETA) -> AQUÍ ESTÁ EL CAMBIO
      else if (respuestaId?.startsWith('SUB_')) {
        const subMap = {
          'SUB_BanamexBeto': 'Banamex Beto',
          'SUB_BBVARigo': 'BBVA Rigo',
          'SUB_BBVABeto': 'BBVA Beto',
          'SUB_NU': 'NU',
          'SUB_DIDI': 'DIDI',
          'SUB_MercadoPago': 'MercadoPago'
        };
        sesion.subMetodo = subMap[respuestaId] || '';
        
        // FORZAMOS LA PREGUNTA DE FACTURA
        await pedirFactura(from, sesion);
      } 
      
      // PASO 4: ESTATUS DE FACTURA Y CIERRE
      else if (respuestaId?.startsWith('FAC_')) {
        if (respuestaId === 'FAC_Si') {
          sesion.estatusFactura = 'Facturado 🟢';
        } else if (respuestaId === 'FAC_Pendiente') {
          sesion.estatusFactura = 'Pendiente 🟡';
        } else {
          sesion.estatusFactura = 'No Requiere 🔴';
        }
        await finalizarRegistro(from, sesion);
      }
    }

    // 3. RECEPCIÓN DE ARCHIVOS (PDF / XML / IMAGEN)
    else if (msg.type === 'document' || msg.type === 'image') {
      const registroPendiente = ultimosRegistros[from];

      if (registroPendiente) {
        await enviarTexto(from, '⏳ Subiendo factura a Google Drive...');

        const mediaId = msg.type === 'document' ? msg.document.id : msg.image.id;
        const mimeType = msg.type === 'document' ? msg.document.mime_type : msg.image.mime_type;
        const ext = msg.type === 'document' ? (msg.document.filename?.split('.').pop() || 'pdf') : 'jpg';

        const nombreLimpio = `${registroPendiente.id}_${registroPendiente.obra.replace(/\s+/g, '_')}_${registroPendiente.concepto.replace(/\s+/g, '_')}.${ext}`;

        const driveLink = await guardarArchivoEnDrive(mediaId, nombreLimpio, mimeType);

        if (driveLink) {
          await actualizarLinkFacturaEnSheets(registroPendiente.id, driveLink);
          await enviarTexto(from, `✅ *Factura adjuntada exitosamente a Google Drive*\n\n📄 *Enlace:* ${driveLink}`);
        } else {
          await enviarTexto(from, '⚠️ No se pudo subir el archivo a Drive. Revisa los permisos de la carpeta.');
        }

        delete ultimosRegistros[from];
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
    resumen += `\n\n📎 *Por favor, envía el archivo (PDF, XML o Imagen) de la factura a este chat.*`;
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
