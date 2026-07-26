const express = require('express');
const { google } = require('googleapis');
const https = require('https');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
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

// 1. Categorías Principales
const CATEGORIAS_PRINCIPALES = [
  { id: 'CAT_MAT_ALB', title: 'MATERIAL ALBAÑILERIA GRUESA', description: 'Cemento, varilla, tabique' },
  { id: 'CAT_MAT_EST', title: 'MATERIAL ESTRUCTURA METALICA', description: 'Perfiles, vigas, acero' },
  { id: 'CAT_MAT_HERR', title: 'MATERIAL HERRERIA', description: 'Pernos, soleras, tubos' },
  { id: 'CAT_DIESEL', title: 'DIESEL PLANTA', description: 'Combustible maquinaria/planta' },
  { id: 'CAT_INDIRECTOS', title: 'INDIRECTOS', description: 'Gastos generales de obra' },
  { id: 'CAT_HONORARIOS', title: 'HONORARIOS', description: 'Pagos a Rigo, Paty o Casa' },
  { id: 'CAT_BLOQUE_1', title: '📁 Más Materiales/Obra', description: 'Ver preliminares, acabados, instalaciones' },
  { id: 'CAT_BLOQUE_2', title: '📁 Más Servicios/Admin', description: 'Ver viáticos, IMSS, contabilidad, fletes' }
];

// 2. Bloque 1: Materiales y Trabajos de Campo
const CATEGORIAS_MATERIALES = [
  { id: 'CAT_PREELIMINARES', title: '01) PREELIMINARES' },
  { id: 'CAT_ALB_MDO', title: '02) ALBAÑILERIA MDO' },
  { id: 'CAT_PISOS_MDO', title: '03) PISOS Y RECUBR. MDO' },
  { id: 'CAT_PISOS_MAT', title: '03) PISOS Y RECUBR. MAT' },
  { id: 'CAT_EST_CONC_MAT', title: '04) ESTRUCTURA CONCRETO' },
  { id: 'CAT_PLAFOND', title: '07) PLAFOND Y TABLAROCA' },
  { id: 'CAT_ALUMINIO', title: '08) ALUMINIO Y VIDRIOS' },
  { id: 'CAT_HIDRAULICA', title: '13) INST HIDRAULICA' },
  { id: 'CAT_DRENAJES', title: '14) DRENAJES' },
  { id: 'CAT_CUBIERTAS', title: '10) CUBIERTAS / ANUNCIO' }
];

// 3. Bloque 2: Servicios, Administración y Varios
const CATEGORIAS_SERVICIOS = [
  { id: 'CAT_PINTURA', title: '09) PINTURA' },
  { id: 'CAT_CARPINTERIA', title: '08) CARPINTERIA' },
  { id: 'CAT_LIMPIEZA', title: '11) LIMPIEZA Y ACARREOS' },
  { id: 'CAT_TERRACERIA', title: '15) TERRACERIA / MOV.' },
  { id: 'CAT_VIATICOS', title: '16) VIATICOS / GASOLINA' },
  { id: 'CAT_IMSS', title: '17) IMSS / ISN' },
  { id: 'CAT_CONTA', title: '18) CONTABILIDAD' },
  { id: 'CAT_RESIDENCIA', title: '19) RESIDENCIA DE OBRA' },
  { id: 'CAT_VARIOS', title: '12) VARIOS' }
];

const CONTRATISTAS_VALIDOS = ['tablaroca', 'aluminio y vidrio', 'aluminio', 'cortinas', 'pintura', 'cubiertas'];

function obtenerNombreUsuario(numeroFrom) {
  if (!numeroFrom) return 'Usuario WhatsApp';
  const diezDigitos = numeroFrom.replace(/\D/g, '').slice(-10);
  return DIRECTORIO_USUARIOS[diezDigitos] || `Usuario (${diezDigitos})`;
}

