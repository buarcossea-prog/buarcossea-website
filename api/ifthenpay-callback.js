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
  const resendKey = process.env.RESEND_API_KEY;

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
      const jaEstavaPago = reserva.estado === 'pago';
      const valorFinal = amount || reserva.total;

      reserva.estado = 'pago';
      reserva.pagoEm = reserva.pagoEm || new Date().toISOString();
      reserva.valorPago = valorFinal;
      reserva.calendarioBloqueado = true;

      // 1. Bloquear/confirmar os dias no calendário principal (precos_buarcos)
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

      // 2. Enviar email de Reserva Confirmada (apenas se ainda não tiver sido enviado e existir email do hóspede)
      if (resendKey && reserva.hospede?.email && !reserva.emailConfirmacaoEnviado) {
        const nomeApt = reserva.apartamento === 'cristal_mar'
          ? 'Cristal Mar (161145/AL)'
          : 'Tonay Sol (146454/AL)';

        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Buarcos & Sea <reservas@buarcossea.pt>',
            to: reserva.hospede.email,
            bcc: 'buarcossea@gmail.com',
            reply_to: 'buarcossea@gmail.com',
            subject: `Reserva Confirmada: ${nomeApt} (${reserva.checkin} a ${reserva.checkout}) - ${reserva.hospede.nome || reservaId}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #193247;">
                <h2 style="color: #23425c;">Reserva Confirmada!</h2>
                <p>Olá <strong>${reserva.hospede.nome || 'Hóspede'}</strong>,</p>
                <p>Confirmamos a receção do seu pagamento e a validação da sua reserva no <strong>Buarcos & Sea Accommodation</strong> para o <strong>${nomeApt}</strong>.</p>
                <div style="background-color: #f3f1eb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                  <p style="margin: 5px 0;"><strong>Referência da Reserva:</strong> ${reserva.orderId || reservaId}</p>
                  <p style="margin: 5px 0;"><strong>Check-in:</strong> ${reserva.checkin}</p>
                  <p style="margin: 5px 0;"><strong>Check-out:</strong> ${reserva.checkout}</p>
                  ${reserva.adultos !== undefined ? `<p style="margin: 5px 0;"><strong>Hóspedes:</strong> ${reserva.adultos} Adultos, ${reserva.criancas || 0} Crianças</p>` : ''}
                  <p style="margin: 5px 0;"><strong>Valor Pago:</strong> ${valorFinal} €</p>
                  <p style="margin: 5px 0;"><strong>Método de Pagamento:</strong> ${(reserva.metodoPagamento || '').toUpperCase()}</p>
                  <p style="color: #15803d; margin-top: 10px;"><strong>✅ Estado:</strong> Pagamento confirmado e datas bloqueadas.</p>
                </div>
                <p style="font-size: 14px; color: #475569;">Se precisar de alguma informação adicional antes da chegada, basta responder diretamente a este email.</p>
              </div>
            `
          })
        });

        if (emailRes.ok) {
          reserva.emailConfirmacaoEnviado = true;
        }
      }

      // 3. Guardar estado atualizado da reserva no Redis
      if (!jaEstavaPago || reserva.emailConfirmacaoEnviado) {
        await fetch(`${redisUrl}/set/reserva_${reservaId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(reserva)
        });
      }
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Erro no callback ifthenpay:', error);
    return res.status(500).send('Erro interno');
  }
}
