// ─── Matrix Rain ─────────────────────────────────────
const canvas = document.getElementById('matrix-bg');
const ctx = canvas.getContext('2d');
let cols, drops;
function initMatrix() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; cols = Math.floor(canvas.width / 18); drops = Array(cols).fill(1); }
function drawMatrix() { ctx.fillStyle = 'rgba(7,8,15,0.05)'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#6366f1'; ctx.font = '14px JetBrains Mono,monospace'; drops.forEach((y, i) => { const ch = Math.random() > 0.5 ? '1' : '0'; ctx.fillText(ch, i * 18, y * 18); if (y * 18 > canvas.height && Math.random() > 0.975) drops[i] = 0; drops[i]++; }); }
initMatrix(); setInterval(drawMatrix, 60); window.addEventListener('resize', initMatrix);

// ─── State ────────────────────────────────────────────
function switchTab(tab) {
  document.getElementById('encodePanel').style.display = tab === 'encode' ? 'block' : 'none';
  document.getElementById('decodePanel').style.display = tab === 'decode' ? 'block' : 'none';
  document.getElementById('tab-encode').classList.toggle('active', tab === 'encode');
  document.getElementById('tab-decode').classList.toggle('active', tab === 'decode');
}

function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ─── Base 32/64 Custom Alphabets ──────────────────────
const BASE32_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BASE64_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bigIntToBase(num, base) {
  if (num === 0n) {
      if (base === 32768) return String.fromCharCode(256);
      return base <= 36 ? '0' : (base === 32 ? BASE32_ALPHA[0] : BASE64_ALPHA[0]);
  }
  if (base <= 36) return num.toString(base);
  
  const alpha = base === 32 ? BASE32_ALPHA : BASE64_ALPHA;
  let n = num;
  let res = '';
  const b = BigInt(base);
  while (n > 0n) {
      const rem = Number(n % b);
      if (base === 32768) {
          res = String.fromCharCode(rem + 256) + res;
      } else {
          res = alpha[rem] + res;
      }
      n = n / b;
  }
  return res;
}

function baseToBigInt(str, base) {
  if (base === 16) return BigInt('0x' + str);
  if (base === 8) return BigInt('0o' + str);
  if (base === 2) return BigInt('0b' + str);
  
  const alpha = base === 32 ? BASE32_ALPHA : BASE64_ALPHA;
  let result = 0n;
  const b = BigInt(base);
  const chars = (base <= 36) ? str.toLowerCase() : str;
  
  for (const ch of chars.split('')) {
      let idx;
      if (base === 32768) {
           idx = ch.charCodeAt(0) - 256;
           if (idx < 0 || idx >= 32768) return null;
      } else if (base <= 36) {
           idx = parseInt(ch, base);
           if (isNaN(idx)) return null;
      } else {
           idx = alpha.indexOf(ch);
           if (idx === -1) return null;
      }
      result = result * b + BigInt(idx);
  }
  return result;
}

// ─── Encode/Decode (AES-GCM-256) ──────────────────────
async function getAesKey(password) {
  const pwBytes = new TextEncoder().encode(password || ' ');
  const hashBuffer = await crypto.subtle.digest('SHA-256', pwBytes);
  return crypto.subtle.importKey('raw', hashBuffer, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encodeText(text, keyStr, base) {
  if (!text) return '';
  // 1. Compress string to raw bytes
  const bytes = LZString.compressToUint8Array(text);
  if (!bytes) return '?';
  
  try {
    const key = await getAesKey(keyStr);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    const encryptedBytes = new Uint8Array(encryptedBuffer);
    
    const combined = new Uint8Array(12 + encryptedBytes.length);
    combined.set(iv, 0);
    combined.set(encryptedBytes, 12);
    
    let hexStr = '1';
    for (let i = 0; i < combined.length; i++) {
      hexStr += combined[i].toString(16).padStart(2, '0');
    }
    
    const bigNum = BigInt('0x' + hexStr);
    return bigIntToBase(bigNum, base);
  } catch (e) {
    return '?';
  }
}

async function decodeText(encoded, keyStr, base) {
  if (!encoded) return '';
  try {
    const bigNum = baseToBigInt(encoded, base);
    if (bigNum === null) return '?';
    
    let hexStr = bigNum.toString(16);
    if (!hexStr.startsWith('1')) return '?';
    hexStr = hexStr.slice(1);
    if (hexStr.length % 2 !== 0) return '?';
    
    const combined = new Uint8Array(hexStr.length / 2);
    for (let i = 0; i < combined.length; i++) {
      combined[i] = parseInt(hexStr.slice(i * 2, i * 2 + 2), 16);
    }
    
    if (combined.length < 28) return '?'; // IV (12) + Tag (16)
    
    const iv = combined.slice(0, 12);
    const encryptedBytes = combined.slice(12);
    const key = await getAesKey(keyStr);
    
    const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encryptedBytes);
    const decodedText = LZString.decompressFromUint8Array(new Uint8Array(decryptedBuffer));
    return decodedText || '?';
  } catch (e) {
    return '?';
  }
}

// ─── Live ─────────────────────────────────────────────
let encodeSeq = 0, decodeSeq = 0;

async function liveEncode() {
  const text = document.getElementById('inputText').value;
  if (!text) { setOutput('encodedOutput', '', false); document.getElementById('encodeStats').innerHTML = ''; return; }
  const base = parseInt(document.getElementById('baseSelect').value);
  const key = document.getElementById('ruleKey').value;
  const seq = ++encodeSeq;
  
  const result = await encodeText(text, key, base); 
  if (seq !== encodeSeq) return;
  
  setOutput('encodedOutput', result, true);
  document.getElementById('encodeStats').innerHTML = `<div class="stat-chip"><div class="stat-dot"></div>Input:<strong>${text.length} chars</strong></div><div class="stat-chip"><div class="stat-dot cyan"></div>Output:<strong>${result.length} chars</strong></div><div class="stat-chip"><div class="stat-dot green"></div>Base:<strong>${base}</strong></div>`;
}

async function liveDecode() {
  const text = document.getElementById('decodeInput').value;
  if (!text) { setOutput('decodedOutput', '', false); document.getElementById('decodeStats').innerHTML = ''; return; }
  const base = parseInt(document.getElementById('baseSelect').value);
  const key = document.getElementById('ruleKey').value;
  const seq = ++decodeSeq;
  
  const result = await decodeText(text.trim(), key, base); 
  if (seq !== decodeSeq) return;
  
  setOutput('decodedOutput', result, true, 'var(--success)');
  document.getElementById('decodeStats').innerHTML = `<div class="stat-chip"><div class="stat-dot green"></div>Decoded:<strong>${result.length} chars</strong></div>`;
}

function doEncode() { liveEncode().then(() => { const o = document.getElementById('encodedOutput'); o.classList.add('blink-in', 'output-glow'); setTimeout(() => o.classList.remove('blink-in'), 500); setTimeout(() => o.classList.remove('output-glow'), 2000); showToast('✅ Encoded!', 'success'); }); }
function doDecode() { liveDecode().then(() => { document.getElementById('decodedOutput').classList.add('blink-in'); setTimeout(() => document.getElementById('decodedOutput').classList.remove('blink-in'), 500); showToast('🔓 Decoded!', 'success'); }); }
function setOutput(id, html, hasContent, color) {
  const el = document.getElementById(id); if (color) el.style.color = color;
  if (!hasContent || !html) { el.innerHTML = `<span class="output-placeholder">${id === 'encodedOutput' ? 'Your encoded message will appear here...' : 'Decoded text will appear here...'}</span>`; el.classList.remove('has-content'); }
  else { el.textContent = html; el.classList.add('has-content'); }
}

// ─── Utils ────────────────────────────────────────────
function clearAll() { document.getElementById('inputText').value = ''; setOutput('encodedOutput', '', false); document.getElementById('encodeStats').innerHTML = ''; }
function clearDecode() { document.getElementById('decodeInput').value = ''; setOutput('decodedOutput', '', false); document.getElementById('decodeStats').innerHTML = ''; }
function copyOutput(id) { const el = document.getElementById(id); if (el.querySelector('.output-placeholder')) { showToast('⚠️ Nothing to copy!', 'warn'); return; } navigator.clipboard.writeText(el.textContent).then(() => showToast('📋 Copied!', 'success')); }
function copyKey() { navigator.clipboard.writeText(document.getElementById('ruleKey').value).then(() => showToast('🔑 Key copied!', 'success')); }
function generateKey() { const w = ['NOVA', 'CIPHER', 'SHADOW', 'NEXUS', 'GHOST', 'PRISM', 'ECHO', 'VAULT', 'FORGE', 'PULSE']; document.getElementById('ruleKey').value = w[Math.floor(Math.random() * w.length)] + '-' + w[Math.floor(Math.random() * w.length)] + '-' + (Math.floor(Math.random() * 9000) + 1000); showToast('🎲 New key generated!', 'info'); }

// ─── Toast ────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'info') { const t = document.getElementById('toast'); t.textContent = msg; t.className = 'show ' + type; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2500); }

// ─── QR Code Generation ─────────────────────────────
function generateQR() {
  const encoded = document.getElementById('encodedOutput').textContent;
  if (!encoded || document.getElementById('encodedOutput').querySelector('.output-placeholder')) {
    showToast('⚠️ Encode a message first!', 'warn'); return;
  }
  if (encoded.length > 2000) {
    showToast('⚠️ Encoded text too long for QR (try shorter text or Base 64)', 'warn'); return;
  }
  const qrCanvas = document.getElementById('qrCanvas');
  const ctx2 = qrCanvas.getContext('2d');
  ctx2.clearRect(0, 0, 240, 240);
  try {
    QRCode.toCanvas(qrCanvas, encoded, {
      width: 240, margin: 2,
      color: { dark: '#a78bfa', light: '#07080f' }
    }, err => {
      if (err) { showToast('❌ QR error: ' + err.message, 'warn'); return; }
      document.getElementById('qrModalOverlay').classList.add('open');
    });
  } catch(e) { showToast('❌ Could not generate QR', 'warn'); }
}
function closeQRModal(e) {
  if (e.target === document.getElementById('qrModalOverlay'))
    document.getElementById('qrModalOverlay').classList.remove('open');
}
function downloadQR() {
  const c = document.getElementById('qrCanvas');
  const a = document.createElement('a');
  a.download = 'cipherforge-qr.png'; a.href = c.toDataURL(); a.click();
}

// ─── Listeners ────────────────────────────────────────
document.getElementById('baseSelect').addEventListener('change', () => { liveEncode(); liveDecode(); });
