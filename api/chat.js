// api/chat.js
// Roxy'nin backend'i — Groq API'sine güvenli şekilde bağlanır.
// Anahtar burada değil, Vercel'in "Environment Variables" ayarında saklanır.

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
      },
      ...messages
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.GROQ_API_KEY
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: groqMessages,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Groq hata:', errText);
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
