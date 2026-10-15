// The Gemini Live session: streams the microphone up, plays the model's voice back,
// runs function calls through the main process and reports one "phase" for the UI.

import { GoogleGenAI, Modality } from '@google/genai';
import { Microphone, Player, bytesToBase64 } from './audio.js';

export const MODELS = [
  { id: 'gemini-3.1-flash-live-preview', label: 'Gemini 3.1 Flash Live' },
  { id: 'gemini-2.5-flash-native-audio-latest', label: 'Gemini 2.5 Flash Native Audio' },
  { id: 'gemini-live-2.5-flash-preview', label: 'Gemini Live 2.5 Flash (yarı çift yönlü)' }
];

const CONTROL_TOKEN = /<ctrl\d+>/i;
const stripControl = (t) => t.replace(/<ctrl\d+>/gi, '');

export const VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr', 'Sulafat', 'Achird'];

function systemPrompt(settings, info, packIndex = '', mind = {}) {
  const now = new Date();
  const os = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[info.platform] || info.platform;
  return `Sen Vektör'sün: kullanıcının ${os} bilgisayarında yaşayan, sesle konuşulan bir yapay zekâ asistanısın.

Nasıl konuşursun:
- Kullanıcının dilinde (varsayılan Türkçe) kısa, sıcak ve doğal konuş; gerçek bir insan asistan gibi. Madde işareti, markdown ya da emoji kullanma; her şey sesli okunacak.
- Bir işi yapmadan önce uzun uzun anlatma. Hemen ilgili aracı çağır, sonra sonucu tek iki cümleyle söyle.
- Araç çalışırken sessiz kalabilirsin; arayüz kullanıcıya canlı bir kart gösteriyor. Kartta görünen uzun listeleri tek tek okuma, özetle.

Araçlar:
- Bilgisayarı gerçekten yönetebilirsin: uygulama açma/kapama, web, dosyalar, ses, parlaklık, pencere, klavye/fare, pano, ekran görüntüsü, zamanlayıcı, not, hava durumu, döviz ve daha fazlası. Kullanıcı bir şey istediğinde aracı kullan.
- Doğrudan tanımlı araçların dışında yaklaşık 460 araçlık bir kütüphanen daha var (aşağıda listelendi): Windows ayar sayfaları, klasik sistem araçları, 100 site ve site içi arama, kısayollar, metin ve hesap araçları, bilgi servisleri, sistem bilgisi, geliştirici ve dosya araçları. Bunları use_tool ile adıyla çalıştırırsın (args_json'a parametreleri JSON olarak yaz). Parametrelerinden emin değilsen önce find_tools ile ara; o sana parametreleri de verir.

"Yapamam" deme, yol ara:
- Bir isteği karşılayan doğrudan bir araç yoksa sırayla şunları dene: 1) kütüphanedeki listeye bak ya da find_tools ile ara; 2) bulamazsan find_a_way ile işin nasıl yapıldığını araştır ve dönen planı run_steps ya da use_tool ile uygula; 3) gerekiyorsa araçları birleştir (open_app + press_keys + type_text + click_button gibi).
- Bir adım başarısız olursa hatayı oku ve başka bir yoldan dene (farklı araç, farklı düğme adı, kısayol, ayar sayfası). Ancak gerçekten denediğin yollar tükendiyse ne denediğini kısaca söyle ve kullanıcının elle yapabileceği en yakın yolu anlat.
- Kullanıcı bir onayı reddederse o işi başka bir yoldan zorlamaya çalışma; reddi kabul et ve ne istediğini sor. Güvenlik korumalarını kapatma, lisans/ödeme atlatma ya da başkasının hesabına erişme gibi işler için yol arama.
- İşi yarım bırakma, sonuna kadar götür. Gerekirse birkaç aracı art arda çağır. Örnekler: "şarkı aç" → play_youtube (arama sayfasında bırakma, videoyu oynat); "Steam'den X'i indir" → steam_install; "X oyununu aç" → steam_launch; "şu projede şunu düzelt" → ask_claude_code. Bir araç başarısız olursa başka bir yoldan dene.
- Çoğu iş bir onay/kurulum penceresiyle biter ("Yükle", "İndir", "Kaydet", "Tamam", "Evet", "İleri"). Bu pencerelerde işi bitirmek için click_button aracını o düğmenin adıyla çağır; arama sayfasında ya da açık pencerede bırakma. Hangi düğmelerin olduğundan emin değilsen önce list_buttons ile bak. click_button her uygulamada çalışır, sadece Steam'de değil.
- Güncel, çok kaynaklı ya da araştırma gerektiren sorularda (fiyat, hava durumu dışındaki karşılaştırmalar, "en iyi X", haber, teknik bilgi) deep_research kullan; tarayıcı açmadan web'de araştırır. Hava durumu için get_weather yeterli.
- Kullanıcı bir dosya/program indirmek isterse önce find_download_link ile araştır, bulduğun bağlantıyı kullanıcıya söyle, onaylarsa download_from_web ile indir. Korsan/crack kaynak önerme.
- Çok adımlı işlerde araçları zincirle: birden fazla aracı, gerekirse aynı aracı birkaç kez çağırabilirsin. Adımları önceden biliyorsan run_steps ile tek planda sırayla yaptır (aç → bekle → bas → bildir gibi; pencere açılması gerekiyorsa wait_ms ver). Bir sonraki adım önceki sonuca bağlıysa araçları tek tek çağır, her sonucu oku ve iş bitene kadar devam et.
- Her araç sonucundan sonra kendine sor: istek tamamen bitti mi? Bitmediyse bir sonraki aracı çağır; bittiyse kısaca söyle.
- Sadece kullanıcının istediği işi yap; kendi kafana göre yeni görevler başlatma.
- Tehlikeli işlemlerde (silme, kapatma, komut çalıştırma) arayüz zaten onay penceresi açar; ayrıca sözlü onay isteme. Kullanıcı reddederse kibarca kabul et.
- Hesaplama ve birim/döviz çevirisini tahmin etme; calculate, convert_units ya da convert_currency kullan.
- Kullanıcı ekranındaki bir şeyi sorarsa ("bu ne", "ekranımda ne var", "şu hatayı oku") take_screenshot'ı look=true ile çağır ve gördüğünü anlat.
- Dosya yollarında "masaüstü", "indirilenler", "belgeler", "resimler" takma adlarını kullanabilirsin.
- Bir araç hata verirse nedenini sade bir dille söyle ve varsa alternatif öner.

Hafıza, beceriler ve geçmiş:
- Kullanıcı kalıcı bir tercih ya da kendisiyle ilgili bir bilgi söylerse ("adım…", "bundan sonra…", "bunu hatırla") remember ile kaydet; "unut" derse forget kullan. Şifre, kart numarası, anahtar gibi gizli bilgileri asla kaydetme.
- Kullanıcı bir rutini adlandırıp kaydetmek isterse ("bunu çalışma modu olarak kaydet") adımları kur ve skill_save ile kaydet. Kayıtlı bir becerinin adını söylerse skill_run ile çalıştır.
- Eski konuşmalarla ilgili sorularda ("dün ne konuşmuştuk?") search_history kullan.
${mind.memory?.length ? `\nKullanıcı hakkında hatırladıkların (kullan ama her seferinde tekrarlama):\n${mind.memory.map((m) => `- ${m.text}`).join('\n')}\n` : ''}${mind.skills?.length ? `\nKayıtlı beceriler (adı söylenince skill_run): ${mind.skills.map((k) => `${k.name}${k.description ? ` (${k.description})` : ''}`).join('; ')}\n` : ''}${mind.recent?.length ? `\nÖnceki oturumun son mesajları (bağlam için; kullanıcı devam etmek isterse kullan):\n${mind.recent.map((e) => `${e.role === 'user' ? 'Kullanıcı' : 'Sen'}: ${e.text.slice(0, 200)}`).join('\n')}\n` : ''}
Kütüphane (use_tool ile adıyla çalıştır):
${packIndex}

Bağlam: Bugün ${now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, saat ${now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}. Saat dilimi ${Intl.DateTimeFormat().resolvedOptions().timeZone}.
${settings.persona ? `\nKullanıcının senden isteği:\n${settings.persona}` : ''}`;
}

