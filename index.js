const express = require('express');
const { google } = require('googleapis');
const https = require('https');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const SPREADSHEET_PRECIOS_ID = process.env.SPREADSHEET_PRECIOS_ID || '1Cscdoi4k3BkHLWPSB9nSxrGyZsshRXMKEtx2jbBcIQ0';
const SPREADSHEET_EXTRAS_ID = process.env.SPREADSHEET_EXTRAS_ID || '1uO9QMilrhjooFgsqF7Nu7GA4WYEV94QZRNjwQj2Jz5o';
const SPREADSHEET_PERSONAL_ID = process.env.SPREADSHEET_PERSONAL_ID || '1LU5V21D9wPILoq6HHEBqxJc9mE7EwDMJEnwpvQHnpFQ';
const DRIVE_FOLDER_EXTRAS_ID = process.env.DRIVE_FOLDER_EXTRAS_ID || '1ZTIGfyRjFa0Yn1MMUMjOzWiPi810vVvw';

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const sesiones = {};

const ROLES_DIRECCION = ['3314856080', '3314107902', '3313008395'];

const DIRECTORIO_USUARIOS = {
  '3336673972': 'Paty',
  '3314107902': 'Rigo',
  '3331747434': 'Miguelonches',
  '3314856080': 'Beto',
  '3313008395': 'Cris'
};

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
  { id: 'CAT_28', title: 'GASTO HISTORICO INICIAL' },
  { id: 'CAT_29', title: '29) RESIDENCIA DE OBRA' }
];

const CONTRATISTAS_VALIDOS = ['tablaroca', 'aluminio y vidrio', 'cortinas', 'pintura', 'cubiertas', 'herreria', 'carpinteria'];

