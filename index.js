const express = require('express');
const { google } = require('googleapis');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

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
async function registrarEnGoogleSheets(concepto, monto) {
  if (!sheets || !SPREADSHEET_ID) {
    console.error('❌ Google Sheets no está configurado correctamente.');
    return;
  }

  try {
    const idMovimiento = 'MOV-' + Date.now().toString().slice(-6);
    const fechaHora = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });

    // Mapeo de tus columnas:
    // A: ID_MOVIMIENTO | B: FECHA_HORA | C: OBRA | D: METODO_PAGO | E: CATEGORIA_SIMPLIFICADA | F: MONTO | G: CONCEPTO_DESCRIPCION | H: QUIEN_REGISTRO
    const valores = [
      [
        idMovimiento,       // A
        fechaHora,          // B
        'General',          // C
        'Efectivo/Digital', // D
        'General',          // E
        monto,              // F
        concepto,           // G
        'Bot WhatsApp'      // H
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

    console.log(`✅ Fila agregada exitosamente: ${concepto} - $${monto}`);
  } catch (error) {
    console.error('❌ Error al escribir en Google Sheets:', error.message);
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

      if (message.type === 'text') {
        const textBody = message.text.body.trim();
        console.log('📩 Mensaje recibido:', textBody);

        // Separación de concepto y monto (Ejemplo: "this is a text message")
        const partes = textBody.split(/\s+/);
        const posibleMonto = parseFloat(partes[partes.length - 1]);

        if (!isNaN(posibleMonto)) {
          const concepto = partes.slice(0, -1).join(' ') || 'Gasto no especificado';
          await registrarEnGoogleSheets(concepto, posibleMonto);
        } else {
          // Si el mensaje no trae número, guardamos todo el texto y ponemos monto 0 para probar
          await registrarEnGoogleSheets(textBody, 0);
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
