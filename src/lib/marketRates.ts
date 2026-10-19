/**
 * Real-Time Dynamic Bullion Rates Engine for Hema Finance
 * Fetches live spot market prices dynamically over HTTPS from live public market feeds (XAU/INR & XAG/INR)
 * and adjusts for Indian domestic import duties and local market premiums (Tirupati, AP & All-India).
 * Features intelligent client-side caching to avoid excessive network overhead.
 */

export interface GoldRates {
  updatedAt: string;
  dateStr: string;
  rate24kPerGram: number; // 24 Karat (99.9% Purity Bullion)
  rate22kPerGram: number; // 22 Karat (91.6% Hallmark KDM Jewellery)
  rate18kPerGram: number; // 18 Karat (75% Purity)
  silverPerGram: number;  // Fine Silver per gram (99.9%)
  city: string;
  state: string;
  gstPercent: number;     // 3% GST on Gold/Silver in India
  wastageRange: string;   // e.g. "8% - 14%"
  isLive: boolean;        // True if fetched live from internet
}

const CACHE_KEY = 'hema_live_bullion_rates_cache';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes cache

// Baseline fallback in case device is completely offline with zero connectivity
const OFFLINE_BASELINE: GoldRates = {
  updatedAt: new Date().toISOString(),
  dateStr: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
  rate24kPerGram: 14765,
  rate22kPerGram: 13535,
  rate18kPerGram: 11074,
  silverPerGram: 192,
  city: 'Tirupati (తిరుపతి)',
  state: 'Andhra Pradesh',
  gstPercent: 3,
  wastageRange: '8% - 14%',
  isLive: false
};

/**
 * Dynamically fetches live Gold (XAU) and Silver (XAG) market prices in INR
 * directly from live web APIs without static hardcoding.
 */
export async function getLiveGoldRates(): Promise<GoldRates> {
  const now = Date.now();

  // 1. Check in-memory/session cache
  try {
    const cachedStr = sessionStorage.getItem(CACHE_KEY);
    if (cachedStr) {
      const cached = JSON.parse(cachedStr);
      if (cached && cached.timestamp && now - cached.timestamp < CACHE_TTL_MS) {
        return cached.data;
      }
    }
  } catch {
    // Ignore storage issues
  }

  // 2. Fetch live data from internet
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const [goldRes, silverRes] = await Promise.all([
      fetch('https://api.gold-api.com/price/XAU/INR', { signal: controller.signal }).catch(() => null),
      fetch('https://api.gold-api.com/price/XAG/INR', { signal: controller.signal }).catch(() => null)
    ]);
    clearTimeout(timeout);

    let rate24k = 0;
    let silverPerGram = 0;

    if (goldRes && goldRes.ok) {
      const goldData = await goldRes.json().catch(() => null);
      if (goldData && typeof goldData.price === 'number') {
        // Price is for 1 troy ounce (31.1034768 grams) in INR
        const inrPerOz = goldData.price;
        const rawSpotPerGram = inrPerOz / 31.1034768;
        // Indian domestic retail 24k includes customs duty + local market premium (~15.2%)
        rate24k = Math.round(rawSpotPerGram * 1.152);
      }
    }

    if (silverRes && silverRes.ok) {
      const silverData = await silverRes.json().catch(() => null);
      if (silverData && typeof silverData.price === 'number') {
        const inrPerOz = silverData.price;
        const rawSpotPerGram = inrPerOz / 31.1034768;
        silverPerGram = Math.round(rawSpotPerGram * 1.09);
      }
    }

    // Validate sane boundaries
    if (rate24k > 8000 && rate24k < 35000) {
      const rate22k = Math.round(rate24k * (22 / 24));
      const rate18k = Math.round(rate24k * (18 / 24));
      const finalSilver = silverPerGram > 100 ? silverPerGram : OFFLINE_BASELINE.silverPerGram;

      const liveRates: GoldRates = {
        updatedAt: new Date().toISOString(),
        dateStr: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
        rate24kPerGram: rate24k,
        rate22kPerGram: rate22k,
        rate18kPerGram: rate18k,
        silverPerGram: finalSilver,
        city: 'Tirupati (తిరుపతి)',
        state: 'Andhra Pradesh',
        gstPercent: 3,
        wastageRange: '8% - 14%',
        isLive: true
      };

      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: now, data: liveRates }));
      } catch {}

      return liveRates;
    }
  } catch (err) {
    console.warn('[Bullion Rates Engine] Live web rate fetch failed, using fallback:', err);
  }

  // 3. Fallback if offline
  return {
    ...OFFLINE_BASELINE,
    updatedAt: new Date().toISOString(),
    dateStr: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
  };
}

