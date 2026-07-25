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

function enviarPeticionMeta(payload) {
  return new Promise((resolve, reject) => {
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
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
        } else {
          console.error(`❌ Error Meta (${res.statusCode}):`, body);
          resolve();
        }
      });
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
        sections: [
          {
            title: tituloSeccion.substring(0, 24),
            rows: rowsPayload
          }
        ]
      }
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

async function obtenerOCrearCarpetaMes(parentFolderId) {
  const fechaObj = new Date();
  const anio = fechaObj.getFullYear();
  const mesNumero = String(fechaObj.getMonth() + 1).padStart(2, '0');
  const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const nombreCarpetaMes = `${anio}/${mesNumero}_${mesesNombres[fechaObj.getMonth()]}`;

  try {
    const query = `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${nombreCarpetaMes}' and trashed = false`;
    const resSearch = await drive.files.list({ q: query, fields: 'files(id, name)' });

    if (resSearch.data.files && resSearch.data.files.length > 0) {
      return resSearch.data.files[0].id;
    }

    const resFolder = await drive.files.create({
      requestBody: {
        name: nombreCarpetaMes,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId]
      },
      fields: 'id'
    });

    return resFolder.data.id;
  } catch (error) {
    console.error('❌ Error gestionando carpeta del mes:', error.message);
    return parentFolderId;
  }
}

