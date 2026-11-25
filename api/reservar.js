export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método não permitido' });
  }

  const { apartamento, checkin, checkout, adultos, criancas, total, metodoPagamento, hospede } = req.body;

  if (!apartamento || !checkin || !checkout || !hospede?.email) {
    return res.status(400).json({ success: false, error: 'Dados incompletos' });
  }

  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  const resendKey = process.env.RESEND_API_KEY;

  // Limpar o valor numérico (ex: "150.00 €" -> "150.00")
  const valorNumerico = parseFloat(String(total).replace(/[^\d.,]/g, '').replace(',', '.')).toFixed(2);
  const orderId = `RES-${Date.now().toString().slice(-6)}`;

  // MB WAY expira em 5 min; Multibanco / outros em 24h
  const minutosValidade = metodoPagamento === 'mbway' ? 5 : 24 * 60;
  const agora = Date.now();
  const expiraEm = agora + (minutosValidade * 60 * 1000);
  const dataLimiteFormatada = new Date(expiraEm).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' });

  let dadosPagamento = {};

  try {
    // 1. GERAR PAGAMENTO REAL NA IFTHENPAY CONSOANTE O MÉTODO
    if (metodoPagamento === 'multibanco') {
      const mbRes = await fetch('https://api.ifthenpay.com/multibanco/reference/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mbKey: process.env.IFTHENPAY_MB_KEY,
          orderId,
          amount: valorNumerico,
          description: `Reserva ${apartamento} (${checkin} a ${checkout})`,
          expiryDays: 1
        })
      });
      const mbData = await mbRes.json();
      if (mbData.Status !== '0') {
        return res.status(400).json({ success: false, error: mbData.Message || 'Erro ao gerar referência Multibanco' });
      }
      dadosPagamento = {
        entidade: mbData.Entity,
        referencia: String(mbData.Reference).replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')
      };

    } else if (metodoPagamento === 'mbway') {
      let telLimpo = String(hospede.telefone || '').replace(/\D/g, '');
      if (telLimpo.length === 9) telLimpo = `351#${telLimpo}`;
      else if (telLimpo.startsWith('351')) telLimpo = `351#${telLimpo.slice(3)}`;

      const mbwayRes = await fetch('https://api.ifthenpay.com/spg/payment/mbway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mbWayKey: process.env.IFTHENPAY_MBWAY_KEY,
          orderId,
          amount: valorNumerico,
          mobileNumber: telLimpo,
          email: hospede.email,
          description: `Reserva ${apartamento}`
        })
      });
      const mbwayData = await mbwayRes.json();
      if (mbwayData.Status !== '000') {
        return res.status(400).json({ success: false, error: mbwayData.Message || 'Erro no pedido MB WAY' });
      }
      dadosPagamento = { requestId: mbwayData.RequestId };

    } else if (metodoPagamento === 'cartao' || metodoPagamento === 'carteiras') {
      const accounts = metodoPagamento === 'cartao'
        ? `CCARD|${process.env.IFTHENPAY_CCARD_KEY}`
        : `APPLE|${process.env.IFTHENPAY_APPLE_KEY};GOOGLE|${process.env.IFTHENPAY_GOOGLE_KEY}`;

      const expireDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
        .replace(/-/g, '');

      const gwRes = await fetch(`https://api.ifthenpay.com/gateway/pinpay/${process.env.IFTHENPAY_BACKOFFICE_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: orderId,
          amount: valorNumerico,
          description: `Reserva ${apartamento} (${checkin} a ${checkout})`,
          lang: 'pt',
          accounts,
          selected_method: metodoPagamento === 'cartao' ? 'CCARD' : '',
          expiredate: expireDate,
          success_url: 'https://www.buarcossea.pt/?pagamento=sucesso',
          error_url: 'https://www.buarcossea.pt/?pagamento=erro',
          cancel_url: 'https://www.buarcossea.pt/?pagamento=cancelado',
          btnCloseUrl: 'https://www.buarcossea.pt',
          btnCloseLabel: 'Voltar ao site'
        })
      });
      const gwData = await gwRes.json();
      if (!gwData.PinpayUrl) {
        return res.status(400).json({ success: false, error: 'Erro ao gerar ligação de pagamento' });
      }
      dadosPagamento = { paymentUrl: gwData.PinpayUrl };
    }

    // 2. BLOQUEAR DATAS NO CALENDÁRIO E GUARDAR RESERVA NO REDIS
    if (redisUrl && redisToken) {
      const getRes = await fetch(`${redisUrl}/get/precos_buarcos`, {
        headers: { Authorization: `Bearer ${redisToken}` }
      });
      const getData = await getRes.json();
      let storedData = {
        data: {},
        limpezaGlobal: { cristal_mar: 35, tonay_sol: 35 },
        petGlobal: 15,
        regrasEstadia: { base: 2, junho: 4, alta: 7 }
      };

      if (getData && getData.result) {
        const parsed = typeof getData.result === 'string' ? JSON.parse(getData.result) : getData.result;
        if (parsed.data) {
          storedData = parsed;
        } else {
          storedData.data = parsed;
        }
      }

      if (!storedData.data[apartamento]) {
        storedData.data[apartamento] = {};
      }

      let dtAtual = new Date(`${checkin}T00:00:00`);
      const dtFim = new Date(`${checkout}T00:00:00`);
      while (dtAtual < dtFim) {
        const ano = dtAtual.getFullYear();
        const mes = String(dtAtual.getMonth() + 1).padStart(2, '0');
        const dia = String(dtAtual.getDate()).padStart(2, '0');
        const dataStr = `${ano}-${mes}-${dia}`;

        storedData.data[apartamento][dataStr] = {
          ...(storedData.data[apartamento][dataStr] || {}),
          bloqueado: true,
          estadoPagamento: 'pendente',
          orderId,
          expiraEm: expiraEm,
          motivo: `Pré-Reserva (${metodoPagamento.toUpperCase()}): ${hospede.nome}`,
          contacto: `${hospede.telefone} (${hospede.email})`
        };
        dtAtual.setDate(dtAtual.getDate() + 1);
      }

      await fetch(`${redisUrl}/set/precos_buarcos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(storedData)
      });

      // Guardar registo individual da reserva para o callback confirmar quando for paga
      const registoReserva = {
        orderId,
        apartamento,
        checkin,
        checkout,
        total: valorNumerico,
        metodoPagamento,
        hospede,
        estado: 'pendente',
        criadaEm: new Date().toISOString()
      };

      await fetch(`${redisUrl}/set/reserva_${orderId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(registoReserva)
      });
    }

    // 3. ENVIAR EMAIL DE PRÉ-RESERVA PELO RESEND
    let emailEnviado = false;
    if (resendKey) {
      const nomeApt = apartamento === 'cristal_mar' ? 'Cristal Mar (161145/AL)' : 'Tonay Sol (146454/AL)';
      const formCristalMar = "https://docs.google.com/forms/d/e/1FAIpQLSe3mo6kPf1zrk3d_Sd-LgCeWgnJaetPvMBIUB2lMVLh3MIQyw/viewform?usp=header";
      const formTonaySol = "https://docs.google.com/forms/d/e/1FAIpQLSdIQY4ulOCMwe2u5INgvA8ViHeEy6nXmFHpyadOaGR8C3k62A/viewform?usp=header";
      const linkAimaSef = (apartamento === 'cristal_mar') ? formCristalMar : formTonaySol;

      const blocoMultibanco = dadosPagamento.entidade
        ? `<p style="margin: 5px 0;"><strong>Entidade:</strong> ${dadosPagamento.entidade}</p>
           <p style="margin: 5px 0;"><strong>Referência:</strong> ${dadosPagamento.referencia}</p>`
        : '';

      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
          from: 'Buarcos & Sea <reservas@buarcossea.pt>',
          replyTo: 'buarcossea@gmail.com',
          to: ['buarcossea@gmail.com', hospede.email],
          subject: `Nova Pré-Reserva (${metodoPagamento.toUpperCase()}): ${nomeApt} (${checkin} a ${checkout}) - ${hospede.nome}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #193247;">
              <h2 style="color: #23425c;">Pré-Reserva Registada com Sucesso!</h2>
              <p>Olá <strong>${hospede.nome}</strong>,</p>
              <p>Obrigado por escolher o <strong>Buarcos & Sea Accommodation</strong>. A sua pré-reserva para o <strong>${nomeApt}</strong> foi registada.</p>
              <div style="background-color: #f3f1eb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 5px 0;"><strong>Referência da Reserva:</strong> ${orderId}</p>
                <p style="margin: 5px 0;"><strong>Check-in:</strong> ${checkin}</p>
                <p style="margin: 5px 0;"><strong>Check-out:</strong> ${checkout}</p>
                <p style="margin: 5px 0;"><strong>Hóspedes:</strong> ${adultos} Adultos, ${criancas} Crianças</p>
                <p style="margin: 5px 0;"><strong>Valor Total:</strong> ${total}</p>
                <p style="margin: 5px 0;"><strong>Método de Pagamento:</strong> ${metodoPagamento.toUpperCase()}</p>
                ${blocoMultibanco}
                <p style="color: #b45309; margin-top: 10px;"><strong>⏳ Prazo de Pagamento:</strong> O pagamento expira em <strong>${dataLimiteFormatada}</strong>.</p>
              </div>
              <div style="background-color: #e6f0ef; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0; color: #193247; font-size: 16px;">Registo Obrigatório (AIMA / SEF)</h3>
                <a href="${linkAimaSef}" target="_blank" style="display: inline-block; background-color: #648c88; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 5px; font-size: 13px;">Preencher Formulário de Registo</a>
              </div>
            </div>
          `
        })
      });
      if (emailRes.ok) emailEnviado = true;
    }

    return res.status(200).json({
      success: true,
      orderId,
      emailEnviado,
      expiraEm: dataLimiteFormatada,
      ...dadosPagamento
    });

  } catch (error) {
    console.error('Erro na API reservar:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
