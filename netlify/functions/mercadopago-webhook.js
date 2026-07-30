const PRODUCT_PRICE = 11990;
const PRODUCT_REFERENCE = 'primer-ingreso-online';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 200, body: 'OK' };
  }

  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  const brevoKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'nicolaspatullo2@gmail.com';
  const siteUrl = process.env.URL || 'https://primeringreso.netlify.app';

  if (!accessToken || !brevoKey) {
    console.error('Faltan variables de entorno');
    return { statusCode: 500, body: 'Configuration error' };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const params = event.queryStringParameters || {};
    const paymentId = body?.data?.id || params['data.id'] || params.id;
    const topic = body?.type || params.type || params.topic;

    if (!paymentId || (topic && topic !== 'payment')) {
      return { statusCode: 200, body: 'Ignored' };
    }

    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payment = await paymentResponse.json();

    if (!paymentResponse.ok) {
      console.error('No se pudo consultar el pago:', payment);
      return { statusCode: 200, body: 'Payment not found' };
    }

    const validPayment =
      payment.status === 'approved' &&
      Number(payment.transaction_amount) === PRODUCT_PRICE &&
      payment.external_reference === PRODUCT_REFERENCE;

    if (!validPayment) {
      return { statusCode: 200, body: 'Payment not approved or not matching product' };
    }

    const buyerEmail = payment.payer?.email;
    if (!buyerEmail) {
      console.error('Pago aprobado sin email:', paymentId);
      return { statusCode: 200, body: 'Approved, but no buyer email' };
    }

    const downloadUrl = `${siteUrl}/downloads/Primer_Ingreso_Online_Contenido.zip`;
    const firstName = payment.payer?.first_name || 'Hola';

    const emailResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': brevoKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'Primer Ingreso Online', email: senderEmail },
        to: [{ email: buyerEmail }],
        subject: 'Tu acceso a Primer Ingreso Online',
        htmlContent: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1b1b1b;line-height:1.6">
            <h1 style="font-size:26px">¡Gracias por tu compra!</h1>
            <p>${firstName}, tu pago fue aprobado y el material ya está disponible.</p>
            <p style="margin:28px 0">
              <a href="${downloadUrl}" style="background:#ef4f78;color:#fff;text-decoration:none;padding:14px 22px;border-radius:8px;font-weight:bold;display:inline-block">Descargar el contenido</a>
            </p>
            <p>El archivo incluye el e-book principal, el test de perfil, el checklist, el plan de 30 días y la guía antiestafas.</p>
            <p>Guardá este correo para acceder nuevamente al enlace.</p>
            <p>¿Tenés alguna consulta? Respondé este email o escribinos por WhatsApp al 11 2167-4398.</p>
            <hr style="border:none;border-top:1px solid #eee;margin:28px 0">
            <small>Primer Ingreso Online · Pago ID ${paymentId}</small>
          </div>`,
      }),
    });

    const emailResult = await emailResponse.text();
    if (!emailResponse.ok) {
      console.error('Brevo error:', emailResult);
      return { statusCode: 500, body: 'Email error' };
    }

    console.log(`Entrega enviada a ${buyerEmail} para pago ${paymentId}`);
    return { statusCode: 200, body: 'Delivered' };
  } catch (error) {
    console.error('Webhook error:', error);
    return { statusCode: 500, body: 'Webhook error' };
  }
};
