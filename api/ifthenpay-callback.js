import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  // A ifthenpay envia os callbacks via GET
  if (req.method !== 'GET') {
    return res.status(405).send('Method Not Allowed');
  }

  const { key, id, orderId, amount, status } = req.query;
  const reservaId = id || orderId;

  // 1. Validar se o pedido veio mesmo da ifthenpay através da chave anti-phishing
  if (!key || key !== process.env.IFTHENPAY_ANTI_PHISHING_KEY) {
    console.warn('Tentativa de callback inválida:', req.query);
    return res.status(401).send('Chave anti-phishing inválida');
  }

  if (!reservaId) {
    return res.status(400).send('ID da reserva em falta');
  }

  try {
    // 2. Procurar a reserva pendente no Upstash Redis
    const reservaKey = `reserva:${reservaId}`;
    const reserva = await redis.get(reservaKey);

    if (!reserva) {
      console.warn(`Reserva ${reservaId} não encontrada no Redis.`);
      return res.status(404).send('Reserva não encontrada');
    }

    // 3. Confirmar o pagamento
    if (!status || status.toUpperCase() === 'PAGO' || status.toUpperCase() === 'PAID' || status === '000') {
      reserva.estado = 'PAGO';
      reserva.pagoEm = new Date().toISOString();
      reserva.valorPago = amount || reserva.total;

      await redis.set(reservaKey, reserva);
      console.log(`Pagamento confirmado para a reserva ${reservaId}`);
    }

    // A ifthenpay exige HTTP 200 OK para confirmar a receção
    return res.status(200).send('OK');
  } catch (error) {
    console.error('Erro no processamento do callback:', error);
    return res.status(500).send('Erro interno');
  }
}
