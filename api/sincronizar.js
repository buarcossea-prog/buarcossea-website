export default async function handler(req, res) {
    const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!redisUrl || !redisToken) {
        return res.status(500).json({ success: false, error: 'Configuração do Redis em falta' });
    }

    const linksCanais = {
        cristal_mar: [
            "https://www.airbnb.com/calendar/ical/1357310302657236052.ics?t=dee07350f32b440c84ea7a435852ce1a&locale=pt-PT",
            "https://ical.booking.com/v1/export?t=65bbe889-665e-4ba9-b27f-f7d565f9052d"
        ],
        tonay_sol: [
            "https://www.airbnb.com/calendar/ical/913697094754040454.ics?t=4fcdaae84b2740699596375f71e0b5e2&locale=pt-PT",
            "https://ical.booking.com/v1/export?t=4e97733e-08c0-49af-bb24-566c40dc55c0"
        ]
    };

    try {
        const getRes = await fetch(`${redisUrl}/get/precos_buarcos`, {
            headers: { Authorization: `Bearer ${redisToken}` }
        });
        const getData = await getRes.json();

        let storedData = { data: {}, limpezaGlobal: { cristal_mar: 35, tonay_sol: 35 }, petGlobal: 15 };
        if (getData && getData.result) {
            const parsed = typeof getData.result === 'string' ? JSON.parse(getData.result) : getData.result;
            if (parsed.data) storedData = parsed;
            else storedData.data = parsed;
        }

        for (const [apt, urls] of Object.entries(linksCanais)) {
            if (!urls || urls.length === 0) continue;
            if (!storedData.data[apt]) storedData.data[apt] = {};

            for (const url of urls) {
                try {
                    const icallRes = await fetch(url);
                    const icallText = await icallRes.text();

                    const eventos = icallText.split('BEGIN:VEVENT');
                    for (const ev of eventos) {
                        const startMatch = ev.match(/DTSTART(?:;VALUE=DATE)?:([0-9]{8})/);
                        const endMatch = ev.match(/DTEND(?:;VALUE=DATE)?:([0-9]{8})/);
                        const summaryMatch = ev.match(/SUMMARY:(.*?)(?:\r\n|\n|\r)/);

                        if (startMatch && endMatch) {
                            let dStart = parseIcalDate(startMatch[1]);
                            let dEnd = parseIcalDate(endMatch[1]);
                            let origemNome = summaryMatch ? summaryMatch[1].trim() : 'Canal Externo (Airbnb/Booking)';

                            let dtAtual = new Date(dStart);
                            let dtFim = new Date(dEnd);

                            while (dtAtual < dtFim) {
                                const ano = dtAtual.getFullYear();
                                const mes = String(dtAtual.getMonth() + 1).padStart(2, '0');
                                const dia = String(dtAtual.getDate()).padStart(2, '0');
                                const dataStr = `${ano}-${mes}-${dia}`;

                                if (!storedData.data[apt][dataStr] || !storedData.data[apt][dataStr].bloqueado) {
                                    storedData.data[apt][dataStr] = {
                                        ...(storedData.data[apt][dataStr] || {}),
                                        bloqueado: true,
                                        motivo: origemNome,
                                        contacto: 'Sincronizado via iCal'
                                    };
                                }

                                dtAtual.setDate(dtAtual.getDate() + 1);
                            }
                        }
                    }
                } catch (errIcal) {
                    console.error(`Erro ao ler iCal para ${apt}:`, errIcal);
                }
            }
        }

        await fetch(`${redisUrl}/set/precos_buarcos`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${redisToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(storedData)
        });

        return res.status(200).json({ success: true, message: 'Sincronização de canais concluída com sucesso!' });

    } catch (error) {
        console.error('Erro na sincronização:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
}

function parseIcalDate(str8) {
    const ano = str8.substring(0, 4);
    const mes = str8.substring(4, 6);
    const dia = str8.substring(6, 8);
    return `${ano}-${mes}-${dia}T00:00:00`;
}