let sheets;

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
  console.log('✅ Google OAuth2 configurado correctamente.');
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
    console.log(`✅ Registrado en Sheets: ${datos.idMovimiento}`);
  } catch (error) {
    console.error('❌ Error guardando en Sheets:', error.message);
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

      // Filtrar por obra si se seleccionó una en específico
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

    if (msg.type === 'text') {
      const textBody = msg.text.body.trim();

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

      // CONSULTAR FACTURAS PENDIENTES
      if (/^(facturar|facturas|pendientes|ver pendientes)$/i.test(textBody)) {
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

      // REPORTE DE SALDOS Y CORTE DE CAJA CHICA
      if (/^(saldo|corte|reporte|resumen)$/i.test(textBody)) {
        await enviarBotones(from, '📊 *¿De qué Sucursal deseas consultar el Reporte?*', [
          { id: 'REP_Pelicano', title: 'Pelicano' },
          { id: 'REP_Caldera', title: 'Caldera' },
          { id: 'REP_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Opciones:*', [
          { id: 'REP_Salud', title: 'Salud' },
          { id: 'REP_GLOBAL', title: 'Caja General Efectivo' }
        ]);
        res.sendStatus(200);
        return;
      }

      // CONSULTA DE CONTRATISTAS POR OBRA
      if (/^(contratistas|destajos|contratos)$/i.test(textBody)) {
        await enviarBotones(from, '👷‍♂️ *¿De qué Sucursal deseas ver los Contratistas?*', [
          { id: 'REPCONTRATISTAS_Pelicano', title: 'Pelicano' },
          { id: 'REPCONTRATISTAS_Caldera', title: 'Caldera' },
          { id: 'REPCONTRATISTAS_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Opciones:*', [
          { id: 'REPCONTRATISTAS_Salud', title: 'Salud' },
          { id: 'REPCONTRATISTAS_GLOBAL', title: 'Todas las Obras' }
        ]);
        res.sendStatus(200);
        return;
      }

      // CONSULTA AVANCE DE PRESUPUESTOS (COBRADO VS AUTORIZADO)
      if (/^(avance|cobrado|avance presupuestos)$/i.test(textBody)) {
        const rep = await calcularReportePresupuestos();
        let msgTexto = '🏦 *Avance de Presupuestos Autorizados (Farmacias):*\n\n';
        Object.keys(rep).forEach(o => {
          const t = rep[o];
          const porCobrar = t.presupuestoTotal - t.liberado;
          msgTexto += `🏗️ *${o}*\n` +
            `  • Presupuesto Autorizado: $${t.presupuestoTotal.toFixed(2)}\n` +
            `  • Liberado a la Fecha: $${t.liberado.toFixed(2)}\n` +
            `  • Pendiente por Liberar: $${porCobrar.toFixed(2)}\n\n`;
        });
        await enviarTexto(from, msgTexto);
        res.sendStatus(200);
        return;
      }

      // REGISTRO DE PRESUPUESTO AUTORIZADO (SOLO MONTO, PREGUNTA OBRA)
      const matchPptoTotalAuto = textBody.match(/^(presupuesto autorizado|presupuesto total)\s+(\d+(\.\d+)?)/i);
      if (matchPptoTotalAuto) {
        const montoPpto = parseFloat(matchPptoTotalAuto[2]);

        sesiones[from] = {
          tipoAccion: 'PPTO_TOTAL',
          idMovimiento: 'PPT-' + Date.now().toString().slice(-6),
          monto: montoPpto,
          concepto: 'Presupuesto Total Autorizado Farmacia',
          usuario: nombreUsuario
        };

        await enviarBotones(from, `🏢 *Presupuesto Total Autorizado:* $${montoPpto.toFixed(2)}\n\n🏗️ *¿A qué sucursal pertenece este presupuesto?*`, [
          { id: 'PPTOBRA_Pelicano', title: 'Pelicano' },
          { id: 'PPTOBRA_Caldera', title: 'Caldera' },
          { id: 'PPTOBRA_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Opciones:*', [
          { id: 'PPTOBRA_Salud', title: 'Salud' },
          { id: 'PPTOBRA_Otro', title: 'Otro' }
        ]);
        res.sendStatus(200);
        return;
      }

      // REGISTRO DE CONTRATO A CONTRATISTA (SOLO MONTO, PREGUNTA OBRA)
      const matchContrato = textBody.match(/^contrato\s+(.+)\s+(\d+(\.\d+)?)/i);
      if (matchContrato) {
        const nombreContratista = matchContrato[1].trim();
        const montoContrato = parseFloat(matchContrato[2]);

        sesiones[from] = {
          tipoAccion: 'CONTRATO_CONTRATISTA',
          idMovimiento: 'CTR-' + Date.now().toString().slice(-6),
          monto: montoContrato,
          contratista: nombreContratista.toUpperCase(),
          concepto: `Contrato ${nombreContratista.toUpperCase()} Total Autorizado`,
          usuario: nombreUsuario
        };

        await enviarBotones(from, `👷‍♂️ *Contrato ${nombreContratista.toUpperCase()}:* $${montoContrato.toFixed(2)}\n\n🏗️ *¿A qué sucursal pertenece este contrato?*`, [
          { id: 'CTROBRA_Pelicano', title: 'Pelicano' },
          { id: 'CTROBRA_Caldera', title: 'Caldera' },
          { id: 'CTROBRA_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Opciones:*', [
          { id: 'CTROBRA_Salud', title: 'Salud' },
          { id: 'CTROBRA_Otro', title: 'Otro' }
        ]);
        res.sendStatus(200);
        return;
      }

      // INGRESO LIBERADO POR FARMACIA (PARTIDA DADA)
      const matchPresupuesto = textBody.match(/^(ingreso|pago farmacia)\s+(\d+(\.\d+)?)/i);
      if (matchPresupuesto) {
        const montoIngreso = parseFloat(matchPresupuesto[2]);

        sesiones[from] = {
          tipoAccion: 'PRESUPUESTO',
          idMovimiento: 'ING-' + Date.now().toString().slice(-6),
          monto: montoIngreso,
          concepto: 'Ingreso Liberado Farmacia',
          usuario: nombreUsuario
        };

        await enviarBotones(from, `🏦 *Ingreso Liberado Farmacia:* $${montoIngreso.toFixed(2)}\n\n🏗️ *¿A qué sucursal ingresa este pago?*`, [
          { id: 'ACTOBRA_Pelicano', title: 'Pelicano' },
          { id: 'ACTOBRA_Caldera', title: 'Caldera' },
          { id: 'ACTOBRA_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Opciones:*', [
          { id: 'ACTOBRA_Salud', title: 'Salud' },
          { id: 'ACTOBRA_Otro', title: 'Otro' }
        ]);
        res.sendStatus(200);
        return;
      }

      // DOTACIÓN DE CAJA CHICA / EFECTIVO CENTRAL
      const matchCaja = textBody.match(/^(caja|efectivo|dotacion|fondo)\s+(\d+(\.\d+)?)/i);
      if (matchCaja) {
        const montoCaja = parseFloat(matchCaja[2]);

        await guardarEnSheets({
          idMovimiento: 'DOT-' + Date.now().toString().slice(-6),
          obra: 'Efectivo General',
          metodo: 'Dotación Caja Chica',
          subMetodo: '',
          categoria: 'Fondo de Caja',
          monto: montoCaja,
          concepto: 'Ingreso a Caja Chica Central (Efectivo)',
          usuario: nombreUsuario,
          estatusFactura: 'No Requiere 🔴',
          linkFactura: 'N/A'
        });

        const reporteCaja = await calcularReporteSaldos(null);
        await enviarTexto(from, `💵 *Efectivo Ingresado a Caja Chica:* $${montoCaja.toFixed(2)}\n👤 *Registró:* ${nombreUsuario}\n\n💰 *Efectivo Disponible en Mano:* $${reporteCaja.cajaDisponible.toFixed(2)} MXN`);
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

      sesiones[from] = {
        tipoAccion: 'GASTO',
        idMovimiento: 'MOV-' + Date.now().toString().slice(-6),
        concepto,
        monto,
        categoria: '12) VARIOS',
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

      // REPORTE DE CONTRATISTAS FILTRADO POR SUCURSAL
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

      // ASIGNACIÓN DE SUCURSAL PARA CONTRATO DE CONTRATISTA
      if (respuestaId?.startsWith('CTROBRA_')) {
        const obraMap = {
          'CTROBRA_Pelicano': 'Suc. Pelicano',
          'CTROBRA_Caldera': 'Suc. Caldera',
          'CTROBRA_Nativitas': 'Suc. Nativitas',
          'CTROBRA_Salud': 'Suc. Salud',
          'CTROBRA_Otro': 'Suc. Otro'
        };
        const obraElegida = obraMap[respuestaId] || 'Suc. Otro';

        await guardarEnSheets({
          idMovimiento: sesion.idMovimiento,
          obra: obraElegida,
          metodo: 'Asignación Contrato',
          subMetodo: '',
          categoria: '20) INDIRECTOS',
          monto: sesion.monto,
          concepto: `Contrato ${sesion.contratista} Total Autorizado`,
          usuario: sesion.usuario,
          estatusFactura: 'No Requiere 🔴',
          linkFactura: 'N/A'
        });

        await enviarTexto(from, `✅ *Contrato Registrado con Éxito*\n👷‍♂️ *Contratista:* ${sesion.contratista}\n🏗️ *Sucursal:* ${obraElegida}\n💵 *Monto Total:* $${sesion.monto.toFixed(2)}`);
        delete sesiones[from];
        res.sendStatus(200);
        return;
      }

      // ASIGNACIÓN DE SUCURSAL PARA PRESUPUESTO AUTORIZADO
      if (respuestaId?.startsWith('PPTOBRA_')) {
        const obraMap = {
          'PPTOBRA_Pelicano': 'Suc. Pelicano',
          'PPTOBRA_Caldera': 'Suc. Caldera',
          'PPTOBRA_Nativitas': 'Suc. Nativitas',
          'PPTOBRA_Salud': 'Suc. Salud',
          'PPTOBRA_Otro': 'Suc. Otro'
        };
        const obraElegida = obraMap[respuestaId] || 'Suc. Otro';

        await guardarEnSheets({
          idMovimiento: sesion.idMovimiento,
          obra: obraElegida,
          metodo: 'Asignación Presupuesto',
          subMetodo: '',
          categoria: 'Cobro Cliente',
          monto: sesion.monto,
          concepto: 'Presupuesto Total Autorizado Farmacia',
          usuario: sesion.usuario,
          estatusFactura: 'No Requiere 🔴',
          linkFactura: 'N/A'
        });

        await enviarTexto(from, `✅ *Presupuesto Total Autorizado Registrado*\n🏗️ *Sucursal:* ${obraElegida}\n💵 *Monto:* $${sesion.monto.toFixed(2)}`);
        delete sesiones[from];
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('ACTOBRA_')) {
        const obraMap = {
          'ACTOBRA_Pelicano': 'Suc. Pelicano',
          'ACTOBRA_Caldera': 'Suc. Caldera',
          'ACTOBRA_Nativitas': 'Suc. Nativitas',
          'ACTOBRA_Salud': 'Suc. Salud',
          'ACTOBRA_Otro': 'Suc. Otro'
        };
        const obraElegida = obraMap[respuestaId] || 'Suc. Otro';

        await guardarEnSheets({
          idMovimiento: sesion.idMovimiento,
          obra: obraElegida,
          metodo: 'Ingreso Presupuesto',
          subMetodo: '',
          categoria: 'Cobro Cliente',
          monto: sesion.monto,
          concepto: sesion.concepto,
          usuario: sesion.usuario,
          estatusFactura: 'No Requiere 🔴',
          linkFactura: 'N/A'
        });

        await enviarTexto(from, `🏦 *Ingreso Liberado Registrado Correctamente*\n🏗️ *Sucursal:* ${obraElegida}\n💵 *Monto:* $${sesion.monto.toFixed(2)}`);
        delete sesiones[from];
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

        await enviarLista(from, `🏗️ *Obra:* ${sesion.obra}\n\n📌 *Selecciona la Categoría Principal:*`, 'Ver Categorías', 'Categorías Principales:', CATEGORIAS_PRINCIPALES);

      } else if (respuestaId?.startsWith('CAT_')) {
        if (respuestaId === 'CAT_BLOQUE_1') {
          await enviarLista(from, '📋 *Materiales y Obras:*', 'Ver Opciones', 'Selecciona una:', CATEGORIAS_MATERIALES);
          res.sendStatus(200);
          return;
        }

        if (respuestaId === 'CAT_BLOQUE_2') {
          await enviarLista(from, '📋 *Servicios y Administración:*', 'Ver Opciones', 'Selecciona una:', CATEGORIAS_SERVICIOS);
          res.sendStatus(200);
          return;
        }

        const todasCategorias = CATEGORIAS_PRINCIPALES.concat(CATEGORIAS_MATERIALES).concat(CATEGORIAS_SERVICIOS);
        const catSel = todasCategorias.find(c => c.id === respuestaId);
        sesion.categoria = catSel ? catSel.title : '12) VARIOS';

        if (sesion.categoria === 'HONORARIOS') {
          await enviarBotones(from, '👤 *¿Honorarios de quién?*', [
            { id: 'HON_Rigo', title: 'Rigo' },
            { id: 'HON_Paty', title: 'Paty' },
            { id: 'HON_Casa', title: 'Casa' }
          ]);
        } else {
          await desplegarFormasPago(from);
        }

      } else if (respuestaId?.startsWith('HON_')) {
        const honMap = {
          'HON_Rigo': 'Honorarios (Rigo)',
          'HON_Paty': 'Honorarios (Paty)',
          'HON_Casa': 'Honorarios (Casa)'
        };
        sesion.categoria = honMap[respuestaId] || 'HONORARIOS';
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