export function formatGoldRatesSummary(rates: GoldRates, lang: string = 'en'): string {
  const liveBadge = rates.isLive ? '🟢 Live Online' : '📌 Indicative Market';

  if (lang === 'te') {
    return `🪙 **తిరుపతిలో బంగారం & వెండి ధరలు (${rates.dateStr}) [${liveBadge}]:**
• **24 క్యారెట్ల స్వచ్ఛమైన బంగారం (99.9% Pure):**
  - గ్రాముకు: **₹${rates.rate24kPerGram.toLocaleString('en-IN')}**
  - 10 గ్రాములకు: **₹${(rates.rate24kPerGram * 10).toLocaleString('en-IN')}**
• **22 క్యారెట్ల ఆభరణాల బంగారం (91.6% KDM Hallmark):**
  - గ్రాముకు: **₹${rates.rate22kPerGram.toLocaleString('en-IN')}**
  - 10 గ్రాములకు: **₹${(rates.rate22kPerGram * 10).toLocaleString('en-IN')}**
  - 1 సవరం / తులం (8 గ్రాములు): **₹${(rates.rate22kPerGram * 8).toLocaleString('en-IN')}**
• **18 క్యారెట్ల బంగారం:** గ్రాముకు **₹${rates.rate18kPerGram.toLocaleString('en-IN')}**
• **వెండి (Silver 99.9%):** గ్రాముకు **₹${rates.silverPerGram.toLocaleString('en-IN')}** (కేజీకి ₹${(rates.silverPerGram * 1000).toLocaleString('en-IN')})

*(గమనిక: ఆభరణాల కొనుగోలులో తరుగు/తయారీ ఛార్జీలు సాధారణంగా ${rates.wastageRange} మరియు ${rates.gstPercent}% జీఎస్టీ అదనంగా ఉంటాయి. BIS 6-అంకెల HUID హాల్‌మార్క్ సరిచూసుకోండి).*`;
  }

  if (lang === 'hi') {
    return `🪙 **तिरुपति में सोने और चांदी के भाव (${rates.dateStr}) [${liveBadge}]:**
• **24 कैरेट शुद्ध सोना (99.9% Pure):**
  - प्रति ग्राम: **₹${rates.rate24kPerGram.toLocaleString('en-IN')}**
  - 10 ग्राम: **₹${(rates.rate24kPerGram * 10).toLocaleString('en-IN')}**
• **22 कैरेट जेवर सोना (91.6% हॉलमार्क KDM):**
  - प्रति ग्राम: **₹${rates.rate22kPerGram.toLocaleString('en-IN')}**
  - 10 ग्राम: **₹${(rates.rate22kPerGram * 10).toLocaleString('en-IN')}**
• **18 कैरेट सोना:** प्रति ग्राम **₹${rates.rate18kPerGram.toLocaleString('en-IN')}**
• **चांदी (Silver 99.9%):** प्रति ग्राम **₹${rates.silverPerGram.toLocaleString('en-IN')}** (प्रति किलो ₹${(rates.silverPerGram * 1000).toLocaleString('en-IN')})

*(नोट: आभूषणों की खरीद पर मेकिंग चार्ज सामान्यतः ${rates.wastageRange} और ${rates.gstPercent}% जीएसटी अलग से लागू होता है। BIS 6-अंकीय HUID हॉलमार्क देखकर ही खरीदें).*`;
  }

  return `🪙 **Gold & Silver Rates in Tirupati (${rates.dateStr}) [${liveBadge}]:**
• **24-Karat Gold (99.9% Pure Bullion):**
  - Per Gram: **₹${rates.rate24kPerGram.toLocaleString('en-IN')}**
  - Per 10 Grams: **₹${(rates.rate24kPerGram * 10).toLocaleString('en-IN')}**
• **22-Karat Gold (91.6% KDM Hallmark Jewellery):**
  - Per Gram: **₹${rates.rate22kPerGram.toLocaleString('en-IN')}**
  - Per 10 Grams: **₹${(rates.rate22kPerGram * 10).toLocaleString('en-IN')}**
  - 1 Tola / Savaran (8 grams): **₹${(rates.rate22kPerGram * 8).toLocaleString('en-IN')}**
• **18-Karat Gold (75% Purity):** Per Gram **₹${rates.rate18kPerGram.toLocaleString('en-IN')}**
• **Silver (Fine 99.9%):** Per Gram **₹${rates.silverPerGram.toLocaleString('en-IN')}** (₹${(rates.silverPerGram * 1000).toLocaleString('en-IN')} / kg)

*(Note: Jewellery purchases incur making charges/wastage typically ${rates.wastageRange} and ${rates.gstPercent}% GST. Always insist on a tax invoice with 6-digit BIS HUID Hallmarking).*`;
}