function formatoMoneda(monto) {
  const num = parseFloat(monto) || 0;
  return '$' + num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function limpiarMonto(texto) {
  if (!texto) return 0;
  const limpio = texto.toString().replace('$', '').replace(/,/g, '').trim();
  const res = parseFloat(limpio);
  return isNaN(res) ? 0 : res;
}

function esDireccion(from) {
  if (!from) return false;
  const diez = from.replace(/\D/g, '').slice(-10);
  return ROLES_DIRECCION.includes(diez);
}

function obtenerNombreUsuario(numeroFrom) {
  if (!numeroFrom) return 'Usuario WhatsApp';
  const diezDigitos = numeroFrom.replace(/\D/g, '').slice(-10);
  return DIRECTORIO_USUARIOS[diezDigitos] || `Usuario (${diezDigitos})`;
}

function extraerPalabraClave(texto) {
  if (!texto) return 'EXTRA';
  const palabrasIgnoradas = ['de', 'del', 'la', 'los', 'las', 'un', 'una', 'en', 'para', 'por', 'con', 'sin', 'instalacion', 'colocacion', 'trabajo', 'reparacion', 'arreglo'];
  const palabras = texto.toLowerCase().replace(/[^a-z0-9áéíóúñ\s]/gi, '').split(/\s+/);
  const palabraFilt = palabras.find(p => p.length > 2 && !palabrasIgnoradas.includes(p));
  return palabraFilt ? palabraFilt.toUpperCase() : 'TRABAJO';
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
} catch (error) {
  console.error('❌ Error OAuth2 Google:', error.message);
}

function enviarPeticionMeta(payload) {
  return new Promise((resolve) => {
    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return resolve();

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

    req.on('error', () => resolve());
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

async function enviarDocumentoWhatsApp(to, rutaArchivo, nombreArchivo, caption) {
  return new Promise((resolve) => {
    if (!fs.existsSync(rutaArchivo)) return resolve();

    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fs.createReadStream(rutaArchivo), { filename: nombreArchivo, contentType: 'application/pdf' });
    form.append('type', 'document');
    form.append('messaging_product', 'whatsapp');

    const reqMetaMedia = https.request({
      hostname: 'graph.facebook.com',
      port: 443,
      path: `/v18.0/${PHONE_NUMBER_ID.trim()}/media`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN.trim()}`,
        ...form.getHeaders()
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', async () => {
        try {
          const resJson = JSON.parse(body);
          const mediaId = resJson.id;
          if (mediaId) {
            await enviarPeticionMeta({
              messaging_product: 'whatsapp',
              to,
              type: 'document',
              document: { id: mediaId, filename: nombreArchivo, caption: caption }
            });
          }
          resolve();
        } catch (e) { resolve(); }
      });
    });

    reqMetaMedia.on('error', () => resolve());
    form.pipe(reqMetaMedia);
  });
}

function generarPDFCorteSemanal(datos, rutaSalida) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 35, size: 'LETTER' });
    const stream = fs.createWriteStream(rutaSalida);
    doc.pipe(stream);

    const rutasPosiblesLogo = [
      path.join(__dirname, 'logo.png'),
      path.join(__dirname, 'logo.PNG'),
      path.join(__dirname, 'Imagenes', 'logo.png'),
      path.join(__dirname, 'imagenes', 'logo.png')
    ];

    let rutaLogoEncontrada = rutasPosiblesLogo.find(r => fs.existsSync(r));
    if (rutaLogoEncontrada) {
      doc.image(rutaLogoEncontrada, 35, 20, { width: 105 });
    }

    doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold')
       .text('CONSTRUCTIVE GALLERY ARCHITECTS', 180, 25, { align: 'right' });
    doc.fontSize(9).fillColor('#4A5568')
       .text('ESTADO DE CUENTA Y CORTE FINANCIERO SEMANAL', 180, 40, { align: 'right' });
    doc.fontSize(8).fillColor('#718096')
       .text(`SUCURSAL: ${datos.sucursal.toUpperCase()}  |  PERIODO: ${datos.periodo}`, 180, 53, { align: 'right' });

    doc.moveTo(35, 70).lineTo(575, 70).strokeColor('#000000').lineWidth(1.5).stroke();

    // 1. FLUJO SEMANAL
    let y = 80;
    doc.rect(35, y, 540, 16).fill('#000000');
    doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold').text('1. RESUMEN DE FLUJO SEMANAL (LUNES A DOMINGO)', 40, y + 4);

    y += 20;
    const anchoCaja = 130;
    const cajas = [
      { t: 'GASTOS EFECTIVO', v: formatoMoneda(datos.semanaEfectivo) },
      { t: 'GASTOS TARJETA', v: formatoMoneda(datos.semanaTarjeta) },
      { t: 'TRANSFERENCIAS', v: formatoMoneda(datos.semanaTransferencia) },
      { t: 'TOTAL SEMANAL', v: formatoMoneda(datos.semanaTotal) }
    ];

    cajas.forEach((c, i) => {
      const x = 35 + (i * 135);
      doc.rect(x, y, anchoCaja, 28).fillAndStroke('#F8FAFC', '#CBD5E1');
      doc.fillColor('#64748B').fontSize(6.5).font('Helvetica-Bold').text(c.t, x + 5, y + 4, { width: anchoCaja - 10, align: 'center' });
      doc.fillColor('#0F172A').fontSize(9.5).font('Helvetica-Bold').text(c.v, x + 5, y + 14, { width: anchoCaja - 10, align: 'center' });
    });

    // 2. DESGLOSE DE GASTOS
    y += 36;
    doc.rect(35, y, 540, 16).fill('#000000');
    doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold').text('2. DESGLOSE DE GASTOS SEMANALES VS ACUMULADO POR CATEGORÍA', 40, y + 4);

    y += 18;
    doc.rect(35, y, 540, 14).fill('#E2E8F0');
    doc.fillColor('#0F172A').fontSize(7.5).font('Helvetica-Bold');
    doc.text('Partida Presupuestal / Categoría', 40, y + 3);
    doc.text('Gastado en la Semana', 280, y + 3, { width: 130, align: 'right' });
    doc.text('Acumulado Histórico', 420, y + 3, { width: 150, align: 'right' });

    y += 15;
    doc.font('Helvetica').fontSize(7.5);
    
    let contadorFilas = 0;
    datos.partidas.forEach((p) => {
      if (p.semana > 0 || p.acumulado > 0) {
        if (contadorFilas % 2 === 1) doc.rect(35, y - 2, 540, 12).fill('#F8FAFC');
        doc.fillColor('#1A1A1A').text(p.nombre, 40, y);
        doc.text(formatoMoneda(p.semana), 280, y, { width: 130, align: 'right' });
        doc.text(formatoMoneda(p.acumulado), 420, y, { width: 150, align: 'right' });
        y += 12;
        contadorFilas++;
      }
    });

    if (contadorFilas === 0) {
      doc.fillColor('#64748B').text('Sin gastos registrados en la semana seleccionada.', 40, y, { align: 'left' });
      y += 12;
    }

    doc.rect(35, y, 540, 13).fill('#F1F5F9');
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(7.5);
    doc.text('TOTAL GENERAL ACUMULADO DE OBRA', 40, y + 3);
    doc.text(formatoMoneda(datos.semanaTotal), 280, y + 3, { width: 130, align: 'right' });
    doc.text(formatoMoneda(datos.gastosTotal), 420, y + 3, { width: 150, align: 'right' });

    // 3. CONTRATISTAS
    y += 20;
    doc.rect(35, y, 540, 16).fill('#000000');
    doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold').text('3. ESTADO DE CUENTA DETALLADO DE CONTRATISTAS', 40, y + 4);

    y += 18;
    doc.rect(35, y, 540, 14).fill('#E2E8F0');
    doc.fillColor('#0F172A').fontSize(7.5).font('Helvetica-Bold');
    doc.text('Especialidad / Contratista', 40, y + 3);
    doc.text('Contrato Autorizado', 240, y + 3, { width: 105, align: 'right' });
    doc.text('Pagado a la Fecha', 355, y + 3, { width: 105, align: 'right' });
    doc.text('Saldo Pendiente', 465, y + 3, { width: 105, align: 'right' });

    y += 15;
    doc.font('Helvetica').fontSize(7.5);

    let cFilas = 0;
    Object.keys(datos.detalleContratistas).forEach((esp) => {
      const c = datos.detalleContratistas[esp];
      if (c.contrato > 0 || c.pagado > 0) {
        if (cFilas % 2 === 1) doc.rect(35, y - 2, 540, 12).fill('#F8FAFC');
        const pendiente = c.contrato - c.pagado;
        doc.fillColor('#1A1A1A').text(esp.toUpperCase(), 40, y);
        doc.text(formatoMoneda(c.contrato), 240, y, { width: 105, align: 'right' });
        doc.fillColor('#166534').text(formatoMoneda(c.pagado), 355, y, { width: 105, align: 'right' });
        doc.fillColor(pendiente > 0 ? '#991B1B' : '#0F172A').text(formatoMoneda(pendiente), 465, y, { width: 105, align: 'right' });
        y += 12;
        cFilas++;
      }
    });

    if (cFilas === 0) {
      doc.fillColor('#64748B').text('Sin contratos o destajos asignados a esta sucursal.', 40, y, { align: 'left' });
      y += 12;
    }

    doc.rect(35, y, 540, 13).fill('#F1F5F9');
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(7.5);
    doc.text('TOTAL CONTRATISTAS', 40, y + 3);
    doc.text(formatoMoneda(datos.contratistasContrato), 240, y + 3, { width: 105, align: 'right' });
    doc.fillColor('#166534').text(formatoMoneda(datos.contratistasPagado), 355, y + 3, { width: 105, align: 'right' });
    doc.fillColor(datos.contratistasDeuda > 0 ? '#991B1B' : '#0F172A').text(formatoMoneda(datos.contratistasDeuda), 465, y + 3, { width: 105, align: 'right' });

    // 4. BALANCE FINANCIERO Y DESGLOSE EN CUENTAS
    y += 20;
    doc.rect(35, y, 540, 16).fill('#000000');
    doc.fillColor('#FFFFFF').fontSize(8.5).font('Helvetica-Bold').text('4. BALANCE FINANCIERO GENERAL Y DISPONIBILIDAD', 40, y + 4);

    y += 18;
    doc.fillColor('#000000').fontSize(7.5).font('Helvetica');
    doc.text('(+) Total Presupuesto / Ingresos Recibidos:', 40, y, { width: 180 });
    doc.font('Helvetica-Bold').text(formatoMoneda(datos.ingresosTotal), 205, y, { width: 90, align: 'right' });

    doc.font('Helvetica').fillColor('#991B1B').text('(-) Gastos Acumulados Totales de Obra:', 305, y, { width: 175 });
    doc.font('Helvetica-Bold').text(formatoMoneda(datos.gastosTotal), 480, y, { width: 95, align: 'right' });

    y += 14;
    doc.fillColor('#166534').font('Helvetica-Bold').text('(=) SALDO TOTAL DISPONIBLE EN OBRA:', 40, y, { width: 180 });
    doc.text(formatoMoneda(datos.saldoDisponible), 205, y, { width: 90, align: 'right' });

    // Desglose Cuentas
    y += 18;
    doc.rect(35, y, 540, 48).fillAndStroke('#F8FAFC', '#CBD5E1');
    doc.fillColor('#0F172A').fontSize(7.5).font('Helvetica-Bold').text('DESGLOSE DETALLADO DE DISPONIBILIDAD EN CUENTAS:', 42, y + 4);
    
    doc.font('Helvetica').fontSize(7);
    doc.text(`• Banamex Beto: ${formatoMoneda(datos.cuentas.banamexBeto)}`, 45, y + 16);
    doc.text(`• BBVA Rigo: ${formatoMoneda(datos.cuentas.bbvaRigo)}`, 45, y + 26);
    doc.text(`• BBVA Beto: ${formatoMoneda(datos.cuentas.bbvaBeto)}`, 45, y + 36);

    doc.text(`• Tarjeta NU: ${formatoMoneda(datos.cuentas.nu)}`, 220, y + 16);
    doc.text(`• Tarjeta DIDI: ${formatoMoneda(datos.cuentas.didi)}`, 220, y + 26);
    doc.text(`• MercadoPago: ${formatoMoneda(datos.cuentas.mercadoPago)}`, 220, y + 36);

    doc.fillColor('#166534').font('Helvetica-Bold');
    doc.text(`• En Efectivo (Caja Chica): ${formatoMoneda(datos.saldoEfectivo)}`, 385, y + 16);
    doc.text(`• Total en Bancos: ${formatoMoneda(datos.saldoBanco)}`, 385, y + 28);

    // ==========================================
    // FIRMA ABSOLUTA SEGURA (Y = 700)
    // ==========================================
    const yFirmaSegura = 700; 
    const xFirma = 350;
    const anchoFirma = 210;

    const rutasPosiblesFirma = [
      path.join(__dirname, 'firma.png'),
      path.join(__dirname, 'firma.PNG'),
      path.join(__dirname, 'Imagenes', 'firma.png'),
      path.join(__dirname, 'imagenes', 'firma.png')
    ];

    let rutaFirmaEncontrada = rutasPosiblesFirma.find(r => fs.existsSync(r));
    if (rutaFirmaEncontrada) {
      doc.image(rutaFirmaEncontrada, xFirma + 55, yFirmaSegura - 45, { width: 95 });
    }

    doc.moveTo(xFirma, yFirmaSegura + 6).lineTo(xFirma + anchoFirma, yFirmaSegura + 6).strokeColor('#000000').lineWidth(1).stroke();
    
    let yTextoFirma = yFirmaSegura + 10;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#0F172A')
        .text('Administración Constructive Gallery Architects', xFirma, yTextoFirma, { width: anchoFirma, align: 'center' });
    
    yTextoFirma += 10;
    doc.fontSize(6.5).font('Helvetica').fillColor('#64748B')
        .text('Validación y Firma Digital Autónoma', xFirma, yTextoFirma, { width: anchoFirma, align: 'center' });

    doc.end();
    stream.on('finish', () => resolve(rutaSalida));
    stream.on('error', reject);
  });
}

async function calcularGastosPreviosObra(obraBuscada) {
  if (!sheets || !SPREADSHEET_ID) return 0;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:I'
    });
    const filas = res.data.values || [];
    let acumuladoPrevio = 0;

    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i];
      const obra = fila[2] || '';
      const categoria = (fila[4] || '').toUpperCase();
      const monto = limpiarMonto(fila[5]);
      const estatus = fila[8] || '';

      if (estatus.includes('CANCELADO') || monto === 0) continue;
      if (obra.toLowerCase() === obraBuscada.toLowerCase()) {
        if (!categoria.includes('CONTROL') && !categoria.includes('APERTURA') && !categoria.includes('PRESUPUESTO')) {
          acumuladoPrevio += monto;
        }
      }
    }
    return acumuladoPrevio;
  } catch (e) {
    return 0;
  }
}

async function generarDatosCorteSemanal(obraBuscada) {
  if (!sheets || !SPREADSHEET_ID) return null;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:J'
    });
    const filas = res.data.values || [];

    const ahora = new Date();
    const diaSemana = ahora.getDay();
    const diferenciaLunes = diaSemana === 0 ? 6 : diaSemana - 1;

    const inicioLunes = new Date(ahora);
    inicioLunes.setDate(ahora.getDate() - diferenciaLunes);
    inicioLunes.setHours(0, 0, 0, 0);

    const finDomingo = new Date(inicioLunes);
    finDomingo.setDate(inicioLunes.getDate() + 6);
    finDomingo.setHours(23, 59, 59, 999);

    let semanaEfectivo = 0, semanaTarjeta = 0, semanaTransferencia = 0;
    let gastosTotal = 0, ingresosTotal = 0, dotacionesCaja = 0, egresosEfectivoTotal = 0;

    const cuentas = {
      banamexBeto: 0,
      bbvaRigo: 0,
      bbvaBeto: 0,
      nu: 0,
      didi: 0,
      mercadoPago: 0
    };

    const mapaPartidas = {};
    const detalleContratistas = {};
    CONTRATISTAS_VALIDOS.forEach(c => detalleContratistas[c] = { contrato: 0, pagado: 0 });

    let totalPagadoContratistasGlobal = 0;
    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i];
      const obra = fila[2] || '';
      const concepto = (fila[6] || '').toLowerCase();
      const categoria = (fila[4] || '').toUpperCase();
      const monto = limpiarMonto(fila[5]);
      const estatus = fila[8] || '';

      if (estatus.includes('CANCELADO') || monto === 0) continue;
      if (obraBuscada && obra.toLowerCase() !== obraBuscada.toLowerCase()) continue;

      CONTRATISTAS_VALIDOS.forEach(c => {
        if ((concepto.includes(c) || categoria.includes(c.toUpperCase())) && !concepto.includes('contrato') && !concepto.includes('cerrado') && !concepto.includes('total autorizado')) {
          totalPagadoContratistasGlobal += monto;
        }
      });
    }

    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i];
      const fechaStr = fila[1] || '';
      const obra = fila[2] || '';
      const metodo = fila[3] || '';
      const categoria = (fila[4] || '20) VARIOS').toUpperCase();
      let monto = limpiarMonto(fila[5]);
      const concepto = (fila[6] || '').toLowerCase();
      const estatus = fila[8] || '';

      if (estatus.includes('CANCELADO') || monto === 0) continue;

      if (!obraBuscada || obra.toLowerCase() === obraBuscada.toLowerCase()) {
        let fechaMov = new Date(fechaStr);
        const partes = fechaStr.split(',')[0].split('/');
        if (partes.length === 3) {
          fechaMov = new Date(partes[2], partes[1] - 1, partes[0]);
        }
        
        const esSemanaActual = !isNaN(fechaMov.getTime()) && fechaMov >= inicioLunes && fechaMov <= finDomingo;

        if (metodo.includes('Apertura Banamex Beto')) cuentas.banamexBeto += monto;
        else if (metodo.includes('Apertura BBVA Rigo')) cuentas.bbvaRigo += monto;
        else if (metodo.includes('Apertura BBVA Beto')) cuentas.bbvaBeto += monto;
        else if (metodo.includes('Apertura NU')) cuentas.nu += monto;
        else if (metodo.includes('Apertura DIDI')) cuentas.didi += monto;
        else if (metodo.includes('Apertura MercadoPago')) cuentas.mercadoPago += monto;

        if (metodo.includes('Banamex Beto') && !metodo.includes('Apertura')) cuentas.banamexBeto -= monto;
        else if (metodo.includes('BBVA Rigo') && !metodo.includes('Apertura')) cuentas.bbvaRigo -= monto;
        else if (metodo.includes('BBVA Beto') && !metodo.includes('Apertura')) cuentas.bbvaBeto -= monto;
        else if (metodo.includes('NU') && !metodo.includes('Apertura')) cuentas.nu -= monto;
        else if (metodo.includes('DIDI') && !metodo.includes('Apertura')) cuentas.didi -= monto;
        else if (metodo.includes('MercadoPago') && !metodo.includes('Apertura')) cuentas.mercadoPago -= monto;

        if (concepto.includes('presupuesto total autorizado') || metodo.includes('Control Presupuestal')) {
          // Informativo de presupuesto
        } else if (metodo.includes('Ingreso Presupuesto') || concepto.includes('ingreso presupuesto')) {
          ingresosTotal += monto;
        } else if (metodo.includes('Dotación Caja Chica')) {
          dotacionesCaja += monto;
        } else if (concepto.includes('contrato') || concepto.includes('cerrado')) {
          CONTRATISTAS_VALIDOS.forEach(c => {
            if (concepto.includes(c) || categoria.includes(c.toUpperCase())) {
              detalleContratistas[c].contrato += monto;
            }
          });
        } else if (!metodo.includes('Apertura') && !categoria.includes('CONTROL') && !categoria.includes('APERTURA')) {
          
          if (categoria.includes('GASTO HISTORICO INICIAL')) {
            monto = monto - totalPagadoContratistasGlobal;
          }

          gastosTotal += monto;

          if (metodo.startsWith('Efectivo')) {
            egresosEfectivoTotal += monto;
          }

          if (!mapaPartidas[categoria]) mapaPartidas[categoria] = { semana: 0, acumulado: 0 };
          mapaPartidas[categoria].acumulado += monto;

          if (esSemanaActual) {
            mapaPartidas[categoria].semana += monto;
            if (metodo.startsWith('Efectivo')) semanaEfectivo += monto;
            else if (metodo.startsWith('Tarjeta')) semanaTarjeta += monto;
            else if (metodo.startsWith('Transferencia')) semanaTransferencia += monto;
          }
        }

        CONTRATISTAS_VALIDOS.forEach(c => {
          if ((concepto.includes(c) || categoria.includes(c.toUpperCase())) && !concepto.includes('contrato') && !concepto.includes('cerrado') && !concepto.includes('total autorizado')) {
            detalleContratistas[c].pagado += monto;
          }
        });
      }
    }

    const listaPartidas = Object.keys(mapaPartidas).map(k => ({
      nombre: k,
      semana: mapaPartidas[k].semana,
      acumulado: mapaPartidas[k].acumulado
    }));

    let contratistasContrato = 0, contratistasPagado = 0;
    Object.keys(detalleContratistas).forEach(k => {
      contratistasContrato += detalleContratistas[k].contrato;
      contratistasPagado += detalleContratistas[k].pagado;
    });

    const inicioStr = inicioLunes.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });
    const finStr = finDomingo.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });

    const saldoDisponible = ingresosTotal - gastosTotal;
    let saldoEfectivo = dotacionesCaja - egresosEfectivoTotal;
    if (saldoEfectivo < 0) saldoEfectivo = 0;

    let saldoBancoTotal = (cuentas.banamexBeto + cuentas.bbvaRigo + cuentas.bbvaBeto + cuentas.nu + cuentas.didi + cuentas.mercadoPago);
    if (saldoBancoTotal <= 0 && saldoDisponible > saldoEfectivo) {
      saldoBancoTotal = saldoDisponible - saldoEfectivo;
    }

    return {
      sucursal: obraBuscada || 'General Global',
      periodo: `${inicioStr} al ${finStr}`,
      semanaEfectivo,
      semanaTarjeta,
      semanaTransferencia,
      semanaTotal: semanaEfectivo + semanaTarjeta + semanaTransferencia,
      partidas: listaPartidas,
      detalleContratistas,
      contratistasContrato,
      contratistasPagado,
      contratistasDeuda: contratistasContrato - contratistasPagado,
      ingresosTotal,
      gastosTotal,
      saldoDisponible,
      saldoBanco: saldoBancoTotal > 0 ? saldoBancoTotal : 0,
      saldoEfectivo: saldoEfectivo > 0 ? saldoEfectivo : 0,
      cuentas
    };
  } catch (error) {
    return null;
  }
}

async function verificarSobregiroContratista(obra, categoria, concepto, montoNuevo) {
  if (!sheets || !SPREADSHEET_ID) return null;
  try {
    const textoComp = `${categoria} ${concepto}`.toLowerCase();
    const contratista = CONTRATISTAS_VALIDOS.find(c => textoComp.includes(c));
    if (!contratista) return null;

    const rep = await calcularReporteContratistas(obra);
    const datosC = rep[contratista];
    if (!datosC || datosC.totalContrato <= 0) return null;

    const totalPagadoFuturo = datosC.pagado + montoNuevo;
    const porcentaje = (totalPagadoFuturo / datosC.totalContrato) * 100;

    if (porcentaje > 100) {
      const exceso = totalPagadoFuturo - datosC.totalContrato;
      return `🚨 *ALERTA DE SOBREGIRO:* El contratista de *${contratista.toUpperCase()}* ha superado su contrato por ${formatoMoneda(exceso)} (${porcentaje.toFixed(1)}% pagado).`;
    } else if (porcentaje >= 90) {
      return `🟡 *AVISO PREVENTIVO:* El contratista de *${contratista.toUpperCase()}* está al ${porcentaje.toFixed(1)}% de su contrato (${formatoMoneda(totalPagadoFuturo)} de ${formatoMoneda(datosC.totalContrato)}).`;
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function obtenerUltimosGastos(obraFiltro) {
  if (!sheets || !SPREADSHEET_ID) return [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:I'
    });
    const filas = res.data.values || [];
    const ultimos = [];

    for (let i = filas.length - 1; i >= 1; i--) {
      const fila = filas[i];
      const id = fila[0] || '';
      const obra = fila[2] || '';
      const monto = limpiarMonto(fila[5]);
      const concepto = (fila[6] || '').toLowerCase();
      const estatus = fila[8] || '';

      if (!estatus.includes('CANCELADO') && monto > 0) {
        if (!obraFiltro || obra.toLowerCase() === obraFiltro.toLowerCase()) {
          ultimos.push({ filaIndex: i + 1, id, obra, concepto, monto });
        }
      }
      if (ultimos.length >= 10) break;
    }
    return ultimos;
  } catch (e) {
    return [];
  }
}

async function actualizarMontoGasto(filaIndex, nuevoMonto) {
  if (!sheets || !SPREADSHEET_ID) return false;
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Hoja 1!F${filaIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[nuevoMonto]] }
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function anularGastoPorFila(filaIndex) {
  if (!sheets || !SPREADSHEET_ID) return false;
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `Hoja 1!F${filaIndex}:I${filaIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[0, 'ANULADO', '', '❌ CANCELADO']] }
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function obtenerOcrearSubcarpetaObra(nombreObra) {
  if (!drive || !DRIVE_FOLDER_EXTRAS_ID) return DRIVE_FOLDER_EXTRAS_ID;
  try {
    const nombreLimpio = nombreObra.replace(/^Suc\.\s*/i, '').trim();
    const q = `'${DRIVE_FOLDER_EXTRAS_ID}' in parents and name contains '${nombreLimpio}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const res = await drive.files.list({ q, fields: 'files(id, name)' });
    
    if (res.data.files && res.data.files.length > 0) {
      return res.data.files[0].id;
    }
    
    const folderMetadata = {
      name: `Suc. ${nombreLimpio}`,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [DRIVE_FOLDER_EXTRAS_ID]
    };
    const folder = await drive.files.create({ resource: folderMetadata, fields: 'id' });
    return folder.data.id;
  } catch (error) {
    return DRIVE_FOLDER_EXTRAS_ID;
  }
}

async function obtenerOcrearCarpetaTrabajoExtra(parentFolderId, idExtra, descripcion) {
  if (!drive) return { folderId: parentFolderId, folderLink: '' };
  try {
    const palabraClave = extraerPalabraClave(descripcion);
    const nombreCarpetaExtra = `${idExtra}_${palabraClave}`;

    const q = `'${parentFolderId}' in parents and name = '${nombreCarpetaExtra}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const res = await drive.files.list({ q, fields: 'files(id, webViewLink)' });

    if (res.data.files && res.data.files.length > 0) {
      return { folderId: res.data.files[0].id, folderLink: res.data.files[0].webViewLink };
    }

    const folderMetadata = {
      name: nombreCarpetaExtra,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId]
    };
    const folder = await drive.files.create({ resource: folderMetadata, fields: 'id, webViewLink' });

    await drive.permissions.create({
      fileId: folder.data.id,
      requestBody: { role: 'reader', type: 'anyone' }
    });

    return { folderId: folder.data.id, folderLink: folder.data.webViewLink };
  } catch (error) {
    return { folderId: parentFolderId, folderLink: '' };
  }
}

function descargarArchivoWhatsApp(mediaId) {
  return new Promise((resolve, reject) => {
    const optionsUrl = {
      hostname: 'graph.facebook.com',
      port: 443,
      path: `/v18.0/${mediaId}`,
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

async function subirArchivoADrive(buffer, nombreArchivo, folderId, mimeType) {
  if (!drive) return 'N/A';
  try {
    const Readable = require('stream').Readable;
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    const fileMetadata = { name: nombreArchivo, parents: [folderId] };
    const media = { mimeType: mimeType || 'image/jpeg', body: stream };

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
    return 'Error Subida';
  }
}

async function obtenerSiguienteFilaDisponible(spreadsheetId, hojaYColumna) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: hojaYColumna
    });
    const filas = res.data.values || [];
    return filas.length + 1;
  } catch (e) {
    return 2;
  }
}

async function buscarTrabajadoresActivos(busqueda) {
  if (!sheets || !SPREADSHEET_PERSONAL_ID) return [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_PERSONAL_ID,
      range: 'PLANTILLA_PERSONAL!A:G'
    });
    const filas = res.data.values || [];
    const coincidencia = [];
    const termino = (busqueda || '').toLowerCase().trim();

    for (let i = 1; i < filas.length; i++) {
      const filaIndex = i + 1;
      const idTrabajador = filas[i][1] || '';
      const nombre = filas[i][2] || '';
      const obra = filas[i][3] || '';
      const estatus = filas[i][6] || '';

      if (nombre && !estatus.includes('BAJA')) {
        if (!termino || nombre.toLowerCase().includes(termino)) {
          coincidencia.push({ filaIndex, idTrabajador, nombre, obra });
        }
      }
    }
    return coincidencia;
  } catch (e) {
    return [];
  }
}

async function actualizarObraTrabajadorPorFila(filaIndex, nuevaObra) {
  if (!sheets || !SPREADSHEET_PERSONAL_ID) return false;
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_PERSONAL_ID,
      range: `PLANTILLA_PERSONAL!D${filaIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[nuevaObra]] }
    });
    return true;
  } catch (e) {
    return false;
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
  } catch (error) {
    console.error('❌ Error guardando en Sheets:', error.message);
  }
}

async function guardarTrabajoExtra(datos) {
  if (!sheets || !SPREADSHEET_EXTRAS_ID) return;
  try {
    const fechaHora = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    const filaDestino = await obtenerSiguienteFilaDisponible(SPREADSHEET_EXTRAS_ID, 'Extras!B:B');
    const numFila = filaDestino - 1;

    let formulaEvidencias = '';
    if (datos.carpetaExtraLink && datos.linksFotos && datos.linksFotos.length > 0) {
      formulaEvidencias = `=HIPERVINCULO("${datos.carpetaExtraLink}", "📁 Ver Carpeta Evidencias (${datos.linksFotos.length} archivos)")`;
    } else if (datos.linksFotos && datos.linksFotos.length > 0) {
      formulaEvidencias = `=HIPERVINCULO("${datos.linksFotos[0]}", "📸 Ver Evidencia Directa")`;
    } else {
      formulaEvidencias = 'Sin Evidencias';
    }

    const valores = [[
      numFila,
      datos.idExtra,
      fechaHora,
      datos.obra,
      datos.descripcion,
      datos.monto,
      formulaEvidencias,
      datos.usuario,
      'Pendiente 🟡'
    ]];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_EXTRAS_ID,
      range: `Extras!A${filaDestino}:I${filaDestino}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: valores }
    });
  } catch (error) {
    console.error('❌ Error guardando trabajo extra:', error.message);
  }
}

