// api/chat.js
// Roxy'nin backend'i — Groq API'sine güvenli şekilde bağlanır.
// Gerekirse önce Tavily ile güncel internet bilgisi çeker.
// Anahtarlar burada değil, Vercel'in "Environment Variables" ayarında saklanır.

// Bir mesajın güncel/gerçek dünya bilgisi gerektirip gerektirmediğini
// kaba bir tahminle anlar. Her mesajda arama yapmak ücretsiz kotayı
// gereksiz tüketir, o yüzden sadece "soru gibi" mesajlarda arama yapılır.
function shouldSearch(text) {
  const t = (text || '').toLowerCase();
  const questionHints = [
    '?', 'mı', 'mi', 'mu', 'mü', 'ne zaman', 'kim', 'kaç', 'nedir',
    'var mı', 'açık mı', 'yasak', 'güncel', 'bugün', 'şu an', 'fiyat',
    'kim kazandı', 'hangi', 'nerede', 'kaçıncı'
  ];
  return questionHints.some(h => t.includes(h));
}

async function tavilySearch(query) {
  if (!process.env.TAVILY_API_KEY) return null;
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query,
        max_results: 3
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.results || [];
  } catch (e) {
    console.error('Tavily hatası:', e);
    return null;
  }
}

export default async function handler(req, res) {
  // Herhangi bir siteden (Roxy'nin HTML dosyasından) çağrılabilmesi için
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Tarayıcı, gerçek isteği göndermeden önce bir "preflight" OPTIONS isteği yollar
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Sadece POST isteklerine izin ver
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Sadece POST istekleri kabul edilir.' });
  }

  try {
    const { messages, system } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages alanı gerekli ve dizi olmalı.' });
    }

    const groqMessages = [
      {
        role: 'system',
        content: 'Sen Roxy adında, samimi ve yardımsever bir yapay zeka asistanısın. ' +
          'DİL KURALI: Kullanıcının mesajının BASKIN (ağırlıklı) dilini tespit et ve cevabını SADECE o dilde yaz. ' +
          'Kullanıcı ağırlıklı olarak Türkçe yazıyorsa, cümle içinde tek tük yabancı kelime geçse bile ' +
          '(ör. "happy", "ok", "cool" gibi) sen cevabını tamamen Türkçe ver; o kelimeleri Türkçeye çevirerek kullan, ' +
          'kendi cevabına asla başka dilden kelime karıştırma. ' +
          'Kullanıcı gerçekten başka bir dilde (ör. tamamen İngilizce) yazıyorsa, o zaman cevabını tamamen o dilde ver. ' +
          'Tek bir cevap içinde birden fazla dili asla karıştırma. Cevaplarını kısa ve doğal sohbet diline uygun tut.'
      }
    ];

    // Son kullanıcı mesajı bir soru gibi görünüyorsa, güncel bilgi için
    // Tavily'den arama sonucu çek ve Groq'a ek bağlam olarak ver.
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg && shouldSearch(lastUserMsg.content)) {
      const results = await tavilySearch(lastUserMsg.content);
      if (results && results.length > 0) {
        const contextText = results
          .map((r, i) => `${i + 1}. ${r.title}: ${(r.content || '').slice(0, 300)} (kaynak: ${r.url})`)
          .join('\n');
        groqMessages.push({
          role: 'system',
          content: 'Aşağıda kullanıcının sorusuyla ilgili GÜNCEL internet arama sonuçları var. ' +
            'Cevabını bu sonuçlara dayandır, kendi eski/olası yanlış bilgini kullanma. ' +
            'Sonuçlar birbiriyle çelişiyorsa ya da yetersizse, bunu kullanıcıya açıkça belirt:\n' + contextText
        });
      }
    }

    groqMessages.push(...messages);

    // Mesajlardan herhangi birinde görsel varsa, görsel anlayabilen
    // Groq modeline geç; yoksa normal hızlı metin modelini kullan.
    const hasImage = messages.some(m =>
      Array.isArray(m.content) && m.content.some(part => part.type === 'image_url')
    );
    const modelName = hasImage ? 'qwen/qwen3.6-27b' : 'llama-3.3-70b-versatile';

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY
      },
      body: JSON.stringify({
        model: modelName,
        messages: groqMessages,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Groq hata:', errText);

      // Kota/istek limiti aşıldığında kullanıcıya anlaşılır, nazik bir
      // mesaj göster — bunu normal bir cevap (200) olarak dönüyoruz ki
      // frontend'deki genel hata metnini değil, bu mesajı göstersin.
      if (response.status === 429) {
        return res.status(200).json({
          reply: 'Şu an biraz yoğunum (günlük ücretsiz kullanım sınırına yaklaşıldı) 🙏 Birkaç dakika sonra tekrar dener misin?'
        });
      }

      return res.status(response.status).json({ error: 'Groq API hatası', detail: errText });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content?.trim() || 'Cevap üretilemedi.';

    return res.status(200).json({ reply });
  } catch (err) {
    console.error('Sunucu hatası:', err);
    return res.status(500).json({ error: 'Sunucu hatası oluştu.' });
  }
}

// OPTIONS isteği (tarayıcı ön kontrolü / preflight) için
export const config = {
  api: {
    bodyParser: true
  }
};
