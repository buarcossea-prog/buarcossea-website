export default async function handler(req, res) {
    const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

    const { apt } = req.query; // Ex: /api/ical?apt=tonay_sol ou /api/ical?apt=cristal_mar

    if (!apt || (apt !== 'cristal_mar' && apt !== 'tonay_sol')) {
        return res.status(400).send('Apartamento inválido ou não especificado.');
    }

    if (!redisUrl || !redisToken) {
        return res.status(500).send('Configuração do Redis em falta.');
    }

    try {
        const getRes = await fetch(`${redisUrl}/get/precos_buarcos`, {
            headers: { Authorization: `Bearer ${redisToken}` }
        });
        const getData = await getRes.json();

        let storedData = {};
        if (getData && getData.result) {
            const parsed = typeof getData.result === 'string' ? JSON.parse(getData.result) : getData.result;
            storedData = parsed.data ? parsed.data : parsed;
        }

        const datasApt = storedData[apt] || {};

        // Construir o ficheiro iCal (.ics)
        let icsContent = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Buarcos & Sea Accommodation//NAG//PT',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH'
        ];

        // Agrupar dias bloqueados consecutivos para criar eventos limpos
        const diasBloqueados = Object.keys(datasApt)
            .filter(dataStr => datasApt[dataStr] && datasApt[dataStr].bloqueado)
            .sort();

        let i = 0;
        while (i < diasBloqueados.length) {
            let inicio = diasBloqueados[i];
            let fim = inicio;
            
            let dt = new Date(inicio + 'T00:00:00');
            
            // Encontrar o fim do período consecutivo
            while (i + 1 < diasBloqueados.length) {
                let proximaDt = new Date(diasBloqueados[i + 1] + 'T00:00:00');
                dt.setDate(dt.getDate() + 1);
                
                if (proximaDt.getTime() === dt.getTime()) {
                    fim = diasBloqueados[i + 1];
                    i++;
                } else {
                    break;
                }
            }

            // Para o iCal, a data de fim do evento deve ser o dia seguinte ao último dia bloqueado
            let dtFimEvento = new Date(fim + 'T00:00:00');
            dtFimEvento.setDate(dtFimEvento.getDate() + 1);
            
            const startStr = inicio.replace(/-/g, '');
            const endStr = formatarDataIcal(dtFimEvento);

            icsContent.push('BEGIN:VEVENT');
            icsContent.push(`UID:block-${inicio}-${fim}@buarcossea.pt`);
            icsContent.push(`DTSTAMP:${formatarDataIcal(new Date())}Z`);
            icsContent.push(`DTSTART;VALUE=DATE:${startStr}`);
            icsContent.push(`DTEND;VALUE=DATE:${endStr}`);
            icsContent.push(`SUMMARY:Reservado - Buarcos & Sea`);
            icsContent.push('END:VEVENT');

            i++;
        }

        icsContent.push('END:VCALENDAR');

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${apt}.ics"`);
        return res.status(200).send(icsContent.join('\r\n'));

    } catch (error) {
        console.error('Erro ao gerar iCal:', error);
        return res.status(500).send('Erro interno ao gerar o calendário.');
    }
}

function formatarDataIcal(dateObj) {
    const ano = dateObj.getFullYear();
    const mes = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dia = String(dateObj.getDate()).padStart(2, '0');
    return `${ano}${mes}${dia}`;
}