async function obtenerTrabajosExtrasPendientes() {
  if (!sheets || !SPREADSHEET_EXTRAS_ID) return [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_EXTRAS_ID,
      range: 'Extras!A:I'
    });
    const filas = res.data.values || [];
    const pendientes = [];

    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i];
      const idExtra = fila[1];
      const obra = fila[3];
      const descripcion = fila[4];
      const monto = fila[5];
      const estatus = fila[8] || '';

      if (idExtra && (!estatus.includes('Cobrado') && !estatus.includes('Cancelado'))) {
        pendientes.push({ filaIndex: i + 1, idExtra, obra, descripcion, monto, estatus });
      }
      if (pendientes.length >= 10) break;
    }
    return pendientes;
  } catch (error) {
    return [];
  }
}

async function actualizarEstatusTrabajoExtra(idExtra, nuevoEstatus) {
  if (!sheets || !SPREADSHEET_EXTRAS_ID) return false;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_EXTRAS_ID,
      range: 'Extras!B:B'
    });
    const filas = res.data.values || [];
    for (let i = 0; i < filas.length; i++) {
      if (filas[i][0] === idExtra) {
        const filaIndex = i + 1;
        await sheets.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_EXTRAS_ID,
          range: `Extras!I${filaIndex}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[nuevoEstatus]] }
        });
        return true;
      }
    }
    return false;
  } catch (error) {
    return false;
  }
}

async function guardarTrabajador(datos) {
  if (!sheets || !SPREADSHEET_PERSONAL_ID) return;
  try {
    const fechaHora = new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });
    const filaDestino = await obtenerSiguienteFilaDisponible(SPREADSHEET_PERSONAL_ID, 'PLANTILLA_PERSONAL!C:C');
    const numFila = filaDestino - 1;

    const valores = [[
      numFila,
      datos.idTrabajador,
      datos.nombre,
      datos.obra,
      datos.tipo,
      datos.sueldo,
      'ACTIVO 🟢',
      fechaHora,
      datos.usuario
    ]];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_PERSONAL_ID,
      range: `PLANTILLA_PERSONAL!A${filaDestino}:I${filaDestino}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: valores }
    });
  } catch (error) {
    console.error('❌ Error guardando trabajador:', error.message);
  }
}

async function darDeBajaTrabajadorPorFila(filaIndex) {
  if (!sheets || !SPREADSHEET_PERSONAL_ID) return null;
  try {
    const fechaBaja = new Date().toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_PERSONAL_ID,
      range: `PLANTILLA_PERSONAL!C${filaIndex}:D${filaIndex}`
    });

    const nombre = res.data.values?.[0]?.[0] || 'Trabajador';
    const obra = res.data.values?.[0]?.[1] || 'N/A';

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_PERSONAL_ID,
      range: `PLANTILLA_PERSONAL!G${filaIndex}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[`BAJA 🔴 (${fechaBaja})`]] }
    });

    return { nombre, obra, fechaBaja };
  } catch (error) {
    return null;
  }
}

async function guardarVisitaFamiliar(datos) {
  if (!sheets || !SPREADSHEET_PERSONAL_ID) return;
  try {
    const fechaSalida = new Date(datos.fechaPago || Date.now());
    const fechaSugerida = new Date(fechaSalida.getTime() + (45 * 24 * 60 * 60 * 1000));

    const fechaSalidaStr = fechaSalida.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });
    const fechaSugeridaStr = fechaSugerida.toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });

    const filaDestino = await obtenerSiguienteFilaDisponible(SPREADSHEET_PERSONAL_ID, 'VISITAS_FAMILIARES!C:C');
    const numFila = filaDestino - 1;

    const valores = [[
      numFila,
      fechaSalidaStr,
      datos.nombre,
      datos.obra,
      datos.monto,
      fechaSugeridaStr,
      datos.usuario
    ]];

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_PERSONAL_ID,
      range: `VISITAS_FAMILIARES!A${filaDestino}:G${filaDestino}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: valores }
    });
  } catch (error) {
    console.error('❌ Error guardando visita familiar:', error.message);
  }
}

