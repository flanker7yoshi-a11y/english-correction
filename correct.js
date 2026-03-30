// api/correct.js  — Vercel Serverless Function
// APIキーはここには書かず、Vercelの環境変数から読み込む

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// レート制限（簡易版：メモリベース。本格運用はKV Storeを使うこと）
const requestLog = new Map();
const RATE_LIMIT = 10;        // 1IPあたり1時間に最大10回
const RATE_WINDOW = 60 * 60 * 1000; // 1時間

function checkRateLimit(ip) {
  const now = Date.now();
  const record = requestLog.get(ip) || { count: 0, start: now };
  if (now - record.start > RATE_WINDOW) {
    requestLog.set(ip, { count: 1, start: now });
    return true;
  }
  if (record.count >= RATE_LIMIT) return false;
  record.count++;
  requestLog.set(ip, record);
  return true;
}

export default async function handler(req, res) {
  // CORS設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // レート制限チェック
  const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: '利用回数の上限に達しました。1時間後にお試しください。' });
  }

  // リクエストボディ検証
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || prompt.length > 5000) {
    return res.status(400).json({ error: '不正なリクエストです。' });
  }

  // 環境変数からAPIキーを取得（絶対にクライアントには渡さない）
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'サーバー設定エラー' });
  }

  try {
    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2500,
          responseMimeType: 'application/json'
        },
        systemInstruction: {
          parts: [{ text: 'あなたはプロの英語教師です。必ず指定のJSON形式のみで返答してください。余分な文字・マークダウン・コードブロックは一切含めないでください。' }]
        }
      })
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.json();
      throw new Error(err?.error?.message || 'Gemini APIエラー');
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);

  } catch (e) {
    console.error('Gemini error:', e.message);
    return res.status(500).json({ error: '添削処理中にエラーが発生しました: ' + e.message });
  }
}