export class LiveAgent extends EventTarget {
  constructor() {
    super();
    this.session = null;
    this.mic = new Microphone();
    this.player = new Player();
    this.phase = 'offline';
    this.connected = false;
    this.wantMic = false;
    this.userClosed = false;
    this.resumeHandle = null;
    this.retries = 0;
    this.pendingTools = 0;
    this.userText = '';
    this.modelText = '';
    this.lastHeard = 0;
    this.mic.onChunk = (pcm) => this.sendAudio(pcm);
    this.tick = this.tick.bind(this);
    this.ticker = setInterval(this.tick, 60);
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  setPhase(phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.emit('phase', phase);
  }

  /** Works out the visible phase from what is actually happening right now. */
  tick() {
    if (!this.connected) return;
    if (this.awaitingConfirm) return this.setPhase('confirm');
    if (this.pendingTools > 0) return this.setPhase('tool');
    if (this.player.playing) return this.setPhase('speaking');
    if (this.mic.active && this.mic.level > 0.18) this.lastHeard = performance.now();
    if (this.mic.active && performance.now() - this.lastHeard < 450) return this.setPhase('hearing');
    if (this.thinking) return this.setPhase('thinking');
    this.setPhase(this.mic.active ? 'listening' : 'idle');
  }

  get level() {
    if (this.phase === 'speaking') return this.player.level;
    if (this.mic.active) return this.mic.level;
    return 0;
  }

  async connect(settings, info) {
    if (this.session || this.phase === 'connecting') return;
    if (!settings.apiKey) {
      this.emit('error', { message: 'Gemini API anahtarı yok. Ayarlar\'dan ekle.', code: 'no-key' });
      return;
    }
    this.userClosed = false;
    this.setPhase('connecting');
    const [declarations, packIndex, memory, skills, recent] = await Promise.all([
      window.vektor.tools.declarations(), window.vektor.tools.packIndex(),
      window.vektor.store.get('memory'), window.vektor.store.get('skills'),
      this.resumeHandle ? [] : window.vektor.history.recent(10)
    ]);
    const mind = { memory: (memory || []).slice(-60), skills: skills || [], recent: recent || [] };
    const ai = new GoogleGenAI({ apiKey: settings.apiKey });
    const config = {
      responseModalities: [Modality.AUDIO],
      systemInstruction: { parts: [{ text: systemPrompt(settings, info, packIndex, mind) }] },
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: settings.voice || 'Kore' } } },
      tools: [{ functionDeclarations: declarations }],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: this.resumeHandle ? { handle: this.resumeHandle } : {}
    };
    try {
      this.session = await ai.live.connect({
        model: settings.model,
        config,
        callbacks: {
          onopen: () => {},
          onmessage: (m) => this.onMessage(m),
          onerror: (e) => this.emit('error', { message: e?.message || 'Bağlantı hatası.' }),
          onclose: (e) => this.onClose(e, settings, info)
        }
      });
      this.connected = true;
      this.retries = 0;
      this.emit('connected', { model: settings.model, resumed: !!this.resumeHandle });
      if (this.wantMic) await this.startMic();
      this.tick();
    } catch (e) {
      this.session = null;
      this.setPhase('error');
      this.emit('error', { message: humanError(e?.message || String(e)) });
    }
  }

  onClose(e, settings, info) {
    const wasConnected = this.connected;
    this.session = null;
    this.connected = false;
    this.player.stop();
    if (this.userClosed) {
      this.setPhase('offline');
      return;
    }
    const reason = e?.reason || '';
    // Policy/auth failures will not fix themselves; anything else gets a resumed retry.
    if (/api key|permission|not found|unsupported|invalid/i.test(reason) || (e?.code === 1008 && !wasConnected)) {
      this.setPhase('error');
      this.emit('error', { message: humanError(reason) });
      this.mic.stop();
      return;
    }
    if (this.retries < 5) {
      const wait = Math.min(8000, 600 * 2 ** this.retries++);
      this.setPhase('connecting');
      this.emit('reconnecting', { wait, reason });
      setTimeout(() => !this.userClosed && this.connect(settings, info), wait);
    } else {
      this.setPhase('error');
      this.emit('error', { message: `Bağlantı koptu${reason ? `: ${reason}` : ''}.` });
      this.mic.stop();
    }
  }

  disconnect() {
    this.userClosed = true;
    this.wantMic = false;
    this.mic.stop();
    this.player.stop();
    try { this.session?.close(); } catch { /* already closed */ }
    this.session = null;
    this.connected = false;
    this.resumeHandle = null;
    this.setPhase('offline');
    this.emit('disconnected');
  }

  async startMic() {
    this.wantMic = true;
    if (!this.connected) return;
    try {
      await this.mic.start();
      this.emit('mic', true);
    } catch (e) {
      this.wantMic = false;
      this.emit('error', { message: 'Mikrofona erişilemedi. Sistem ayarlarından izin ver.' });
    }
  }

  stopMic() {
    this.wantMic = false;
    if (this.mic.active) {
      this.mic.stop();
      try { this.session?.sendRealtimeInput({ audioStreamEnd: true }); } catch { /* closed */ }
    }
    this.emit('mic', false);
  }

  sendAudio(pcm) {
    if (!this.session || !this.connected) return;
    try {
      this.session.sendRealtimeInput({ audio: { data: bytesToBase64(pcm), mimeType: 'audio/pcm;rate=16000' } });
    } catch { /* socket closing; onclose handles it */ }
  }

  sendText(text) {
    if (!this.session) return false;
    this.retriedTurn = false;
    this.player.stop();
    this.thinking = true;
    this.session.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true });
    return true;
  }

  /** Tells the model about something that happened without the user speaking (a timer firing). */
  sendEvent(text) {
    if (!this.session) return false;
    this.session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: `[Sistem olayı] ${text}` }] }], turnComplete: true });
    return true;
  }

  interrupt() {
    this.player.stop();
  }

  onMessage(m) {
    // Gemini sometimes leaks internal control tokens such as <ctrl46> into the transcript,
    // typically when a tool call came out malformed. They are never meant for the user.
    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle) {
      this.resumeHandle = m.sessionResumptionUpdate.newHandle;
    }
    if (m.goAway) this.emit('notice', { message: 'Oturum yenileniyor…' });

    const sc = m.serverContent;
    if (sc) {
      if (sc.interrupted) {
        this.player.stop();
        this.flushModel(true);
      }
      if (sc.inputTranscription?.text) {
        this.retriedTurn = false;
        this.userText += sc.inputTranscription.text;
        this.thinking = true;
        this.emit('user-text', { text: this.userText.trim(), final: false });
      }
      for (const part of sc.modelTurn?.parts || []) {
        if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio')) {
          this.turnHadAudio = true;
          this.thinking = false;
          this.player.enqueue(part.inlineData.data);
        }
      }
      if (sc.outputTranscription?.text) {
        if (this.userText) this.flushUser();
        this.thinking = false;
        const raw = sc.outputTranscription.text;
        if (CONTROL_TOKEN.test(raw)) this.turnHadControlTokens = true;
        this.modelText += stripControl(raw);
        if (this.modelText.trim()) this.emit('model-text', { text: this.modelText.trim(), final: false });
      }
      if (sc.turnComplete || sc.generationComplete) {
        this.thinking = false;
        this.flushUser();
        if (sc.turnComplete) {
          const broken = this.turnHadControlTokens && !this.modelText.trim() && !this.turnHadTool;
          this.flushModel(false);
          if (broken) this.retryBrokenTurn();
          this.turnHadControlTokens = this.turnHadAudio = this.turnHadTool = false;
        }
      }
    }

    if (m.toolCall?.functionCalls?.length) {
      this.turnHadTool = true;
      this.runTools(m.toolCall.functionCalls);
    }
    if (m.toolCallCancellation?.ids) this.emit('tool-cancel', { ids: m.toolCallCancellation.ids });
  }

  /** A turn that produced only control tokens: ask the model once to answer properly. */
  retryBrokenTurn() {
    if (this.retriedTurn || !this.session) return;
    this.retriedTurn = true;
    this.thinking = true;
    this.emit('notice', { message: 'Cevap bozuk geldi, yeniden deniyorum…' });
    try {
      this.session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: '[Sistem] Önceki cevabın bozuk geldi. Son isteğe tekrar cevap ver; gerekiyorsa uygun aracı düzgün şekilde çağır.' }] }],
        turnComplete: true
      });
    } catch { /* session closed */ }
  }

  flushUser() {
    if (!this.userText.trim()) return;
    this.emit('user-text', { text: this.userText.trim(), final: true });
    this.userText = '';
  }

  flushModel(interrupted) {
    if (!this.modelText.trim()) return;
    this.emit('model-text', { text: this.modelText.trim(), final: true, interrupted });
    this.modelText = '';
  }

  async runTools(calls) {
    this.flushUser();
    this.thinking = false;
    this.pendingTools += calls.length;
    // In order, one after another: "open Steam" has to finish before "press Yükle" runs.
    const responses = [];
    for (const fc of calls) {
      let result;
      try {
        result = await this.toolRunner(fc.name, fc.args || {}, fc.id);
      } catch (e) {
        result = { ok: false, summary: e.message, model: { ok: false, summary: e.message } };
      } finally {
        this.pendingTools--;
      }
      if (result.vision && this.session) {
        try { this.session.sendRealtimeInput({ video: result.vision }); } catch { /* ignore */ }
      }
      responses.push({ id: fc.id, name: fc.name, response: result.model });
    }
    this.thinking = true;
    try { this.session?.sendToolResponse({ functionResponses: responses }); } catch { /* session closed meanwhile */ }
  }
}

function humanError(msg) {
  if (/api key not valid|API_KEY_INVALID|invalid api key/i.test(msg)) return 'API anahtarı geçersiz. Ayarlar\'dan kontrol et.';
  if (/not found|is not supported|unsupported/i.test(msg)) return `Model bulunamadı ya da Live API desteklemiyor. Ayarlar'dan başka model seç. (${msg})`;
  if (/quota|exhausted|429/i.test(msg)) return 'Gemini kotası doldu. Biraz sonra yeniden dene.';
  if (/permission|403/i.test(msg)) return 'Bu API anahtarının Live API erişimi yok.';
  if (/network|failed to fetch|websocket/i.test(msg)) return 'Gemini\'ye bağlanılamadı. İnternet bağlantını kontrol et.';
  return msg;
}