async function guardarPrecioHistorico(datos) {
  if (!sheets || !SPREADSHEET_PRECIOS_ID) return;
  try {
    const fechaHora = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    const filaDestino = await obtenerSiguienteFilaDisponible(SPREADSHEET_PRECIOS_ID, 'PRECIOS!D:D');
    const numFila = filaDestino - 1;

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

    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_PRECIOS_ID,
      range: `PRECIOS!A${filaDestino}:H${filaDestino}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: valores }
    });
  } catch (error) {
    console.error('❌ Error guardando precio:', error.message);
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

    for (let i = 1; i < filas.length; i++) {
      const fila = filas[i];
      const fecha = fila[1] || '';
      const obra = fila[2] || '';
      const mat = (fila[3] || '').toLowerCase();
      const unidad = fila[4] || '';
      const precio = limpiarMonto(fila[5]);
      const proveedor = fila[6] || 'No especificado';

      if (mat.includes(materialBuscado.toLowerCase())) {
        resultados.push({ fecha, obra, material: fila[3], unidad, precio, proveedor });
      }
    }

    resultados.sort((a, b) => a.precio - b.precio);
    return resultados;
  } catch (error) {
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
      const categoria = fila[4] || '';
      const monto = limpiarMonto(fila[5]);
      const estatus = fila[8] || '';

      if (estatus.includes('CANCELADO') || monto === 0) continue;
      if (categoria.includes('Apertura') || categoria.includes('Control')) continue;

      if (metodo.includes('Dotación Caja Chica') || categoria.includes('Fondo Caja')) {
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
      const categoria = (fila[4] || '').toUpperCase();
      const monto = limpiarMonto(fila[5]);
      const estatus = fila[8] || '';

      if (estatus.includes('CANCELADO') || monto === 0) continue;
      if (obraBuscada && obra.toLowerCase() !== obraBuscada.toLowerCase()) continue;

      CONTRATISTAS_VALIDOS.forEach(c => {
        if (!resultado[c]) resultado[c] = { totalContrato: 0, pagado: 0 };

        if (concepto.includes(`contrato ${c}`) || concepto.includes(`total autorizado ${c}`) || concepto.includes(`contrato cerrado ${c}`)) {
          resultado[c].totalContrato += monto;
        } else if (concepto.includes(c) || categoria.includes(c.toUpperCase())) {
          if (!concepto.includes('contrato') && !concepto.includes('total autorizado')) {
            resultado[c].pagado += monto;
          }
        }
      });
    }
    return resultado;
  } catch (error) {
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
      const categoria = fila[4] || '';
      const concepto = (fila[6] || '').toLowerCase();
      const monto = limpiarMonto(fila[5]);
      const estatus = fila[8] || '';

      if (estatus.includes('CANCELADO') || monto === 0) continue;

      if (resultado[obra]) {
        if (concepto.includes('presupuesto total autorizado') || metodo.includes('Control Presupuestal')) {
          resultado[obra].presupuestoTotal += monto;
        } else if (metodo.includes('Ingreso Presupuesto') || concepto.includes('ingreso presupuesto')) {
          resultado[obra].liberado += monto;
        }
      }
    }
    return resultado;
  } catch (error) {
    return {};
  }
}

async function procesarBusquedaCambioObra(from, busqueda) {
  const coincidencias = await buscarTrabajadoresActivos(busqueda);

  if (coincidencias.length === 0) {
    await enviarTexto(from, `⚠️ No se encontró a ningún trabajador activo registrado que coincida con "${busqueda || 'la consulta'}".`);
  } else if (coincidencias.length === 1) {
    const t = coincidencias[0];
    sesiones[from] = { tipoAccion: 'CAMBIO_OBRA_SELECCION', filaIndex: t.filaIndex, nombre: t.nombre, obraActual: t.obra };
    await enviarBotones(from, `👤 *Trabajador:* ${t.nombre}\n🏗️ *Obra Actual:* ${t.obra}\n\n¿A qué nueva Sucursal deseas moverlo?`, [
      { id: 'CAMBIOBRA_Pelicano', title: 'Pelicano' },
      { id: 'CAMBIOBRA_Caldera', title: 'Caldera' },
      { id: 'CAMBIOBRA_Nativitas', title: 'Nativitas' }
    ]);
    await enviarBotones(from, '👇 *Otras Opciones:*', [
      { id: 'CAMBIOBRA_Salud', title: 'Salud' },
      { id: 'CAMBIOBRA_Otro', title: 'Otro' }
    ]);
  } else {
    const opciones = coincidencias.slice(0, 10).map(c => ({
      id: `EJECUTARCASO_${c.filaIndex}`,
      title: c.nombre.substring(0, 24),
      description: `Actual: ${c.obra} (Fila ${c.filaIndex})`
    }));
    await enviarLista(from, `🔍 *Se encontraron ${coincidencias.length} coincidencias:*`, 'Seleccionar', 'Trabajadores Activos', opciones);
  }
}

async function desplegarMenuPrincipal(from) {
  const tieneAccesoDireccion = esDireccion(from);

  if (tieneAccesoDireccion) {
    const opciones = [
      { id: 'MENU_CARGA_OBRA', title: '🚀 Configurar / Cargar Obra', description: 'Presupuesto, Cuentas Bancarias y Contratos' },
      { id: 'MENU_REPORTES', title: '📊 Saldos y PDF de Corte', description: 'Caja chica, bancos y estado de cuenta oficial' },
      { id: 'MENU_CORREGIR', title: '✏️ Corregir Últimos Gastos', description: 'Modificar monto o anular gasto con un toque' },
      { id: 'MENU_CONTRATISTAS', title: '🤝 Contratistas / Destajos', description: 'Asignación de contratos y consulta de saldos' },
      { id: 'MENU_PRESU', title: '🏦 Avance de Presupuestos', description: 'Presupuesto autorizado y cobro a clientes' },
      { id: 'MENU_PERSONAL', title: '👷‍♂️ Personal Propio', description: 'Altas, bajas, cambio de obra y Visitas' },
      { id: 'MENU_EXTRAS', title: '🔨 Trabajos Extras', description: 'Registro de extras y evidencias a Drive' },
      { id: 'MENU_PRECIOS', title: '🏷️ Precios Materiales', description: 'Registrar precio y comparar histórico' }
    ];
    await enviarLista(from, '🏗️ *PANEL DE CONTROL CENTRAL (DIRECCIÓN)*\n\nSelecciona la gestión que deseas realizar:', 'Abrir Menú', 'Dirección de Obra', opciones);
  } else {
    const opciones = [
      { id: 'MENU_PERSONAL', title: '👷‍♂️ Personal Propio', description: 'Altas, bajas, cambio de obra y Visitas' },
      { id: 'MENU_EXTRAS', title: '🔨 Trabajos Extras', description: 'Registro de extras y evidencias con foto' },
      { id: 'MENU_PRECIOS', title: '🏷️ Precios Materiales', description: 'Registrar precio y comparar cotizaciones' }
    ];
    await enviarLista(from, '🏗️ *MENÚ OPERATIVO DE OBRA*\n\nPara registrar un gasto rápido, escribe el concepto y monto (ej: `cemento 450`).\n\nO selecciona una gestión:', 'Abrir Menú', 'Operación de Campo', opciones);
  }
}

async function desplegarGuiaComandos(from) {
  const tieneAccesoDireccion = esDireccion(from);

  if (tieneAccesoDireccion) {
    const guia = `📝 *COMANDOS Y ACCESOS (DIRECCIÓN):*\n\n` +
      `• *Menú Completo:* \`menu\`, \`hola\`, \`inicio\` o \`ayuda\`\n` +
      `• *Cargar/Configurar Obra:* \`cargar obra\` o \`configurar\`\n` +
      `• *Generar PDF Corte:* \`corte\` o \`saldo\`\n` +
      `• *Corregir Gasto:* \`corregir\` o \`editar\` (Táctil)\n` +
      `• *Gasto Rápido:* \`[concepto] [monto]\` (ej: cemento 450)\n` +
      `• *Alta Trabajador:* \`alta [nombre]\`\n` +
      `• *Baja Trabajador:* \`baja\` o \`baja [nombre]\`\n` +
      `• *Cambiar de Obra:* \`cambiar obra [nombre]\`\n` +
      `• *Visita Familiar:* \`visita [nombre] [monto]\`\n` +
      `• *Trabajos Extras:* \`extra\`\n` +
      `• *Dotar Caja Chica:* \`caja [monto]\`\n` +
      `• *Ver Contratistas:* \`contratistas\`\n` +
      `• *Precios Materiales:* \`precio [mat] [monto]\`\n` +
      `• *Comparar Precios:* \`comparar [mat]\`\n` +
      `• *Cancelar Último:* \`cancelar\``;
    await enviarTexto(from, guia);
  } else {
    const guia = `📝 *GUÍA DE REGISTRO RÁPIDO DE CAMPO:*\n\n` +
      `• *Registrar Gasto:* \`[concepto] [monto]\` (ej: \`cemento 450\`)\n` +
      `• *Alta Trabajador:* \`alta [nombre]\` (ej: \`alta Pedro Gomez\`)\n` +
      `• *Baja Trabajador:* \`baja\` (Buscador táctil)\n` +
      `• *Cambiar de Obra:* \`cambiar obra [nombre]\`\n` +
      `• *Visita Familiar:* \`visita [nombre] [monto]\`\n` +
      `• *Trabajo Extra:* \`extra\` (Sube fotos/videos)\n` +
      `• *Registrar Precio:* \`precio [mat] [monto]\`\n` +
      `• *Comparar Precios:* \`comparar [mat]\`\n` +
      `• *Cancelar Último:* \`cancelar\``;
    await enviarTexto(from, guia);
  }
}

