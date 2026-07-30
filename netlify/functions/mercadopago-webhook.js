const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const PRODUCT = {
  id: 'primer-ingreso-online',
  price: 11990,
  currency: 'ARS',
};

const json = (statusCode, payload) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
  body: JSON.stringify(payload),
});

const getHeader = (headers, name) => {
  const target = name.toLowerCase();
  const key = Object.keys(headers || {}).find((item) => item.toLowerCase() === target);
  return key ? String(headers[key]) : '';
};

const parseBody = (event) => {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return {};
  }
};

const getPaymentId = (event, body) =>
  String(event.queryStringParameters?.['data.id'] || body?.data?.id || '').trim();

const validSignature = (event, dataId, secret) => {
  const signature = getHeader(event.headers, 'x-signature');
  const requestId = getHeader(event.headers, 'x-request-id');
  if (!signature || !requestId || !dataId || !secret) return false;

  const parts = Object.fromEntries(
    signature.split(',').map((part) => {
      const [key, ...value] = part.trim().split('=');
      return [key, value.join('=')];
    }),
  );
  if (!parts.ts || !parts.v1 || !/^[a-f0-9]{64}$/i.test(parts.v1)) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(parts.v1, 'hex'));
};

const deliveryEmail = ({ downloadUrl }) => `<!doctype html>
<html lang="es">
<body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a">
  <div style="display:none;max-height:0;overflow:hidden">Tu e-book y bonos ya están listos para descargar.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:32px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border:1px solid #e2e8f0;border-radius:22px;overflow:hidden;box-shadow:0 16px 40px rgba(15,23,42,.08)">
        <tr><td style="padding:38px 40px 28px;background:linear-gradient(135deg,#0f172a,#1e3a8a);color:#fff">
          <div style="font-size:14px;font-weight:700;color:#93c5fd;letter-spacing:.08em;text-transform:uppercase">Primer Ingreso Online</div>
          <h1 style="margin:12px 0 0;font-size:31px;line-height:1.18">¡Tu compra está confirmada!</h1>
        </td></tr>
        <tr><td style="padding:36px 40px">
          <p style="margin:0 0 18px;font-size:17px;line-height:1.7">Gracias por confiar en <strong>Primer Ingreso Online</strong>.</p>
          <p style="margin:0 0 28px;color:#475569;font-size:15px;line-height:1.7">Ya podés descargar la guía completa, el plan de acción y los recursos incluidos. Guardá el archivo en tu dispositivo para consultarlo cuando quieras.</p>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#22c55e">
            <a href="${downloadUrl}" style="display:inline-block;padding:16px 26px;color:#fff;text-decoration:none;font-weight:700;font-size:16px">Descargar e-book y bonos</a>
          </td></tr></table>
          <div style="margin-top:30px;padding:18px 20px;border-radius:14px;background:#eff6ff;color:#1e3a8a;font-size:14px;line-height:1.6">
            <strong>Tu próximo paso:</strong> completá el test de perfil de la guía antes de elegir un modelo de negocio.
          </div>
          <p style="margin:28px 0 0;color:#64748b;font-size:13px;line-height:1.6">Si tenés algún problema con la descarga, respondé este correo y te ayudamos.</p>
        </td></tr>
        <tr><td style="padding:20px 40px;background:#f8fafc;color:#94a3b8;font-size:12px;text-align:center">Primer Ingreso Online · Creado por NGP</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const brevoApiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'nicolaspatullo2@gmail.com';
  const siteUrl = (process.env.URL || 'https://primeringreso.netlify.app').replace(/\/$/, '');

  if (!accessToken || !webhookSecret || !brevoApiKey) {
    console.error('Missing required environment variables');
    return json(500, { error: 'server_not_configured' });
  }

  const body = parseBody(event);
  const paymentId = getPaymentId(event, body);
  const notificationType = String(event.queryStringParameters?.type || body?.type || '');

  if (notificationType && notificationType !== 'payment') {
    return json(200, { ignored: true });
  }

  if (!validSignature(event, paymentId, webhookSecret)) {
    console.warn('Invalid Mercado Pago webhook signature');
    return json(401, { error: 'invalid_signature' });
  }

  try {
    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payment = await paymentResponse.json();

    if (!paymentResponse.ok) {
      console.error('Mercado Pago payment lookup failed', paymentResponse.status, payment);
      return json(502, { error: 'payment_lookup_failed' });
    }

    if (payment.status !== 'approved') {
      return json(200, { ignored: true, reason: 'payment_not_approved' });
    }

    const amount = Number(payment.transaction_amount);
    const reference = String(payment.external_reference || '');
    const productId = String(payment.metadata?.product_id || '');
    const currency = String(payment.currency_id || '');

    if (
      amount !== PRODUCT.price
      || currency !== PRODUCT.currency
      || !reference.startsWith(`${PRODUCT.id}:`)
      || productId !== PRODUCT.id
    ) {
      console.warn('Rejected payment data', { paymentId, amount, currency, reference, productId });
      return json(400, { error: 'payment_data_mismatch' });
    }

    const email = String(payment.metadata?.buyer_email || payment.payer?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      console.error('Approved payment has no delivery email', paymentId);
      return json(422, { error: 'buyer_email_missing' });
    }

    const store = getStore('primer-ingreso-deliveries');
    const reservation = await store.set(
      `payment-${paymentId}`,
      JSON.stringify({ status: 'processing', email, createdAt: new Date().toISOString() }),
      { onlyIfNew: true },
    );

    if (!reservation.modified) {
      return json(200, { delivered: true, duplicate: true });
    }

    const downloadUrl = `${siteUrl}/downloads/Primer_Ingreso_Online_Contenido.zip`;
    const emailResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': brevoApiKey,
      },
      body: JSON.stringify({
        sender: { name: 'Primer Ingreso Online', email: senderEmail },
        to: [{ email }],
        subject: 'Tu e-book Primer Ingreso Online ya está listo',
        htmlContent: deliveryEmail({ downloadUrl }),
        tags: ['compra-primer-ingreso-online'],
      }),
    });
    const emailResult = await emailResponse.json().catch(() => ({}));

    if (!emailResponse.ok) {
      await store.delete(`payment-${paymentId}`);
      console.error('Brevo delivery failed', emailResponse.status, emailResult);
      return json(502, { error: 'email_delivery_failed' });
    }

    await store.set(
      `payment-${paymentId}`,
      JSON.stringify({
        status: 'delivered',
        email,
        messageId: emailResult.messageId || null,
        deliveredAt: new Date().toISOString(),
      }),
    );

    return json(200, { delivered: true });
  } catch (error) {
    console.error('mercadopago-webhook error', error);
    return json(500, { error: 'internal_error' });
  }
};
