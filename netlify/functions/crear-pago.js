const crypto = require('crypto');

const PRODUCT = {
  id: 'primer-ingreso-online',
  title: 'Primer Ingreso Online',
  description: 'E-book y bonos digitales',
  price: 11990,
  currency: 'ARS',
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const page = (message = '', email = '') => `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Completá tu compra | Primer Ingreso Online</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root{color-scheme:light;--ink:#0f172a;--blue:#2563eb;--green:#22c55e;--muted:#64748b}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;font-family:Poppins,system-ui,sans-serif;color:var(--ink);background:
    radial-gradient(circle at 16% 14%,rgba(37,99,235,.13),transparent 28rem),
    radial-gradient(circle at 88% 80%,rgba(34,197,94,.10),transparent 28rem),#f8fafc}
    .card{width:min(100%,560px);padding:clamp(28px,6vw,52px);background:rgba(255,255,255,.94);border:1px solid rgba(148,163,184,.25);border-radius:28px;box-shadow:0 30px 80px rgba(15,23,42,.14)}
    .brand{font-weight:800;letter-spacing:-.03em;color:var(--blue);font-size:18px}.eyebrow{margin:28px 0 10px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--blue)}
    h1{font-size:clamp(29px,6vw,42px);line-height:1.08;letter-spacing:-.045em;margin:0 0 16px}p{color:var(--muted);line-height:1.7;margin:0}
    label{display:block;margin:28px 0 9px;font-size:14px;font-weight:700}input{width:100%;height:56px;padding:0 17px;border:1.5px solid #cbd5e1;border-radius:14px;font:500 16px Poppins;background:#fff;outline:0;transition:.2s}
    input:focus{border-color:var(--blue);box-shadow:0 0 0 4px rgba(37,99,235,.12)}button{width:100%;min-height:58px;margin-top:14px;border:0;border-radius:14px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;font:700 16px Poppins;cursor:pointer;box-shadow:0 14px 30px rgba(34,197,94,.25);transition:.2s}
    button:hover{transform:translateY(-2px);box-shadow:0 18px 36px rgba(34,197,94,.32)}button:disabled{opacity:.7;cursor:wait;transform:none}.error{margin-top:12px;padding:11px 13px;border-radius:10px;background:#fef2f2;color:#b91c1c;font-size:13px}
    .trust{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:20px;color:#475569;font-size:12px}.back{display:inline-block;margin-top:24px;color:#64748b;text-decoration:none;font-size:13px}.back:hover{color:var(--blue)}
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">Primer Ingreso Online</div>
    <div class="eyebrow">Último paso antes del pago</div>
    <h1>¿A qué correo enviamos tu e-book?</h1>
    <p>Ingresá tu correo para recibir el e-book y los bonos automáticamente cuando Mercado Pago confirme la compra.</p>
    <form method="post" id="checkout-form">
      <label for="email">Correo de entrega</label>
      <input id="email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="tu@email.com" value="${email.replace(/[&<>"']/g, '')}" required>
      ${message ? `<div class="error" role="alert">${message}</div>` : ''}
      <button type="submit">Continuar a Mercado Pago</button>
    </form>
    <div class="trust"><span>✓ Pago seguro</span><span>✓ Acceso inmediato</span><span>✓ Descarga digital</span></div>
    <a class="back" href="/">← Volver a la landing</a>
  </main>
  <script>
    document.getElementById('checkout-form').addEventListener('submit', function () {
      const button = this.querySelector('button');
      button.disabled = true;
      button.textContent = 'Preparando pago seguro…';
    });
  </script>
</body>
</html>`;

const response = (statusCode, body, contentType = 'text/html; charset=utf-8') => ({
  statusCode,
  headers: {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  },
  body,
});

const readEmail = (event) => {
  const contentType = String(event.headers?.['content-type'] || event.headers?.['Content-Type'] || '');
  if (contentType.includes('application/json')) {
    return JSON.parse(event.body || '{}').email;
  }
  return new URLSearchParams(event.body || '').get('email');
};

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') {
    return response(200, page());
  }

  if (event.httpMethod !== 'POST') {
    return response(405, 'Método no permitido.', 'text/plain; charset=utf-8');
  }

  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const siteUrl = (process.env.URL || 'https://primeringreso.netlify.app').replace(/\/$/, '');

  if (!accessToken) {
    return response(500, page('No pudimos iniciar el pago. Por favor, escribinos por WhatsApp.'));
  }

  let email;
  try {
    email = String(readEmail(event) || '').trim().toLowerCase();
  } catch {
    return response(400, page('Ingresá un correo válido.'));
  }

  if (!emailPattern.test(email) || email.length > 254) {
    return response(400, page('Revisá el correo e intentá nuevamente.', email));
  }

  try {
    const orderId = crypto.randomUUID();
    const preferenceResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': orderId,
      },
      body: JSON.stringify({
        items: [{
          id: PRODUCT.id,
          title: PRODUCT.title,
          description: PRODUCT.description,
          quantity: 1,
          currency_id: PRODUCT.currency,
          unit_price: PRODUCT.price,
        }],
        payer: { email },
        metadata: {
          buyer_email: email,
          product_id: PRODUCT.id,
          order_id: orderId,
        },
        external_reference: `${PRODUCT.id}:${orderId}`,
        notification_url: `${siteUrl}/.netlify/functions/mercadopago-webhook?source_news=webhooks`,
        back_urls: {
          success: `${siteUrl}/gracias/`,
          pending: `${siteUrl}/gracias/?estado=pendiente`,
          failure: `${siteUrl}/?pago=fallido`,
        },
        auto_return: 'approved',
      }),
    });

    const data = await preferenceResponse.json();
    if (!preferenceResponse.ok || !data.init_point) {
      console.error('Mercado Pago preference error', preferenceResponse.status, data);
      return response(502, page('Mercado Pago no pudo iniciar la compra. Esperá un momento e intentá otra vez.', email));
    }

    return {
      statusCode: 303,
      headers: {
        Location: data.init_point,
        'Cache-Control': 'no-store',
      },
      body: '',
    };
  } catch (error) {
    console.error('crear-pago error', error);
    return response(500, page('Ocurrió un error inesperado. Intentá nuevamente o escribinos por WhatsApp.', email));
  }
};