async function procesarBusquedaBaja(from, busqueda) {
  const coincidencias = await buscarTrabajadoresActivos(busqueda);

  if (coincidencias.length === 0) {
    await enviarTexto(from, `⚠️ No se encontró a ningún trabajador activo registrado que coincida con "${busqueda || 'la consulta'}".`);
  } else if (coincidencias.length === 1) {
    const t = coincidencias[0];
    const baja = await darDeBajaTrabajadorPorFila(t.filaIndex);
    if (baja) {
      await enviarTexto(from, `🔴 *Trabajador Dado de Baja Correctamente*\n\n👤 *Nombre:* ${baja.nombre}\n🏗️ *Obra:* ${baja.obra}\n📅 *Fecha de Baja:* ${baja.fechaBaja}\n📌 *Estatus:* BAJA 🔴`);
    } else {
      await enviarTexto(from, '⚠️ Error procesando la baja.');
    }
  } else {
    const opciones = coincidencias.slice(0, 10).map(c => ({
      id: `EJECUTARBAJA_${c.filaIndex}`,
      title: c.nombre.substring(0, 24),
      description: `${c.obra} (Fila ${c.filaIndex})`
    }));

    await enviarLista(from, `🔍 *Se encontraron ${coincidencias.length} coincidencias:*`, 'Seleccionar', 'Trabajadores Activos', opciones);
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
    const tieneAccesoDireccion = esDireccion(from);
    const sesionActual = sesiones[from];

    if (msg.type === 'image' || msg.type === 'video') {
      if (sesionActual && sesionActual.esperandoFotosExtra) {
        const mediaId = msg.type === 'image' ? msg.image.id : msg.video.id;
        const mimeType = msg.type === 'image' ? 'image/jpeg' : 'video/mp4';
        const ext = msg.type === 'image' ? 'jpg' : 'mp4';
        const tipoEtiqueta = msg.type === 'image' ? 'Foto' : 'Video';

        if (!sesionActual.parentFolderId) {
          sesionActual.parentFolderId = await obtenerOcrearSubcarpetaObra(sesionActual.obra);
        }

        if (!sesionActual.subfolderId) {
          const extraFolder = await obtenerOcrearCarpetaTrabajoExtra(sesionActual.parentFolderId, sesionActual.idExtra, sesionActual.descripcion || 'EXTRA');
          sesionActual.subfolderId = extraFolder.folderId;
          sesionActual.carpetaExtraLink = extraFolder.folderLink;
        }

        const numArchivo = sesionActual.linksFotos.length + 1;
        const palabraClave = extraerPalabraClave(sesionActual.descripcion);
        const timestampUnico = Date.now().toString().slice(-4);
        const nombreArchivo = `${sesionActual.idExtra}_${palabraClave}_${tipoEtiqueta}${numArchivo}_${timestampUnico}.${ext}`;

        try {
          const buffer = await descargarArchivoWhatsApp(mediaId);
          const driveLink = await subirArchivoADrive(buffer, nombreArchivo, sesionActual.subfolderId, mimeType);
          sesionActual.linksFotos.push(driveLink);

          await enviarBotones(from, `📸 *${tipoEtiqueta} ${numArchivo} ("${palabraClave}") guardado en Drive.*\n\n¿Deseas agregar otra evidencia o finalizar?`, [
            { id: 'EXTRAFOTO_OTRA', title: '📸 Agregar Evidencia' },
            { id: 'EXTRAFOTO_FIN', title: '✅ Finalizar' }
          ]);
        } catch (e) {
          await enviarTexto(from, '⚠️ Error guardando el archivo. Intenta enviarlo nuevamente.');
        }
        res.sendStatus(200);
        return;
      }
    }

    if (msg.type === 'text') {
      const textBody = msg.text.body.trim();

      if (/^(menu|hola|inicio|ayuda)$/i.test(textBody)) {
        await desplegarMenuPrincipal(from);
        res.sendStatus(200);
        return;
      }

      if (/^(comandos)$/i.test(textBody)) {
        await desplegarGuiaComandos(from);
        res.sendStatus(200);
        return;
      }

      if (/^(cargar obra|configurar obra|configurar|carga inicial)$/i.test(textBody)) {
        if (!tieneAccesoDireccion) {
          await enviarTexto(from, '⚙️ *Módulo en consolidación administrativa.*\nEsta función se encuentra deshabilitada para este perfil.');
          res.sendStatus(200);
          return;
        }

        sesiones[from] = { tipoAccion: 'CARGA_OBRA', usuario: nombreUsuario };
        await enviarBotones(from, '🚀 *ASISTENTE DE CONFIGURACIÓN DE OBRA*\n\n🏗️ *¿Qué sucursal deseas configurar/cargar?*r', [
          { id: 'CARGAOBRA_Pelicano', title: 'Pelicano' },
          { id: 'CARGAOBRA_Caldera', title: 'Caldera' },
          { id: 'CARGAOBRA_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Opciones:*', [
          { id: 'CARGAOBRA_Salud', title: 'Salud' },
          { id: 'CARGAOBRA_Otro', title: 'Otro' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (/^(corregir|editar|modificar|corregir gasto)$/i.test(textBody)) {
        if (!tieneAccesoDireccion) {
          await enviarTexto(from, '⚙️ *Módulo en consolidación administrativa.* Para cancelar el último gasto inmediato utiliza `cancelar`.');
          res.sendStatus(200);
          return;
        }

        const ultimos = await obtenerUltimosGastos(null);
        if (ultimos.length === 0) {
          await enviarTexto(from, '⚠️ No hay gastos recientes para corregir.');
        } else {
          const opciones = ultimos.map(u => ({
            id: `EDITARGAS_${u.filaIndex}`,
            title: `${formatoMoneda(u.monto)} - ${u.concepto.substring(0, 14)}`,
            description: `${u.obra} (${u.id})`
          }));
          await enviarLista(from, '✏️ *CORRECCIÓN TÁCTIL DE GASTOS Y MOVIMIENTOS*\n\nToca el registro que deseas modificar o anular:', 'Ver Registros', 'Últimos Movimientos', opciones);
        }
        res.sendStatus(200);
        return;
      }

      if (/^(cancelar|borrar ultimo)$/i.test(textBody)) {
        const cancelado = await cancelarUltimoRegistro();
        if (cancelado) {
          await enviarTexto(from, `❌ *Último registro cancelado correctamente:*\n\n🆔 *ID:* ${cancelado.idMovimiento}\n📝 *Concepto:* ${cancelado.concepto}\n💵 *Monto ajustado a $0.00 en Sheets.*`);
        } else {
          await enviarTexto(from, '⚠️ No se encontró ningún registro previo para cancelar.');
        }
        res.sendStatus(200);
        return;
      }

      if (/^(saldo|corte|reporte|resumen)$/i.test(textBody)) {
        if (!tieneAccesoDireccion) {
          await enviarTexto(from, '⚙️ *Módulo en consolidación administrativa.*\nEsta consulta de balance financiero se encuentra deshabilitada para este perfil.');
          res.sendStatus(200);
          return;
        }

        await enviarBotones(from, '📊 *¿De qué Sucursal deseas generar el Reporte PDF?*', [
          { id: 'REP_Pelicano', title: 'Pelicano' },
          { id: 'REP_Caldera', title: 'Caldera' },
          { id: 'REP_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Opciones:*', [
          { id: 'REP_Salud', title: 'Salud' },
          { id: 'REP_GLOBAL', title: 'Caja Chica' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (/^(contratistas|destajos|contratos)$/i.test(textBody)) {
        if (!tieneAccesoDireccion) {
          await enviarTexto(from, '⚙️ *Módulo en consolidación administrativa.* Consulta con administración central.');
          res.sendStatus(200);
          return;
        }

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

      if (/^(avance|cobrado|avance presupuestos)$/i.test(textBody)) {
        if (!tieneAccesoDireccion) {
          await enviarTexto(from, '⚙️ *Módulo en consolidación administrativa.* Consulta con administración central.');
          res.sendStatus(200);
          return;
        }

        const rep = await calcularReportePresupuestos();
        let msgTexto = '🏦 *Avance de Presupuestos Autorizados (Farmacias):*\n\n';
        Object.keys(rep).forEach(o => {
          const t = rep[o];
          const porCobrar = t.presupuestoTotal - t.liberado;
          msgTexto += `🏗️ *${o}*\n` +
            `  • Presupuesto Autorizado: ${formatoMoneda(t.presupuestoTotal)}\n` +
            `  • Liberado a la Fecha: ${formatoMoneda(t.liberado)}\n` +
            `  • Pendiente por Liberar: ${formatoMoneda(porCobrar)}\n\n`;
        });
        await enviarTexto(from, msgTexto);
        res.sendStatus(200);
        return;
      }

      if (/^(facturar|facturas|pendientes|ver pendientes)$/i.test(textBody)) {
        const pendientes = await obtenerMovimientosPendientes();
        if (pendientes.length === 0) {
          await enviarTexto(from, '🎉 ¡Excelente! No hay gastos pendientes de factura.');
        } else {
          const opciones = pendientes.map(p => ({
            id: `RESOLVER_${p.id}`,
            title: p.concepto.substring(0, 24),
            description: `${p.obra} | ${formatoMoneda(p.monto)} (${p.id})`
          }));
          await enviarLista(from, '📋 *Gastos Pendientes de Factura:*', 'Ver Pendientes', 'Selecciona para resolver:', opciones);
        }
        res.sendStatus(200);
        return;
      }

      if (/^(extras pendientes|ver extras|actualizar extras)$/i.test(textBody)) {
        const extras = await obtenerTrabajosExtrasPendientes();
        if (extras.length === 0) {
          await enviarTexto(from, '🎉 ¡Excelente! No hay trabajos extras pendientes de cobro/envío.');
        } else {
          const opciones = extras.map(e => ({
            id: `GESTIONEXT_${e.idExtra}`,
            title: e.descripcion.substring(0, 24),
            description: `${e.obra} | ${formatoMoneda(e.monto)} (${e.idExtra})`
          }));
          await enviarLista(from, '🔨 *Trabajos Extras Pendientes:*', 'Ver Extras', 'Selecciona para actualizar:', opciones);
        }
        res.sendStatus(200);
        return;
      }

      const matchAltaTrabajador = textBody.match(/^alta\s+(.+)/i);
      if (matchAltaTrabajador) {
        const nombreTrabajador = matchAltaTrabajador[1].trim();

        sesiones[from] = {
          tipoAccion: 'ALTA_TRABAJADOR',
          idTrabajador: 'EMP-' + Date.now().toString().slice(-6),
          nombre: nombreTrabajador.toUpperCase(),
          usuario: nombreUsuario
        };

        await enviarBotones(from, `👷‍♂️ *Alta de Trabajador:* ${nombreTrabajador.toUpperCase()}\n\n🏗️ *¿A qué obra pertenece?*`, [
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

      const matchBajaGenerico = textBody.match(/^baja(\s+(.+))?/i);
      if (matchBajaGenerico) {
        const busqueda = matchBajaGenerico[2] ? matchBajaGenerico[2].trim() : '';
        await procesarBusquedaBaja(from, busqueda);
        res.sendStatus(200);
        return;
      }

      const matchCambioObra = textBody.match(/^(cambiar obra|mover obra|cambiar)\s+(.+)/i);
      if (matchCambioObra) {
        const busqueda = matchCambioObra[2].trim();
        await procesarBusquedaCambioObra(from, busqueda);
        res.sendStatus(200);
        return;
      }

      const matchVisita = textBody.match(/^visita\s+(.+)\s+(\d+(\.\d+)?)/i);
      if (matchVisita) {
        const nombreTrabajador = matchVisita[1].trim();
        const montoApoyo = limpiarMonto(matchVisita[2]);

        sesiones[from] = {
          tipoAccion: 'VISITA_FAMILIAR',
          nombre: nombreTrabajador.toUpperCase(),
          monto: montoApoyo,
          esperandoFechaVisita: true,
          usuario: nombreUsuario
        };

        await enviarBotones(from, `🚌 *Visita Familiar:* ${nombreTrabajador.toUpperCase()} (${formatoMoneda(montoApoyo)})\n\n📅 *¿Cuándo se realizó este pago?*`, [
          { id: 'VISFECHA_Hoy', title: 'Hoy (Fecha actual)' },
          { id: 'VISFECHA_Ayer', title: 'Ayer' },
          { id: 'VISFECHA_Otra', title: '✏️ Otra fecha' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (/^(extra|extras|trabajo extra|trabajos extras)$/i.test(textBody)) {
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

      const matchRegistroPrecio = textBody.match(/^precio\s+(.+)\s+(\d+(\.\d+)?)/i);
      if (matchRegistroPrecio) {
        const material = matchRegistroPrecio[1].trim();
        const precio = limpiarMonto(matchRegistroPrecio[2]);

        sesiones[from] = {
          tipoAccion: 'REGISTRO_PRECIO_HISTORICO',
          material,
          precio,
          usuario: nombreUsuario
        };

        await enviarBotones(from, `🏷️ *Material:* ${material.toUpperCase()}\n💵 *Precio:* ${formatoMoneda(precio)}\n\n📐 *Selecciona la Unidad de Medida:*`, [
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

      const matchBusquedaPrecio = textBody.match(/^(comparar|buscar|precios)\s+(.+)/i);
      if (matchBusquedaPrecio) {
        const materialBuscado = matchBusquedaPrecio[2].trim();
        const resultados = await buscarHistoricoPrecios(materialBuscado);

        if (resultados.length === 0) {
          await enviarTexto(from, `⚠️ No se encontraron precios registrados para "${materialBuscado}".`);
        } else {
          let msgTxt = `📊 *HISTÓRICO DE PRECIOS: "${materialBuscado.toUpperCase()}"*\n\n`;
          resultados.forEach((r, idx) => {
            const emoji = idx === 0 ? '🟢' : idx === 1 ? '🟡' : '🔴';
            msgTxt += `${emoji} *${formatoMoneda(r.precio)}* / ${r.unidad}\n` +
              `    📍 ${r.obra}\n` +
              `    🏢 Proveedor: ${r.proveedor}\n` +
              `    📝 Material: ${r.material}\n` +
              `    📅 Fecha: ${r.fecha.split(',')[0]}\n\n`;
          });
          await enviarTexto(from, msgTxt);
        }
        delete sesiones[from];
        res.sendStatus(200);
        return;
      }

      const matchCaja = textBody.match(/^(caja|efectivo|dotacion|fondo)\s+(\d+(\.\d+)?)/i);
      if (matchCaja) {
        const montoCaja = limpiarMonto(matchCaja[2]);

        await guardarEnSheets({
          idMovimiento: 'DOT-' + Date.now().toString().slice(-6),
          obra: 'Efectivo General',
          metodo: 'Dotación Caja Chica',
          subMetodo: '',
          categoria: 'Fondo Caja',
          monto: montoCaja,
          concepto: 'Ingreso a Caja Chica Central (Efectivo)',
          usuario: nombreUsuario,
          estatusFactura: 'No Requiere 🔴',
          linkFactura: 'N/A'
        });

        const reporteCaja = await calcularReporteSaldos(null);
        await enviarTexto(from, `💵 *Efectivo Ingresado a Caja Chica:* ${formatoMoneda(montoCaja)}\n👤 *Registró:* ${nombreUsuario}\n\n💰 *Efectivo Disponible en Mano:* ${formatoMoneda(reporteCaja.cajaDisponible)} MXN`);
        res.sendStatus(200);
        return;
      }

      const matchContrato = textBody.match(/^contrato\s+(.+)\s+(\d+(\.\d+)?)/i);
      if (matchContrato) {
        const nombreContratista = matchContrato[1].trim();
        const montoContrato = limpiarMonto(matchContrato[2]);

        sesiones[from] = {
          tipoAccion: 'CONTRATO_CONTRATISTA',
          idMovimiento: 'CTR-' + Date.now().toString().slice(-6),
          monto: montoContrato,
          contratista: nombreContratista.toUpperCase(),
          concepto: `Contrato ${nombreContratista.toUpperCase()} Total Autorizado`,
          usuario: nombreUsuario
        };

        await enviarBotones(from, `👷‍♂️ *Contrato ${nombreContratista.toUpperCase()}:* ${formatoMoneda(montoContrato)}\n\n🏗️ *¿A qué sucursal pertenece este contrato?*`, [
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

      if (sesionActual && sesionActual.esperandoFechaVisitaManual) {
        sesionActual.fechaPago = textBody;
        delete sesionActual.esperandoFechaVisitaManual;
        sesionActual.esperandoObraVisita = true;

        await enviarBotones(from, `📅 *Fecha Registrada:* ${sesionActual.fechaPago}\n\n🏗️ *¿A qué Obra/Sucursal se aplica este viático?*`, [
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

      if (sesionActual && sesionActual.esperandoNuevoMontoGasto) {
        const nuevoMonto = limpiarMonto(textBody);
        const ok = await actualizarMontoGasto(sesionActual.filaIndexEditar, nuevoMonto);
        delete sesionActual.esperandoNuevoMontoGasto;
        delete sesionActual.filaIndexEditar;

        if (ok) {
          await enviarTexto(from, `✅ *Monto actualizado con éxito a:* ${formatoMoneda(nuevoMonto)} MXN`);
        } else {
          await enviarTexto(from, '⚠️ No se pudo actualizar el monto.');
        }
        delete sesiones[from];
        res.sendStatus(200);
        return;
      }

      if (sesionActual && sesionActual.esperandoNombreTrabajadorCambio) {
        delete sesionActual.esperandoNombreTrabajadorCambio;
        await procesarBusquedaCambioObra(from, textBody.trim());
        delete sesiones[from];
        res.sendStatus(200);
        return;
      }

      // ASISTENTE DE CARGA DE OBRA (CON GASTO HISTÓRICO INTELIGENTE)
      if (sesionActual && sesionActual.tipoAccion === 'CARGA_OBRA') {
        const montoNum = limpiarMonto(textBody);

        if (sesionActual.esperandoPresupuestoTotal) {
          sesionActual.presupuestoTotal = montoNum;
          delete sesionActual.esperandoPresupuestoTotal;

          await guardarEnSheets({
            idMovimiento: 'INI-' + Date.now().toString().slice(-6),
            obra: sesionActual.obra,
            metodo: 'Control Presupuestal',
            subMetodo: '',
            categoria: 'Presupuesto Contractual',
            monto: sesionActual.presupuestoTotal,
            concepto: 'Presupuesto Total Autorizado',
            usuario: nombreUsuario,
            estatusFactura: 'No Requiere 🔴',
            linkFactura: 'N/A'
          });

          if (sesionActual.modoCarga === 'AVANZADA') {
            sesionActual.esperandoCobradoCliente = true;
            await enviarTexto(from, `💰 *Presupuesto registrado:* ${formatoMoneda(montoNum)}\n\n¿Cuánto dinero ha *liberado/pagado el cliente* a la fecha? (Escribe el monto):`);
          } else {
            sesionActual.esperandoAnticipo = true;
            await enviarTexto(from, `💰 *Presupuesto registrado:* ${formatoMoneda(montoNum)}\n\n¿Cuánto dinero entró de *anticipo inicial*? (Escribe el monto):`);
          }
          res.sendStatus(200);
          return;
        }

        if (sesionActual.esperandoAnticipo || sesionActual.esperandoCobradoCliente) {
          sesionActual.liberadoCliente = montoNum;
          delete sesionActual.esperandoAnticipo;
          delete sesionActual.esperandoCobradoCliente;

          if (montoNum > 0) {
            await guardarEnSheets({
              idMovimiento: 'LIB-' + Date.now().toString().slice(-6),
              obra: sesionActual.obra,
              metodo: 'Ingreso Presupuesto',
              subMetodo: '',
              categoria: 'Ingreso Presupuesto',
              monto: montoNum,
              concepto: 'Ingreso Presupuesto Inicial Recibido',
              usuario: nombreUsuario,
              estatusFactura: 'No Requiere 🔴',
              linkFactura: 'N/A'
            });
          }

          if (sesionActual.modoCarga === 'AVANZADA') {
            sesionActual.esperandoGastadoAcumulado = true;
            await enviarTexto(from, `💵 *Ingreso registrado:* ${formatoMoneda(montoNum)}\n\n¿Cuánto se lleva *gastado en total acumulado* en esta obra a la fecha? (Escribe el monto o 0):`);
          } else {
            sesionActual.esperandoSaldoBanamexBeto = true;
            await enviarTexto(from, `🏦 *Desglose de Cuentas:*\n\n¿Cuánto dinero hay en *Banamex Beto* para esta obra? (Escribe el monto o 0):`);
          }
          res.sendStatus(200);
          return;
        }

        if (sesionActual.esperandoGastadoAcumulado) {
          const gastosPreviosEnHoja = await calcularGastosPreviosObra(sesionActual.obra);
          const historicoNetoReal = montoNum - gastosPreviosEnHoja;
          sesionActual.gastadoAcumulado = historicoNetoReal > 0 ? historicoNetoReal : 0;
          delete sesionActual.esperandoGastadoAcumulado;

          if (sesionActual.gastadoAcumulado > 0) {
            await guardarEnSheets({
              idMovimiento: 'GASINI-' + Date.now().toString().slice(-6),
              obra: sesionActual.obra,
              metodo: 'Transferencia',
              subMetodo: '',
              categoria: 'GASTO HISTORICO INICIAL',
              monto: sesionActual.gastadoAcumulado,
              concepto: 'Gasto Consolidado Histórico Inicial de Obra',
              usuario: nombreUsuario,
              estatusFactura: 'No Requiere 🔴',
              linkFactura: 'N/A'
            });
          }

          sesionActual.esperandoSaldoBanamexBeto = true;
          await enviarTexto(from, `🏦 *Desglose de Cuentas:*\n\n¿Cuánto dinero hay en *Banamex Beto* para esta obra? (Escribe el monto o 0):`);
          res.sendStatus(200);
          return;
        }

        if (sesionActual.esperandoSaldoBanamexBeto) {
          sesionActual.banamexBeto = montoNum;
          delete sesionActual.esperandoSaldoBanamexBeto;
          
          if (montoNum > 0) {
            await guardarEnSheets({
              idMovimiento: 'AP-BNX-' + Date.now().toString().slice(-6),
              obra: sesionActual.obra,
              metodo: 'Apertura Banamex Beto',
              subMetodo: 'Banamex Beto',
              categoria: 'Apertura Cuenta',
              monto: montoNum,
              concepto: 'Fondo Inicial en Banamex Beto',
              usuario: nombreUsuario,
              estatusFactura: 'No Requiere 🔴',
              linkFactura: 'N/A'
            });
          }

          sesionActual.esperandoSaldoBBVARigo = true;
          await enviarTexto(from, `¿Cuánto dinero hay en *BBVA Rigo*? (Escribe el monto o 0):`);
          res.sendStatus(200);
          return;
        }

        if (sesionActual.esperandoSaldoBBVARigo) {
          sesionActual.bbvaRigo = montoNum;
          delete sesionActual.esperandoSaldoBBVARigo;

          if (montoNum > 0) {
            await guardarEnSheets({
              idMovimiento: 'AP-BBVAR-' + Date.now().toString().slice(-6),
              obra: sesionActual.obra,
              metodo: 'Apertura BBVA Rigo',
              subMetodo: 'BBVA Rigo',
              categoria: 'Apertura Cuenta',
              monto: montoNum,
              concepto: 'Fondo Inicial en BBVA Rigo',
              usuario: nombreUsuario,
              estatusFactura: 'No Requiere 🔴',
              linkFactura: 'N/A'
            });
          }

          sesionActual.esperandoSaldoBBVABeto = true;
          await enviarTexto(from, `¿Cuánto dinero hay en *BBVA Beto*? (Escribe el monto o 0):`);
          res.sendStatus(200);
          return;
        }

        if (sesionActual.esperandoSaldoBBVABeto) {
          sesionActual.bbvaBeto = montoNum;
          delete sesionActual.esperandoSaldoBBVABeto;

          if (montoNum > 0) {
            await guardarEnSheets({
              idMovimiento: 'AP-BBVAB-' + Date.now().toString().slice(-6),
              obra: sesionActual.obra,
              metodo: 'Apertura BBVA Beto',
              subMetodo: 'BBVA Beto',
              categoria: 'Apertura Cuenta',
              monto: montoNum,
              concepto: 'Fondo Inicial en BBVA Beto',
              usuario: nombreUsuario,
              estatusFactura: 'No Requiere 🔴',
              linkFactura: 'N/A'
            });
          }

          sesionActual.cuentasPendientes = ['NU', 'DIDI', 'MercadoPago'];
          await enviarBotones(from, `💳 *Tarjetas / Cuentas Adicionales (NU, DiDi, MercadoPago):*\n\n¿Tiene saldo alguna de estas tarjetas para esta obra?`, [
            { id: 'ADDCRED_NU', title: 'Tarjeta NU' },
            { id: 'ADDCRED_DIDI', title: 'Tarjeta DiDi' },
            { id: 'ADDCRED_MP', title: 'MercadoPago' }
          ]);
          await enviarBotones(from, '👇 *O continuar:*', [
            { id: 'ADDCRED_FIN', title: '➡️ Sin más cuentas' }
          ]);
          res.sendStatus(200);
          return;
        }

        if (sesionActual.esperandoMontoCuentaAdicional) {
          const cuentaActual = sesionActual.cuentaActualTemp;
          const montoAdicional = montoNum;
          delete sesionActual.esperandoMontoCuentaAdicional;

          if (montoAdicional > 0) {
            const metMap = { 'NU': 'Apertura NU', 'DIDI': 'Apertura DIDI', 'MercadoPago': 'Apertura MercadoPago' };
            await guardarEnSheets({
              idMovimiento: 'AP-' + cuentaActual + '-' + Date.now().toString().slice(-6),
              obra: sesionActual.obra,
              metodo: metMap[cuentaActual],
              subMetodo: cuentaActual,
              categoria: 'Apertura Cuenta',
              monto: montoAdicional,
              concepto: `Fondo Inicial en Tarjeta ${cuentaActual}`,
              usuario: nombreUsuario,
              estatusFactura: 'No Requiere 🔴',
              linkFactura: 'N/A'
            });
          }

          sesionActual.cuentasPendientes = sesionActual.cuentasPendientes.filter(c => c !== cuentaActual);

          if (sesionActual.cuentasPendientes.length > 0) {
            const botonesSiguientes = sesionActual.cuentasPendientes.map(c => ({
              id: `ADDCRED_${c === 'MercadoPago' ? 'MP' : c}`,
              title: `Tarjeta ${c}`
            }));
            botonesSiguientes.push({ id: 'ADDCRED_FIN', title: '➡️ Continuar' });

            await enviarBotones(from, `💳 ¿Deseas agregar saldo a otra tarjeta disponible?`, botonesSiguientes.slice(0, 3));
          } else {
            sesionActual.esperandoSaldoCajaChica = true;
            await enviarTexto(from, `💵 ¿Cuánto efectivo disponible hay en *Caja Chica / Campo* para esta obra? (Escribe el monto o 0):`);
          }
          res.sendStatus(200);
          return;
        }

        if (sesionActual.esperandoSaldoCajaChica) {
          sesionActual.cajaChica = montoNum;
          delete sesionActual.esperandoSaldoCajaChica;

          if (montoNum > 0) {
            await guardarEnSheets({
              idMovimiento: 'DOTINI-' + Date.now().toString().slice(-6),
              obra: sesionActual.obra,
              metodo: 'Dotación Caja Chica',
              subMetodo: '',
              categoria: 'Fondo Caja',
              monto: montoNum,
              concepto: 'Fondo Inicial Asignado a Caja Chica',
              usuario: nombreUsuario,
              estatusFactura: 'No Requiere 🔴',
              linkFactura: 'N/A'
            });
          }

          await enviarBotones(from, `✅ *Datos Financieros de ${sesionActual.obra} guardados con éxito.*\n\n🤝 ¿Deseas dar de alta contratos de contratistas para esta obra?`, [
            { id: 'CARGACONTRATO_SI', title: '➕ Agregar Contrato' },
            { id: 'CARGACONTRATO_FIN', title: '✅ Finalizar Carga' }
          ]);
          res.sendStatus(200);
          return;
        }

        if (sesionActual.esperandoMontoContrato) {
          sesionActual.montoContratoTemp = montoNum;
          delete sesionActual.esperandoMontoContrato;
          sesionActual.esperandoPagadoContrato = true;
          await enviarTexto(from, `Monto de Contrato: ${formatoMoneda(montoNum)}\n\n¿Cuánto se le ha *pagado a la fecha* a este contratista? (Escribe el monto o 0):`);
          res.sendStatus(200);
          return;
        }

        if (sesionActual.esperandoPagadoContrato) {
          const pagadoTemp = montoNum;
          delete sesionActual.esperandoPagadoContrato;

          const especialidadUpper = sesionActual.especialidadTemp.toUpperCase();

          await guardarEnSheets({
            idMovimiento: 'CTR-' + Date.now().toString().slice(-6),
            obra: sesionActual.obra,
            metodo: 'Transferencia',
            subMetodo: '',
            categoria: especialidadUpper,
            monto: sesionActual.montoContratoTemp,
            concepto: `Contrato Cerrado ${especialidadUpper} Total Autorizado`,
            usuario: nombreUsuario,
            estatusFactura: 'No Requiere 🔴',
            linkFactura: 'N/A'
          });

          if (pagadoTemp > 0) {
            await guardarEnSheets({
              idMovimiento: 'PAGCTR-' + Date.now().toString().slice(-6),
              obra: sesionActual.obra,
              metodo: 'Transferencia',
              subMetodo: '',
              categoria: especialidadUpper,
              monto: pagadoTemp,
              concepto: `Abono a Contratista ${especialidadUpper}`,
              usuario: nombreUsuario,
              estatusFactura: 'No Requiere 🔴',
              linkFactura: 'N/A'
            });
          }

          const saldoPendiente = sesionActual.montoContratoTemp - pagadoTemp;
          await enviarBotones(from, `✅ *Contratista (${especialidadUpper}) Registrado*\n• Contrato: ${formatoMoneda(sesionActual.montoContratoTemp)}\n• Pagado: ${formatoMoneda(pagadoTemp)}\n• Saldo Pendiente: ${formatoMoneda(saldoPendiente)}\n\n¿Deseas agregar otro contratista?`, [
            { id: 'CARGACONTRATO_SI', title: '➕ Agregar Otro' },
            { id: 'CARGACONTRATO_FIN', title: '✅ Finalizar Obra' }
          ]);
          res.sendStatus(200);
          return;
        }
      }

      if (sesionActual && sesionActual.esperandoNombreTrabajadorBaja) {
        delete sesionActual.esperandoNombreTrabajadorBaja;
        await procesarBusquedaBaja(from, textBody.trim());
        delete sesiones[from];
        res.sendStatus(200);
        return;
      }

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
        sesionActual.sueldo = limpiarMonto(textBody);
        delete sesionActual.esperandoSueldoTrabajador;

        await guardarTrabajador(sesionActual);
        await enviarTexto(from, `✅ *Trabajador Registrado con Éxito*\n\n🆔 *ID:* ${sesionActual.idTrabajador}\n👤 *Nombre:* ${sesionActual.nombre}\n🏗️ *Obra:* ${sesionActual.obra}\n📌 *Tipo:* ${sesionActual.tipo}\n💵 *Sueldo Semanal:* ${formatoMoneda(sesionActual.sueldo)}\n📌 *Estatus:* ACTIVO 🟢`);
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
        sesionActual.monto = limpiarMonto(textBody);
        delete sesionActual.esperandoMontoVisita;
        sesionActual.esperandoFechaVisita = true;

        await enviarBotones(from, `🚌 *Visita Familiar (${sesionActual.nombre}):* ${formatoMoneda(sesionActual.monto)}\n\n📅 *¿Cuándo se realizó este pago?*`, [
          { id: 'VISFECHA_Hoy', title: 'Hoy (Fecha actual)' },
          { id: 'VISFECHA_Ayer', title: 'Ayer' },
          { id: 'VISFECHA_Otra', title: '✏️ Otra fecha' }
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
        sesionActual.precio = limpiarMonto(textBody);
        delete sesionActual.esperandoMontoPrecio;

        await enviarBotones(from, `🏷️ *Material:* ${sesionActual.material.toUpperCase()}\n💵 *Precio:* ${formatoMoneda(sesionActual.precio)}\n\n📐 *Selecciona la Unidad de Medida:*`, [
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
        const resultados = await buscarHistoricoPrecios(materialBuscado);

        if (resultados.length === 0) {
          await enviarTexto(from, `⚠️ No se encontraron precios registrados para "${textBody}".`);
        } else {
          let msgTxt = `📊 *HISTÓRICO DE PRECIOS: "${textBody.toUpperCase()}"*\n\n`;
          resultados.forEach((r, idx) => {
            const emoji = idx === 0 ? '🟢' : idx === 1 ? '🟡' : '🔴';
            msgTxt += `${emoji} *${formatoMoneda(r.precio)}* / ${r.unidad}\n` +
              `    📍 ${r.obra}\n` +
              `    🏢 Proveedor: ${r.proveedor}\n` +
              `    📝 Material: ${r.material}\n` +
              `    📅 Fecha: ${r.fecha.split(',')[0]}\n\n`;
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

        sesionActual.parentFolderId = await obtenerOcrearSubcarpetaObra(sesionActual.obra);
        const extraFolder = await obtenerOcrearCarpetaTrabajoExtra(sesionActual.parentFolderId, sesionActual.idExtra, sesionActual.descripcion);
        sesionActual.subfolderId = extraFolder.folderId;
        sesionActual.carpetaExtraLink = extraFolder.folderLink;

        await enviarTexto(from, '💵 *Escribe el Monto Estimado o Valor a cobrar por este trabajo extra:*');
        res.sendStatus(200);
        return;
      }

      if (sesionActual && sesionActual.esperandoMontoExtra) {
        sesionActual.monto = limpiarMonto(textBody);
        delete sesionActual.esperandoMontoExtra;
        sesionActual.esperandoFotosExtra = true;

        await enviarBotones(from, `📸 *Monto registrado:* ${formatoMoneda(sesionActual.monto)}\n\n*Envía la primera FOTO o VIDEO de evidencia por WhatsApp, o presiona el botón:*`, [
          { id: 'EXTRAFOTO_OMITIR', title: '🚫 Sin Evidencia' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (sesionActual && sesionActual.esperandoUnidadManual) {
        sesionActual.unidad = textBody.toLowerCase();
        delete sesionActual.esperandoUnidadManual;
        
        await enviarBotones(from, `🏷️ *Material:* ${sesionActual.material.toUpperCase()}\n💵 *Precio:* ${formatoMoneda(sesionActual.precio)} / ${sesionActual.unidad}\n\n🏗️ *¿En qué Sucursal se cotizó/compró?*`, [
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

        await enviarTexto(from, `✅ *Precio Histórico Guardado con Éxito*\n\n📍 *Obra:* ${sesionActual.obra}\n📝 *Material:* ${sesionActual.material.toUpperCase()}\n📐 *Unidad:* ${sesionActual.unidad}\n💵 *Precio:* ${formatoMoneda(sesionActual.precio)}\n🏢 *Proveedor:* ${sesionActual.proveedor}\n👤 *Registró:* ${sesionActual.usuario}`);
        delete sesiones[from];
        res.sendStatus(200);
        return;
      }

      const partes = textBody.split(/\s+/);
      const posibleMonto = limpiarMonto(partes[partes.length - 1]);
      let concepto = '';
      let monto = 0;

      if (!isNaN(posibleMonto) && posibleMonto > 0) {
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

      await enviarBotones(from, `📝 *Gasto:* ${concepto} (${formatoMoneda(monto)})\n\n🏗️ *Selecciona la Sucursal:*`, [
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

      if (respuestaId?.startsWith('ADDCRED_')) {
        const sesion = sesiones[from];
        if (sesion) {
          if (respuestaId === 'ADDCRED_FIN') {
            sesion.esperandoSaldoCajaChica = true;
            await enviarTexto(from, `💵 ¿Cuánto efectivo disponible hay en *Caja Chica / Campo* para esta obra? (Escribe el monto o 0):`);
          } else {
            const cuentaMapBtn = { 'ADDCRED_NU': 'NU', 'ADDCRED_DIDI': 'DIDI', 'ADDCRED_MP': 'MercadoPago' };
            const cuentaSel = cuentaMapBtn[respuestaId];
            sesion.cuentaActualTemp = cuentaSel;
            sesion.esperandoMontoCuentaAdicional = true;
            await enviarTexto(from, `💳 Escribe el saldo inicial en *Tarjeta ${cuentaSel}* (Escribe el monto):`);
          }
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'EXTRAFOTO_OMITIR') {
        const sesion = sesiones[from];
        if (sesion) {
          sesion.linksFotos = [];
          delete sesion.carpetaExtraLink;
          await guardarTrabajoExtra(sesion);
          await enviarTexto(from, `✅ *Trabajo Extra Guardado con Éxito*\n\n🆔 *ID:* ${sesion.idExtra}\n🏗️ *Obra:* ${sesion.obra}\n📝 *Descripción:* ${sesion.descripcion}\n💵 *Monto Estimado:* ${formatoMoneda(sesion.monto)}\n📷 *Evidencia:* Sin Evidencias\n👤 *Registró:* ${sesion.usuario}`);
          delete sesiones[from];
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('VISFECHA_')) {
        const sesion = sesiones[from];
        if (sesion && sesion.tipoAccion === 'VISITA_FAMILIAR') {
          if (respuestaId === 'VISFECHA_Hoy') {
            sesion.fechaPago = new Date().toLocaleDateString('es-MX');
            sesion.esperandoObraVisita = true;
            await enviarBotones(from, `📅 *Fecha:* Hoy\n\n🏗️ *¿A qué Obra/Sucursal se aplican estos viáticos?*`, [
              { id: 'VISITAOBRA_Pelicano', title: 'Pelicano' },
              { id: 'VISITAOBRA_Caldera', title: 'Caldera' },
              { id: 'VISITAOBRA_Nativitas', title: 'Nativitas' }
            ]);
            await enviarBotones(from, '👇 *Otras Opciones:*', [
              { id: 'VISITAOBRA_Salud', title: 'Salud' },
              { id: 'VISITAOBRA_Otro', title: 'Otro' }
            ]);
          } else if (respuestaId === 'VISFECHA_Ayer') {
            const ayer = new Date();
            ayer.setDate(ayer.getDate() - 1);
            sesion.fechaPago = ayer.toLocaleDateString('es-MX');
            sesion.esperandoObraVisita = true;
            await enviarBotones(from, `📅 *Fecha:* Ayer\n\n🏗️ *¿A qué Obra/Sucursal se aplican estos viáticos?*`, [
              { id: 'VISITAOBRA_Pelicano', title: 'Pelicano' },
              { id: 'VISITAOBRA_Caldera', title: 'Caldera' },
              { id: 'VISITAOBRA_Nativitas', title: 'Nativitas' }
            ]);
            await enviarBotones(from, '👇 *Otras Opciones:*', [
              { id: 'VISITAOBRA_Salud', title: 'Salud' },
              { id: 'VISITAOBRA_Otro', title: 'Otro' }
            ]);
          } else {
            sesion.esperandoFechaVisitaManual = true;
            await enviarTexto(from, '✏️ *Escribe la fecha exacta del pago en formato DD/MM/AAAA:* (ej: 15/08/2026)');
          }
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('EJECUTARCASO_') || respuestaId?.startsWith('EJECUTARBAJA_')) {
        const esBaja = respuestaId.startsWith('EJECUTARBAJA_');
        const prefijo = esBaja ? 'EJECUTARBAJA_' : 'EJECUTARCASO_';
        const filaIndex = parseInt(respuestaId.replace(prefijo, ''));

        if (esBaja) {
          const baja = await darDeBajaTrabajadorPorFila(filaIndex);
          if (baja) {
            await enviarTexto(from, `🔴 *Trabajador Dado de Baja Correctamente*\n\n👤 *Nombre:* ${baja.nombre}\n🏗️ *Obra:* ${baja.obra}\n📅 *Fecha de Baja:* ${baja.fechaBaja}\n📌 *Estatus:* BAJA 🔴`);
          } else {
            await enviarTexto(from, '⚠️ Error procesando la baja.');
          }
        } else {
          const resPers = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_PERSONAL_ID,
            range: `PLANTILLA_PERSONAL!C${filaIndex}:D${filaIndex}`
          });
          const nombreTrabajador = resPers.data.values?.[0]?.[0] || 'Trabajador';
          const obraActual = resPers.data.values?.[0]?.[1] || 'N/A';

          sesiones[from] = { tipoAccion: 'CAMBIO_OBRA_SELECCION', filaIndex, nombre: nombreTrabajador, obraActual };
          await enviarBotones(from, `👤 *Trabajador:* ${nombreTrabajador}\n🏗️ *Obra Actual:* ${obraActual}\n\n¿A qué nueva Sucursal deseas moverlo?`, [
            { id: 'CAMBIOBRA_Pelicano', title: 'Pelicano' },
            { id: 'CAMBIOBRA_Caldera', title: 'Caldera' },
            { id: 'CAMBIOBRA_Nativitas', title: 'Nativitas' }
          ]);
          await enviarBotones(from, '👇 *Otras Opciones:*', [
            { id: 'CAMBIOBRA_Salud', title: 'Salud' },
            { id: 'CAMBIOBRA_Otro', title: 'Otro' }
          ]);
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('CAMBIOBRA_')) {
        const obraMap = {
          'CAMBIOBRA_Pelicano': 'Suc. Pelicano',
          'CAMBIOBRA_Caldera': 'Suc. Caldera',
          'CAMBIOBRA_Nativitas': 'Suc. Nativitas',
          'CAMBIOBRA_Salud': 'Suc. Salud',
          'CAMBIOBRA_Otro': 'Suc. Otro'
        };
        const sesion = sesiones[from];
        if (sesion && sesion.tipoAccion === 'CAMBIO_OBRA_SELECCION') {
          const nuevaObra = obraMap[respuestaId] || 'Suc. Otro';
          const ok = await actualizarObraTrabajadorPorFila(sesion.filaIndex, nuevaObra);

          if (ok) {
            await enviarTexto(from, `✅ *Trabajador Reubicado con Éxito*\n\n👤 *Nombre:* ${sesion.nombre}\n🏢 *Obra Anterior:* ${sesion.obraActual}\n🏗️ *Nueva Obra:* ${nuevaObra}\n📌 *Estatus:* ACTIVO 🟢`);
          } else {
            await enviarTexto(from, '⚠️ Error actualizando la obra del trabajador.');
          }
          delete sesiones[from];
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('EDITARGAS_')) {
        const filaIndex = parseInt(respuestaId.replace('EDITARGAS_', ''));
        sesiones[from] = { filaIndexEditar: filaIndex };

        await enviarBotones(from, `✏️ *Opciones para el registro seleccionado:*\n\n¿Qué acción deseas realizar?`, [
          { id: 'ACCIONEDIT_MONTO', title: '💵 Cambiar Monto' },
          { id: 'ACCIONEDIT_ANULAR', title: '❌ Anular / Borrar' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'ACCIONEDIT_MONTO') {
        const sesion = sesiones[from];
        if (sesion && sesion.filaIndexEditar) {
          sesion.esperandoNuevoMontoGasto = true;
          await enviarTexto(from, '💵 *Escribe el nuevo monto correcto para este registro:*');
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'ACCIONEDIT_ANULAR') {
        const sesion = sesiones[from];
        if (sesion && sesion.filaIndexEditar) {
          const ok = await anularGastoPorFila(sesion.filaIndexEditar);
          if (ok) {
            await enviarTexto(from, '❌ *Registro anulado y ajustado a $0.00 en Sheets.*');
          } else {
            await enviarTexto(from, '⚠️ Error al anular el registro.');
          }
          delete sesiones[from];
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'MENU_CARGA_OBRA') {
        sesiones[from] = { tipoAccion: 'CARGA_OBRA', usuario: nombreUsuario };
        await enviarBotones(from, '🚀 *ASISTENTE DE CONFIGURACIÓN DE OBRA*\n\n🏗️ *¿Qué sucursal deseas configurar?*', [
          { id: 'CARGAOBRA_Pelicano', title: 'Pelicano' },
          { id: 'CARGAOBRA_Caldera', title: 'Caldera' },
          { id: 'CARGAOBRA_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Opciones:*', [
          { id: 'CARGAOBRA_Salud', title: 'Salud' },
          { id: 'CARGAOBRA_Otro', title: 'Otro' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('CARGAOBRA_')) {
        const obraMap = {
          'CARGAOBRA_Pelicano': 'Suc. Pelicano',
          'CARGAOBRA_Caldera': 'Suc. Caldera',
          'CARGAOBRA_Nativitas': 'Suc. Nativitas',
          'CARGAOBRA_Salud': 'Suc. Salud',
          'CARGAOBRA_Otro': 'Suc. Otro'
        };
        const sesion = sesiones[from] || { tipoAccion: 'CARGA_OBRA', usuario: nombreUsuario };
        sesiones[from] = sesion;
        sesion.obra = obraMap[respuestaId] || 'Suc. Otro';

        await enviarBotones(from, `🏗️ *Obra: ${sesion.obra}*\n\nSelecciona la modalidad:\n• *Obra Nueva:* Arranca desde cero.\n• *Obra Avanzada:* Ya tiene historial de gastos acumulados.`, [
          { id: 'MODOCARGA_Nueva', title: '🆕 Obra Nueva' },
          { id: 'MODOCARGA_Avanzada', title: '🏗️ Obra Avanzada' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('MODOCARGA_')) {
        const sesion = sesiones[from];
        if (sesion) {
          sesion.modoCarga = respuestaId === 'MODOCARGA_Nueva' ? 'NUEVA' : 'AVANZADA';
          sesion.esperandoPresupuestoTotal = true;
          await enviarTexto(from, `📋 *Configuración: ${sesion.obra}*\n\n💵 Escribe el *Presupuesto Total Autorizado* con el cliente:`);
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'CARGACONTRATO_SI') {
        const sesion = sesiones[from];
        if (sesion) {
          await enviarBotones(from, '👷‍♂️ *Selecciona la especialidad del contratista:*', [
            { id: 'ESPCONT_tablaroca', title: 'Tablaroca' },
            { id: 'ESPCONT_aluminio y vidrio', title: 'Aluminio y Vidrio' },
            { id: 'ESPCONT_pintura', title: 'Pintura' }
          ]);
          await enviarBotones(from, '👇 *Más Especialidades:*', [
            { id: 'ESPCONT_cubiertas', title: 'Cubiertas' },
            { id: 'ESPCONT_cortinas', title: 'Cortinas' },
            { id: 'ESPCONT_herreria', title: 'Herrería' }
          ]);
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('ESPCONT_')) {
        const sesion = sesiones[from];
        if (sesion) {
          sesion.especialidadTemp = respuestaId.replace('ESPCONT_', '');
          sesion.esperandoMontoContrato = true;
          await enviarTexto(from, `👷‍♂️ *Especialidad:* ${sesion.especialidadTemp.toUpperCase()}\n\n💵 Escribe el *Monto Total del Contrato Cerrado*:`);
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'CARGACONTRATO_FIN') {
        const sesion = sesiones[from];
        if (sesion) {
          await enviarTexto(from, `🎉 *¡Excelente! Configuración de ${sesion.obra} completada con éxito.*\n\nTodos los datos financieros, cuentas bancarias y contratos han quedado registrados y listos para los reportes.`);
          delete sesiones[from];
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('CTROBRA_')) {
        const obraMap = {
          'CTROBRA_Pelicano': 'Suc. Pelicano',
          'CTROBRA_Caldera': 'Suc. Caldera',
          'CTROBRA_Nativitas': 'Suc. Nativitas',
          'CTROBRA_Salud': 'Suc. Salud',
          'CTROBRA_Otro': 'Suc. Otro'
        };
        const sesion = sesiones[from];
        if (sesion) {
          sesion.obra = obraMap[respuestaId] || 'Suc. Otro';
          sesion.categoria = sesion.especialidadTemp.toUpperCase();
          sesion.metodo = 'Transferencia';
          sesion.estatusFactura = 'No Requiere 🔴';

          await guardarEnSheets(sesion);

          await enviarTexto(from, `✅ *Contrato Autorizado Guardado con Éxito*\n\n🆔 *ID:* ${sesion.idMovimiento}\n👷‍♂️ *Contratista:* ${sesion.contratista}\n🏗️ *Sucursal:* ${sesion.obra}\n💵 *Monto Total Contratado:* ${formatoMoneda(sesion.monto)}\n👤 *Registró:* ${sesion.usuario}`);
          delete sesiones[from];
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'MENU_CORREGIR') {
        const ultimos = await obtenerUltimosGastos(null);
        if (ultimos.length === 0) {
          await enviarTexto(from, '⚠️ No hay registros recientes para corregir.');
        } else {
          const opciones = ultimos.map(u => ({
            id: `EDITARGAS_${u.filaIndex}`,
            title: `${formatoMoneda(u.monto)} - ${u.concepto.substring(0, 14)}`,
            description: `${u.obra} (${u.id})`
          }));
          await enviarLista(from, '✏️ *CORRECCIÓN TÁCTIL DE REGISTROS*\n\nToca el registro que deseas modificar o anular:', 'Ver Registros', 'Últimos Movimientos', opciones);
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'MENU_PERSONAL') {
        await enviarBotones(from, '👷‍♂️ *Gestión de Personal Propio:*', [
          { id: 'OPC_ALTA_EMP', title: '➕ Alta Trabajador' },
          { id: 'OPC_BAJA_EMP', title: '❌ Baja Trabajador' },
          { id: 'OPC_CAMBIO_EMP', title: '🔄 Cambiar Obra' }
        ]);
        await enviarBotones(from, '👇 *Otras Opciones:*', [
          { id: 'OPC_VISITA_EMP', title: '🚌 Visita Familiar' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'MENU_CONTRATISTAS') {
        if (!tieneAccesoDireccion) {
          await enviarTexto(from, '⚙️ *Módulo en consolidación administrativa.* Consulta con administración central.');
          res.sendStatus(200);
          return;
        }
        await enviarBotones(from, '🤝 *Gestión de Contratistas:*', [
          { id: 'REPCONTRATISTAS_GLOBAL', title: '📊 Ver Saldos' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'MENU_PRESU') {
        if (!tieneAccesoDireccion) {
          await enviarTexto(from, '⚙️ *Módulo en consolidación administrativa.* Consulta con administración central.');
          res.sendStatus(200);
          return;
        }
        const rep = await calcularReportePresupuestos();
        let msgTexto = '🏦 *Avance de Presupuestos Autorizados (Farmacias):*\n\n';
        Object.keys(rep).forEach(o => {
          const t = rep[o];
          const porCobrar = t.presupuestoTotal - t.liberado;
          msgTexto += `🏗️ *${o}*\n` +
            `  • Presupuesto Autorizado: ${formatoMoneda(t.presupuestoTotal)}\n` +
            `  • Liberado a la Fecha: ${formatoMoneda(t.liberado)}\n` +
            `  • Pendiente por Liberar: ${formatoMoneda(porCobrar)}\n\n`;
        });
        await enviarTexto(from, msgTexto);
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'MENU_EXTRAS') {
        await enviarBotones(from, '🔨 *Gestión de Trabajos Extras:*', [
          { id: 'OPC_REG_EXTRA', title: '➕ Registrar Extra' },
          { id: 'OPC_VER_EXTRAS', title: '📋 Estatus Extras' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'OPC_REG_EXTRA') {
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

      if (respuestaId === 'OPC_VER_EXTRAS') {
        const extras = await obtenerTrabajosExtrasPendientes();
        if (extras.length === 0) {
          await enviarTexto(from, '🎉 ¡Excelente! No hay trabajos extras pendientes de cobro/envío.');
        } else {
          const opciones = extras.map(e => ({
            id: `GESTIONEXT_${e.idExtra}`,
            title: e.descripcion.substring(0, 24),
            description: `${e.obra} | ${formatoMoneda(e.monto)} (${e.idExtra})`
          }));
          await enviarLista(from, '🔨 *Trabajos Extras Pendientes:*', 'Ver Extras', 'Selecciona para actualizar:', opciones);
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('GESTIONEXT_')) {
        const idExtra = respuestaId.replace('GESTIONEXT_', '');
        sesiones[from] = { idExtraSeleccionado: idExtra };

        await enviarBotones(from, `🔨 *Actualizar Trabajo Extra (${idExtra}):*\n\nSelecciona el nuevo estatus:`, [
          { id: 'ESTEXTRA_Cobrado', title: '🟢 Cobrado' },
          { id: 'ESTEXTRA_Encargado', title: '🔵 Pasado a Encargado' },
          { id: 'ESTEXTRA_Cancelado', title: '🔴 Cancelado' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('ESTEXTRA_')) {
        const sesion = sesiones[from];
        if (sesion && sesion.idExtraSeleccionado) {
          const mapaEstatus = {
            'ESTEXTRA_Cobrado': 'Cobrado 🟢',
            'ESTEXTRA_Encargado': 'Enviado a Encargado 🔵',
            'ESTEXTRA_Cancelado': 'Cancelado 🔴'
          };
          const nuevoEst = mapaEstatus[respuestaId] || 'Pendiente 🟡';
          const ok = await actualizarEstatusTrabajoExtra(sesion.idExtraSeleccionado, nuevoEst);

          if (ok) {
            await enviarTexto(from, `✅ *Estatus del Trabajo Extra (${sesion.idExtraSeleccionado}) actualizado a:* ${nuevoEst}`);
          } else {
            await enviarTexto(from, '⚠️ No se pudo actualizar el trabajo extra.');
          }
          delete sesiones[from];
        }
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'MENU_PRECIOS') {
        await enviarBotones(from, '🏷️ *Histórico de Precios:*', [
          { id: 'OPC_REG_PRECIO', title: '📝 Registrar Precio' },
          { id: 'OPC_BUS_PRECIO', title: '🔍 Comparar / Buscar' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'MENU_REPORTES') {
        if (!tieneAccesoDireccion) {
          await enviarTexto(from, '⚙️ *Módulo en consolidación administrativa.* Consulta con administración central.');
          res.sendStatus(200);
          return;
        }
        await enviarBotones(from, '📊 *¿De qué Sucursal deseas generar el Reporte PDF?*', [
          { id: 'REP_Pelicano', title: 'Pelicano' },
          { id: 'REP_Caldera', title: 'Caldera' },
          { id: 'REP_Nativitas', title: 'Nativitas' }
        ]);
        await enviarBotones(from, '👇 *Otras Opciones:*', [
          { id: 'REP_Salud', title: 'Salud' },
          { id: 'REP_GLOBAL', title: 'Caja Chica' }
        ]);
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'REP_GLOBAL') {
        if (!tieneAccesoDireccion) {
          await enviarTexto(from, '⚙️ *Módulo en consolidación administrativa.* Consulta con administración central.');
          res.sendStatus(200);
          return;
        }
        const rep = await calcularReporteSaldos(null);
        let txt = `📊 *Corte de Caja Chica General (Efectivo)*\n\n` +
          `💵 *Total Efectivo Ingresado:* ${formatoMoneda(rep.dotacionesCaja)} MXN\n` +
          `💸 *Egresos en Efectivo:* ${formatoMoneda(rep.egresosEfectivo)} MXN\n` +
          `💰 *Efectivo Disponible en Mano:* ${formatoMoneda(rep.cajaDisponible)} MXN\n` +
          `📄 *Total Facturado en Efectivo:* ${formatoMoneda(rep.facturadoEfectivo)} MXN`;

        await enviarTexto(from, txt);
        res.sendStatus(200);
        return;
      }

      if (respuestaId?.startsWith('REP_')) {
        if (!tieneAccesoDireccion) {
          await enviarTexto(from, '⚙️ *Módulo en consolidación administrativa.* Consulta con administración central.');
          res.sendStatus(200);
          return;
        }

        const obraMap = {
          'REP_Pelicano': 'Suc. Pelicano',
          'REP_Caldera': 'Suc. Caldera',
          'REP_Nativitas': 'Suc. Nativitas',
          'REP_Salud': 'Suc. Salud'
        };
        const obraSel = obraMap[respuestaId];

        await enviarTexto(from, `⏳ *Generando Estado de Cuenta y Corte Semanal (Lunes a Domingo) en PDF...*`);

        const datosCorte = await generarDatosCorteSemanal(obraSel);

        if (datosCorte) {
          const nombreArchivoPdf = `Corte_${(obraSel || 'General').replace(/\s+/g, '_')}_${Date.now()}.pdf`;
          const rutaPdfLocal = path.join(__dirname, nombreArchivoPdf);

          await generarPDFCorteSemanal(datosCorte, rutaPdfLocal);

          const captionTxt = `📄 *Corte Financiero Semanal — ${datosCorte.sucursal}*\n` +
            `📅 *Periodo:* ${datosCorte.periodo}\n\n` +
            `💵 *Gastos de la Semana:* ${formatoMoneda(datosCorte.semanaTotal)}\n` +
            `💰 *Saldo Total Disponible:* ${formatoMoneda(datosCorte.saldoDisponible)}\n` +
            `  • Banco: ${formatoMoneda(datosCorte.saldoBanco)}\n` +
            `  • Efectivo: ${formatoMoneda(datosCorte.saldoEfectivo)}\n\n` +
            `✍️ *Validado y Firmado por Constructive Gallery Architects.*`;

          await enviarDocumentoWhatsApp(from, rutaPdfLocal, nombreArchivoPdf, captionTxt);

          if (fs.existsSync(rutaPdfLocal)) fs.unlinkSync(rutaPdfLocal);
        } else {
          await enviarTexto(from, '⚠️ No se pudieron obtener los datos para generar el reporte.');
        }

        res.sendStatus(200);
        return;
      }

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

      if (respuestaId === 'OPC_BAJA_EMP') {
        sesiones[from] = { esperandoNombreTrabajadorBaja: true };
        await enviarTexto(from, '✏️ *Escribe el Nombre (o parte del nombre) del trabajador a dar de BAJA:*');
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'OPC_CAMBIO_EMP') {
        sesiones[from] = { esperandoNombreTrabajadorCambio: true };
        await enviarTexto(from, '✏️ *Escribe el Nombre (o parte del nombre) del trabajador al que deseas cambiar de obra:*');
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
            title: p.concepto.substring(0, 24),
            description: `${p.obra} | ${formatoMoneda(p.monto)} (${p.id})`
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
        await enviarTexto(from, '📸 *Envía la siguiente foto o video de evidencia:*');
        res.sendStatus(200);
        return;
      }

      if (respuestaId === 'EXTRAFOTO_FIN') {
        const sesion = sesiones[from];
        if (sesion) {
          await guardarTrabajoExtra(sesion);
          await enviarTexto(from, `✅ *Trabajo Extra Guardado con Éxito*\n\n🆔 *ID:* ${sesion.idExtra}\n🏗️ *Obra:* ${sesion.obra}\n📝 *Descripción:* ${sesion.descripcion}\n💵 *Monto Estimado:* ${formatoMoneda(sesion.monto)}\n📷 *Archivos en Drive:* ${sesion.linksFotos.length} evidencia(s)\n👤 *Registró:* ${sesion.usuario}`);
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
          await enviarTexto(from, '✏️ *Escribe la descripción detallada del trabajo extra:* (ej: Instalación de viga de acero 6m)');
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

          const fechaSalidaReal = new Date(sesion.fechaPago || Date.now());
          const fechaProxima = new Date(fechaSalidaReal.getTime() + (45 * 24 * 60 * 60 * 1000)).toLocaleDateString('es-MX', { timeZone: 'America/Mexico_City' });

          await enviarTexto(from, `✅ *Visita Familiar Registrada con Éxito*\n\n👤 *Trabajador:* ${sesion.nombre}\n🏗️ *Obra Afectada:* ${sesion.obra}\n💵 *Monto Apoyo:* ${formatoMoneda(sesion.monto)}\n📅 *Fecha de Pago:* ${sesion.fechaPago}\n⏳ *Próxima Visita Sugerida (+45 días):* ${fechaProxima}`);
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

        await enviarBotones(from, `🏷️ *Material:* ${sesion.material.toUpperCase()}\n💵 *Precio:* ${formatoMoneda(sesion.precio)} / ${sesion.unidad}\n\n🏗️ *¿En qué Sucursal se cotizó/compró?*`, [
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

      if (respuestaId?.startsWith('REPCONTRATISTAS_')) {
        if (!tieneAccesoDireccion) {
          await enviarTexto(from, '⚙️ *Módulo en consolidación administrativa.* Consulta con administración central.');
          res.sendStatus(200);
          return;
        }

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
              `  • Contrato Total: ${formatoMoneda(t.totalContrato)}\n` +
              `  • Pagado a la Fecha: ${formatoMoneda(t.pagado)}\n` +
              `  • Saldo Pendiente: ${formatoMoneda(pendiente)}\n\n`;
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
          { id: 'CAT_29', title: '29) RESIDENCIA DE OBRA' },
          { id: 'CAT_30', title: '30) INDIRECTOS' }
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
          'CAT_29': '29) RESIDENCIA DE OBRA',
          'CAT_30': '30) INDIRECTOS'
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

        sesion.categoria = '31) HONORARIOS';
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

        const alerta = await verificarSobregiroContratista(sesion.obra, sesion.categoria, sesion.concepto, sesion.monto);

        await guardarEnSheets(sesion);

        const metodoTexto = sesion.subMetodo ? `${sesion.metodo} (${sesion.subMetodo})` : sesion.metodo;
        let resumen = `✅ *Gasto Registrado con Éxito*\n\n` +
          `🆔 *ID:* ${sesion.idMovimiento}\n` +
          `👤 *Registró:* ${sesion.usuario}\n` +
          `📌 *Categoría:* ${sesion.categoria}\n` +
          `💵 *Monto:* ${formatoMoneda(sesion.monto)}\n` +
          `📝 *Concepto:* ${sesion.concepto}\n` +
          `🏗️ *Obra:* ${sesion.obra}\n` +
          `💳 *Pago:* ${metodoTexto}\n` +
          `📄 *Factura:* ${sesion.estatusFactura}`;

        if (alerta) {
          resumen += `\n\n${alerta}`;
        }

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
