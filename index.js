// Función para buscar o crear la carpeta del mes actual
async function obtenerOCrearCarpetaMes(parentFolderId) {
  const fechaObj = new Date();
  const anio = fechaObj.getFullYear();
  const mesNumero = String(fechaObj.getMonth() + 1).padStart(2, '0');
  const mesesNombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const nombreCarpetaMes = `${anio}/${mesNumero}_${mesesNombres[fechaObj.getMonth()]}`;

  try {
    // 1. Buscar si la carpeta ya existe dentro de Facturas_Bot
    const query = `'${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${nombreCarpetaMes}' and trashed = false`;
    const resSearch = await drive.files.list({ q: query, fields: 'files(id, name)' });

    if (resSearch.data.files.length > 0) {
      return resSearch.data.files[0].id;
    }

    // 2. Si no existe, crearla
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
    return parentFolderId; // Si falla, usa la raíz para no perder el archivo
  }
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

    // Obtener la carpeta del mes correspondiente
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
