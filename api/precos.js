import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();
const ADMIN_PIN = process.env.ADMIN_PIN || "buarcos2026";

export default async function handler(req, res) {
  // Configuração CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: Obter mapa de preços e bloqueios
  if (req.method === 'GET') {
    try {
      const precos = await redis.get('alojamento_precos_diarios') || {};
      return res.status(200).json({ success: true, data: precos });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // POST: Guardar novos preços ou bloqueios (Requer PIN no Header)
  if (req.method === 'POST') {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${ADMIN_PIN}`) {
      return res.status(401).json({ success: false, error: 'Acesso não autorizado.' });
    }

    try {
      const { alojamento, datas, preco, bloqueado } = req.body;
      // datas = array de strings YYYY-MM-DD
      
      let mapaAtual = (await redis.get('alojamento_precos_diarios')) || {};

      if (!mapaAtual[alojamento]) {
        mapaAtual[alojamento] = {};
      }

      datas.forEach(dataStr => {
        mapaAtual[alojamento][dataStr] = {
          preco: Number(preco),
          bloqueado: Boolean(bloqueado)
        };
      });

      await redis.set('alojamento_precos_diarios', mapaAtual);

      return res.status(200).json({ success: true, data: mapaAtual });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  return res.status(405).json({ error: 'Método não permitido' });
}

