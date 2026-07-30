exports.handler = async () => {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const siteUrl = process.env.URL || 'https://primeringreso.netlify.app';

  if (!accessToken) {
    return { statusCode: 500, body: 'Falta configurar MERCADOPAGO_ACCESS_TOKEN en Netlify.' };
  }

  try {
    const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{
          id: 'primer-ingreso-online',
          title: 'Primer Ingreso Online',
          description: 'E-book y bonos digitales',
          quantity: 1,
          currency_id: 'ARS',
          unit_price: 11990,
        }],
        external_reference: 'primer-ingreso-online',
        notification_url: `${siteUrl}/.netlify/functions/mercadopago-webhook`,
        back_urls: {
          success: `${siteUrl}/gracias/`,
          pending: `${siteUrl}/gracias/?estado=pendiente`,
          failure: `${siteUrl}/?pago=fallido`,
        },
        auto_return: 'approved',
      }),
    });

    const data = await response.json();
    if (!response.ok || !data.init_point) {
      console.error('Mercado Pago preference error:', data);
      return { statusCode: 502, body: 'No se pudo iniciar el pago. Intentá nuevamente.' };
    }

    return {
      statusCode: 302,
      headers: { Location: data.init_point, 'Cache-Control': 'no-store' },
      body: '',
    };
  } catch (error) {
    console.error(error);
    return { statusCode: 500, body: 'Error al iniciar el pago.' };
  }
};
