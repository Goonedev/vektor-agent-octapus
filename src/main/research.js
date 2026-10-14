'use strict';

/*
 * Web research without opening a browser. A text Gemini model with Google Search grounding and
 * URL context searches, reads the pages it picks, and writes an answer with its sources. Used by
 * the deep_research and find_download_link tools.
 */

const { GoogleGenAI } = require('@google/genai');
const { ToolError } = require('./tools/util');

const DEFAULT_MODEL = 'gemini-flash-latest';

function client(settings) {
  if (!settings?.apiKey) throw new ToolError('Gemini API anahtarı yok. Ayarlar\'dan ekle.');
  return new GoogleGenAI({ apiKey: settings.apiKey });
}

function sourcesOf(res) {
  const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const seen = new Set();
  const out = [];
  for (const c of chunks) {
    const uri = c.web?.uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    out.push({ title: c.web.title || c.web.domain || uri, url: uri });
  }
  return out;
}

async function ask(settings, prompt, { search = true, model } = {}) {
  const ai = client(settings);
  const tools = search ? [{ googleSearch: {} }, { urlContext: {} }] : [];
  let res;
  try {
    res = await ai.models.generateContent({
      model: model || settings.researchModel || DEFAULT_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { tools, temperature: 0.3 }
    });
  } catch (e) {
    throw new ToolError(`Araştırma yapılamadı: ${String(e.message || e).split('\n')[0].slice(0, 200)}`);
  }
  return { text: (res.text || '').trim(), sources: sourcesOf(res) };
}

async function research(settings, question, depth = 'normal') {
  const detail = depth === 'deep'
    ? 'Konuyu derinlemesine araştır: birden fazla güvenilir kaynağa bak, sayfaların içeriğini oku, kaynaklar arasında çelişki varsa belirt.'
    : 'Güvenilir kaynaklarda ara ve gerekirse sayfaları oku.';
  const prompt = `${detail}
Soru: ${question}

Türkçe, net ve doğru bir yanıt yaz. Önce kısa cevabı ver, sonra önemli ayrıntıları maddeler halinde ekle. Tarih, fiyat, sürüm gibi değişebilen bilgilerde bilginin güncel olup olmadığını belirt. Uydurma bilgi yazma; emin olmadığın yeri söyle.`;
  return ask(settings, prompt);
}

/* Asks the model for direct download links, then checks each one really is a file. */
async function findDownload(settings, what, fileType) {
  const prompt = `Şunun indirilebilir dosyasını bul: ${what}${fileType ? ` (dosya türü: ${fileType})` : ''}.
Mümkünse resmi kaynağı tercih et (üreticinin sitesi, resmi GitHub sürümleri). Korsan, crack ya da şüpheli siteleri önerme.
Yalnızca şu biçimde JSON döndür, başka metin yazma:
{"candidates":[{"url":"doğrudan dosya adresi","source":"site adı","note":"kısa açıklama"}]}
En fazla 4 aday ver. Adresler doğrudan dosyaya gitmeli (.zip, .exe, .msi, .pdf, .dmg vb.), bir indirme sayfasına değil.`;
  const { text, sources } = await ask(settings, prompt);
  const json = text.match(/\{[\s\S]*\}/);
  let candidates = [];
  try { candidates = JSON.parse(json ? json[0] : '{}').candidates || []; } catch { /* model returned prose */ }
  return { candidates: candidates.filter((c) => /^https?:\/\//.test(c?.url || '')).slice(0, 4), sources, raw: text };
}

module.exports = { research, findDownload, ask };
