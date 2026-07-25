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
          // Es un gasto regular
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
