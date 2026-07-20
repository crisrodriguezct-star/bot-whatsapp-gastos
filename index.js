const express = require('express');
const app = express();

app.use(express.json());

// Token de verificación
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'Buenaadmin20';

// Ruta GET para la verificación de Meta
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === VERIFY_TOKEN) {
    console.log('WEBHOOK VERIFICADO CORRECTAMENTE');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Ruta POST para recibir los mensajes de WhatsApp
app.post('/webhook', (req, res) => {
  console.log('📩 MENSAJE ENTRANTE RECIBIDO:');
  console.log(JSON.stringify(req.body, null, 2));

  // Responder 200 OK inmediatamente a Meta para confirmar recepción
  res.status(200).send('EVENT_RECEIVED');
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
