export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  const { key, id, orderId, amount, status } = req.query;
  const reservaId = id || orderId;

  if (!key || key !== process.env.IFTHENPAY_ANTI_PHISHING_KEY) {
    return res.status(401).send('Chave anti-phishing inválida');
  }

  if (!reservaId) {
    return res.status(400).send('ID da reserva em falta');
  }

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  try {
    const getRes = await fetch(`${redisUrl}/get/reserva_${reservaId}`, {
      headers: { Authorization: `Bearer ${redisToken}` }
    });
    const getData = await getRes.json();

    if (!getData || !getData.result) {
      return res.status(404).send('Reserva não encontrada');
    }

    const reserva = typeof getData.result === 'string' ? JSON.parse(getData.result) : getData.result;

    if (!status || status.toUpperCase() === 'PAGO' || status.toUpperCase() === 'PAID' || status === '000') {
      reserva.estado = 'pago';
      reserva.pagoEm = new Date().toISOString();
      reserva.valorPago = amount || reserva.total;
      reserva.calendarioBloqueado = true;

      await fetch(`${redisUrl}/set/reserva_${reservaId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(reserva)
      });

      // Bloquear/confirmar os dias no calendário principal (precos_buarcos) apenas após pagamento
      const calRes = await fetch(`${redisUrl}/get/precos_buarcos`, {
        headers: { Authorization: `Bearer ${redisToken}` }
      });
      const calData = await calRes.json();

      let storedData = {
        data: {},
        limpezaGlobal: { cristal_mar: 35, tonay_sol: 35 },
        petGlobal: 15,
        regrasEstadia: { base: 2, junho: 4, alta: 7 }
      };

      if (calData && calData.result) {
        const parsed = typeof calData.result === 'string' ? JSON.parse(calData.result) : calData.result;
        if (parsed.data) {
          storedData = parsed;
        } else {
          storedData.data = parsed;
        }
      }

      if (!storedData.data) {
        storedData.data = {};
      }
      if (!storedData.data[reserva.apartamento]) {
        storedData.data[reserva.apartamento] = {};
      }

      let dtAtual = new Date(`${reserva.checkin}T00:00:00`);
      const dtFim = new Date(`${reserva.checkout}T00:00:00`);
      while (dtAtual < dtFim) {
        const ano = dtAtual.getFullYear();
        const mes = String(dtAtual.getMonth() + 1).padStart(2, '0');
        const dia = String(dtAtual.getDate()).padStart(2, '0');
        const dataStr = `${ano}-${mes}-${dia}`;

        const diaAtual = { ...(storedData.data[reserva.apartamento][dataStr] || {}) };
        delete diaAtual.expiraEm;

        storedData.data[reserva.apartamento][dataStr] = {
          ...diaAtual,
          bloqueado: true,
          estadoPagamento: 'pago',
          orderId: reserva.orderId || reservaId,
          motivo: `Reserva Confirmada (${(reserva.metodoPagamento || '').toUpperCase()}): ${reserva.hospede?.nome || ''}`,
          contacto: reserva.hospede ? `${reserva.hospede.telefone || ''} (${reserva.hospede.email || ''})` : ''
        };

        dtAtual.setDate(dtAtual.getDate() + 1);
      }

      await fetch(`${redisUrl}/set/precos_buarcos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(storedData)
      });
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Erro no callback ifthenpay:', error);
    return res.status(500).send('Erro interno');
  }
}
