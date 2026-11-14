export default async function handler(req, res) {
    const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!redisUrl || !redisToken) {
        return res.status(500).json({ success: false, error: 'Redis não configurado' });
    }

    // Impede cache do navegador para que o calendário esteja sempre atualizado
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    if (req.method === 'GET') {
        try {
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

            // VERIFICAÇÃO AUTOMÁTICA DE EXPIRAÇÃO (24H)
            const agora = Date.now();
            let houveAlteracao = false;

            Object.keys(storedData.data || {}).forEach(apt => {
                Object.keys(storedData.data[apt] || {}).forEach(dataStr => {
                    const diaInfo = storedData.data[apt][dataStr];
                    if (
                        diaInfo &&
                        diaInfo.bloqueado &&
                        diaInfo.estadoPagamento === 'pendente' &&
                        diaInfo.expiraEm &&
                        agora > diaInfo.expiraEm
                    ) {
                        // O prazo de 24h expirou sem pagamento: liberta a data!
                        delete diaInfo.bloqueado;
                        delete diaInfo.estadoPagamento;
                        delete diaInfo.expiraEm;
                        delete diaInfo.motivo;
                        houveAlteracao = true;
                    }
                });
            });

            // Se alguma data expirou e foi libertada, grava a atualização no Redis
            if (houveAlteracao) {
                await fetch(`${redisUrl}/set/precos_buarcos`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${redisToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(storedData)
                });
            }

            return res.status(200).json({
                success: true,
                data: storedData.data || {},
                limpezaGlobal: storedData.limpezaGlobal || { cristal_mar: 35, tonay_sol: 35 },
                petGlobal: storedData.petGlobal !== undefined ? storedData.petGlobal : 15
            });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    if (req.method === 'POST') {
        try {
            const body = req.body;
            await fetch(`${redisUrl}/set/precos_buarcos`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${redisToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            return res.status(200).json({ success: true });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    }

    return res.status(405).json({ success: false, error: 'Método não permitido' });
}
