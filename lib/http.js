const DEFAULT_BODY_LIMIT = 1024 * 1024;

function setNoStore(res) {
  res.setHeader('Cache-Control', 'no-store');
}

function methodNotAllowed(res, allowedMethods) {
  res.setHeader('Allow', allowedMethods.join(', '));
  return res.status(405).json({ error: 'Method not allowed' });
}

async function readJsonBody(req, limitBytes = DEFAULT_BODY_LIMIT) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;

    const existing = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    if (Buffer.byteLength(existing) > limitBytes) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
    return existing ? JSON.parse(existing) : {};
  }

  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > limitBytes) {
      const error = new Error('Request body is too large');
      error.statusCode = 413;
      throw error;
    }
  }

  return body ? JSON.parse(body) : {};
}

function sendHandlerError(res, error, fallback = 'Server error') {
  if (error instanceof SyntaxError) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (error?.statusCode === 413) {
    return res.status(413).json({ error: error.message });
  }
  return res.status(500).json({ error: fallback });
}

module.exports = { methodNotAllowed, readJsonBody, sendHandlerError, setNoStore };
