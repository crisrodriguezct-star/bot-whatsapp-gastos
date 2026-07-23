const express = require('express');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

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
  } else {
    console.warn('⚠️ No se encontró la variable GOOGLE_CREDENTIALS.');
  }
} catch (error) {
  console.error('❌ Error al inicializar Google Sheets API:', error.message);
}

// Función para clasificar categorías automáticamente
function obtenerCategoria(concepto) {
  const texto = concepto.toLowerCase();
  
  if (/gasolina|diésel|diesel|caseta|estacionamiento|peaje|taller|flete/i.test(texto)) {
    return 'Transporte / Vehículo';
  }
  if (/comida|almuerzo|cena|desayuno|oxxo|7eleven|restaurante|agua|café|cafe/i.test(texto)) {
    return 'Alimentos y Consumo';
  }
  if (/cemento|varilla|arena|grava|pintura|cable|tubo|madera|tabique|material/i.test(texto)) {
    return 'Materiales';
  }
  if (/herramienta|disco|broca|pala|martillo|equipo|reparacion/i.test(texto)) {
    return 'Herramientas y Equipo';
  }
  if (/nomina|sueldo|raya|pago|trabajador|peon|albañil/i.test(texto)) {
    return 'Mano de Obra';
  }

  return 'General';
}

// Función para enviar mensaje de respuesta a WhatsApp
async function enviarRespuestaWhatsApp(toPhoneNumber, textoRespuesta) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.warn('⚠️ Faltan variables WHATSAPP_TOKEN o PHONE_NUMBER_ID para enviar mensaje.');
    return;
  }

  try {
    const response = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toPhoneNumber,
        type: 'text',
        text: { body: textoRespuesta },
      }),
    });

    if (response.ok) {
      console.log(`📤 Respuesta de confirmación enviada a ${toPhoneNumber}`);
    } else {
      const errorData = await response.json();
      console.error('❌ Error devuelto por Meta al enviar WhatsApp:', JSON.stringify(errorData));
    }
  } catch (error) {
    console.error('❌ Error al enviar mensaje por WhatsApp:', error.message);
  }
}

// Endpoint de verificación para Meta Webhook
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// Función para registrar una nueva fila en Google Sheets
async function registrarEnGoogleSheets(concepto, monto, categoria, obra) {
  if (!sheets || !SPREADSHEET_ID) {
    console.error('❌ Google Sheets no está configurado correctamente.');
    return null;
  }

  try {
    const idMovimiento = 'MOV-' + Date.now().toString().slice(-6);
    const fechaHora = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

    const valores = [
      [
        idMovimiento,       // A: ID_MOVIMIENTO
        fechaHora,          // B: FECHA_HORA
        obra,               // C: OBRA
        'Efectivo/Digital', // D: METODO_PAGO
        categoria,          // E: CATEGORIA_SIMPLIFICADA
        monto,              // F: MONTO
        concepto,           // G: CONCEPTO_DESCRIPCION
        'Bot WhatsApp'      // H: QUIEN_REGISTRO
      ]
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Hoja 1!A:H',
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: valores,
      },
    });

    console.log(`✅ Fila agregada exitosamente: ${concepto} - $${monto} [Obra: ${obra}]`);
    return idMovimiento;
  } catch (error) {
    console.error('❌ Error al escribir en Google Sheets:', error.message);
    return null;
  }
}

// Endpoint para recibir mensajes del Webhook
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object) {
    if (
      body.entry &&
      body.entry[0].changes &&
      body.entry[0].changes[0].value.messages &&
      body.entry[0].changes[0].value.messages[0]
    ) {
      const message = body.entry[0].changes[0].value.messages[0];
      const fromPhoneNumber = message.from;

      if (message.type === 'text') {
        const textBody = message.text.body.trim();
        console.log('📩 Mensaje recibido:', textBody);

        let obra = 'General';
        let textoLimpio = textBody;

        // 1. INTENTO VÍA HASHTAG (#Obra)
        const matchHashtag = textoLimpio.match(/#(\w+)/);
        if (matchHashtag) {
          obra = matchHashtag[1];
          textoLimpio = textoLimpio.replace(/#\w+/, '').trim();
        } else {
          // 2. INTENTO VÍA PALABRA CLAVE ("obra X" o "para X")
          const matchPalabraClave = textoLimpio.match(/(?:obra|para)\s+([a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ]+)/i);
          if (matchPalabraClave) {
            obra = matchPalabraClave[1];
            textoLimpio = textoLimpio.replace(/(?:obra|para)\s+[a-zA-Z0-9_áéíóúÁÉÍÓÚñÑ]+/i, '').trim();
          }
        }

        const partes = textoLimpio.split(/\s+/);
        const posibleMonto = parseFloat(partes[partes.length - 1]);

        let concepto = '';
        let monto = 0;

        if (!isNaN(posibleMonto)) {
          concepto = partes.slice(0, -1).join(' ') || 'Gasto no especificado';
          monto = posibleMonto;
        } else {
          concepto = textoLimpio;
          monto = 0;
        }

        const categoria = obtenerCategoria(concepto);
        const idMovimiento = await registrarEnGoogleSheets(concepto, monto, categoria, obra);

        if (idMovimiento) {
          const mensajeConfirmacion = `✅ *Gasto Registrado*\n\n` +
            `🆔 *ID:* ${idMovimiento}\n` +
            `💵 *Monto:* $${monto.toFixed(2)}\n` +
            `🏗️ *Obra:* ${obra}\n` +
            `📝 *Concepto:* ${concepto}\n` +
            `🏷️ *Categoría:* ${categoria}`;

          await enviarRespuestaWhatsApp(fromPhoneNumber, mensajeConfirmacion);
        }
      }
    }
    res.sendStatus(200);
  } else {
    res.sendStatus(404);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
});
