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

    // MB WAY expira em 5 min; Multibanco / outros em 24h
    const minutosValidade = metodoPagamento === 'mbway' ? 5 : 24 * 60;
    const agora = Date.now();
    const expiraEm = agora + (minutosValidade * 60 * 1000);
    const dataLimiteFormatada = new Date(expiraEm).toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' });

    try {
        if (redisUrl && redisToken) {
            const getRes = await fetch(`${redisUrl}/get/precos_buarcos`, {
                headers: { Authorization: `Bearer ${redisToken}` }
            });
            const getData = await getRes.json();

            let storedData = { data: {}, limpezaGlobal: { cristal_mar: 35, tonay_sol: 35 }, petGlobal: 15, regrasEstadia: { base: 2, junho: 4, alta: 7 } };
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
                    expiraEm: expiraEm,
                    motivo: `Pré-Reserva (${metodoPagamento.toUpperCase()}): ${hospede.nome}`,
                    contacto: `${hospede.telefone} (${hospede.email})`
                };

                dtAtual.setDate(dtAtual.getDate() + 1);
            }

            await fetch(`${redisUrl}/set/precos_buarcos`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${redisToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(storedData)
            });
        }

        let emailEnviado = false;
        if (resendKey) {
            const nomeApt = apartamento === 'cristal_mar' ? 'Cristal Mar (161145/AL)' : 'Tonay Sol (146454/AL)';
            const formCristalMar = "https://docs.google.com/forms/d/e/1FAIpQLSe3mo6kPf1zrk3d_Sd-LgCeWgnJaetPvMBIUB2lMVLh3MIQyw/viewform?usp=header";
            const formTonaySol = "https://docs.google.com/forms/d/e/1FAIpQLSdIQY4ulOCMwe2u5INgvA8ViHeEy6nXmFHpyadOaGR8C3k62A/viewform?usp=header";
            const linkAimaSef = (apartamento === 'cristal_mar') ? formCristalMar : formTonaySol;

            const emailRes = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${resendKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: 'Buarcos & Sea <onboarding@resend.dev>',
                    to: ['buarcossea@gmail.com', hospede.email],
                    subject: `Nova Pré-Reserva (${metodoPagamento.toUpperCase()}): ${nomeApt} (${checkin} a ${checkout}) - ${hospede.nome}`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #193247;">
                            <h2 style="color: #23425c;">Pré-Reserva Registada com Sucesso!</h2>
                            <p>Olá <strong>${hospede.nome}</strong>,</p>
                            <p>Obrigado por escolher o <strong>Buarcos & Sea Accommodation</strong>. A sua pré-reserva para o <strong>${nomeApt}</strong> foi registada.</p>
                            
                            <div style="background-color: #f3f1eb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                                <p style="margin: 5px 0;"><strong>Check-in:</strong> ${checkin}</p>
                                <p style="margin: 5px 0;"><strong>Check-out:</strong> ${checkout}</p>
                                <p style="margin: 5px 0;"><strong>Hóspedes:</strong> ${adultos} Adultos, ${criancas} Crianças</p>
                                <p style="margin: 5px 0;"><strong>Valor Total:</strong> ${total}</p>
                                <p style="margin: 5px 0;"><strong>Método de Pagamento:</strong> ${metodoPagamento.toUpperCase()}</p>
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
            emailEnviado,
            expiraEm: dataLimiteFormatada,
            entidade: '11683',
            referencia: Math.floor(100000000 + Math.random() * 900000000).toString().replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')
        });

    } catch (error) {
        console.error('Erro na API reservar:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}
