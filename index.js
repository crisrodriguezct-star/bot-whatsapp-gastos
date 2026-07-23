const express = require('express');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const sesiones = {};

// Configuración de autenticación con Google Sheets
let sheets;
try {
  if (process.env.GOOGLE_CREDENTIALS) {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheets = google.sheets({ version: 'v4', auth });
    console.log('✅ Google Sheets API configurado correctamente.');
  }
} catch (error) {
  console.error('❌ Error Google Sheets:', error.message);
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
      'Bot WhatsApp'
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:H',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: valores },
    });
    console.log(`✅ Registrado en Sheets: ${datos.idMovimiento}`);
  } catch (error) {
    console.error('❌ Error en Sheets:', error.message);
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
        subMetodo: ''
      };

      // Preguntar Sucursal usando botones de respuesta
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
          await finalizarRegistro(from, sesion);
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
        await finalizarRegistro(from, sesion);
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

async function finalizarRegistro(from, sesion) {
  await guardarEnSheets(sesion);
  const metodoTexto = sesion.subMetodo ? `${sesion.metodo} (${sesion.subMetodo})` : sesion.metodo;
  const resumen = `✅ *Gasto Registrado*\n\n` +
    `🆔 *ID:* ${sesion.idMovimiento}\n` +
    `💵 *Monto:* $${sesion.monto.toFixed(2)}\n` +
    `📝 *Concepto:* ${sesion.concepto}\n` +
    `🏗️ *Obra:* ${sesion.obra}\n` +
    `💳 *Pago:* ${metodoTexto}`;
  await enviarTexto(from, resumen);
  delete sesiones[from];
}

app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