async function guardarArchivoEnDrive(mediaId, nombreArchivo, mimeType) {
  if (!drive || !DRIVE_FOLDER_ID) {
    console.error('❌ Drive o FOLDER_ID no están inicializados.');
    return null;
  }

  try {
    const mediaRes = await new Promise((resolve, reject) => {
      https.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
        headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN.trim()}` }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });

    if (!mediaRes.url) return null;

    const buffer = await descargarBufferMeta(mediaRes.url, WHATSAPP_TOKEN.trim());

    const bufferStream = new stream.PassThrough();
    bufferStream.end(buffer);

    const targetFolderId = await obtenerOCrearCarpetaMes(DRIVE_FOLDER_ID);

    const driveRes = await drive.files.create({
      requestBody: {
        name: nombreArchivo,
        parents: [targetFolderId]
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

async function calcularSaldosSemanalesPorObra(obraBuscada) {
  if (!sheets || !SPREADSHEET_ID) return { presupuestoGlobal: 0, dotacionesCaja: 0, egresosTotales: 0, cajaChica: 0 };
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:I'
    });
    const filas = res.data.values || [];
    let presupuestoGlobal = 0;
    let dotacionesCaja = 0;
    let egresosEfectivo = 0;
    let egresosTotales = 0;

    const hoy = new Date();
    const diaSemana = hoy.getDay();
    const diferenciaLunes = hoy.getDate() - diaSemana + (diaSemana === 0 ? -6 : 1);
    const inicioSemana = new Date(hoy.setDate(diferenciaLunes));
    inicioSemana.setHours(0, 0, 0, 0);

    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i];
      const fechaTexto = fila[1] || '';
      const obra = fila[2] || '';
      const metodo = fila[3] || '';
      let montoStr = fila[5] || '0';
      const estatus = fila[8] || '';

      if (estatus.includes('CANCELADO')) continue;

      if (fechaTexto) {
        const partesFecha = fechaTexto.split(',')[0].split('/');
        if (partesFecha.length === 3) {
          const fechaFila = new Date(partesFecha[2], partesFecha[1] - 1, partesFecha[0]);
          if (fechaFila < inicioSemana) continue;
        }
      }

      montoStr = montoStr.toString().replace('$', '').replace(/,/g, '').trim();
      const monto = parseFloat(montoStr) || 0;

      if (obra.toLowerCase() === obraBuscada.toLowerCase()) {
        if (metodo.includes('Ingreso Presupuesto')) {
          presupuestoGlobal += monto;
        } else if (metodo.includes('Dotación Caja Chica')) {
          dotacionesCaja += monto;
        } else {
          egresosTotales += monto;
          if (metodo.startsWith('Efectivo')) {
            egresosEfectivo += monto;
          }
        }
      }
    }
    return {
      presupuestoGlobal,
      dotacionesCaja,
      egresosTotales,
      cajaChica: dotacionesCaja - egresosEfectivo
    };
  } catch (error) {
    console.error('❌ Error calculando saldos semanales por obra:', error.message);
    return { presupuestoGlobal: 0, dotacionesCaja: 0, egresosTotales: 0, cajaChica: 0 };
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
          range: `Hoja 1!I${filaIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [['CANCELADO ⚪']] }
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

async function obtenerUltimoMovimientoDeSheets() {
  if (!sheets || !SPREADSHEET_ID) return null;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:J'
    });

    const filas = res.data.values;
    if (!filas || filas.length < 2) return null;

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

async function obtenerListaMovimientosPendientes() {
  if (!sheets || !SPREADSHEET_ID) return [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:J'
    });

    const filas = res.data.values;
    if (!filas || filas.length < 2) return [];

    const pendientes = [];
    for (let i = filas.length - 1; i >= 1; i--) {
      const fila = filas[i];
      const id = fila[0];
      const obra = fila[2];
      let montoStr = fila[5] || '0';
      const concepto = fila[6];
      const estatus = fila[8];
      const link = fila[9];

      montoStr = montoStr.toString().replace('$', '').trim();

      if (estatus === 'Pendiente 🟡' || (!link || link === 'N/A')) {
        if (!estatus.includes('CANCELADO')) {
          pendientes.push({ id, obra, concepto, monto: montoStr });
        }
      }
      if (pendientes.length >= 10) break;
    }
    return pendientes;
  } catch (error) {
    console.error('❌ Error consultando pendientes:', error.message);
    return [];
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

async function actualizarLinkYEstatusEnSheets(idMovimiento, linkFactura) {
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
        range: `Hoja 1!I${filaIndex}:J${filaIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Facturado 🟢', linkFactura]] }
      });
      console.log(`✅ Estatus y Link actualizados en Sheets: ${idMovimiento}`);
    }
  } catch (error) {
    console.error('❌ Error actualizando estatus y link:', error.message);
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

      if (/^(cancelar|cancelar ultimo|borrar ultimo)$/i.test(textBody)) {
        const cancelado = await cancelarUltimoRegistro();
        if (cancelado) {
          await enviarTexto(from, `⚪ *Último registro cancelado correctamente:*\n\n🆔 *ID:* ${cancelado.idMovimiento}\n📝 *Concepto:* ${cancelado.concepto}\n💵 *Monto:* $${cancelado.monto}`);
        } else {
          await enviarTexto(from, '⚠️ No se encontró ningún registro previo para cancelar.');
        }
        res.sendStatus(200);
        return;
      }

      if (/^(facturas|pendientes|factura|pendiente|ver pendientes|ver facturas)$/i.test(textBody)) {
        const pendientes = await obtenerListaMovimientosPendientes();
        if (pendientes.length === 0) {
          await enviarTexto(from, '🎉 ¡Excelente! No tienes ningún gasto pendiente de factura.');
        } else {
          const opciones = pendientes.map(p => ({
            id: `SEL_${p.id}`,
            title: p.concepto,
            description: `${p.obra} | $${p.monto} (${p.id})`
          }));
          await enviarLista(from, '📋 *Gastos pendientes de factura:*', 'Ver Pendientes', 'Selecciona uno:', opciones);
        }
        res.sendStatus(200);
        return;
      }

      if (/^(saldo|reporte|resumen|semana|corte)$/i.test(textBody)) {
        await enviarBotones(from, '💰 *¿De qué Sucursal deseas consultar el Saldo de la Semana?*', [
          { id: 'SALDO_Pelicano', title: 'Pelicano' },
          { id: 'SALDO_Caldera', title: 'Caldera' },
          { id: 'SALDO_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Sucursales:*', [
          { id: 'SALDO_Salud', title: 'Salud' }
        ]);
        res.sendStatus(200);
        return;
      }

      // PRESUPUESTO LIBERADO DE FARMACIA
      const matchPresupuesto = textBody.match(/^(presupuesto|ingreso farmacia|pago farmacia)\s+(\d+(\.\d+)?)/i);
      if (matchPresupuesto) {
        const montoIngreso = parseFloat(matchPresupuesto[2]);
        const idMovimiento = 'ING-' + Date.now().toString().slice(-6);

        sesiones[from] = {
          tipoAccion: 'PRESUPUESTO',
          idMovimiento,
          monto: montoIngreso,
          concepto: 'Presupuesto Liberado / Pago Farmacia'
        };

        await enviarBotones(from, `🏦 *Presupuesto Farmacia:* $${montoIngreso.toFixed(2)}\n\n🏗️ *¿A qué sucursal ingresa este pago?*`, [
          { id: 'ACTOBRA_Pelicano', title: 'Pelicano' },
          { id: 'ACTOBRA_Caldera', title: 'Caldera' },
          { id: 'ACTOBRA_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Sucursales:*', [
          { id: 'ACTOBRA_Salud', title: 'Salud' }
        ]);
        res.sendStatus(200);
        return;
      }

      // ENTREGA DE CAJA CHICA A PAPÁS
      const matchCaja = textBody.match(/^(caja|efectivo|dotacion|fondo)\s+(\d+(\.\d+)?)/i);
      if (matchCaja) {
        const montoCaja = parseFloat(matchCaja[2]);
        const idMovimiento = 'DOT-' + Date.now().toString().slice(-6);

        sesiones[from] = {
          tipoAccion: 'CAJA_CHICA',
          idMovimiento,
          monto: montoCaja,
          concepto: 'Dotación de Efectivo (Caja Chica)'
        };

        await enviarBotones(from, `💵 *Entrega de Efectivo:* $${montoCaja.toFixed(2)}\n\n🏗️ *¿Para la Caja Chica de qué sucursal?*`, [
          { id: 'ACTOBRA_Pelicano', title: 'Pelicano' },
          { id: 'ACTOBRA_Caldera', title: 'Caldera' },
          { id: 'ACTOBRA_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Sucursales:*', [
          { id: 'ACTOBRA_Salud', title: 'Salud' }
        ]);
        res.sendStatus(200);
        return;
      }

      // REGISTRO REGULAR DE GASTOS
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
        tipoAccion: 'GASTO',
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

      await enviarBotones(from, '👇 *Otras Sucursales:*', [
        { id: 'OBRA_Salud', title: 'Salud' }
      ]);

    } else if (msg.type === 'interactive') {
      const respuestaId = msg.interactive.button_reply?.id || msg.interactive.list_reply?.id;

      if (respuestaId?.startsWith('SALDO_')) {
        const obraMap = {
          'SALDO_Pelicano': 'Suc. Pelicano',
          'SALDO_Caldera': 'Suc. Caldera',
          'SALDO_Nativitas': 'Suc. Nativitas',
          'SALDO_Salud': 'Suc. Salud'
        };
        const obraSeleccionada = obraMap[respuestaId] || 'Suc. Salud';
        const saldos = await calcularSaldosSemanalesPorObra(obraSeleccionada);
        await enviarTexto(from, `📊 *Corte Semanal - ${obraSeleccionada}*\n\n` +
          `🏦 *Presupuesto Farmacia:* $${saldos.presupuestoGlobal.toFixed(2)} MXN\n` +
          `💵 *Efectivo Entregado (Caja):* $${saldos.dotacionesCaja.toFixed(2)} MXN\n` +
          `💸 *Total Gastado Semana:* $${saldos.egresosTotales.toFixed(2)} MXN\n` +
          `💰 *Efectivo Disponible en Mano:* $${saldos.cajaChica.toFixed(2)} MXN`);
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('SEL_')) {
        const idSelec = respuestaId.replace('SEL_', '');
        const resSheets = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: 'Hoja 1!A:G'
        });
        const filas = resSheets.data.values || [];
        const filaEncontrada = filas.find(f => f[0] === idSelec);

        if (filaEncontrada) {
          ultimosRegistros[from] = {
            id: idSelec,
            obra: filaEncontrada[2],
            concepto: filaEncontrada[6]
          };
          await enviarTexto(from, `🎯 *Gasto seleccionado:* ${filaEncontrada[6]} (${filaEncontrada[0]})\n\n📎 Por favor, *envía la foto, PDF o XML de la factura ahora*.`);
        } else {
          await enviarTexto(from, '⚠️ No se encontró la información de ese gasto.');
        }
        res.sendStatus(200);
        return;
      }

      const sesion = sesiones[from];
      if (!sesion) {
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('ACTOBRA_')) {
        const obraMap = {
          'ACTOBRA_Pelicano': 'Suc. Pelicano',
          'ACTOBRA_Caldera': 'Suc. Caldera',
          'ACTOBRA_Nativitas': 'Suc. Nativitas',
          'ACTOBRA_Salud': 'Suc. Salud'
        };
        const obraElegida = obraMap[respuestaId] || 'Suc. Salud';

        const metodoRegistrar = sesion.tipoAccion === 'PRESUPUESTO' ? 'Ingreso Presupuesto' : 'Dotación Caja Chica';

        await guardarEnSheets({
          idMovimiento: sesion.idMovimiento,
          obra: obraElegida,
          metodo: metodoRegistrar,
          subMetodo: '',
          categoria: sesion.tipoAccion === 'PRESUPUESTO' ? 'Cobro Cliente' : 'Fondo de Caja',
          monto: sesion.monto,
          concepto: sesion.concepto,
          estatusFactura: 'No Requiere 🔴',
          linkFactura: 'N/A'
        });

        const saldosActualizados = await calcularSaldosSemanalesPorObra(obraElegida);
        
        let msgRespuesta = '';
        if (sesion.tipoAccion === 'PRESUPUESTO') {
          msgRespuesta = `🏦 *Presupuesto de Farmacia Registrado*\n\n🏗️ *Sucursal:* ${obraElegida}\n💵 *Monto:* $${sesion.monto.toFixed(2)}\n📊 *Total Acumulado Semana:* $${saldosActualizados.presupuestoGlobal.toFixed(2)} MXN`;
        } else {
          msgRespuesta = `💵 *Entrega de Efectivo (Caja Chica) Registrada*\n\n🏗️ *Sucursal:* ${obraElegida}\n💵 *Monto Entregado:* $${sesion.monto.toFixed(2)}\n💰 *Nuevo Efectivo Disponible en Mano:* $${saldosActualizados.cajaChica.toFixed(2)} MXN`;
        }

        await enviarTexto(from, msgRespuesta);
        delete sesiones[from];
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('OBRA_')) {
        const obraMap = {
          'OBRA_Pelicano': 'Suc. Pelicano',
          'OBRA_Caldera': 'Suc. Caldera',
          'OBRA_Nativitas': 'Suc. Nativitas',
          'OBRA_Salud': 'Suc. Salud'
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
          await actualizarLinkYEstatusEnSheets(registroPendiente.id, driveLink);
          await enviarTexto(from, `✅ *Factura adjuntada y estatus actualizado a Facturado 🟢*\n\n📄 *Enlace:* ${driveLink}`);
        } else {
          await enviarTexto(from, '⚠️ Ocurrió un error al subir el archivo a Drive.');
        }

        delete ultimosRegistros[from];
      } else {
        await enviarTexto(from, '⚠️ No se encontró ningún gasto pendiente para asociar este archivo.');
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
  const metodoTexto = datosMetodo(sesion);
  
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

function datosMetodo(s) {
  return s.subMetodo ? `${s.metodo} (${s.subMetodo})` : s.metodo;
}

app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
