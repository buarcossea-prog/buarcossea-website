import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: Retornar todos os preços, bloqueios e taxas globais
  if (req.method === 'GET') {
    try {
      const data = await redis.get('buarcos_precos_map') || {};
      const limpezaGlobal = await redis.get('buarcos_limpeza_global') || { cristal_mar: 35, tonay_sol: 35 };
      return res.status(200).json({ success: true, data, limpezaGlobal });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // POST: Atualizar dados (Protegido por PIN)
  if (req.method === 'POST') {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== 'Bearer buarcos2026') {
      return res.status(401).json({ success: false, error: 'Palavra-passe incorreta.' });
    }

    try {
      const body = req.body;

      if (body.acao === 'salvar_limpeza') {
        const limpezaGlobal = {
          cristal_mar: Number(body.limpezaCristal) || 35,
          tonay_sol: Number(body.limpezaTonay) || 35
        };
        await redis.set('buarcos_limpeza_global', limpezaGlobal);
        return res.status(200).json({ success: true });
      }

      // Guardar mapa de preços e bloqueios por datas
      const { alojamento, datas, preco, pet, descontoExtra, bloqueado, nota } = body;
      let mapaAtual = await redis.get('buarcos_precos_map') || {};

      if (!mapaAtual[alojamento]) {
        mapaAtual[alojamento] = {};
      }

      datas.forEach(dataStr => {
        mapaAtual[alojamento][dataStr] = {
          preco: Number(preco),
          pet: Number(pet) || 0,
          descontoExtra: Number(descontoExtra) || 0,
          bloqueado: Boolean(bloqueado),
          nota: nota || ''
        };
      });

      await redis.set('buarcos_precos_map', mapaAtual);
      return res.status(200).json({ success: true });

    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(405).json({ success: false, error: 'Método não permitido' });
}
