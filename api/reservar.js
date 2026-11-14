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

    try {
        if (redisUrl && redisToken) {
            const getRes = await fetch(`${redisUrl}/get/precos_buarcos`, {
                headers: { Authorization: `Bearer ${redisToken}` }
            });
            const getData = await getRes.json();

            let storedData = { data: {}, limpezaGlobal: { cristal_mar: 35, tonay_sol: 35 }, petGlobal: 15 };
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
                    motivo: `Reserva Site - ${hospede.nome}`
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
            
            const emailRes = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${resendKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: 'Buarcos & Sea <onboarding@resend.dev>',
                    to: ['buarcossea@gmail.com'],
                    subject: `Nova Pré-Reserva: ${nomeApt} (${checkin} a ${checkout})`,
                    html: `
                        <h2>Nova Reserva Recebida no Site</h2>
                        <p><strong>Alojamento:</strong> ${nomeApt}</p>
                        <p><strong>Check-in:</strong> ${checkin}</p>
                        <p><strong>Check-out:</strong> ${checkout}</p>
                        <p><strong>Hóspedes:</strong> ${adultos} Adultos, ${criancas} Crianças</p>
                        <p><strong>Valor Total:</strong> ${total}</p>
                        <p><strong>Método Escolhido:</strong> ${metodoPagamento.toUpperCase()}</p>
                        <hr>
                        <h3>Dados do Hóspede</h3>
                        <p><strong>Nome:</strong> ${hospede.nome}</p>
                        <p><strong>Email:</strong> ${hospede.email}</p>
                        <p><strong>Telemóvel:</strong> ${hospede.telefone}</p>
                        <p><strong>País:</strong> ${hospede.pais}</p>
                        <p><strong>NIF:</strong> ${hospede.nif || 'Não indicado'}</p>
                    `
                })
            });

            if (emailRes.ok) emailEnviado = true;
        }

        return res.status(200).json({ 
            success: true, 
            emailEnviado,
            entidade: '11683',
            referencia: Math.floor(100000000 + Math.random() * 900000000).toString().replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3')
        });

    } catch (error) {
        console.error('Erro na API reservar:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

