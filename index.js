const express = require('express');
const app = express();

app.use(express.json());

// Ruta principal para validar que el servidor está vivo
app.get('/', (req, res) => {
  res.send('Servidor de WhatsApp funcionando 🚀');
});

// Verificación del Webhook para Meta
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
      console.log('WEBHOOK VERIFICADO CORRECTAMENTE');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

// Recepción de mensajes
app.post('/webhook', (req, res) => {
  console.log('Mensaje entrante:', JSON.stringify(req.body, null, 2));
  res.status(200).send('EVENT_RECEIVED');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
